import { TripRequestSchema } from '@ai-travel/contracts';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { CompiledTravelGraph } from '../agent/graph.js';
import { ActiveRuns } from '../agent/activeRuns.js';
import { buildResultPayload, runTrip } from '../agent/runTrip.js';
import type { RateLimiters } from '../middlewares/rateLimiter.js';
import { conflict, notFound, validationError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { SseStreamer } from '../utils/sseStreamer.js';

const ThreadIdSchema = z.uuid();
const STOPPED_ERROR = 'Trip planning stopped before it finished, resume to continue';

export interface TripsRouterDeps {
  config: Pick<Config, 'RUN_TIMEOUT_MS'>;
  graph: CompiledTravelGraph;
  logger: Logger;
  activeRuns: ActiveRuns;
  runLimiter: RateLimiters['runLimiter'];
}

/** Trip routes. Reconnect and cancel arrive with B25. */
export function createTripsRouter({ config, graph, logger, activeRuns, runLimiter }: TripsRouterDeps): Router {
  const router = Router();

  router.post('/trips', runLimiter, async (req, res) => {
    const parsed = TripRequestSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const threadId = randomUUID();
    const streamer = new SseStreamer(res);
    streamer.open(threadId);

    // The run must not die with the connection (a closed streamer just drops packets); only the
    // timeout and shutdown abort it. Cancel joins in B25.
    const signal = activeRuns.start(threadId, config.RUN_TIMEOUT_MS);
    try {
      await runTrip({
        graph,
        emit: (event) => streamer.send(event),
        threadId,
        request: parsed.data,
        signal,
        logger,
      });
    } finally {
      activeRuns.finish(threadId);
      streamer.close();
    }
  });

  /** Reads the latest checkpoint of a thread; `null` when the thread is unknown. */
  async function loadThread(rawId: unknown) {
    const parsedId = ThreadIdSchema.safeParse(rawId);
    if (!parsedId.success) throw notFound('Trip not found');
    const threadId = parsedId.data;
    const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
    if (snapshot.config.configurable?.['checkpoint_id'] === undefined) throw notFound('Trip not found');
    return { threadId, snapshot, finished: snapshot.next.length === 0 };
  }

  router.get('/trips/:threadId', async (req, res) => {
    const { threadId, snapshot, finished } = await loadThread(req.params.threadId);
    res.json(buildResultPayload(threadId, snapshot.values, finished ? undefined : STOPPED_ERROR));
  });

  router.post('/trips/:threadId/resume', runLimiter, async (req, res) => {
    const { threadId, snapshot, finished } = await loadThread(req.params.threadId);
    if (activeRuns.has(threadId)) throw conflict('This trip is still running');

    const streamer = new SseStreamer(res);
    streamer.open(threadId);
    if (finished) {
      streamer.send({ type: 'RESULT', payload: buildResultPayload(threadId, snapshot.values) });
      streamer.close();
      return;
    }

    const signal = activeRuns.start(threadId, config.RUN_TIMEOUT_MS);
    try {
      await runTrip({ graph, emit: (event) => streamer.send(event), threadId, resume: true, signal, logger });
    } finally {
      activeRuns.finish(threadId);
      streamer.close();
    }
  });

  return router;
}
