import { OWNER_ID_HEADER, OwnerIdSchema } from '@ai-travel/contracts';

/**
 * Anonymous owner id for "My trips" (no accounts). A first-party cookie on the web domain, sent to the agent as the
 * `X-Owner-Id` header; the agent and web live on different sites, so an agent cookie would be blocked as third-party.
 * Whoever has the id sees its trips, so it is shared only on purpose ("Open on another device").
 */
const COOKIE = 'ai-travel-owner';
/** Browsers cap cookie lifetimes at 400 days. */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function readCookie(): string | null {
  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const parsed = OwnerIdSchema.safeParse(raw ? decodeURIComponent(raw) : undefined);
  return parsed.success ? parsed.data : null;
}

function writeCookie(id: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${encodeURIComponent(id)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

/** This browser's owner id, created on first use. Browser only. */
export function ownerId(): string {
  const existing = readCookie();
  if (existing) return existing;
  const id = crypto.randomUUID();
  writeCookie(id);
  return id;
}

/** Adopts an id from an "Open on another device" link; `false` when it is not a valid id. */
export function adoptOwnerId(raw: string): boolean {
  const parsed = OwnerIdSchema.safeParse(raw);
  if (!parsed.success) return false;
  writeCookie(parsed.data);
  return true;
}

/** Header for agent calls that create or list trips. */
export function ownerHeaders(): Record<string, string> {
  return { [OWNER_ID_HEADER]: ownerId() };
}
