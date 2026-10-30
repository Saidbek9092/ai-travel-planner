import { SseEventSchema, type SseEventInput } from '@ai-travel/contracts';
import type { Response } from 'express';

const HEARTBEAT_MS = 15_000;

/**
 * The only way packets reach the wire. Every packet is validated with `SseEventSchema` and written
 * as `id: n\ndata: <json>\n\n`. Never `res.write` a packet by hand.
 *
 * The `RunRegistry` assigns the ids (so `Last-Event-ID` means the same on every connection to a run)
 * and keeps `PROGRESS` monotonic before a packet is stored.
 */
export class SseStreamer {
  private heartbeat: NodeJS.Timeout | undefined;
  private closed = false;
  private readonly closeListeners: (() => void)[] = [];

  constructor(private readonly res: Response) {}

  /** True once the client went away or `close()` ran. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Runs `listener` once when the client goes away or `close()` runs. */
  onClose(listener: () => void): void {
    if (this.closed) listener();
    else this.closeListeners.push(listener);
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
    this.heartbeat = setInterval(() => this.write(': ping\n\n'), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /**
   * Validates and writes one packet. An invalid packet is a server bug and throws; a closed stream
   * is not an error (the run goes on without its client), so the call is a no-op.
   */
  send(event: SseEventInput, id: number): void {
    const packet = SseEventSchema.parse(event);
    if (this.closed) return;
    this.write(`id: ${id}\ndata: ${JSON.stringify(packet)}\n\n`);
  }

  /** Ends the response. Safe to call more than once. */
  close(): void {
    if (this.closed) return;
    this.stop();
    this.res.end();
  }

  private stop(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.closeListeners.splice(0).forEach((listener) => listener());
  }

  private write(chunk: string): void {
    if (!this.closed) this.res.write(chunk);
  }
}
