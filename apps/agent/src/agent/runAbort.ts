const TIMEOUT_MESSAGE = 'Trip planning took too long, resume to continue';
export const SHUTDOWN_MESSAGE = 'Server restarting, resume to continue';
export const CANCEL_MESSAGE = 'Run stopped';

/** Abort reason that carries the user-facing message for the failed `RESULT`. */
export class RunAbortError extends Error {
  override readonly name = 'RunAbortError';
}

/** The message for an aborted signal; `undefined` when it was not aborted. */
export function abortMessage(signal: AbortSignal | undefined): string | undefined {
  if (!signal?.aborted) return undefined;
  const reason: unknown = signal.reason;
  if (reason instanceof RunAbortError) return reason.message;
  if (reason instanceof Error && reason.name === 'TimeoutError') return TIMEOUT_MESSAGE;
  return undefined;
}
