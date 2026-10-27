import { TripRequestSchema } from '@ai-travel/contracts';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Config } from '../config.js';
import type { CompiledTravelGraph } from '../agent/graph.js';
import { runTrip } from '../agent/runTrip.js';
import type { RateLimiters } from '../middlewares/rateLimiter.js';
import { validationError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { SseStreamer } from '../utils/sseStreamer.js';

export interface TripsRouterDeps {
  config: Pick<Config, 'RUN_TIMEOUT_MS'>;
  graph: CompiledTravelGraph;
  logger: Logger;
  runLimiter: RateLimiters['runLimiter'];
}

/** Trip routes. Resume, lookup, reconnect and cancel arrive with B16 and B25. */
export function createTripsRouter({ config, graph, logger, runLimiter }: TripsRouterDeps): Router {
  const router = Router();

  router.post('/trips', runLimiter, async (req, res) => {
    const parsed = TripRequestSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const threadId = randomUUID();
    const streamer = new SseStreamer(res);
    streamer.open(threadId);

    // The run must not die with the connection (a closed streamer just drops packets); only the
    // timeout aborts it. Cancel and shutdown join in B17 / B25.
    await runTrip({
      graph,
      emit: (event) => streamer.send(event),
      threadId,
      request: parsed.data,
      signal: AbortSignal.timeout(config.RUN_TIMEOUT_MS),
      logger,
    });
    streamer.close();
  });

  return router;
}
