import type { SseEvent, SseEventInput } from '@ai-travel/contracts';
import { SseEventSchema } from '@ai-travel/contracts';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { TravelNodes } from '../src/agent/graph.js';
import { buildResultPayload, runTrip } from '../src/agent/runTrip.js';
import type { TravelAgentUpdate } from '../src/agent/state.js';
import { createLogger } from '../src/utils/logger.js';
import { testConfig } from './helpers/testConfig.js';
import { parseSse, testGraph } from './helpers/testGraph.js';

const THREAD_ID = '6f1b3a52-8a52-4f0c-9d0e-2f1f4a1d9c11';
const logger = createLogger({ silent: true });

async function collect(nodes?: Partial<TravelNodes>, request = { prompt: '5 days in Paris' }): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  const emit = (event: SseEventInput) => void events.push(SseEventSchema.parse(event));
  await runTrip({ graph: testGraph(nodes), emit, threadId: THREAD_ID, request, logger });
  return events;
}

const percents = (events: SseEvent[]) =>
  events.flatMap((event) => (event.type === 'PROGRESS' ? [event.payload.progressPercent] : []));

describe('runTrip', () => {
  it('streams LOG and PROGRESS packets and ends with exactly one RESULT', async () => {
    const events = await collect();
    const types = events.map((event) => event.type);

    expect(types.filter((type) => type === 'RESULT')).toHaveLength(1);
    expect(types.at(-1)).toBe('RESULT');
    expect(types.filter((type) => type === 'LOG')).toHaveLength(5);
    expect(events.at(-1)).toMatchObject({
      type: 'RESULT',
      payload: { threadId: THREAD_ID, status: 'completed', destination: 'Paris', error: null },
    });
  });

  it('opens at 5 / parsing, follows the §6.3 table and ends at 100', async () => {
    const events = await collect();
    const progress = events.flatMap((event) => (event.type === 'PROGRESS' ? [event.payload] : []));

    expect(progress.map((p) => [p.progressPercent, p.currentStatus])).toEqual([
      [5, 'parsing'],
      [15, 'searching'],
      [35, 'searching'],
      [55, 'planning'],
      [75, 'auditing'],
      [95, 'completed'],
      [100, 'completed'],
    ]);
    expect(progress.every((p) => p.pass === 1)).toBe(true);
  });

  it('sends each node\'s logs before its progress, with increasing steps', async () => {
    const events = await collect();
    const logs = events.flatMap((event) => (event.type === 'LOG' ? [event.payload] : []));

    expect(logs.map((l) => l.step)).toEqual([1, 2, 3, 4, 5]);
    expect(logs.map((l) => l.agent)).toEqual(['Supervisor', 'FlightAgent', 'HotelAgent', 'Planner', 'BudgetAuditor']);
    expect(events[0]?.type).toBe('PROGRESS');
    expect(events[1]?.type).toBe('LOG');
    expect(events[2]?.type).toBe('PROGRESS');
  });

  it('keeps progress monotonic across re-plans and counts the pass', async () => {
    let audits = 0;
    const events = await collect({
      budgetAuditor: async (): Promise<TravelAgentUpdate> => {
        audits += 1;
        return audits < 3 ? { status: 'searching', retryCount: audits } : { status: 'completed' };
      },
    });
    const progress = events.flatMap((event) => (event.type === 'PROGRESS' ? [event.payload] : []));

    // runTrip may report a lower value when a re-plan restarts at flights; SseStreamer raises it.
    expect(progress.filter((p) => p.currentStatus === 'searching' && p.pass > 1).map((p) => p.pass)).toContain(3);
    expect(Math.max(...progress.map((p) => p.pass))).toBe(3);
    expect(progress.at(-1)).toMatchObject({ progressPercent: 100 });
    expect(events.filter((event) => event.type === 'RESULT')).toHaveLength(1);
  });

  it('ends a failed Supervisor in RESULT failed without a search progress step', async () => {
    const events = await collect({
      supervisorAgent: async () => ({ status: 'failed', error: 'Please include a budget.' }),
    });

    expect(percents(events)).toEqual([5, 100]);
    expect(events.at(-1)).toMatchObject({
      type: 'RESULT',
      payload: { status: 'failed', error: 'Please include a budget.' },
    });
  });

  it('turns a throwing node into an error LOG and RESULT failed built from the last checkpoint', async () => {
    const events = await collect({
      hotelAgent: async () => {
        throw new Error('boom sk-ant-secret at /srv/app/hotel.ts:12');
      },
    });

    const lastLog = events.filter((event) => event.type === 'LOG').at(-1);
    expect(lastLog).toMatchObject({ payload: { agent: 'System', level: 'error', step: 3 } });

    const result = events.at(-1);
    expect(result).toMatchObject({ type: 'RESULT', payload: { status: 'failed', destination: 'Paris' } });
    // Partial data from the flight step survives; the error text is generic.
    if (result?.type !== 'RESULT') throw new Error('expected RESULT');
    expect(result.payload.flights).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(/sk-ant|boom|hotel\.ts/);
    expect(percents(events).at(-1)).toBe(100);
    expect(events.filter((event) => event.type === 'RESULT')).toHaveLength(1);
  });

  it('reports an aborted run as interrupted', async () => {
    const controller = new AbortController();
    const events: SseEvent[] = [];
    controller.abort();
    await runTrip({
      graph: testGraph(),
      emit: (event) => void events.push(SseEventSchema.parse(event)),
      threadId: THREAD_ID,
      request: { prompt: '5 days in Paris' },
      signal: controller.signal,
      logger,
    });

    expect(events.at(-1)).toMatchObject({
      type: 'RESULT',
      payload: { status: 'failed', error: 'Trip planning was interrupted before it finished.' },
    });
  });
});

