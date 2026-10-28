'use client';

import { useCallback, useSyncExternalStore } from 'react';

export interface TripHistoryEntry {
  threadId: string;
  title: string;
  /** Epoch ms. */
  createdAt: number;
}

const KEY = 'ai-travel:trips';
const MAX_ENTRIES = 20;
const EMPTY: TripHistoryEntry[] = [];
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedList: TripHistoryEntry[] = EMPTY;

function read(): TripHistoryEntry[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedList = Array.isArray(parsed)
      ? parsed.filter(
          (e): e is TripHistoryEntry =>
            typeof e?.threadId === 'string' && typeof e?.title === 'string' && typeof e?.createdAt === 'number',
        )
      : EMPTY;
  } catch {
    cachedList = EMPTY;
  }
  return cachedList;
}

function write(list: TripHistoryEntry[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the list is a convenience, not a source of truth.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => event.key === KEY && onChange();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** "My trips": the newest 20 finished trips in `localStorage`, newest first. No accounts in v1. */
export function useTripHistory() {
  const trips = useSyncExternalStore(subscribe, read, () => EMPTY);

  const add = useCallback((entry: TripHistoryEntry) => {
    const rest = read().filter((e) => e.threadId !== entry.threadId);
    write([entry, ...rest].slice(0, MAX_ENTRIES));
  }, []);

  const remove = useCallback((threadId: string) => {
    write(read().filter((e) => e.threadId !== threadId));
  }, []);

  return { trips, add, remove };
}
