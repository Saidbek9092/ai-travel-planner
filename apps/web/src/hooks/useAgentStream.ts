'use client';

import {
  SseEventSchema,
  type DecisionTopic,
  type ErrorCode,
  type DraftPayload,
  type LogPayload,
  type MessagePayload,
  type ProgressPayload,
  type ResultPayload,
  type SseEvent,
  type TripRequest,
} from '@ai-travel/contracts';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { env } from '@/lib/env';
import { authHeaders, dropSessionIf401 } from '@/lib/auth';
import { ownerHeaders } from '@/lib/owner';
import { readSseEvents } from '@/lib/sse';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'completed' | 'failed' | 'aborted';

export interface ReconnectState {
  attempt: number;
  max: number;
  /** Epoch ms of the next attempt; `null` while the attempt is in flight. */
  nextAt: number | null;
}

export interface AgentStreamState {
  status: StreamStatus;
  threadId: string | null;
  logs: LogPayload[];
  messages: MessagePayload[];
  decisions: Partial<Record<DecisionTopic, MessagePayload>>;
  draft: DraftPayload;
  progress: ProgressPayload | null;
  result: ResultPayload | null;
  error: string | null;
  /** Epoch ms when the rate limit lifts (429), else null. */
  retryAt: number | null;
  reconnect: ReconnectState | null;
  lastRequest: TripRequest | null;
  /** Epoch ms when the current run started (for the ETA). */
  startedAt: number | null;
  /** Index in `logs` where the current search pass began (`AgentBoard`). */
  passStart: number;
}

export type AgentStreamAction =
  | { type: 'START'; request: TripRequest | null; now?: number }
  | { type: 'CONNECTED'; threadId: string }
  /** Follow a run that is already going: its stream replays every packet, so start from an empty run. */
  | { type: 'ATTACH'; threadId: string }
  | { type: 'PACKET'; event: SseEvent }
  | { type: 'STREAM_ENDED' }
  | { type: 'RECONNECTING'; attempt: number; nextAt: number | null }
  | { type: 'HTTP_ERROR'; code: string; message?: string; retryAfterSeconds?: number; now?: number }
  | { type: 'ABORTED' }
  | { type: 'RESET' };

export const MAX_RECONNECTS = 5;
/** Wait before each reconnect attempt, in ms. */
export const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000] as const;

export const initialStreamState: AgentStreamState = {
  status: 'idle',
  threadId: null,
  logs: [],
  messages: [],
  decisions: {},
  draft: {},
  progress: null,
  result: null,
  error: null,
  retryAt: null,
  reconnect: null,
  lastRequest: null,
  startedAt: null,
  passStart: 0,
};

/** Agent codes come from the contracts; `NETWORK` and `CONNECTION_LOST` are the browser's own. */
type ClientErrorCode = ErrorCode | 'NETWORK' | 'CONNECTION_LOST';

const ERROR_MESSAGES: Record<ClientErrorCode, string> = {
  VALIDATION_ERROR: 'Please check your request and try again.',
  RATE_LIMITED: "You've reached the request limit for now.",
  UNAUTHORIZED: 'Your sign-in expired. Sign in again.',
  NOT_FOUND: 'We could not find that trip. It may have expired.',
  CONFLICT: 'This trip is still being planned. Give it a moment.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
  NETWORK: 'Could not reach the planning agent. Check your connection and try again.',
  CONNECTION_LOST: 'Connection lost',
};

export function errorMessage(code: string, serverMessage?: string): string {
  // The daily cap words its own reason ("today's limit"); show it instead of the generic line.
  if ((code === 'VALIDATION_ERROR' || code === 'RATE_LIMITED') && serverMessage) return serverMessage;
  return ERROR_MESSAGES[code as ClientErrorCode] ?? ERROR_MESSAGES.INTERNAL;
}

