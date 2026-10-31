import type { AuthUser } from '@ai-travel/contracts';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PayloadSchema = z.object({
  sub: z.string().min(1),
  email: z.string(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
  /** Epoch seconds. */
  exp: z.number(),
});

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

const sign = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('base64url');

/** An HS256 token for the user, valid for 30 days. Our own session, so a Google token's one-hour life does not log people out. */
export function signSession(user: AuthUser, secret: string, now = Date.now()): { token: string; expiresAt: string } {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ sub: user.id, email: user.email, name: user.name, picture: user.picture, exp: Math.floor(expiresAt / 1000) }),
  ).toString('base64url');
  const unsigned = `${HEADER}.${payload}`;
  return { token: `${unsigned}.${sign(unsigned, secret)}`, expiresAt: new Date(expiresAt).toISOString() };
}

/** The user in a valid, unexpired token; `null` for anything else (bad shape, bad signature, expired). */
export function verifySession(token: string, secret: string, now = Date.now()): AuthUser | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const [, payload = '', signature = ''] = parts;
  const expected = Buffer.from(sign(`${HEADER}.${payload}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = PayloadSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!parsed.success || parsed.data.exp * 1000 <= now) return null;
    return { id: parsed.data.sub, email: parsed.data.email, name: parsed.data.name, picture: parsed.data.picture };
  } catch {
    return null;
  }
}
