import { RESULT_SCHEMA_VERSION, TripListResponseSchema, TripRecordSchema } from '@ai-travel/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildResultPayload } from '../src/agent/runTrip.js';
import { createMemoryTripStore } from '../src/storage/tripStore.js';
import { parseSse, sseText, testApp } from './helpers/harness.js';


const OWNER = '0b6f8f9e-2c1d-4c3b-9a8e-7f6d5c4b3a21';

describe('trip store (memory)', () => {
  const result = (threadId: string) => ({ ...buildResultPayload(threadId, { destination: 'Paris', durationDays: 3, status: 'completed' }) });

  it('keeps the first owner and createdAt when a resumed trip is saved again', async () => {
    const store = createMemoryTripStore();
    const threadId = crypto.randomUUID();
    await store.save({ ownerId: OWNER, result: result(threadId), messages: [] });
    const first = await store.get(threadId);
    await store.save({ ownerId: null, result: { ...result(threadId), totalCost: 10 }, messages: [] });
    const second = await store.get(threadId);
    expect(second?.result.totalCost).toBe(10);
    expect(second?.createdAt).toBe(first?.createdAt);
    expect((await store.list(OWNER)).map((trip) => trip.threadId)).toEqual([threadId]);
  });

  it('lists only the owner’s trips', async () => {
    const store = createMemoryTripStore();
    await store.save({ ownerId: OWNER, result: result(crypto.randomUUID()), messages: [] });
    await store.save({ ownerId: crypto.randomUUID(), result: result(crypto.randomUUID()), messages: [] });
    expect(await store.list(OWNER)).toHaveLength(1);
  });

  it('removes a trip', async () => {
    const store = createMemoryTripStore();
    const threadId = crypto.randomUUID();
    await store.save({ ownerId: OWNER, result: result(threadId), messages: [] });
    expect(await store.remove(threadId)).toBe(true);
    expect(await store.remove(threadId)).toBe(false);
    expect(await store.list(OWNER)).toEqual([]);
  });

  it('upgrades a result stored before schemaVersion existed', async () => {
    const store = createMemoryTripStore();
    const threadId = crypto.randomUUID();
    const { schemaVersion: _version, ...v0 } = result(threadId);
    await store.save({ ownerId: OWNER, result: v0 as never, messages: [] });
    expect((await store.get(threadId))?.result.schemaVersion).toBe(RESULT_SCHEMA_VERSION);
  });
});

describe('trip routes', () => {
  async function planTrip(app: ReturnType<typeof testApp>['app'], owner?: string) {
    const post = request(app).post('/api/trips').send({ prompt: '3 days in Paris from Tashkent' });
    if (owner) post.set('X-Owner-Id', owner);
    const response = await post.buffer(true).parse(sseText);
    return { threadId: response.headers['x-thread-id'] as string, packets: parseSse(response.body as string) };
  }

  it('lists a finished trip under the owner id and returns it with its chat on another "device"', async () => {
    const { app } = testApp({ trip: { budget: 50_000 } });
    const { threadId, packets } = await planTrip(app, OWNER);

    const list = await request(app).get('/api/trips').set('X-Owner-Id', OWNER);
    expect(list.status).toBe(200);
    const { trips } = TripListResponseSchema.parse(list.body);
    expect(trips).toEqual([expect.objectContaining({ threadId, status: 'completed', destination: 'Paris', durationDays: 3 })]);

    const record = TripRecordSchema.parse((await request(app).get(`/api/trips/${threadId}/record`)).body);
    const result = packets.find((packet) => packet.event.type === 'RESULT')?.event.payload;
    expect(record.result).toEqual(result);
    expect(record.messages.map((m) => m.text)).toEqual(packets.flatMap((p) => (p.event.type === 'MESSAGE' ? [p.event.payload.text] : [])));

    const plain = await request(app).get(`/api/trips/${threadId}`);
    expect(plain.body).toEqual(result);
  });

  it('does not list a trip planned without an owner id', async () => {
    const { app } = testApp({ trip: { budget: 50_000 } });
    await planTrip(app);
    const list = await request(app).get('/api/trips').set('X-Owner-Id', OWNER);
    expect(list.body).toEqual({ trips: [] });
  });

  it('rejects a list request without a valid owner id', async () => {
    const { app } = testApp();
    const response = await request(app).get('/api/trips').set('X-Owner-Id', 'not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 404 for an unknown trip record', async () => {
    const { app } = testApp();
    expect((await request(app).get(`/api/trips/${crypto.randomUUID()}/record`)).status).toBe(404);
  });

  it('caps runs per IP per day with a RATE_LIMITED error and retryAfterSeconds', async () => {
    const { app } = testApp({ trip: { budget: 50_000 }, env: { RATE_LIMIT_DAILY_MAX_RUNS: '1' } });
    await planTrip(app);
    const second = await request(app).post('/api/trips').send({ prompt: '3 days in Paris from Tashkent' });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
    expect(second.body.error.message).toMatch(/today/);
    expect(second.body.error.retryAfterSeconds).toBeGreaterThan(3_600);
    expect(second.headers['retry-after']).toBeDefined();
  });
});
