import { GoogleLoginRequestSchema, type GoogleLoginResponse } from '@ai-travel/contracts';
import { Router } from 'express';
import { verifyGoogleCredential } from '../auth/google.js';
import { signSession } from '../auth/session.js';
import type { Config } from '../config.js';
import { AppError, notFound, validationError } from '../utils/errors.js';

export interface AuthRouterDeps {
  config: Config;
  fetch: typeof fetch;
}

/** `POST /api/auth/google`: trades a Google ID token for the agent's own session token. */
export function createAuthRouter({ config, fetch: fetchImpl }: AuthRouterDeps): Router {
  const router = Router();

  router.post('/auth/google', async (req, res) => {
    const { GOOGLE_CLIENT_ID: clientId, SESSION_SECRET: secret } = config;
    if (clientId === undefined || secret === undefined) throw notFound('Sign-in is not set up on this server');

    const parsed = GoogleLoginRequestSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const user = await verifyGoogleCredential(parsed.data.credential, clientId, fetchImpl).catch(() => {
      throw new AppError('INTERNAL', 'Google sign-in is unavailable right now. Try again.', 502);
    });
    if (user === null) throw new AppError('UNAUTHORIZED', 'Google did not accept that sign-in. Try again.', 401);

    const body: GoogleLoginResponse = { ...signSession(user, secret), user };
    res.json(body);
  });

  return router;
}