describe('buildResultPayload', () => {
  it('fills defaults for an empty state and satisfies the contract', () => {
    const payload = buildResultPayload(THREAD_ID, {}, 'nope');
    expect(payload).toMatchObject({ status: 'failed', destination: '', replans: 0, suggestions: null, error: 'nope' });
    expect(SseEventSchema.safeParse({ type: 'RESULT', payload }).success).toBe(true);
  });

  it('takes the error from state for a failed run and clears it for a completed one', () => {
    expect(buildResultPayload(THREAD_ID, { status: 'failed', error: 'Please include a budget.' }).error).toBe(
      'Please include a budget.',
    );
    expect(buildResultPayload(THREAD_ID, { status: 'completed', error: 'stale' })).toMatchObject({
      status: 'completed',
      error: null,
    });
  });
});

describe('POST /api/trips', () => {
  const makeApp = (nodes?: Partial<TravelNodes>) => createApp({ config: testConfig(), logger, graph: testGraph(nodes) });

  it('streams a valid SSE run and exposes the thread id', async () => {
    const res = await request(makeApp())
      .post('/api/trips')
      .send({ prompt: '5 days in Paris' })
      .expect(200);

    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.headers['x-thread-id']).toMatch(/^[0-9a-f-]{36}$/);

    const packets = parseSse(res.text);
    expect(packets.map((packet) => packet.id)).toEqual(packets.map((_, index) => index + 1));
    const result = packets.at(-1)?.event;
    expect(result).toMatchObject({ type: 'RESULT', payload: { status: 'completed' } });
    if (result?.type === 'RESULT') expect(result.payload.threadId).toBe(res.headers['x-thread-id']);
  });

  it('uses a fresh thread id per request', async () => {
    const app = makeApp();
    const [a, b] = await Promise.all([
      request(app).post('/api/trips').send({ prompt: 'Paris trip' }),
      request(app).post('/api/trips').send({ prompt: 'Paris trip' }),
    ]);
    expect(a.headers['x-thread-id']).not.toBe(b.headers['x-thread-id']);
  });

  it.each([
    ['a too short prompt', { prompt: 'a' }],
    ['a missing prompt', {}],
    ['a bad override', { prompt: 'Paris trip', durationDays: 99 }],
  ])('answers 400 VALIDATION_ERROR for %s, with no stream', async (_name, body) => {
    const res = await request(makeApp()).post('/api/trips').send(body);
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.headers['x-thread-id']).toBeUndefined();
  });

  it('answers 400 when there is no JSON body at all', async () => {
    const res = await request(makeApp()).post('/api/trips');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('keeps running after the client disconnects', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reached: string[] = [];
    const app = makeApp({
      hotelAgent: async () => {
        await gate;
        reached.push('hotel');
        return { status: 'planning' };
      },
      budgetAuditor: async () => {
        reached.push('budget');
        return { status: 'completed' };
      },
    });
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/trips`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: '5 days in Paris' }),
        signal: controller.signal,
      });
      await res.body!.getReader().read(); // first packet arrived
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 50)); // let the server notice the close

      release();
      await expect.poll(() => reached).toEqual(['hotel', 'budget']);
    } finally {
      release();
      server.close();
    }
  });
});
