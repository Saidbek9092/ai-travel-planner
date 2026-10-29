import { z } from 'zod';
import {
  AgentNameSchema,
  DecisionTopicSchema,
  FlightSchema,
  HotelSchema,
  ItineraryDaySchema,
  TransferSchema,
  TripStatusSchema,
} from './trip.js';

export const LogLevelSchema = z.enum(['info', 'warn', 'error']);

/** What a log line means to the UI: plain output, a checkpoint row, or a fallback that fired. */
export const LogKindSchema = z.enum(['log', 'checkpoint', 'llm-fallback', 'search-fallback']);

/** Technical entry for the terminal view. */
export const LogPayloadSchema = z.object({
  /** 1-based index of the node execution in the run. */
  step: z.number().int().min(1),
  agent: AgentNameSchema,
  message: z.string().min(1),
  timestamp: z.iso.datetime(),
  level: LogLevelSchema.default('info'),
  kind: LogKindSchema.default('log'),
});

/** Highlighted tag under a chat message, e.g. "Finding cheaper options, try 1 of 2". */
export const CalloutSchema = z.object({
  tone: z.enum(['info', 'warn']),
  label: z.string().min(1),
});

/** Friendly sentence for the chat panel; see ARCHITECTURE.md §4.6. */
export const MessagePayloadSchema = z.object({
  /** Same `step` as the node's logs. */
  step: z.number().int().min(1),
  agent: AgentNameSchema,
  /** Plain-language text, already formatted for display. */
  text: z.string().min(1),
  timestamp: z.iso.datetime(),
  /** `null` = ordinary update; a topic = confirmed decision. A topic may be confirmed again after a re-plan. */
  decision: DecisionTopicSchema.nullable().default(null),
  callout: CalloutSchema.nullable().default(null),
});

/** Facts for the "Run details" panel. */
export const RunInfoSchema = z.object({
  model: z.string().min(1),
  checkpointer: z.enum(['memory', 'postgres']),
  /** Step of the last saved checkpoint; `null` before the first node finishes. */
  lastCheckpointStep: z.number().int().min(1).nullable(),
});

export const ProgressPayloadSchema = z.object({
  progressPercent: z.number().int().min(0).max(100),
  currentStatus: TripStatusSchema,
  /** Sub-step label, e.g. "Day 4 of 5". */
  detail: z.string().min(1).nullable().default(null),
  /** Search round: 1 = first pass, 2–3 = re-plans. */
  pass: z.number().int().min(1).max(3).default(1),
  run: RunInfoSchema.nullable().default(null),
});

/** One search round, kept so the UI can show "what changed on re-plan". */
export const BudgetPassSchema = z.object({
  pass: z.number().int().min(1).max(3),
  /** USD. */
  flight: z.number().nonnegative(),
  hotel: z.number().nonnegative(),
  transfers: z.number().nonnegative(),
  daily: z.number().nonnegative(),
  totalCost: z.number().nonnegative(),
  /** e.g. "$500 direct" / "$420 via IST". */
  flightLabel: z.string().min(1),
  /** e.g. "5 × $95". */
  hotelLabel: z.string().min(1),
});

/** Ready-made ways out when the trip is still over budget after the last re-plan. */
export const SuggestionsSchema = z.object({
  raiseBudgetTo: z.number().positive(),
  tryDays: z.number().int().min(1),
});

/**
 * Version of the `ResultPayload` shape. Trips are stored (agent `trips` table, links people keep), so bump this when a
 * change would break an old one, and add the step that upgrades it to `upgradeResultPayload` below.
 */
export const RESULT_SCHEMA_VERSION = 1;

