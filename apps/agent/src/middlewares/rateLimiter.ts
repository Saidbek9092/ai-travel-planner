import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Config } from '../config.js';
import { AppError } from '../utils/errors.js';

export interface RateLimiters {
  /** Every `/api` request: 100 / minute / IP. */
  generalLimiter: RequestHandler;
  /** Routes that start a graph run (new trip, resume). */
  runLimiter: RequestHandler;
}

interface Options {
  /** Overrides the general limit (tests). */
  generalMax?: number;
}

export function createRateLimiters(
  config: Pick<Config, 'RATE_LIMIT_WINDOW_MS' | 'RATE_LIMIT_MAX_RUNS'>,
  { generalMax = 100 }: Options = {},
): RateLimiters {
  const limiter = (windowMs: number, limit: number, message: string) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', message, 429)),
    });

  return {
    generalLimiter: limiter(60_000, generalMax, 'Too many requests, please slow down'),
    runLimiter: limiter(
      config.RATE_LIMIT_WINDOW_MS,
      config.RATE_LIMIT_MAX_RUNS,
      'Too many trips planned from this address, please try again later',
    ),
  };
}
