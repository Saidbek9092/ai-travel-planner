import type { ItineraryDay, ProgressPayload, ResultPayload, RunInfo, SseEventInput, TripRequest, TripStatus } from '@ai-travel/contracts';
import type { CompiledTravelGraph } from './graph.js';
import { initialState, log, MAX_BUDGET_RETRIES, toDraft, type ChatMessage, type LogEntry, type TravelAgentState } from './state.js';
import { abortMessage } from './runAbort.js';
import type { Logger } from '../utils/logger.js';
import { createRunMetrics, withRunMetrics, type RunMetrics } from '../utils/runMetrics.js';

const GENERIC_ERROR = 'Something went wrong while planning your trip. Please try again.';
const INTERRUPTED_ERROR = 'Trip planning was interrupted before it finished.';

/** The part of a node's state update that the stream controller reads. */
interface NodeUpdate extends Partial<TravelAgentState> {
  logs?: LogEntry[];
  messages?: ChatMessage[];
  retryCount?: number;
  status?: TripStatus;
}

/** Event the Planner writes after each finished day (`config.writer`). */
interface DayEvent {
  kind: 'day';
  day: number;
  of: number;
  itinerary: ItineraryDay[];
}

const isDayEvent = (chunk: unknown): chunk is DayEvent =>
  typeof chunk === 'object' && chunk !== null && (chunk as { kind?: unknown }).kind === 'day';

/** The Planner's days move the bar from the hotel step (55) towards the audit step (75). */
const PLANNER_START_PERCENT = 55;
const PLANNER_END_PERCENT = 75;

/** Progress after a node finishes (ARCHITECTURE.md §6.3); `null` keeps the current percentage. */
function progressAfter(node: string, update: NodeUpdate): { status: TripStatus; percent: number | null } | null {
  switch (node) {
    case 'supervisorAgent':
      // A failed parse goes straight to the final RESULT.
      return update.status === 'failed' ? null : { status: 'searching', percent: 15 };
    case 'flightAgent':
      return { status: 'searching', percent: 35 };
    case 'hotelAgent':
      return { status: 'planning', percent: 55 };
    case 'itineraryPlanner':
      return { status: 'auditing', percent: 75 };
    case 'budgetAuditor':
      return update.status === 'searching'
        ? { status: 'searching', percent: null }
        : { status: 'completed', percent: 95 };
    default:
      return null;
  }
}

/** Assembles the `RESULT` packet from graph state. Pure, so the trip lookup (B16) can reuse it. */
export function buildResultPayload(
  threadId: string,
  values: Partial<TravelAgentState>,
  failure?: string,
): ResultPayload {
  const failed = failure !== undefined || values.status === 'failed';
  return {
    threadId,
    status: failed ? 'failed' : 'completed',
    origin: values.origin ?? null,
    destination: values.destination ?? '',
    durationDays: values.durationDays ?? 0,
    startDate: values.startDate ?? null,
    totalCost: values.totalCost ?? 0,
    budget: values.budget ?? 0,
    currency: 'USD',
    flights: values.flights ?? [],
    hotels: values.hotels ?? [],
    transfers: values.transfers ?? [],
    itinerary: values.itinerary ?? [],
    dailyExpensesEstimate: values.dailyExpensesEstimate ?? 0,
    replans: Math.min(values.retryCount ?? 0, MAX_BUDGET_RETRIES),
    passes: values.passes ?? [],
    suggestions: values.suggestions ?? null,
    warnings: values.warnings ?? [],
    error: failed ? (failure ?? values.error ?? GENERIC_ERROR) : null,
  };
}

