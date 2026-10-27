import type { ProgressPayload, ResultPayload, SseEventInput, TripRequest, TripStatus } from '@ai-travel/contracts';
import type { CompiledTravelGraph } from './graph.js';
import { initialState, log, MAX_BUDGET_RETRIES, type LogEntry, type TravelAgentState } from './state.js';
import type { Logger } from '../utils/logger.js';

const GENERIC_ERROR = 'Something went wrong while planning your trip. Please try again.';
const INTERRUPTED_ERROR = 'Trip planning was interrupted before it finished.';

/** The part of a node's state update that the stream controller reads. */
interface NodeUpdate {
  logs?: LogEntry[];
  retryCount?: number;
  status?: TripStatus;
}

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
  request: TripRequest;
  /** Timeout / cancel / shutdown. A closed client connection must NOT abort the run. */
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Runs the graph and turns its stream into packets: node logs → `LOG`, node + status → `PROGRESS`,
 * then exactly one `RESULT`. Never throws; failures end the stream with `RESULT failed`.
 */
export async function runTrip({ graph, emit, threadId, request, signal, logger }: RunTripArgs): Promise<void> {
  const config = { configurable: { thread_id: threadId }, recursionLimit: 20, ...(signal && { signal }) };
  const emitLog = (entry: LogEntry) => emit({ type: 'LOG', payload: entry });
  const emitProgress = (payload: Pick<ProgressPayload, 'progressPercent' | 'currentStatus'> & Partial<ProgressPayload>) =>
    emit({ type: 'PROGRESS', payload });

  let retryCount = 0;
  let lastPercent = 5;

  try {
    emitProgress({ progressPercent: lastPercent, currentStatus: 'parsing' });

    // `custom` carries the Planner's per-day events; they are mapped in B24.
    const stream = await graph.stream(initialState(request), { ...config, streamMode: ['updates', 'custom'] });
    for await (const [mode, chunk] of stream) {
      if (mode !== 'updates') continue;

      for (const [node, update] of Object.entries(chunk as Record<string, NodeUpdate | null>)) {
        if (update == null) continue;
        update.logs?.forEach(emitLog);
        retryCount = update.retryCount ?? retryCount;

        const progress = progressAfter(node, update);
        if (progress === null) continue;
        lastPercent = progress.percent ?? lastPercent;
        emitProgress({
          progressPercent: lastPercent,
          currentStatus: progress.status,
          pass: Math.min(retryCount + 1, 3),
        });
      }
    }

    const values: Partial<TravelAgentState> = (await graph.getState(config)).values;
    emitProgress({ progressPercent: 100, currentStatus: values.status === 'failed' ? 'failed' : 'completed' });
    emit({ type: 'RESULT', payload: buildResultPayload(threadId, values) });
  } catch (error) {
    logger?.error('run failed', {
      threadId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await emitFailure();
  }

  /** Safe message only: no stack, no keys. The result carries whatever the last checkpoint holds. */
  async function emitFailure() {
    const message = signal?.aborted ? INTERRUPTED_ERROR : GENERIC_ERROR;
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
