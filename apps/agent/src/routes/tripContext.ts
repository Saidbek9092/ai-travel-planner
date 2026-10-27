import { TripContextQuerySchema } from '@ai-travel/contracts';
import { Router } from 'express';
import type { Config } from '../config.js';
import { lookupTripContext } from '../tools/tripContext.js';
import { validationError } from '../utils/errors.js';

export interface TripContextRouterDeps {
  config: Pick<Config, 'TOOLS_MODE'>;
}

/** `GET /api/trip-context`: weather, exchange rate and time zones for the web destination bar. Plain JSON. */
export function createTripContextRouter({ config }: TripContextRouterDeps): Router {
  const router = Router();

  router.get('/trip-context', async (req, res) => {
    const parsed = TripContextQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);

    const context = await lookupTripContext(
      parsed.data,
      { fetch, mode: config.TOOLS_MODE === 'mock' ? 'mock' : 'live', now: () => new Date() },
      AbortSignal.timeout(15_000),
    );
    res.json(context);
  });

  return router;
}
