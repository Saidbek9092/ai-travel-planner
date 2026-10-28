'use client';

import { PlacesResponseSchema, type PlaceSuggestion } from '@ai-travel/contracts';
import { useEffect, useState } from 'react';
import { env } from '@/lib/env';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

/** Suggestions per normalised query for the page's lifetime. */
const cache = new Map<string, PlaceSuggestion[]>();

/** City / country suggestions for `query`, from the agent. Failures are silent: the field just stays free text. */
export function usePlaceSearch(query: string) {
  const text = query.trim();
  const key = text.toLowerCase();
  const enabled = env.agentUrl !== null && text.length >= MIN_CHARS;
  const [fetched, setFetched] = useState<{ key: string; places: PlaceSuggestion[] } | null>(null);

  useEffect(() => {
    if (!enabled || env.agentUrl === null || cache.has(key)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${env.agentUrl}/api/places?${new URLSearchParams({ q: text })}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((json) => {
          const { places } = PlacesResponseSchema.parse(json);
          cache.set(key, places);
          setFetched({ key, places });
        })
        .catch(() => {
          if (!controller.signal.aborted) setFetched({ key, places: [] });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, key, text]);

  if (!enabled) return { places: [] as PlaceSuggestion[], loading: false };
  const places = cache.get(key) ?? (fetched?.key === key ? fetched.places : null);
  return { places: places ?? [], loading: places === null };
}
