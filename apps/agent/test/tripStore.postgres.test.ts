import { RESULT_SCHEMA_VERSION } from '@ai-travel/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildResultPayload } from '../src/agent/runTrip.js';
import { createPostgresTripStore, type TripStore } from '../src/storage/tripStore.js';

// Runs only against a real database (CI starts a Postgres service and sets TEST_DATABASE_URL).
const url = process.env['TEST_DATABASE_URL'];
const OWNER = '0b6f8f9e-2c1d-4c3b-9a8e-7f6d5c4b3a21';

describe.skipIf(url === undefined)('trip store (Postgres)', () => {
  let store: TripStore;
  beforeAll(async () => {
    store = await createPostgresTripStore(url!);
  });
  afterAll(() => store.close());

  const result = (threadId: string, totalCost = 900) =>
    buildResultPayload(threadId, { destination: 'Paris', origin: 'Tashkent', durationDays: 3, budget: 1_000, totalCost, status: 'completed' });

  it('saves, reads back and lists a trip with its chat', async () => {
    const threadId = crypto.randomUUID();
    const message = { step: 1, agent: 'Supervisor' as const, text: 'Got it', timestamp: new Date().toISOString(), decision: 'trip' as const, callout: null };
    await store.save({ ownerId: OWNER, result: result(threadId), messages: [message] });
    const record = await store.get(threadId);
    expect(record?.result).toEqual(result(threadId));
    expect(record?.messages).toEqual([message]);
    expect((await store.list(OWNER)).map((trip) => trip.threadId)).toContain(threadId);
  });

  it('keeps the first owner and createdAt on a second save', async () => {
    const threadId = crypto.randomUUID();
    await store.save({ ownerId: OWNER, result: result(threadId), messages: [] });
    const first = await store.get(threadId);
    await store.save({ ownerId: null, result: result(threadId, 800), messages: [] });
    const second = await store.get(threadId);
    expect(second?.result.totalCost).toBe(800);
    expect(second?.createdAt).toBe(first?.createdAt);
    expect((await store.list(OWNER)).some((trip) => trip.threadId === threadId)).toBe(true);
  });

  it('upgrades a row written before schemaVersion existed', async () => {
    const threadId = crypto.randomUUID();
    const { schemaVersion: _version, ...v0 } = result(threadId);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('INSERT INTO trips (thread_id, owner_id, result) VALUES ($1, $2, $3)', [threadId, OWNER, JSON.stringify(v0)]);
    await client.end();
    expect((await store.get(threadId))?.result.schemaVersion).toBe(RESULT_SCHEMA_VERSION);
  });
});
