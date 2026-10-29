import { assertProviderUp, markProviderDown, markProviderUp } from './circuitBreaker.js';

const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 300;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * GET → parsed JSON with a 5 s timeout and one retry on network errors, 429 and 5xx.
 * Other 4xx answers throw immediately. The caller decides what a failure means.
 * A host that still fails after the retry is treated as down for 60 s: calls in that window throw at once.
 */
export async function fetchJson(fetchImpl: typeof fetch, url: string, signal?: AbortSignal): Promise<unknown> {
  const host = new URL(url).host;
  assertProviderUp(host);
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(TIMEOUT_MS)]),
      });
      if (!response.ok) throw new HttpError(response.status);
      const body: unknown = await response.json();
      markProviderUp(host);
      return body;
    } catch (error) {
      const transient = !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
      if (attempt > 0 || signal?.aborted || !transient) {
        // A caller's own abort says nothing about the provider.
        if (transient && !signal?.aborted) markProviderDown(host);
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
