import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseMessageLike } from '@langchain/core/messages';
import type { z } from 'zod';
import type { Config } from '../config.js';
import { recordMetric } from '../utils/runMetrics.js';

export interface StructuredResult<T> {
  data: T;
  /** The model that answered; differs from `LlmFactory.primaryModel` when the fallback was used. */
  model: string;
}

export interface StructuredModel<T> {
  invoke(messages: BaseMessageLike[], signal?: AbortSignal): Promise<StructuredResult<T>>;
}

/** `fast` tries the fallback-tier model first (cheaper, quicker) and the primary model second. */
export type ModelTier = 'primary' | 'fast';

export interface LlmFactory {
  readonly primaryModel: string;
  /** The model a `fast` call tries first. */
  readonly fastModel: string;
  /**
   * Structured-output model for `schema`. Every field must be present in the schema
   * (use `nullable()`, never `optional()`).
   */
  structured<S extends z.ZodType>(schema: S, name: string, tier?: ModelTier): StructuredModel<z.infer<S>>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

/**
 * The only place that builds `ChatAnthropic`. No `temperature` / `top_p` / `top_k`: Claude Opus 5.5 and
 * Sonnet 5.5 reject non-default sampling values.
 */
export function createLlmFactory(config: Pick<Config, 'ANTHROPIC_API_KEY' | 'ANTHROPIC_MODEL' | 'ANTHROPIC_FALLBACK_MODEL'>): LlmFactory {
  const build = (model: string) =>
    new ChatAnthropic({ model, apiKey: config.ANTHROPIC_API_KEY, maxRetries: MAX_RETRIES, clientOptions: { timeout: REQUEST_TIMEOUT_MS } });

  const primary = build(config.ANTHROPIC_MODEL);
  const fallback = build(config.ANTHROPIC_FALLBACK_MODEL);

  return {
    primaryModel: config.ANTHROPIC_MODEL,
    fastModel: config.ANTHROPIC_FALLBACK_MODEL,
    structured<S extends z.ZodType>(schema: S, name: string, tier: ModelTier = 'primary'): StructuredModel<z.infer<S>> {
      const first = { model: config.ANTHROPIC_MODEL, runnable: primary.withStructuredOutput(schema as never, { name, method: 'jsonSchema' }) };
      const second = { model: config.ANTHROPIC_FALLBACK_MODEL, runnable: fallback.withStructuredOutput(schema as never, { name, method: 'jsonSchema' }) };
      const runners = tier === 'fast' ? [second, first] : [first, second];

      return {
        async invoke(messages, signal) {
          let lastError: unknown;
          for (const [index, { model, runnable }] of runners.entries()) {
            try {
              const raw: unknown = await runnable.invoke(messages, {
                callbacks: [{ handleLLMEnd: (output) => recordUsage(output, model, index > 0) }],
                ...(signal && { signal }),
              });
              return { data: schema.parse(raw) as z.infer<S>, model };
            } catch (error) {
              if (signal?.aborted) throw error;
              lastError = error;
            }
          }
          throw lastError;
        },
      };
    },
  };
}

interface UsageOutput {
  generations?: { message?: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } }[][];
}

/** Adds one finished model call to the current run's metrics. */
function recordUsage(output: unknown, model: string, fellBack: boolean): void {
  const usage = (output as UsageOutput).generations?.[0]?.[0]?.message?.usage_metadata;
  recordMetric((metrics) => {
    metrics.llmCalls += 1;
    metrics.inputTokens += usage?.input_tokens ?? 0;
    metrics.outputTokens += usage?.output_tokens ?? 0;
    metrics.models[model] = (metrics.models[model] ?? 0) + 1;
    if (fellBack) metrics.llmFallbacks += 1;
  });
}
