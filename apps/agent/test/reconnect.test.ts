import type { SseEventInput } from '@ai-travel/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Run } from '../src/agent/runRegistry.js';
import type { SseStreamer } from '../src/utils/sseStreamer.js';
import { parseSse, sseText, testApp } from './helpers/harness.js';


const log = (message: string): SseEventInput => ({ type: 'LOG', payload: { step: 1, agent: 'System', message, timestamp: new Date().toISOString() } });

/** Stand-in for an HTTP stream: records what it was sent. */
function fakeStreamer() {
  const sent: { id: number; message: string }[] = [];
  let closed = false;
  const listeners: (() => void)[] = [];
  const streamer = {
    send: (event: SseEventInput, id: number) => sent.push({ id, message: event.type === 'LOG' ? event.payload.message : event.type }),
    close: () => {
      closed = true;
      listeners.forEach((listener) => listener());
    },
    onClose: (listener: () => void) => listeners.push(listener),
  } as unknown as SseStreamer;
  return { streamer, sent, isClosed: () => closed };
}

describe('Run replay buffer', () => {
  it('replays only the packets after Last-Event-ID, then follows the live run without duplicates', () => {
    const run = new Run(500);
    ['a', 'b', 'c'].forEach((message) => run.emit(log(message)));
    const { streamer, sent, isClosed } = fakeStreamer();
    run.subscribe(streamer, 1);
    run.emit(log('d'));
    run.finish();
    expect(sent).toEqual([
      { id: 2, message: 'b' },
      { id: 3, message: 'c' },
      { id: 4, message: 'd' },
    ]);
    expect(isClosed()).toBe(true);
  });

  it('drops the oldest packets past the cap', () => {
    const run = new Run(2);
    ['a', 'b', 'c'].forEach((message) => run.emit(log(message)));
    const { streamer, sent } = fakeStreamer();
    run.subscribe(streamer, 0);
    expect(sent.map((packet) => packet.id)).toEqual([2, 3]);
  });

  it('keeps PROGRESS monotonic on replay', () => {
    const run = new Run(10);
    run.emit({ type: 'PROGRESS', payload: { progressPercent: 50, currentStatus: 'planning' } });
    run.emit({ type: 'PROGRESS', payload: { progressPercent: 30, currentStatus: 'searching' } });
    const percents: number[] = [];
    run.subscribe({ send: (event: SseEventInput) => event.type === 'PROGRESS' && percents.push(event.payload.progressPercent), onClose: () => {}, close: () => {} } as unknown as SseStreamer);
    expect(percents).toEqual([50, 50]);
  });
});

describe('GET /api/trips/:threadId/stream (reconnect)', () => {
  it('replays the packets after Last-Event-ID and ends with the RESULT', async () => {
    const { app } = testApp({ trip: { budget: 50_000 } });
    const first = await request(app).post('/api/trips').send({ prompt: '3 days in Paris from Tashkent' }).buffer(true).parse(sseText);
    expect(first.status).toBe(200);
    const threadId = first.headers['x-thread-id'] as string;
    const all = parseSse(first.body as string);
    expect(all.at(-1)?.event.type).toBe('RESULT');

    const lastSeen = 5;
    const again = await request(app).get(`/api/trips/${threadId}/stream`).set('Last-Event-ID', String(lastSeen)).buffer(true).parse(sseText);
    expect(again.status).toBe(200);
    const replayed = parseSse(again.body as string);
    expect(replayed.map((packet) => packet.id)).toEqual(all.filter((packet) => packet.id! > lastSeen).map((packet) => packet.id));
    expect(replayed.filter((packet) => packet.event.type === 'RESULT')).toHaveLength(1);
  });

  it('answers 404 for an unknown run', async () => {
    const { app } = testApp();
    const response = await request(app).get(`/api/trips/${crypto.randomUUID()}/stream`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Run not found or expired' } });
  });
});
