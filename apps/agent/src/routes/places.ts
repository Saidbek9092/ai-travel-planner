import { PlacesQuerySchema } from '@ai-travel/contracts';
import { Router } from 'express';
import type { Config } from '../config.js';
import { mockPlaces, searchPlaces } from '../tools/places.js';
import { validationError } from '../utils/errors.js';

export interface PlacesRouterDeps {
  config: Pick<Config, 'TOOLS_MODE'>;
}

/** `GET /api/places?q=`: city and country suggestions for the web search dropdowns. Plain JSON. */
export function createPlacesRouter({ config }: PlacesRouterDeps): Router {
  const router = Router();

  router.get('/places', async (req, res) => {
    const parsed = PlacesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);

    const places =
      config.TOOLS_MODE === 'mock'
        ? mockPlaces(parsed.data.q)
        : await searchPlaces(parsed.data.q, { fetch }, AbortSignal.timeout(10_000));
    res.json({ places });
  });

  return router;
}