export function agentStreamReducer(state: AgentStreamState, action: AgentStreamAction): AgentStreamState {
  switch (action.type) {
    case 'START':
      return {
        ...initialStreamState,
        // A resume keeps what the run had so far.
        ...(action.request === null
          ? {
              threadId: state.threadId,
              logs: state.logs,
              messages: state.messages,
              decisions: state.decisions,
              draft: state.draft,
              progress: state.progress,
              passStart: state.passStart,
            }
          : {}),
        status: 'connecting',
        lastRequest: action.request ?? state.lastRequest,
        startedAt: action.now ?? Date.now(),
      };
    case 'CONNECTED':
      return { ...state, status: 'streaming', threadId: action.threadId, reconnect: null };
    case 'ATTACH':
      return { ...initialStreamState, status: 'streaming', threadId: action.threadId, lastRequest: state.lastRequest, startedAt: state.startedAt };
    case 'PACKET': {
      const { event } = action;
      switch (event.type) {
        case 'LOG':
          return { ...state, logs: [...state.logs, event.payload] };
        case 'MESSAGE':
          return {
            ...state,
            messages: [...state.messages, event.payload],
            decisions: event.payload.decision
              ? { ...state.decisions, [event.payload.decision]: event.payload }
              : state.decisions,
          };
        case 'DRAFT':
          return { ...state, draft: { ...state.draft, ...event.payload } };
        case 'PROGRESS': {
          const newPass = event.payload.pass > (state.progress?.pass ?? 1);
          return {
            ...state,
            progress: {
              ...event.payload,
              progressPercent: Math.max(state.progress?.progressPercent ?? 0, event.payload.progressPercent),
            },
            passStart: newPass ? state.logs.length : state.passStart,
          };
        }
        case 'RESULT':
          return {
            ...state,
            result: event.payload,
            threadId: event.payload.threadId,
            status: event.payload.status,
            error: event.payload.error,
            reconnect: null,
          };
      }
      return state;
    }
    case 'STREAM_ENDED':
      if (state.result || state.status === 'aborted') return state;
      return { ...state, status: 'failed', error: errorMessage('CONNECTION_LOST'), reconnect: null };
    case 'RECONNECTING':
      return { ...state, status: 'reconnecting', reconnect: { attempt: action.attempt, max: MAX_RECONNECTS, nextAt: action.nextAt } };
    case 'HTTP_ERROR':
      return {
        ...state,
        status: 'failed',
        error: errorMessage(action.code, action.message),
        reconnect: null,
        retryAt:
          action.code === 'RATE_LIMITED' && action.retryAfterSeconds
            ? (action.now ?? Date.now()) + action.retryAfterSeconds * 1000
            : null,
      };
    case 'ABORTED':
      return { ...state, status: 'aborted', reconnect: null };
    case 'RESET':
      return initialStreamState;
  }
}

export interface InitialRun {
  threadId?: string | null;
  result?: ResultPayload | null;
  /** Stored chat of a reopened trip. */
  messages?: MessagePayload[];
}

