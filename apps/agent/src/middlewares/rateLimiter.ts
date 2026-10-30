import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Config } from '../config.js';
import { AppError } from '../utils/errors.js';

export interface RateLimiters {
  /** Every `/api` request: 100 / minute / IP. */
  generalLimiter: RequestHandler;
  /** Routes that start a graph run (new trip, resume): the short window, then the daily cap. */
  runLimiter: RequestHandler[];
}

const DAY_MS = 86_400_000;

export function createRateLimiters(
  config: Pick<Config, 'RATE_LIMIT_WINDOW_MS' | 'RATE_LIMIT_MAX_RUNS' | 'RATE_LIMIT_DAILY_MAX_RUNS'>,
): RateLimiters {
  const limiter = (windowMs: number, limit: number, message: string) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, _res, next) => {
        // Seconds until the window resets: the value the web form counts down from.
        const resetTime = (req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
        const retryAfterSeconds = Math.max(1, Math.ceil(((resetTime?.getTime() ?? Date.now() + windowMs) - Date.now()) / 1000));
        next(new AppError('RATE_LIMITED', message, 429, retryAfterSeconds));
      },
    });

  return {
    generalLimiter: limiter(60_000, 100, 'Too many requests, please slow down'),
    runLimiter: [
      limiter(config.RATE_LIMIT_WINDOW_MS, config.RATE_LIMIT_MAX_RUNS, 'Too many trips planned from this address, please try again later'),
      limiter(DAY_MS, config.RATE_LIMIT_DAILY_MAX_RUNS, "You've reached today's limit of trips from this address, please try again tomorrow"),
    ],
  };
}
