import { z } from 'zod';

export type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'RATE_LIMITED' | 'INTERNAL';

/** Error with a public `code` and HTTP status. Its `message` is safe to send to the client. */
export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const notFound = (message = 'Resource not found') => new AppError('NOT_FOUND', message, 404);

export const validationError = (error: z.ZodError) =>
  new AppError('VALIDATION_ERROR', z.prettifyError(error), 400);

export const internalError = () => new AppError('INTERNAL', 'Something went wrong', 500);

/** Shape of every JSON error response. */
export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}
