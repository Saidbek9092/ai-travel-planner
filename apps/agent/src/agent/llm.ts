import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseMessageLike } from '@langchain/core/messages';
import type { z } from 'zod';
import type { Config } from '../config.js';

export interface StructuredResult<T> {
  data: T;
  /** The model that answered; differs from `LlmFactory.primaryModel` when the fallback was used. */
  model: string;
}

export interface StructuredModel<T> {
  invoke(messages: BaseMessageLike[], signal?: AbortSignal): Promise<StructuredResult<T>>;
}

export interface LlmFactory {
  readonly primaryModel: string;
  /**
   * Structured-output model for `schema`. Every field must be present in the schema
   * (use `nullable()`, never `optional()`).
   */
  structured<S extends z.ZodType>(schema: S, name: string): StructuredModel<z.infer<S>>;
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
    structured<S extends z.ZodType>(schema: S, name: string): StructuredModel<z.infer<S>> {
      const runners = [
        { model: config.ANTHROPIC_MODEL, runnable: primary.withStructuredOutput(schema as never, { name, method: 'jsonSchema' }) },
        { model: config.ANTHROPIC_FALLBACK_MODEL, runnable: fallback.withStructuredOutput(schema as never, { name, method: 'jsonSchema' }) },
      ];

      return {
        async invoke(messages, signal) {
          let lastError: unknown;
          for (const { model, runnable } of runners) {
            try {
              const raw: unknown = await runnable.invoke(messages, signal ? { signal } : undefined);
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
