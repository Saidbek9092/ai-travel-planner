import { AsyncLocalStorage } from 'node:async_hooks';

/** What one run spent. Filled by the LLM factory and the search tools through the run's async context. */
export interface RunMetrics {
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Models that answered, with their call counts. */
  models: Record<string, number>;
  /** Calls where the model that answered was not the first one tried. */
  llmFallbacks: number;
  /** Requests that really went to SerpAPI (cache hits are not counted). */
  searchCalls: number;
  searchCacheHits: number;
}

const storage = new AsyncLocalStorage<RunMetrics>();

export const createRunMetrics = (): RunMetrics => ({
  llmCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  models: {},
  llmFallbacks: 0,
  searchCalls: 0,
  searchCacheHits: 0,
});

/** Runs `fn` with `metrics` as the current run's collector. */
export const withRunMetrics = <T>(metrics: RunMetrics, fn: () => T): T => storage.run(metrics, fn);

/** Mutates the current run's metrics; a no-op outside a run. */
export function recordMetric(update: (metrics: RunMetrics) => void): void {
  const metrics = storage.getStore();
  if (metrics) update(metrics);
}
