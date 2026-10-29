import { z } from 'zod';
import { MessagePayloadSchema, StoredResultSchema } from './sse-events.js';

/**
 * Request header with the browser's anonymous owner id (a UUID kept in a first-party cookie by the web app).
 * There are no accounts: whoever has the id sees its trips, the same way whoever has a trip link sees that trip.
 */
export const OWNER_ID_HEADER = 'X-Owner-Id';
export const OwnerIdSchema = z.uuid();

/** One row of "My trips". The web app words the title from these fields. */
export const TripSummarySchema = z.object({
  threadId: z.uuid(),
  status: z.enum(['completed', 'failed']),
  origin: z.string().nullable(),
  /** Empty string if the Supervisor failed before parsing a destination. */
  destination: z.string(),
  durationDays: z.number().int().min(0),
  startDate: z.iso.date().nullable(),
  /** USD. */
  totalCost: z.number().nonnegative(),
  budget: z.number().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** Response of `GET /api/trips` (header `X-Owner-Id`), newest first. */
export const TripListResponseSchema = z.object({
  trips: z.array(TripSummarySchema),
});

/** Response of `GET /api/trips/:threadId/record`: the final result plus the chat, so a reopened trip shows both. */
export const TripRecordSchema = z.object({
  result: StoredResultSchema,
  messages: z.array(MessagePayloadSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type TripSummary = z.infer<typeof TripSummarySchema>;
export type TripListResponse = z.infer<typeof TripListResponseSchema>;
export type TripRecord = z.infer<typeof TripRecordSchema>;
