import { useCallback, useSyncExternalStore } from 'react';

/**
 * The current time in ms, refreshed every `intervalMs` while `active`; `0` on the server so hydration matches.
 * Stays frozen while inactive, so idle screens don't re-render.
 */
export function useNow(intervalMs: number, active = true): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active) return () => undefined;
      const timer = setInterval(onChange, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs, active],
  );
  const snapshot = useCallback(() => Math.floor(Date.now() / intervalMs) * intervalMs, [intervalMs]);
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
