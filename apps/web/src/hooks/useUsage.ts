'use client';

import type { UsageResponse } from '@ai-travel/contracts';
import { useEffect, useSyncExternalStore } from 'react';
import { useSession } from '@/hooks/useSession';
import { fetchUsage } from '@/lib/api';
import { env } from '@/lib/env';

/** One copy for the whole page: the header pill and the start form show the same number. */
let current: UsageResponse | null = null;
let latest = 0;
const listeners = new Set<() => void>();

function set(next: UsageResponse | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

/** Asks the agent again. Only the newest answer is kept, so a slow older one cannot overwrite it. */
export function refreshUsage() {
  const ticket = ++latest;
  void fetchUsage().then((next) => {
    if (ticket === latest) set(next);
  });
}

function clearUsage() {
  latest += 1;
  set(null);
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
};

/**
 * The plan allowance ("2 of 3 left"). Read again when the account changes; call `refreshUsage()` after a run starts or
 * ends. `null` while unknown, for a guest, and in UI-only mode.
 */
export function useUsage(): UsageResponse | null {
  const session = useSession();
  const accountId = session?.user.id ?? null;
  // A guest has no allowance to show when sign-in is required; without sign-in the browser itself is counted.
  const enabled = env.agentUrl !== null && (accountId !== null || env.googleClientId === null);
  useEffect(() => {
    if (enabled) refreshUsage();
    else clearUsage();
  }, [enabled, accountId]);
  const value = useSyncExternalStore(subscribe, () => current, () => null);
  return enabled ? value : null;
}
