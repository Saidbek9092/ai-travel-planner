import { Annotation } from '@langchain/langgraph';
import type {
  AgentName,
  BudgetPass,
  Flight,
  Hotel,
  ItineraryDay,
  LogKind,
  LogLevel,
  Suggestions,
  Transfer,
  TripRequest,
  TripStatus,
} from '@ai-travel/contracts';

export interface LogEntry {
  timestamp: string;
  agent: AgentName;
  message: string;
  /** 1-based index of the node execution; every log of one node run shares it. */
  step: number;
  level: LogLevel;
  kind: LogKind;
}

/** Maximum number of cheaper-mode re-plans before the Budget Auditor gives up. */
export const MAX_BUDGET_RETRIES = 2;

const replace = <T>(fallback: () => T) =>
  Annotation<T>({ reducer: (_previous, next) => next, default: fallback });
const append = <T>() => Annotation<T[]>({ reducer: (previous, next) => previous.concat(next), default: () => [] });

export const TravelAgentStateAnnotation = Annotation.Root({
  prompt: replace<string>(() => ''),
  overrides: replace<Omit<TripRequest, 'prompt'>>(() => ({})),
  origin: replace<string | null>(() => null),
  destination: replace<string>(() => ''),
  budget: replace<number>(() => 0),
  durationDays: replace<number>(() => 0),
  startDate: replace<string | null>(() => null),

  flights: replace<Flight[]>(() => []),
  hotels: replace<Hotel[]>(() => []),
  transfers: replace<Transfer[]>(() => []),
  itinerary: replace<ItineraryDay[]>(() => []),
  dailyExpensesEstimate: replace<number>(() => 0),

  totalCost: replace<number>(() => 0),
  retryCount: replace<number>(() => 0),
  searchMode: replace<'standard' | 'cheaper'>(() => 'standard'),
  overBudgetBy: replace<number>(() => 0),
  passes: append<BudgetPass>(),
  suggestions: replace<Suggestions | null>(() => null),
  status: replace<TripStatus>(() => 'parsing'),
  error: replace<string | null>(() => null),
  warnings: append<string>(),
  logs: append<LogEntry>(),
});

export type TravelAgentState = typeof TravelAgentStateAnnotation.State;
export type TravelAgentUpdate = typeof TravelAgentStateAnnotation.Update;

/** Every graph node: reads the state, returns only the keys it changes (including its own `logs`). */
export type TravelNode = (state: TravelAgentState) => Promise<TravelAgentUpdate>;

/** Graph input for a new run: the prompt plus the explicit form fields that override what the Supervisor parses. */
export function initialState({ prompt, ...overrides }: TripRequest): TravelAgentUpdate {
  return { prompt, overrides };
}

/** Step number for the node that is about to run: the last log's step + 1, or 1. */
export function nextStep(state: Pick<TravelAgentState, 'logs'>): number {
  return (state.logs.at(-1)?.step ?? 0) + 1;
}

/** Builds a `LogEntry` for the current step. */
export function log(
  state: Pick<TravelAgentState, 'logs'>,
  agent: AgentName,
  message: string,
  level: LogLevel = 'info',
  kind: LogKind = 'log',
): LogEntry {
  return { timestamp: new Date().toISOString(), agent, message, step: nextStep(state), level, kind };
}
