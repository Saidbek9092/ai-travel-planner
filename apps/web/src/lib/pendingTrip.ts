import { TripRequestSchema, type TripRequest } from '@ai-travel/contracts';

/**
 * A trip the person asked for while signed out. On phones Google sign-in leaves the page and comes back, so the
 * request waits in `sessionStorage` and starts once they are signed in. Browser only.
 */
const PENDING_KEY = 'ai-travel:pending-trip';
const RETURN_KEY = 'ai-travel:return-to';
/** A waiting trip older than this is forgotten, so an abandoned sign-in cannot start a trip much later. */
const PENDING_TTL_MS = 10 * 60_000;

export function savePendingTrip(request: TripRequest) {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ request, at: Date.now() }));
  } catch {
    // Storage blocked: the trip is lost on a redirect, which only costs retyping it.
  }
}

/** Reads and forgets the waiting trip. */
export function takePendingTrip(): TripRequest | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    const stored = raw ? (JSON.parse(raw) as { request?: unknown; at?: unknown }) : null;
    if (!stored || typeof stored.at !== 'number' || Date.now() - stored.at > PENDING_TTL_MS) return null;
    const parsed = TripRequestSchema.safeParse(stored.request);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearPendingTrip() {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing stored.
  }
}

/** The page to come back to after Google sign-in (written as the page unloads). */
export function saveReturnPath() {
  try {
    window.sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search);
  } catch {
    // Storage blocked: the person lands on the start page.
  }
}

/** Reads and forgets the return path; only a same-site path is accepted. */
export function takeReturnPath(): string {
  try {
    const path = window.sessionStorage.getItem(RETURN_KEY);
    window.sessionStorage.removeItem(RETURN_KEY);
    return path && path.startsWith('/') && !path.startsWith('//') ? path : '/';
  } catch {
    return '/';
  }
}
