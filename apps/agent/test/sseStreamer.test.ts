import type { SseEventInput } from '@ai-travel/contracts';
import type { Response } from 'express';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseStreamer } from '../src/utils/sseStreamer.js';
import { parseSse } from './helpers/testGraph.js';

const THREAD_ID = '6f1b3a52-8a52-4f0c-9d0e-2f1f4a1d9c11';

function fakeResponse() {
  const emitter = new EventEmitter();
  const headers: Record<string, string> = {};
  const writes: string[] = [];
  const res = {
    setHeader: (name: string, value: string) => void (headers[name] = value),
    flushHeaders: vi.fn(),
    write: (chunk: string) => void writes.push(chunk),
    end: vi.fn(),
    on: (event: string, listener: () => void) => emitter.on(event, listener),
  };
  return { res: res as unknown as Response, raw: res, headers, writes, emitter, body: () => writes.join('') };
}

const progress = (progressPercent: number): SseEventInput => ({
  type: 'PROGRESS',
  payload: { progressPercent, currentStatus: 'searching' },
});
const log = (message = 'hello'): SseEventInput => ({
  type: 'LOG',
  payload: { step: 1, agent: 'Supervisor', message, timestamp: '2026-10-25T10:25:00Z' },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SseStreamer', () => {
  it('opens with the SSE headers, the thread id and flushed headers', () => {
    const { res, raw, headers } = fakeResponse();
    new SseStreamer(res).open(THREAD_ID);

    expect(headers).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Thread-Id': THREAD_ID,
    });
    expect(raw.flushHeaders).toHaveBeenCalledOnce();
  });

  it('writes `id` + `data` blocks with increasing sequence ids that parse back', () => {
    const f = fakeResponse();
    const streamer = new SseStreamer(f.res);
    streamer.open(THREAD_ID);
    streamer.send(log('one'));
    streamer.send(log('two'));

    expect(f.writes[0]).toMatch(/^id: 1\ndata: \{.*\}\n\n$/);
    const packets = parseSse(f.body());
    expect(packets.map((packet) => packet.id)).toEqual([1, 2]);
    expect(packets[1]?.event).toMatchObject({ type: 'LOG', payload: { message: 'two', level: 'info', kind: 'log' } });
  });

  it('throws on an invalid packet and writes nothing', () => {
    const f = fakeResponse();
    const streamer = new SseStreamer(f.res);
    streamer.open(THREAD_ID);

    expect(() => streamer.send(progress(150))).toThrow();
    expect(f.writes).toEqual([]);
    streamer.send(log());
    expect(f.writes[0]).toMatch(/^id: 1\n/);
  });

  it('raises a lower progress to the highest value already sent', () => {
    const f = fakeResponse();
    const streamer = new SseStreamer(f.res);
    streamer.open(THREAD_ID);
    [35, 15, 55].forEach((percent) => streamer.send(progress(percent)));

    const percents = parseSse(f.body()).map((packet) =>
      packet.event.type === 'PROGRESS' ? packet.event.payload.progressPercent : null,
    );
    expect(percents).toEqual([35, 35, 55]);
  });

  it('writes a heartbeat comment every interval', () => {
    const f = fakeResponse();
    new SseStreamer(f.res, { heartbeatMs: 1000 }).open(THREAD_ID);

    vi.advanceTimersByTime(3000);
    expect(f.writes).toEqual([': ping\n\n', ': ping\n\n', ': ping\n\n']);
    expect(parseSse(f.body())).toEqual([]);
  });

  it('close() ends the response once and stops the heartbeat', () => {
    const f = fakeResponse();
    const streamer = new SseStreamer(f.res, { heartbeatMs: 1000 });
    streamer.open(THREAD_ID);
    streamer.close();
    streamer.close();

    expect(streamer.isClosed).toBe(true);
    expect(f.raw.end).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(f.writes).toEqual([]);
  });

  it('does not write after close, even for a valid packet', () => {
    const f = fakeResponse();
    const streamer = new SseStreamer(f.res);
    streamer.open(THREAD_ID);
    streamer.close();

    expect(() => streamer.send(log())).not.toThrow();
    expect(f.writes).toEqual([]);
  });

  it('marks itself closed when the client disconnects', () => {
    const f = fakeResponse();
    const streamer = new SseStreamer(f.res, { heartbeatMs: 1000 });
    streamer.open(THREAD_ID);

    f.emitter.emit('close');
    expect(streamer.isClosed).toBe(true);
    streamer.send(log());
    vi.advanceTimersByTime(5000);
    expect(f.writes).toEqual([]);
  });
});
