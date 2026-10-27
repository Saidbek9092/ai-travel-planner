import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import { createErrorHandler } from './middlewares/errorHandler.js';
import { createRateLimiters, type RateLimiters } from './middlewares/rateLimiter.js';
import { notFound } from './utils/errors.js';
import type { Logger } from './utils/logger.js';

export interface AppDeps {
  config: Config;
  logger: Logger;
  /** Injected by tests to use low limits; built from `config` otherwise. */
  rateLimiters?: RateLimiters;
}

/**
 * Builds the Express app without listening, so tests can drive it with supertest.
 * Do not add `compression()`: it buffers responses and breaks SSE.
 */
export function createApp({ config, logger, rateLimiters = createRateLimiters(config) }: AppDeps): Express {
  const app = express();

  // Render runs one proxy in front of the service; rate limiting needs the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      methods: ['GET', 'POST'],
      exposedHeaders: ['X-Thread-Id'],
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', rateLimiters.generalLimiter);
  // Trip routes (POST /api/trips, resume, lookup) are mounted here from B7 on, with
  // `rateLimiters.runLimiter` on the two run-starting routes.

  app.use((req, _res, next) => {
    next(notFound(`Route ${req.method} ${req.path} not found`));
  });
  app.use(createErrorHandler(logger));

  return app;
}
