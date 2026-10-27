import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { AppError, internalError, validationError, type ErrorBody } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';

/** Errors raised by Express' body parser carry `type`, `status` and `expose`. */
interface HttpError {
  type?: string;
  status?: number;
  expose?: boolean;
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) return validationError(error);

  const http = (typeof error === 'object' && error !== null ? error : {}) as HttpError;
  if (http.type === 'entity.parse.failed') {
    return new AppError('VALIDATION_ERROR', 'Request body is not valid JSON', 400);
  }
  if (http.type === 'entity.too.large') {
    return new AppError('VALIDATION_ERROR', 'Request body is too large', 413);
  }
  if (http.expose === true && http.status !== undefined && http.status >= 400 && http.status < 500) {
    return new AppError('VALIDATION_ERROR', 'Invalid request', http.status);
  }
  return internalError();
}

/**
 * Last middleware. Converts any error into the standard JSON error body. Once an SSE stream is
 * open the status line is already sent, so it only logs and ends the response — stream failures
 * are reported in-band by the stream controller.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    const appError = toAppError(error);

    if (appError.status >= 500) {
      logger.error('request failed', {
        method: req.method,
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    if (res.headersSent) {
      res.end();
      return;
    }

    const body: ErrorBody = { error: { code: appError.code, message: appError.message } };
    res.status(appError.status).json(body);
  };
}
