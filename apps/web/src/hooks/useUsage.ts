'use client';

import type { UsageResponse } from '@ai-travel/contracts';
import { useEffect, useState } from 'react';
import { fetchUsage } from '@/lib/api';

/**
 * The plan allowance ("2 of 3 left"), read from the agent. Asked again whenever `refreshKey` changes (the account, or a
 * run starting or ending), so the number follows what the person just did. `null` while unknown or when `enabled` is off.
 */
export function useUsage(enabled: boolean, refreshKey: string): UsageResponse | null {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchUsage(controller.signal).then((next) => {
      if (!controller.signal.aborted) setUsage(next);
    });
    return () => controller.abort();
  }, [enabled, refreshKey]);
  return enabled ? usage : null;
}
