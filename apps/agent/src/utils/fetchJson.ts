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
 */
export async function fetchJson(fetchImpl: typeof fetch, url: string, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(TIMEOUT_MS)]),
      });
      if (!response.ok) throw new HttpError(response.status);
      return await response.json();
    } catch (error) {
      const transient = !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
      if (attempt > 0 || signal?.aborted || !transient) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
