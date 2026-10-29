import { OWNER_ID_HEADER } from '@ai-travel/contracts';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { RunRegistry } from './agent/runRegistry.js';
import type { CompiledTravelGraph } from './agent/graph.js';
import type { Config } from './config.js';
import { identify } from './middlewares/auth.js';
import { createErrorHandler } from './middlewares/errorHandler.js';
import { createRateLimiters, type RateLimiters } from './middlewares/rateLimiter.js';
import { createAuthRouter } from './routes/auth.js';
import { createPlacesRouter } from './routes/places.js';
import { createTripContextRouter } from './routes/tripContext.js';
import { createTripsRouter } from './routes/trips.js';
import type { TripStore } from './storage/tripStore.js';
import { notFound } from './utils/errors.js';
import type { Logger } from './utils/logger.js';

export interface AppDeps {
  config: Config;
  logger: Logger;
  graph: CompiledTravelGraph;
  registry: RunRegistry;
  trips: TripStore;
  /** Dependency checks behind `/readyz`; each rejects (or returns a reason) when not ready. Defaults to ready. */
  readiness?: () => Promise<string[]>;
  /** Injected by tests to use low limits; built from `config` otherwise. */
  rateLimiters?: RateLimiters;
  /** Reaches Google to check sign-in tokens; tests inject a fake. */
  fetch?: typeof fetch;
}

/**
 * Builds the Express app without listening, so tests can drive it with supertest.
 * Do not add `compression()`: it buffers responses and breaks SSE.
 */
export function createApp({
  config,
  logger,
  graph,
  registry,
  trips,
  readiness = async () => [],
  rateLimiters = createRateLimiters(config),
  fetch: fetchImpl = fetch,
}: AppDeps): Express {
  const app = express();

  // Render runs one proxy in front of the service; rate limiting needs the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Accept', 'Last-Event-ID', 'Authorization', OWNER_ID_HEADER],
      exposedHeaders: ['X-Thread-Id', 'Retry-After'],
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      if (req.path === '/health' || req.path === '/readyz') return;
      logger.info('request', { method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt });
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness (can serve traffic: database reachable, keys present) is separate from liveness above.
  app.get('/readyz', async (_req, res) => {
    const problems = await readiness().catch((error: unknown) => [error instanceof Error ? error.message : String(error)]);
    if (problems.length > 0) {
      logger.warn('not ready', { problems });
      res.status(503).json({ status: 'unavailable', problems });
      return;
    }
    res.json({ status: 'ready' });
  });

  app.use('/api', rateLimiters.generalLimiter);
  app.use('/api', identify(config));
  app.use('/api', createAuthRouter({ config, fetch: fetchImpl }));
  app.use('/api', createTripsRouter({ graph, registry, runLimiter: rateLimiters.runLimiter, trips }));
  app.use('/api', createTripContextRouter({ config }));
  app.use('/api', createPlacesRouter({ config }));

  app.use((req, _res, next) => {
    next(notFound(`Route ${req.method} ${req.path} not found`));
  });
  app.use(createErrorHandler(logger));

  return app;
}