export const ResultPayloadSchema = z.object({
  schemaVersion: z.literal(RESULT_SCHEMA_VERSION),
  threadId: z.uuid(),
  status: z.enum(['completed', 'failed']),
  origin: z.string().nullable(),
  /** Empty string if the Supervisor failed before parsing a destination. */
  destination: z.string(),
  durationDays: z.number().int().min(0),
  startDate: z.iso.date().nullable(),
  totalCost: z.number().nonnegative(),
  budget: z.number().nonnegative(),
  currency: z.literal('USD'),
  /** Sorted; index 0 is the selected option. */
  flights: z.array(FlightSchema),
  /** Sorted; index 0 is the selected option. */
  hotels: z.array(HotelSchema),
  /** The selected airport ↔ hotel transfers. */
  transfers: z.array(TransferSchema),
  itinerary: z.array(ItineraryDaySchema),
  /** USD per day. */
  dailyExpensesEstimate: z.number().nonnegative(),
  /** Number of budget re-plans that ran (0–2). */
  replans: z.number().int().min(0).max(2),
  /** One entry per search round, oldest first. */
  passes: z.array(BudgetPassSchema),
  /** Set only when the trip is over budget after the last re-plan. */
  suggestions: SuggestionsSchema.nullable(),
  warnings: z.array(z.string()),
  /** Set when status is 'failed'. */
  error: z.string().nullable(),
});

/**
 * Brings a stored result of any older version up to the current shape. The single migration point for stored trips:
 * the agent runs it when it reads the `trips` table and the web app when it loads a trip by id.
 */
export function upgradeResultPayload(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  let value = raw as Record<string, unknown>;
  const version = typeof value['schemaVersion'] === 'number' ? value['schemaVersion'] : 0;
  // v0 → v1 (2026-10-29): same fields, the version was not recorded yet.
  if (version < 1) value = { ...value, schemaVersion: 1 };
  return value;
}

/** A `ResultPayload` read back from storage: upgraded first, then validated against the current schema. */
export const StoredResultSchema = z.preprocess(upgradeResultPayload, ResultPayloadSchema);

/** `null` when the stored value cannot be upgraded to a valid result. */
export function parseStoredResult(raw: unknown): ResultPayload | null {
  const parsed = StoredResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The trip so far, sent while agents work. Every field is optional: it fills in as agents decide. */
export const DraftPayloadSchema = ResultPayloadSchema.pick({
  origin: true,
  destination: true,
  durationDays: true,
  startDate: true,
  budget: true,
  totalCost: true,
  flights: true,
  hotels: true,
  transfers: true,
  itinerary: true,
  dailyExpensesEstimate: true,
}).partial();

export const LogEventSchema = z.object({ type: z.literal('LOG'), payload: LogPayloadSchema });
export const MessageEventSchema = z.object({ type: z.literal('MESSAGE'), payload: MessagePayloadSchema });
export const ProgressEventSchema = z.object({ type: z.literal('PROGRESS'), payload: ProgressPayloadSchema });
export const DraftEventSchema = z.object({ type: z.literal('DRAFT'), payload: DraftPayloadSchema });
export const ResultEventSchema = z.object({ type: z.literal('RESULT'), payload: ResultPayloadSchema });

export const SseEventSchema = z.discriminatedUnion('type', [
  LogEventSchema,
  MessageEventSchema,
  ProgressEventSchema,
  DraftEventSchema,
  ResultEventSchema,
]);

export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LogKind = z.infer<typeof LogKindSchema>;
export type LogPayload = z.infer<typeof LogPayloadSchema>;
export type Callout = z.infer<typeof CalloutSchema>;
export type MessagePayload = z.infer<typeof MessagePayloadSchema>;
export type RunInfo = z.infer<typeof RunInfoSchema>;
export type ProgressPayload = z.infer<typeof ProgressPayloadSchema>;
export type BudgetPass = z.infer<typeof BudgetPassSchema>;
export type Suggestions = z.infer<typeof SuggestionsSchema>;
export type DraftPayload = z.infer<typeof DraftPayloadSchema>;
export type ResultPayload = z.infer<typeof ResultPayloadSchema>;
export type LogEvent = z.infer<typeof LogEventSchema>;
export type MessageEvent = z.infer<typeof MessageEventSchema>;
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
export type DraftEvent = z.infer<typeof DraftEventSchema>;
export type ResultEvent = z.infer<typeof ResultEventSchema>;
export type SseEvent = z.infer<typeof SseEventSchema>;
/** Shape accepted by `SseEventSchema.parse` (e.g. `level` may be omitted). */
export type SseEventInput = z.input<typeof SseEventSchema>;
