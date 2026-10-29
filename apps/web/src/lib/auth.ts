import {
  ClaimTripsResponseSchema,
  GoogleLoginResponseSchema,
  OWNER_ID_HEADER,
  type AuthUser,
} from '@ai-travel/contracts';
import { env } from '@/lib/env';
import { ownerId } from '@/lib/owner';

/**
 * No React and no `'use client'` here: `fetchStoredTrip` runs on the server too, where this must be callable (and answer "guest").
 *
 * The signed-in account. The agent trades the Google ID token for its own session token (30 days); that token lives in
 * `localStorage` and goes to the agent as `Authorization: Bearer`. The agent and web are different sites, so an agent
 * cookie would be blocked as third-party. Everything here is the browser's copy: the agent checks the token on each call.
 */
export interface Session {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
  user: AuthUser;
}

const KEY = 'ai-travel:session';
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSession: Session | null = null;

/** The stored session, or `null` when there is none or it has expired. Server: always `null`. */
export function readSession(): Session | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed = raw ? (JSON.parse(raw) as Partial<Session>) : null;
      cachedSession =
        parsed && typeof parsed.token === 'string' && typeof parsed.expiresAt === 'number' && typeof parsed.user?.id === 'string'
          ? (parsed as Session)
          : null;
    } catch {
      cachedSession = null;
    }
  }
  return cachedSession && cachedSession.expiresAt > Date.now() ? cachedSession : null;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function writeSession(session: Session | null) {
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the person stays signed out.
  }
  notify();
}

/** For `useSession`. */
export function subscribeToSession(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => event.key === KEY && onChange();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** `Authorization` for agent calls that depend on who is asking; empty for a guest. */
export function authHeaders(): Record<string, string> {
  const session = readSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

export function signOut() {
  writeSession(null);
}

/** The agent said the token is no good (`401`): forget it so the next call is a plain guest call. */
export function dropSessionIf401(response: Response) {
  if (response.status === 401 && readSession()) signOut();
}

export type SignInResult = { ok: true; user: AuthUser; claimed: number } | { ok: false; message: string };

/** Trades a Google credential for a session, then moves this browser's guest trips to the account. */
export async function signInWithGoogle(credential: string): Promise<SignInResult> {
  if (env.agentUrl === null) return { ok: false, message: 'The planning agent is not connected.' };
  try {
    const response = await fetch(`${env.agentUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: body?.error?.message ?? 'Sign-in failed. Try again.' };
    }
    const login = GoogleLoginResponseSchema.parse(await response.json());
    writeSession({ token: login.token, expiresAt: Date.parse(login.expiresAt), user: login.user });

    let claimed = 0;
    try {
      const claim = await fetch(`${env.agentUrl}/api/trips/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${login.token}`, [OWNER_ID_HEADER]: ownerId() },
      });
      if (claim.ok) claimed = ClaimTripsResponseSchema.parse(await claim.json()).claimed;
    } catch {
      // Signed in all the same; the guest trips stay on this browser and are claimed next time.
    }
    return { ok: true, user: login.user, claimed };
  } catch {
    return { ok: false, message: 'Could not reach the planning agent. Check your connection and try again.' };
  }
}
