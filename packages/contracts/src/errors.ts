import { z } from 'zod';

/** Public error codes of the agent's JSON error responses. The web app maps each one to a message. */
export const ErrorCodeSchema = z.enum(['VALIDATION_ERROR', 'UNAUTHORIZED', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL']);

/** Body of every JSON error response (errors before an SSE stream opens). */
export const ErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    /** Safe to show to the user. */
    message: z.string(),
    /** Seconds until the client may retry; set for `RATE_LIMITED`. */
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
});

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
