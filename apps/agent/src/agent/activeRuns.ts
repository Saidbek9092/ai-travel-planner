export const TIMEOUT_MESSAGE = 'Trip planning took too long, resume to continue';
export const SHUTDOWN_MESSAGE = 'Server restarting, resume to continue';

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

/**
 * Runs in flight in this process, so shutdown can abort them. Cancel and reconnect join in B25;
 * a thread can have only one live run, which also guards resume against double starts.
 */
export class ActiveRuns {
  private readonly runs = new Map<string, AbortController>();

  has(threadId: string): boolean {
    return this.runs.has(threadId);
  }

  /** Registers a run and returns its signal: aborted on `abortAll` or after `timeoutMs`. */
  start(threadId: string, timeoutMs: number): AbortSignal {
    const controller = new AbortController();
    this.runs.set(threadId, controller);
    return AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
  }

  finish(threadId: string): void {
    this.runs.delete(threadId);
  }

  abortAll(message = SHUTDOWN_MESSAGE): void {
    for (const controller of this.runs.values()) controller.abort(new RunAbortError(message));
  }

  get size(): number {
    return this.runs.size;
  }
}
