import { SseEventSchema, type SseEventInput } from '@ai-travel/contracts';
import type { Response } from 'express';

const HEARTBEAT_MS = 15_000;

export interface SseStreamerOptions {
  /** Interval of the `: ping` comment; injectable so tests do not wait 15 s. */
  heartbeatMs?: number;
}

/**
 * The only way packets reach the wire. Every packet is validated with `SseEventSchema` and written
 * as `id: n\ndata: <json>\n\n`. Never `res.write` a packet by hand.
 *
 * Until the run registry arrives (B25) one streamer serves one run, so it numbers the packets itself
 * and keeps `PROGRESS` monotonic; the registry will take both over and pass the id in.
 */
export class SseStreamer {
  private readonly heartbeatMs: number;
  private heartbeat: NodeJS.Timeout | undefined;
  private closed = false;
  private lastId = 0;
  private lastPercent = 0;

  constructor(
    private readonly res: Response,
    { heartbeatMs = HEARTBEAT_MS }: SseStreamerOptions = {},
  ) {
    this.heartbeatMs = heartbeatMs;
  }

  /** True once the client went away or `close()` ran. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Sends the headers and starts the heartbeat. */
  open(threadId: string): void {
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    // Tells nginx-style proxies (Render) not to buffer the stream.
    this.res.setHeader('X-Accel-Buffering', 'no');
    this.res.setHeader('X-Thread-Id', threadId);
    this.res.flushHeaders();

    this.res.on('close', () => this.stop());
    this.heartbeat = setInterval(() => this.write(': ping\n\n'), this.heartbeatMs);
    this.heartbeat.unref();
  }

  /**
   * Validates and writes one packet. An invalid packet is a server bug and throws; a closed stream
   * is not an error (the run goes on without its client), so the call is a no-op.
   */
  send(event: SseEventInput): void {
    const parsed = SseEventSchema.parse(event);
    if (this.closed) return;

    let packet = parsed;
    if (packet.type === 'PROGRESS') {
      // Re-plan rounds must not move the bar backwards.
      const progressPercent = Math.max(packet.payload.progressPercent, this.lastPercent);
      this.lastPercent = progressPercent;
      packet = { type: 'PROGRESS', payload: { ...packet.payload, progressPercent } };
    }

    this.lastId += 1;
    this.write(`id: ${this.lastId}\ndata: ${JSON.stringify(packet)}\n\n`);
  }

  /** Ends the response. Safe to call more than once. */
  close(): void {
    if (this.closed) return;
    this.stop();
    this.res.end();
  }

  private stop(): void {
    this.closed = true;
    clearInterval(this.heartbeat);
  }

  private write(chunk: string): void {
    if (!this.closed) this.res.write(chunk);
  }
}
