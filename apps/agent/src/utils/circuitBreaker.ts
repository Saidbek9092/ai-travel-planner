const OPEN_MS = 60_000;

/** Provider key → time until which it counts as down. In-process, like the rest of the single-instance design. */
const openUntil = new Map<string, number>();

/** The provider failed recently, so the call was refused without trying. */
export class ProviderDownError extends Error {
  override readonly name = 'ProviderDownError';
  constructor(readonly provider: string) {
    super(`${provider} is marked down; skipping the request`);
  }
}

export function isProviderDown(provider: string, now = Date.now()): boolean {
  const until = openUntil.get(provider);
  if (until === undefined) return false;
  if (until > now) return true;
  openUntil.delete(provider);
  return false;
}

/** Throws `ProviderDownError` while the provider's 60 s "down" flag is set. */
export function assertProviderUp(provider: string): void {
  if (isProviderDown(provider)) throw new ProviderDownError(provider);
}

/** Call after a request failed for good (retries used up). The next 60 s of calls fall back at once. */
export function markProviderDown(provider: string, now = Date.now()): void {
  openUntil.set(provider, now + OPEN_MS);
}

/** Call after a request succeeded: the provider is back. */
export function markProviderUp(provider: string): void {
  openUntil.delete(provider);
}
