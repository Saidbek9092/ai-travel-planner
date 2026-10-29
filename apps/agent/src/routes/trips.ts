import { OWNER_ID_HEADER, OwnerIdSchema, TripRequestSchema, type TripListResponse, type TripRecord } from '@ai-travel/contracts';
import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { CompiledTravelGraph } from '../agent/graph.js';
import type { RunRegistry } from '../agent/runRegistry.js';
import { buildResultPayload } from '../agent/runTrip.js';
import type { RateLimiters } from '../middlewares/rateLimiter.js';
import type { TripStore } from '../storage/tripStore.js';
import { AppError, conflict, notFound, validationError } from '../utils/errors.js';
import { SseStreamer } from '../utils/sseStreamer.js';

const ThreadIdSchema = z.uuid();
const STOPPED_ERROR = 'Trip planning stopped before it finished, resume to continue';

export interface TripsRouterDeps {
  graph: CompiledTravelGraph;
  registry: RunRegistry;
  runLimiter: RateLimiters['runLimiter'];
  trips: TripStore;
}

/** The anonymous owner id, or `null` when the header is missing or not a UUID (a run never fails over it). */
function ownerIdOf(req: Request): string | null {
  const parsed = OwnerIdSchema.safeParse(req.get(OWNER_ID_HEADER));
  return parsed.success ? parsed.data : null;
}

/** Trip routes. A run belongs to the registry; each request only subscribes to it. */
export function createTripsRouter({ graph, registry, runLimiter, trips }: TripsRouterDeps): Router {
  const router = Router();

  function parseThreadId(raw: unknown): string {
    const parsed = ThreadIdSchema.safeParse(raw);
    if (!parsed.success) throw notFound('Trip not found');
    return parsed.data;
  }

  router.post('/trips', ...runLimiter, (req, res) => {
    const parsed = TripRequestSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const threadId = randomUUID();
    const streamer = new SseStreamer(res);
    streamer.open(threadId);
    registry.start({ threadId, request: parsed.data, ownerId: ownerIdOf(req) }).subscribe(streamer);
  });

  /** "My trips" for the browser's anonymous owner id, newest first. */
  router.get('/trips', async (req, res) => {
    const ownerId = OwnerIdSchema.safeParse(req.get(OWNER_ID_HEADER));
    if (!ownerId.success) throw new AppError('VALIDATION_ERROR', `${OWNER_ID_HEADER} header must be a UUID`, 400);
    const body: TripListResponse = { trips: await trips.list(ownerId.data) };
    res.json(body);
  });

  /** Reads the latest checkpoint of a thread; 404 when the thread is unknown. */
  async function loadThread(rawId: unknown) {
    const threadId = parseThreadId(rawId);
    const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
    if (snapshot.config.configurable?.['checkpoint_id'] === undefined) throw notFound('Trip not found');
    return { threadId, snapshot, finished: snapshot.next.length === 0 };
  }

  /** The stored trip when there is one, else the result and chat rebuilt from the checkpoint (trips from before the store). */
  async function loadRecord(rawId: unknown): Promise<TripRecord> {
    const stored = await trips.get(parseThreadId(rawId));
    if (stored) return stored;
    const { threadId, snapshot, finished } = await loadThread(rawId);
    const at = snapshot.createdAt ?? new Date().toISOString();
    return {
      result: buildResultPayload(threadId, snapshot.values, finished ? undefined : STOPPED_ERROR),
      messages: snapshot.values.messages ?? [],
      createdAt: at,
      updatedAt: at,
    };
  }

  router.get('/trips/:threadId', async (req, res) => {
    res.json((await loadRecord(req.params.threadId)).result);
  });

  router.get('/trips/:threadId/record', async (req, res) => {
    res.json(await loadRecord(req.params.threadId));
  });

  router.post('/trips/:threadId/resume', ...runLimiter, async (req, res) => {
    const { threadId, snapshot, finished } = await loadThread(req.params.threadId);
    if (registry.get(threadId)?.done === false) throw conflict('This trip is still running');

    const streamer = new SseStreamer(res);
    streamer.open(threadId);
    if (finished) {
      streamer.send({ type: 'RESULT', payload: buildResultPayload(threadId, snapshot.values) }, 1);
      streamer.close();
      return;
    }
    registry.start({ threadId, resume: true, ownerId: ownerIdOf(req) }).subscribe(streamer);
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