export interface RunTripArgs {
  graph: CompiledTravelGraph;
  /** Receives every packet in order; the HTTP route wires it to one `SseStreamer`. */
  emit: (event: SseEventInput) => void;
  threadId: string;
  /** Model and checkpointer shown in the web app's "Run details" panel. */
  run: Pick<RunInfo, 'model' | 'checkpointer'>;
  /** Required for a new run; ignored when `resume` is set. */
  request?: TripRequest;
  /** Continue from the last checkpoint instead of starting over. */
  resume?: boolean;
  /** Timeout / cancel / shutdown. A closed client connection must NOT abort the run. */
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Runs the graph and turns its stream into packets: node logs → `LOG`, node + status → `PROGRESS`,
 * then exactly one `RESULT`. Never throws; failures end the stream with `RESULT failed`.
 */
export function runTrip(args: RunTripArgs): Promise<void> {
  const metrics = createRunMetrics();
  return withRunMetrics(metrics, () => execute(args, metrics));
}

async function execute(
  { graph, emit, threadId, run, request, resume = false, signal, logger }: RunTripArgs,
  metrics: RunMetrics,
): Promise<void> {
  const config = { configurable: { thread_id: threadId }, recursionLimit: 20, ...(signal && { signal }) };
  const emitLog = (entry: LogEntry) => emit({ type: 'LOG', payload: entry });
  const emitProgress = (payload: Pick<ProgressPayload, 'progressPercent' | 'currentStatus'> & Partial<ProgressPayload>) =>
    emit({ type: 'PROGRESS', payload });

  const startedAt = Date.now();
  let nodeStartedAt = startedAt;
  let llmFallbackUsed = false;
  let toolFallbackUsed = false;
  let retryCount = 0;
  let lastPercent = 5;
  let lastCheckpointStep: number | null = null;
  let merged: Partial<TravelAgentState> = {};

  try {
    emitProgress({ progressPercent: lastPercent, currentStatus: 'parsing', pass: 1, run: { ...run, lastCheckpointStep } });

    // `custom` carries the Planner's per-day events.
    const input = resume || request === undefined ? null : initialState(request);
    const stream = await graph.stream(input, { ...config, streamMode: ['updates', 'custom'] });
    for await (const [mode, chunk] of stream) {
      if (mode === 'custom') {
        if (!isDayEvent(chunk)) continue;
        const percent = PLANNER_START_PERCENT + Math.round(((PLANNER_END_PERCENT - PLANNER_START_PERCENT) * chunk.day) / chunk.of);
        emitProgress({
          progressPercent: percent,
          currentStatus: 'planning',
          detail: `Day ${chunk.day} of ${chunk.of}`,
          pass: Math.min(retryCount + 1, 3),
          run: { ...run, lastCheckpointStep },
        });
        emit({ type: 'DRAFT', payload: { itinerary: chunk.itinerary } });
        continue;
      }
      if (mode !== 'updates') continue;

      for (const [node, update] of Object.entries(chunk as Record<string, NodeUpdate | null>)) {
        if (update == null) continue;
        update.logs?.forEach(emitLog);
        update.messages?.forEach((message) => emit({ type: 'MESSAGE', payload: message }));
        merged = { ...merged, ...update };
        const draft = toDraft(merged);
        if (Object.keys(draft).length > 0) emit({ type: 'DRAFT', payload: draft });
        llmFallbackUsed ||= update.logs?.some((entry) => entry.kind === 'llm-fallback') ?? false;
        toolFallbackUsed ||= update.logs?.some((entry) => entry.kind === 'search-fallback') ?? false;
        logger?.info('node finished', { threadId, node, durationMs: Date.now() - nodeStartedAt });
        nodeStartedAt = Date.now();
        retryCount = update.retryCount ?? retryCount;

        const step = update.logs?.at(-1)?.step ?? update.messages?.at(-1)?.step;
        if (step !== undefined) {
          lastCheckpointStep = step;
          const saver = run.checkpointer === 'postgres' ? 'PostgresSaver' : 'MemorySaver';
          emitLog({
            timestamp: new Date().toISOString(),
            agent: 'System',
            message: `State saved after step ${step} · ${saver}`,
            step,
            level: 'info',
            kind: 'checkpoint',
          });
        }

        const progress = progressAfter(node, update);
        if (progress === null) continue;
        lastPercent = progress.percent ?? lastPercent;
        emitProgress({
          progressPercent: lastPercent,
          currentStatus: progress.status,
          pass: Math.min(retryCount + 1, 3),
          run: { ...run, lastCheckpointStep },
        });
      }
    }

    const values: Partial<TravelAgentState> = (await graph.getState(config)).values;
    emitProgress({ progressPercent: 100, currentStatus: values.status === 'failed' ? 'failed' : 'completed' });
    emit({ type: 'RESULT', payload: buildResultPayload(threadId, values) });
    summarize(values.status === 'failed' ? 'failed' : 'completed');
  } catch (error) {
    // An abort is an expected outcome, not an error worth a stack trace.
    if (signal?.aborted) logger?.warn('run aborted', { threadId, reason: abortMessage(signal) ?? 'cancelled' });
    else {
      logger?.error('run failed', {
        threadId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
    await emitFailure();
    summarize(signal?.aborted ? 'aborted' : 'failed');
  }

  function summarize(outcome: 'completed' | 'failed' | 'aborted') {
    logger?.info('run summary', {
      threadId,
      outcome,
      resumed: resume,
      retryCount,
      llmFallbackUsed,
      toolFallbackUsed,
      totalMs: Date.now() - startedAt,
      llmCalls: metrics.llmCalls,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      models: metrics.models,
      llmFallbacks: metrics.llmFallbacks,
      searchCalls: metrics.searchCalls,
      searchCacheHits: metrics.searchCacheHits,
    });
  }

  /** Safe message only: no stack, no keys. The result carries whatever the last checkpoint holds. */
  async function emitFailure() {
    const message = abortMessage(signal) ?? (signal?.aborted ? INTERRUPTED_ERROR : GENERIC_ERROR);
    try {
      const values: Partial<TravelAgentState> = await graph
        .getState(config)
        .then((snapshot) => snapshot.values)
        .catch(() => ({}));
      emitLog(log({ logs: values.logs ?? [] }, 'System', message, 'error'));
      emitProgress({ progressPercent: 100, currentStatus: 'failed' });
      emit({ type: 'RESULT', payload: buildResultPayload(threadId, values, message) });
    } catch (emitError) {
      // The stream itself is broken (e.g. an invalid packet); the route closes it.
      logger?.error('could not report failure', {
        threadId,
        error: emitError instanceof Error ? emitError.message : String(emitError),
      });
    }
  }
}
