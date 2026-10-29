import type { ErrorCode } from '@ai-travel/contracts';
import { z } from 'zod';

/** Error with a public `code` and HTTP status. Its `message` is safe to send to the client. */
export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    /** Seconds until the client may retry; set for `RATE_LIMITED`. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export const notFound = (message = 'Resource not found') => new AppError('NOT_FOUND', message, 404);

export const conflict = (message: string) => new AppError('CONFLICT', message, 409);

export const validationError = (error: z.ZodError) =>
  new AppError('VALIDATION_ERROR', z.prettifyError(error), 400);

export const internalError = () => new AppError('INTERNAL', 'Something went wrong', 500);
