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
