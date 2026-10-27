'use client';

import {
  SseEventSchema,
  type DecisionTopic,
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
import { readSseEvents } from '@/lib/sse';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'completed' | 'failed' | 'aborted';

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
  lastRequest: TripRequest | null;
}

export type AgentStreamAction =
  | { type: 'START'; request: TripRequest | null }
  | { type: 'CONNECTED'; threadId: string }
  | { type: 'PACKET'; event: SseEvent }
  | { type: 'STREAM_ENDED' }
  | { type: 'HTTP_ERROR'; code: string; message?: string; retryAfterSeconds?: number; now?: number }
  | { type: 'ABORTED' }
  | { type: 'RESET' };

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
  lastRequest: null,
};

const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Please check your request and try again.',
  RATE_LIMITED: "You've reached the request limit for now.",
  NOT_FOUND: 'We could not find that trip. It may have expired.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
  NETWORK: 'Could not reach the planning agent. Check your connection and try again.',
};

export function errorMessage(code: string, serverMessage?: string): string {
  if (code === 'VALIDATION_ERROR' && serverMessage) return serverMessage;
  return ERROR_MESSAGES[code] ?? 'Something went wrong on our side. Please try again.';
}

export function agentStreamReducer(state: AgentStreamState, action: AgentStreamAction): AgentStreamState {
  switch (action.type) {
    case 'START':
      return {
        ...initialStreamState,
        // A resume keeps what the run had so far.
        ...(action.request === null
          ? { threadId: state.threadId, logs: state.logs, messages: state.messages, decisions: state.decisions, draft: state.draft, progress: state.progress }
          : {}),
        status: 'connecting',
        lastRequest: action.request ?? state.lastRequest,
      };
    case 'CONNECTED':
      return { ...state, status: 'streaming', threadId: action.threadId };
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
        case 'PROGRESS':
          return {
            ...state,
            progress: {
              ...event.payload,
              progressPercent: Math.max(state.progress?.progressPercent ?? 0, event.payload.progressPercent),
            },
          };
        case 'RESULT':
          return {
            ...state,
            result: event.payload,
            threadId: event.payload.threadId,
            status: event.payload.status,
            error: event.payload.error,
          };
      }
      return state;
    }
    case 'STREAM_ENDED':
      if (state.result || state.status === 'aborted') return state;
      return { ...state, status: 'failed', error: 'Connection lost' };
    case 'HTTP_ERROR':
      return {
        ...state,
        status: 'failed',
        error: errorMessage(action.code, action.message),
        retryAt:
          action.code === 'RATE_LIMITED' && action.retryAfterSeconds
            ? (action.now ?? Date.now()) + action.retryAfterSeconds * 1000
            : null,
      };
    case 'ABORTED':
      return { ...state, status: 'aborted' };
    case 'RESET':
      return initialStreamState;
  }
}

export interface InitialRun {
  threadId?: string | null;
  result?: ResultPayload | null;
}

function initState(initial?: InitialRun): AgentStreamState {
  if (!initial) return initialStreamState;
  return {
    ...initialStreamState,
    threadId: initial.threadId ?? initial.result?.threadId ?? null,
    result: initial.result ?? null,
    status: initial.result ? initial.result.status : 'idle',
    error: initial.result?.error ?? null,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useAgentStream(initial?: InitialRun) {
  const [state, dispatch] = useReducer(agentStreamReducer, initial, initState);
  const controllerRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(async (path: string, body: TripRequest | null, request: TripRequest | null) => {
    if (env.agentUrl === null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: 'START', request });

    try {
      const response = await fetch(`${env.agentUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const json = (await response.json().catch(() => null)) as {
          error?: { code?: string; message?: string; retryAfterSeconds?: number };
        } | null;
        dispatch({
          type: 'HTTP_ERROR',
          code: json?.error?.code ?? 'INTERNAL',
          message: json?.error?.message,
          retryAfterSeconds: json?.error?.retryAfterSeconds,
        });
        return;
      }

      const threadId = response.headers.get('X-Thread-Id');
      if (threadId) {
        dispatch({ type: 'CONNECTED', threadId });
        window.history.replaceState(null, '', `?trip=${threadId}`);
      }
      for await (const { data } of readSseEvents(response.body, controller.signal)) {
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          json = null;
        }
        const parsed = SseEventSchema.safeParse(json);
        if (parsed.success) dispatch({ type: 'PACKET', event: parsed.data });
        else if (process.env.NODE_ENV !== 'production') console.warn('Dropped invalid SSE packet', data);
      }
      if (!controller.signal.aborted) dispatch({ type: 'STREAM_ENDED' });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      dispatch({ type: 'HTTP_ERROR', code: 'NETWORK' });
    }
  }, []);

  const start = useCallback((request: TripRequest) => void run('/api/trips', request, request), [run]);

  const resume = useCallback(() => {
    const { threadId, status } = stateRef.current;
    if (threadId && status === 'failed') void run(`/api/trips/${threadId}/resume`, null, null);
  }, [run]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: 'ABORTED' });
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: 'RESET' });
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return { ...state, start, resume, cancel, reset };
}
