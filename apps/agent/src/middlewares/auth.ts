import type { AuthUser } from '@ai-travel/contracts';
import type { RequestHandler, Response } from 'express';
import { verifySession } from '../auth/session.js';
import type { Config } from '../config.js';
import { AppError } from '../utils/errors.js';

const BEARER = /^Bearer (\S+)$/;

/**
 * Reads `Authorization: Bearer <session token>` into `res.locals.user`. No header = a guest (the request goes on);
 * a header that does not verify is `401`, so the browser drops a stale session instead of silently acting as a guest.
 */
export function identify(config: Pick<Config, 'SESSION_SECRET'>): RequestHandler {
  return (req, res, next) => {
    const header = req.get('Authorization');
    if (header === undefined) return next();
    const token = BEARER.exec(header)?.[1];
    const user = token !== undefined && config.SESSION_SECRET !== undefined ? verifySession(token, config.SESSION_SECRET) : null;
    if (user === null) return next(new AppError('UNAUTHORIZED', 'Your sign-in expired. Sign in again.', 401));
    res.locals['user'] = user;
    next();
  };
}

/** The signed-in user of this request, or `null` for a guest. */
export const userOf = (res: Response): AuthUser | null => (res.locals['user'] as AuthUser | undefined) ?? null;

/**
 * Runs cost money, so with sign-in configured (`GOOGLE_CLIENT_ID` + `SESSION_SECRET`) only a signed-in account may start one.
 * Without it (local development, tests) guests stay allowed, as there is no way to sign in.
 */
export function requireSignIn(config: Pick<Config, 'GOOGLE_CLIENT_ID' | 'SESSION_SECRET'>): RequestHandler {
  const enabled = config.GOOGLE_CLIENT_ID !== undefined && config.SESSION_SECRET !== undefined;
  return (_req, res, next) => {
    if (!enabled || userOf(res) !== null) return next();
    next(new AppError('UNAUTHORIZED', 'Sign in with Google to plan a trip.', 401));
  };
}
