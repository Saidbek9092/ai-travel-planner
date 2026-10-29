import { SseEventSchema, type SseEvent, type SseEventInput, type TripRequest } from '@ai-travel/contracts';
import type { Config } from '../config.js';
import { AppError } from '../utils/errors.js';
import type { TripStore } from '../storage/tripStore.js';
import type { Logger } from '../utils/logger.js';
import type { SseStreamer } from '../utils/sseStreamer.js';
import type { CompiledTravelGraph } from './graph.js';
import { CANCEL_MESSAGE, RunAbortError, SHUTDOWN_MESSAGE } from './runAbort.js';
import { runTrip } from './runTrip.js';

interface StoredEvent {
  id: number;
  event: SseEvent;
}

export interface RunRegistryDeps {
  graph: CompiledTravelGraph;
  config: Pick<Config, 'RUN_TIMEOUT_MS' | 'RUN_REPLAY_TTL_MS' | 'RUN_REPLAY_MAX_EVENTS' | 'ANTHROPIC_MODEL'>;
  checkpointer: 'memory' | 'postgres';
  logger: Logger;
  /** Where finished trips are saved for "My trips" and reopening. */
  trips: TripStore;
}

/**
 * One trip run. It belongs to the registry, not to an HTTP request: connections only subscribe, and
 * a dropped connection never stops it. Every packet is stored in a ring buffer so a late subscriber
 * can replay what it missed.
 */
export class Run {
  private readonly buffer: StoredEvent[] = [];
  private readonly subscribers = new Set<SseStreamer>();
  private readonly controller = new AbortController();
  private nextId = 1;
  private lastPercent = 0;
  private finished = false;

  constructor(private readonly maxEvents: number) {}

  get done(): boolean {
    return this.finished;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Validates, stores and fans out one packet. Throws on an invalid packet (a server bug). */
  emit(input: SseEventInput): void {
    let event = SseEventSchema.parse(input);
    if (event.type === 'PROGRESS') {
      // Re-plan rounds must not move the bar backwards, on replays either.
      const progressPercent = Math.max(event.payload.progressPercent, this.lastPercent);
      this.lastPercent = progressPercent;
      event = { type: 'PROGRESS', payload: { ...event.payload, progressPercent } };
    }

    const stored = { id: this.nextId++, event };
    this.buffer.push(stored);
    if (this.buffer.length > this.maxEvents) this.buffer.shift();
    for (const streamer of this.subscribers) streamer.send(stored.event, stored.id);
  }

  /** Replays buffered packets with an id greater than `lastEventId`, then follows the run until it ends. */
  subscribe(streamer: SseStreamer, lastEventId = 0): void {
    for (const { id, event } of this.buffer) if (id > lastEventId) streamer.send(event, id);
    if (this.finished) {
      streamer.close();
      return;
    }
    this.subscribers.add(streamer);
    streamer.onClose(() => this.subscribers.delete(streamer));
  }

  /** "Stop run": the stream ends with `RESULT failed: Run stopped`; the checkpoint stays so the trip can be resumed. */
  cancel(): void {
    this.abort(CANCEL_MESSAGE);
  }

  abort(message: string): void {
    if (!this.finished) this.controller.abort(new RunAbortError(message));
  }

  /** Marks the run done and ends every open stream. */
  finish(): void {
    this.finished = true;
    for (const streamer of this.subscribers) streamer.close();
    this.subscribers.clear();
  }
}

export class RunRegistry {
  private readonly runs = new Map<string, Run>();

  constructor(private readonly deps: RunRegistryDeps) {}

  /** The live run, or one that finished within `RUN_REPLAY_TTL_MS`. */
  get(threadId: string): Run | undefined {
    return this.runs.get(threadId);
  }

  /** Number of runs still executing. */
  get size(): number {
    return [...this.runs.values()].filter((run) => !run.done).length;
  }

  /** Starts `runTrip` detached from any connection. One live run per thread. */
  start({
    threadId,
    request,
    resume = false,
    ownerId = null,
    userId = null,
  }: {
    threadId: string;
    request?: TripRequest;
    resume?: boolean;
    /** Anonymous browser id the finished trip is listed under. */
    ownerId?: string | null;
    /** Signed-in account the finished trip belongs to. */
    userId?: string | null;
  }): Run {
    if (this.runs.get(threadId)?.done === false) {
      throw new AppError('CONFLICT', 'This trip is still running', 409);
    }

    const { graph, config, checkpointer, logger, trips } = this.deps;
    const run = new Run(config.RUN_REPLAY_MAX_EVENTS);
    this.runs.set(threadId, run);

    // A run nobody watches is still bounded by the timeout.
    const signal = AbortSignal.any([run.signal, AbortSignal.timeout(config.RUN_TIMEOUT_MS)]);
    void runTrip({
      graph,
      emit: (event) => run.emit(event),
      threadId,
      run: { model: config.ANTHROPIC_MODEL, checkpointer },
      ...(request && { request }),
      resume,
      signal,
      logger,
      onResult: (result, messages) => trips.save({ ownerId, userId, result, messages }),
    }).finally(() => {
      run.finish();
      setTimeout(() => {
        if (this.runs.get(threadId) === run) this.runs.delete(threadId);
      }, config.RUN_REPLAY_TTL_MS).unref();
    });
    return run;
  }

  /** Shutdown: every live run ends with a failed `RESULT` that tells the user to resume. */
  abortAll(message = SHUTDOWN_MESSAGE): void {
    for (const run of this.runs.values()) run.abort(message);
  }
}
