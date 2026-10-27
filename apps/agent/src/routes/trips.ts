import { TripRequestSchema } from '@ai-travel/contracts';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { CompiledTravelGraph } from '../agent/graph.js';
import type { RunRegistry } from '../agent/runRegistry.js';
import { buildResultPayload } from '../agent/runTrip.js';
import type { RateLimiters } from '../middlewares/rateLimiter.js';
import { conflict, notFound, validationError } from '../utils/errors.js';
import { SseStreamer } from '../utils/sseStreamer.js';

const ThreadIdSchema = z.uuid();
const STOPPED_ERROR = 'Trip planning stopped before it finished, resume to continue';

export interface TripsRouterDeps {
  graph: CompiledTravelGraph;
  registry: RunRegistry;
  runLimiter: RateLimiters['runLimiter'];
}

/** Trip routes. A run belongs to the registry; each request only subscribes to it. */
export function createTripsRouter({ graph, registry, runLimiter }: TripsRouterDeps): Router {
  const router = Router();

  function parseThreadId(raw: unknown): string {
    const parsed = ThreadIdSchema.safeParse(raw);
    if (!parsed.success) throw notFound('Trip not found');
    return parsed.data;
  }

  router.post('/trips', runLimiter, (req, res) => {
    const parsed = TripRequestSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const threadId = randomUUID();
    const streamer = new SseStreamer(res);
    streamer.open(threadId);
    registry.start({ threadId, request: parsed.data }).subscribe(streamer);
  });

  /** Reads the latest checkpoint of a thread; 404 when the thread is unknown. */
  async function loadThread(rawId: unknown) {
    const threadId = parseThreadId(rawId);
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
    if (registry.get(threadId)?.done === false) throw conflict('This trip is still running');

    const streamer = new SseStreamer(res);
    streamer.open(threadId);
    if (finished) {
      streamer.send({ type: 'RESULT', payload: buildResultPayload(threadId, snapshot.values) }, 1);
      streamer.close();
      return;
    }
    registry.start({ threadId, resume: true }).subscribe(streamer);
  });

  /** Reconnect: replays the packets after `Last-Event-ID`, then follows the live run until its `RESULT`. */
  router.get('/trips/:threadId/stream', (req, res) => {
    const run = registry.get(parseThreadId(req.params.threadId));
    if (!run) throw notFound('Run not found or expired');

    const lastEventId = Number.parseInt(req.get('Last-Event-ID') ?? '', 10);
    const streamer = new SseStreamer(res);
    streamer.open(req.params.threadId);
    run.subscribe(streamer, Number.isNaN(lastEventId) ? 0 : lastEventId);
  });

  /** "Stop run". Idempotent: a finished run answers 204 too. */
  router.post('/trips/:threadId/cancel', (req, res) => {
    const run = registry.get(parseThreadId(req.params.threadId));
    if (!run) throw notFound('Run not found or expired');
    run.cancel();
    res.status(204).end();
  });

  return router;
}
