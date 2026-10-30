import {
  MessagePayloadSchema,
  parseStoredResult,
  type MessagePayload,
  type ResultPayload,
  type TripRecord,
  type TripSummary,
} from '@ai-travel/contracts';
import pg from 'pg';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Logger } from '../utils/logger.js';

/** "My trips" shows at most this many, newest first. */
const LIST_LIMIT = 50;
/** The memory store is for development; it forgets the oldest trips past this many. */
const MEMORY_MAX_TRIPS = 1_000;
/** Every query gives up after this long, so a slow database cannot hold a request or a finished run. */
const QUERY_TIMEOUT_MS = 5_000;

const MessagesSchema = z.array(MessagePayloadSchema);

export interface SaveTripArgs {
  /** Anonymous browser id (`X-Owner-Id`); `null` when the request had none. */
  ownerId: string | null;
  /** Signed-in account that planned the trip; `null` for a guest. */
  userId?: string | null;
  result: ResultPayload;
  messages: MessagePayload[];
}

/**
 * Finished trips (completed or failed) with their chat, so a trip reopened later, or on another device with the same
 * owner id, shows the same result and conversation. The checkpointer still owns resuming; this only stores outcomes.
 */
export interface TripStore {
  readonly kind: 'memory' | 'postgres';
  /** Inserts or replaces the trip; a resume keeps the first owner and `createdAt`. */
  save(args: SaveTripArgs): Promise<void>;
  /** `null` when the trip is unknown or its stored result can no longer be read. */
  get(threadId: string): Promise<TripRecord | null>;
  /**
   * Newest first. A signed-in `userId` gets that account's trips; without one, the guest trips of this browser's
   * `ownerId` (trips already claimed by an account are not listed to guests).
   */
  list(ownerId: string, userId?: string | null): Promise<TripSummary[]>;
  /** Who a stored trip belongs to; `null` when the trip is not stored. `userId` is `null` for a guest trip. */
  ownership(threadId: string): Promise<{ userId: string | null; ownerId: string | null } | null>;
  /** Deletes a stored trip. Returns whether there was one. */
  remove(threadId: string): Promise<boolean>;
  /** Moves this browser's guest trips to the account. Returns how many moved. */
  claim(userId: string, ownerId: string): Promise<number>;
  close(): Promise<void>;
}

function summarize(result: ResultPayload, createdAt: string, updatedAt: string): TripSummary {
  return {
    threadId: result.threadId,
    status: result.status,
    origin: result.origin,
    destination: result.destination,
    durationDays: result.durationDays,
    startDate: result.startDate,
    totalCost: result.totalCost,
    budget: result.budget,
    createdAt,
    updatedAt,
  };
}

/** Reads one stored row through the contracts migration; unreadable rows are skipped, not fatal. */
function toRecord(raw: { result: unknown; messages: unknown; createdAt: string; updatedAt: string }): TripRecord | null {
  const result = parseStoredResult(raw.result);
  if (result === null) return null;
  const messages = MessagesSchema.safeParse(raw.messages);
  return { result, messages: messages.success ? messages.data : [], createdAt: raw.createdAt, updatedAt: raw.updatedAt };
}

interface MemoryRow {
  ownerId: string | null;
  userId: string | null;
  result: unknown;
  messages: unknown;
  createdAt: string;
  updatedAt: string;
}