function initState(initial?: InitialRun): AgentStreamState {
  if (!initial) return initialStreamState;
  return {
    ...initialStreamState,
    threadId: initial.threadId ?? initial.result?.threadId ?? null,
    result: initial.result ?? null,
    messages: initial.messages ?? [],
    decisions: Object.fromEntries((initial.messages ?? []).flatMap((m) => (m.decision ? [[m.decision, m]] : []))),
    status: initial.result ? initial.result.status : 'idle',
    error: initial.result?.error ?? null,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** SSE ids are the run's sequence numbers; compare numerically when they are numbers. */
function isNewer(id: string, last: string | null): boolean {
  if (last === null) return true;
  const a = Number(id);
  const b = Number(last);
  return Number.isFinite(a) && Number.isFinite(b) ? a > b : id !== last;
}

type ReadOutcome = 'result' | 'ended' | 'network' | 'aborted';

export function useAgentStream(initial?: InitialRun) {
  const [state, dispatch] = useReducer(agentStreamReducer, initial, initState);
  const controllerRef = useRef<AbortController | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeRef = useRef<(() => void) | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    wakeRef.current = null;
  };

  /** Reads packets until the stream ends; dedupes replayed packets by SSE id. */
  const consume = useCallback(async (body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<ReadOutcome> => {
    let sawResult = false;
    try {
      for await (const { id, data } of readSseEvents(body, signal)) {
        if (id !== null) {
          if (!isNewer(id, lastEventIdRef.current)) continue;
          lastEventIdRef.current = id;
        }
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          json = null;
        }
        const parsed = SseEventSchema.safeParse(json);
        if (parsed.success) {
          if (parsed.data.type === 'RESULT') sawResult = true;
          dispatch({ type: 'PACKET', event: parsed.data });
        } else if (process.env.NODE_ENV !== 'production') console.warn('Dropped invalid SSE packet', data);
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return 'aborted';
      return sawResult ? 'result' : 'network';
    }
    if (signal.aborted) return 'aborted';
    return sawResult ? 'result' : 'ended';
  }, []);

  /**
   * Waits with backoff and re-attaches to the run with `Last-Event-ID` until it ends or five attempts fail.
   * `immediate`: the first attempt goes out at once, without the "Reconnecting" state (the run is known to be alive).
   */
  const reconnectLoop = useCallback(
    async (threadId: string, controller: AbortController, immediate = false) => {
      let attempt = 0;
      while (attempt < MAX_RECONNECTS && !controller.signal.aborted) {
        const wait = !(immediate && attempt === 0);
        attempt += 1;
        if (wait) {
          const delay = RECONNECT_DELAYS[attempt - 1] ?? 15_000;
          dispatch({ type: 'RECONNECTING', attempt, nextAt: Date.now() + delay });
          await new Promise<void>((resolve) => {
            wakeRef.current = resolve;
            timerRef.current = setTimeout(resolve, delay);
          });
          clearTimer();
          if (controller.signal.aborted) return;
          dispatch({ type: 'RECONNECTING', attempt, nextAt: null });
        }
        let response: Response;
        try {
          response = await fetch(`${env.agentUrl}/api/trips/${encodeURIComponent(threadId)}/stream`, {
            headers: {
              Accept: 'text/event-stream',
              ...authHeaders(),
              ...(lastEventIdRef.current ? { 'Last-Event-ID': lastEventIdRef.current } : {}),
            },
            signal: controller.signal,
          });
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) return;
          continue;
        }
        if (response.status === 404) break;
        if (!response.ok || !response.body) continue;
        dispatch({ type: 'CONNECTED', threadId });
        attempt = 0;
        const outcome = await consume(response.body, controller.signal);
        if (outcome === 'result' || outcome === 'aborted') return;
      }
      if (!controller.signal.aborted) dispatch({ type: 'STREAM_ENDED' });
    },
    [consume],
  );

  /** Follows a run that may still be going on the agent (one look, no retries); a finished or unknown one changes nothing. */
  const follow = useCallback(
    async (threadId: string, controller: AbortController) => {
      const response = await fetch(`${env.agentUrl}/api/trips/${encodeURIComponent(threadId)}/stream`, {
        headers: { Accept: 'text/event-stream', ...authHeaders() },
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok || !response.body || controller.signal.aborted) return;
      dispatch({ type: 'ATTACH', threadId });
      const outcome = await consume(response.body, controller.signal);
      if (outcome === 'ended' || outcome === 'network') await reconnectLoop(threadId, controller);
    },
    [consume, reconnectLoop],
  );

  useEffect(() => {
    if (env.agentUrl === null) return;
    const { status, threadId, result } = stateRef.current;
    // Next.js keeps a page the user navigated away from in a hidden <Activity>: hiding runs this cleanup (the stream is
    // aborted), showing it again runs the setup. A run that was live then has moved on, so catch up from the last packet.
    const live = status === 'connecting' || status === 'streaming' || status === 'reconnecting';
    // A trip opened from a link or "My trips" before it finished may still be planning: follow it live if so.
    const opened = (status === 'idle' || status === 'failed') && result?.status !== 'completed' && lastEventIdRef.current === null;
    if (threadId && !controllerRef.current && (live || opened)) {
      const controller = new AbortController();
      controllerRef.current = controller;
      void (live ? reconnectLoop(threadId, controller, true) : follow(threadId, controller));
    }
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      clearTimer();
    };
  }, [reconnectLoop, follow]);

  const run = useCallback(
    async (path: string, body: TripRequest | null, request: TripRequest | null) => {
      if (env.agentUrl === null) return;
      controllerRef.current?.abort();
      clearTimer();
      const controller = new AbortController();
      controllerRef.current = controller;
      lastEventIdRef.current = null;
      dispatch({ type: 'START', request, now: Date.now() });

      let response: Response;
      try {
        response = await fetch(`${env.agentUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...ownerHeaders(), ...authHeaders() },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return;
        dispatch({ type: 'HTTP_ERROR', code: 'NETWORK' });
        return;
      }
      const runningId = stateRef.current.threadId;
      if (response.status === 409 && body === null && runningId) {
        // Resume of a trip that is still being planned (opened from a link or "My trips"): follow the live run instead.
        dispatch({ type: 'ATTACH', threadId: runningId });
        await reconnectLoop(runningId, controller, true);
        return;
      }
      if (!response.ok || !response.body) {
        dropSessionIf401(response);
        const json = (await response.json().catch(() => null)) as {
          error?: { code?: string; message?: string; retryAfterSeconds?: number };
        } | null;
        dispatch({
          type: 'HTTP_ERROR',
          code: json?.error?.code ?? 'INTERNAL',
          message: json?.error?.message,
          retryAfterSeconds: json?.error?.retryAfterSeconds ?? (Number(response.headers.get('Retry-After')) || undefined),
          now: Date.now(),
        });
        return;
      }

      const threadId = response.headers.get('X-Thread-Id') ?? stateRef.current.threadId;
      if (threadId) {
        dispatch({ type: 'CONNECTED', threadId });
        window.history.replaceState(null, '', `?trip=${threadId}`);
      }
      const outcome = await consume(response.body, controller.signal);
      if (outcome === 'result' || outcome === 'aborted') return;
      // The run keeps going on the server: catch up instead of failing.
      if (threadId) await reconnectLoop(threadId, controller);
      else dispatch({ type: 'STREAM_ENDED' });
    },
    [consume, reconnectLoop],
  );

  const start = useCallback((request: TripRequest) => void run('/api/trips', request, request), [run]);

  const resume = useCallback(() => {
    const { threadId, status, result } = stateRef.current;
    // `idle` with a thread id = a deep link to a trip that never finished; `aborted` = the user stopped it.
    const resumable = status === 'failed' || status === 'aborted' || (status === 'idle' && result === null);
    if (threadId && resumable) void run(`/api/trips/${threadId}/resume`, null, null);
  }, [run]);

  /** Resumes a paused trip picked from the start page, on its own thread id. */
  const resumeTrip = useCallback(
    (threadId: string) => {
      dispatch({ type: 'CONNECTED', threadId });
      void run(`/api/trips/${encodeURIComponent(threadId)}/resume`, null, null);
    },
    [run],
  );

  const reconnectNow = useCallback(() => wakeRef.current?.(), []);

  const cancel = useCallback(() => {
    const { threadId } = stateRef.current;
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearTimer();
    dispatch({ type: 'ABORTED' });
    // Best effort: the agent stops the graph and keeps the checkpoint, so the run stays resumable.
    if (threadId && env.agentUrl !== null) {
      void fetch(`${env.agentUrl}/api/trips/${encodeURIComponent(threadId)}/cancel`, { method: 'POST', headers: authHeaders() }).catch(() => undefined);
    }
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearTimer();
    dispatch({ type: 'RESET' });
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return { ...state, start, resume, resumeTrip, reconnectNow, cancel, reset };
}
