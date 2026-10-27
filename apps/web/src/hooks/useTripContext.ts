'use client';

import { TripContextSchema, type TripContext } from '@ai-travel/contracts';
import { useEffect, useState } from 'react';
import { env } from '@/lib/env';

export type TripContextStatus = 'idle' | 'loading' | 'ready' | 'error';

interface Lookup {
  key: string | null;
  status: TripContextStatus;
  data: TripContext | null;
}

/** Results per normalised destination + origin for the page's lifetime. */
const cache = new Map<string, TripContext>();

const keyOf = (destination: string, origin: string | null | undefined) =>
  `${destination.trim().toLowerCase()}|${origin?.trim().toLowerCase() ?? ''}`;

/** Weather, rate and zone for the top bar. Failures are silent: `error` just hides the bar. */
export function useTripContext(destination: string | null, origin?: string | null) {
  const dest = destination?.trim() || null;
  const key = dest && env.agentUrl !== null ? keyOf(dest, origin) : null;
  const [lookup, setLookup] = useState<Lookup>({ key: null, status: 'idle', data: null });

  useEffect(() => {
    if (key === null || dest === null || env.agentUrl === null) return;
    if (cache.has(key)) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ destination: dest });
    if (origin?.trim()) params.set('origin', origin.trim());
    fetch(`${env.agentUrl}/api/trip-context?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((json) => {
        const parsed = TripContextSchema.parse(json);
        cache.set(key, parsed);
        setLookup({ key, status: 'ready', data: parsed });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLookup({ key, status: 'error', data: null });
      });
    return () => controller.abort();
  }, [key, dest, origin]);

  // A stale lookup for another destination must not show while the next one loads.
  if (key === null) return { status: 'idle' as const, data: null };
  const cached = cache.get(key);
  if (cached) return { status: 'ready' as const, data: cached };
  if (lookup.key !== key) return { status: 'loading' as const, data: null };
  return { status: lookup.status, data: lookup.data };
}
