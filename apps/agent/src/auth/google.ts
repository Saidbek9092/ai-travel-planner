import type { AuthUser } from '@ai-travel/contracts';
import { z } from 'zod';
import { fetchJson } from '../utils/fetchJson.js';

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const TokenInfoSchema = z.looseObject({
  aud: z.string(),
  iss: z.string(),
  sub: z.string().min(1),
  email: z.string().min(1),
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]),
  exp: z.coerce.number(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

/**
 * Checks a Google ID token ("credential") with Google's own `tokeninfo` endpoint, which verifies the signature.
 * We then check that it was issued for our client id, by Google, to a verified email, and has not expired.
 * Returns `null` for a token that is not acceptable; rejects when Google cannot be reached.
 */
export async function verifyGoogleCredential(
  credential: string,
  clientId: string,
  fetchImpl: typeof fetch,
  now = Date.now(),
): Promise<AuthUser | null> {
  let body: unknown;
  try {
    body = await fetchJson(fetchImpl, `${TOKENINFO_URL}?${new URLSearchParams({ id_token: credential })}`);
  } catch (error) {
    // Google answers 400 for a token it does not accept; that is the user's problem, not an outage.
    if (error instanceof Error && error.message === 'HTTP 400') return null;
    throw error;
  }
  const info = TokenInfoSchema.safeParse(body);
  if (!info.success) return null;
  const { aud, iss, sub, email, email_verified, exp, name, picture } = info.data;
  if (aud !== clientId || !ISSUERS.has(iss) || exp * 1000 <= now) return null;
  if (email_verified !== true && email_verified !== 'true') return null;
  return { id: sub, email, name: name ?? null, picture: picture ?? null };
}