export function createMemoryTripStore(): TripStore {
  const rows = new Map<string, MemoryRow>();
  return {
    kind: 'memory',
    async save({ ownerId, userId = null, result, messages }) {
      const now = new Date().toISOString();
      const previous = rows.get(result.threadId);
      rows.delete(result.threadId);
      rows.set(result.threadId, {
        ownerId: previous?.ownerId ?? ownerId,
        userId: previous?.userId ?? userId,
        result: structuredClone(result),
        messages: structuredClone(messages),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
      if (rows.size > MEMORY_MAX_TRIPS) rows.delete(rows.keys().next().value!);
    },
    async get(threadId) {
      const row = rows.get(threadId);
      return row ? toRecord(row) : null;
    },
    async ownership(threadId) {
      const row = rows.get(threadId);
      return row ? { userId: row.userId, ownerId: row.ownerId } : null;
    },
    async remove(threadId) {
      return rows.delete(threadId);
    },
    async claim(userId, ownerId) {
      const mine = [...rows.values()].filter((row) => row.ownerId === ownerId && row.userId === null);
      for (const row of mine) row.userId = userId;
      return mine.length;
    },
    async list(ownerId, userId = null) {
      return [...rows.values()]
        .filter((row) => (userId === null ? row.ownerId === ownerId && row.userId === null : row.userId === userId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .flatMap((row) => {
          const record = toRecord(row);
          return record ? [summarize(record.result, record.createdAt, record.updatedAt)] : [];
        })
        .slice(0, LIST_LIMIT);
    },
    async close() {},
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trips (
  thread_id uuid PRIMARY KEY,
  owner_id uuid,
  user_id text,
  result jsonb NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trips_owner_created_idx ON trips (owner_id, created_at DESC);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS user_id text;
CREATE INDEX IF NOT EXISTS trips_user_created_idx ON trips (user_id, created_at DESC);
`;

interface PgRow {
  result: unknown;
  messages: unknown;
  created_at: Date;
  updated_at: Date;
}

const fromPg = (row: PgRow) =>
  toRecord({ result: row.result, messages: row.messages, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });

/** `trips` table next to the checkpointer's tables; created on boot. */
export async function createPostgresTripStore(connectionString: string): Promise<TripStore> {
  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: QUERY_TIMEOUT_MS, statement_timeout: QUERY_TIMEOUT_MS });
  await pool.query(SCHEMA_SQL);
  return {
    kind: 'postgres',
    async save({ ownerId, userId = null, result, messages }) {
      await pool.query(
        `INSERT INTO trips (thread_id, owner_id, user_id, result, messages) VALUES ($1, $2, $5, $3, $4)
         ON CONFLICT (thread_id) DO UPDATE SET
           result = EXCLUDED.result,
           messages = EXCLUDED.messages,
           owner_id = COALESCE(trips.owner_id, EXCLUDED.owner_id),
           user_id = COALESCE(trips.user_id, EXCLUDED.user_id),
           updated_at = now()`,
        [result.threadId, ownerId, JSON.stringify(result), JSON.stringify(messages), userId],
      );
    },
    async get(threadId) {
      const { rows } = await pool.query<PgRow>('SELECT result, messages, created_at, updated_at FROM trips WHERE thread_id = $1', [threadId]);
      return rows[0] ? fromPg(rows[0]) : null;
    },
    async ownership(threadId) {
      const { rows } = await pool.query<{ user_id: string | null; owner_id: string | null }>('SELECT user_id, owner_id FROM trips WHERE thread_id = $1', [threadId]);
      return rows[0] ? { userId: rows[0].user_id, ownerId: rows[0].owner_id } : null;
    },
    async remove(threadId) {
      const { rowCount } = await pool.query('DELETE FROM trips WHERE thread_id = $1', [threadId]);
      return (rowCount ?? 0) > 0;
    },
    async claim(userId, ownerId) {
      const { rowCount } = await pool.query('UPDATE trips SET user_id = $1 WHERE owner_id = $2 AND user_id IS NULL', [userId, ownerId]);
      return rowCount ?? 0;
    },
    async list(ownerId, userId = null) {
      const where = userId === null ? 'owner_id = $1 AND user_id IS NULL' : 'user_id = $1';
      const { rows } = await pool.query<PgRow>(
        `SELECT result, '[]'::jsonb AS messages, created_at, updated_at FROM trips WHERE ${where} ORDER BY created_at DESC LIMIT $2`,
        [userId ?? ownerId, LIST_LIMIT],
      );
      return rows.flatMap((row) => {
        const record = fromPg(row);
        return record ? [summarize(record.result, record.createdAt, record.updatedAt)] : [];
      });
    },
    close: () => pool.end(),
  };
}

/** Postgres when `DATABASE_URL` is set (same rule as the checkpointer), memory otherwise. */
export async function createTripStore(config: Pick<Config, 'DATABASE_URL'>, logger?: Logger): Promise<TripStore> {
  if (config.DATABASE_URL === undefined) {
    logger?.info('DATABASE_URL not set: "My trips" is kept in memory and lost on restart');
    return createMemoryTripStore();
  }
  return createPostgresTripStore(config.DATABASE_URL);
}
