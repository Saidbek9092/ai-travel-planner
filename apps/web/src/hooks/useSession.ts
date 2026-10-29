'use client';

import { useSyncExternalStore } from 'react';
import { readSession, subscribeToSession, type Session } from '@/lib/auth';

/** The signed-in account; `null` on the server, before hydration, and when signed out. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribeToSession, readSession, () => null);
}
