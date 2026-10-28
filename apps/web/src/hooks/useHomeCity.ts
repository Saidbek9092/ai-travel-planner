'use client';

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'ai-travel:home-city';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
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

/** The traveller's home city, kept in `localStorage` until accounts exist. Empty until they set one. */
export function useHomeCity() {
  const homeCity = useSyncExternalStore(subscribe, read, () => '');
  const setHomeCity = useCallback((city: string) => {
    try {
      window.localStorage.setItem(KEY, city.trim());
    } catch {
      // Blocked storage: the default just won't persist.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return { homeCity, setHomeCity };
}
