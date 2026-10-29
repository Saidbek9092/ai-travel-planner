import { Annotation, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type {
  AgentName,
  BudgetPass,
  Callout,
  DecisionTopic,
  DraftPayload,
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
import type { Preferences } from './pick.js';

export interface LogEntry {
  timestamp: string;
  agent: AgentName;
  message: string;
  /** 1-based index of the node execution; every log of one node run shares it. */
  step: number;
  level: LogLevel;
  kind: LogKind;
}

/** Friendly chat sentence (ARCHITECTURE.md §4.6); shares the `step` of the node's logs. */
export interface ChatMessage {
  timestamp: string;
  agent: AgentName;
  text: string;
  step: number;
  /** A topic marks a confirmed decision; `null` is an ordinary update. */
  decision: DecisionTopic | null;
  callout: Callout | null;
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
  /** What the traveller asked for: hard flags are code filters, `notes` guides the LLM pick. */
  preferences: replace<Preferences>(() => ({ directOnly: false, maxStops: null, notes: null })),

  flights: replace<Flight[]>(() => []),
  hotels: replace<Hotel[]>(() => []),
  transfers: replace<Transfer[]>(() => []),
  itinerary: replace<ItineraryDay[]>(() => []),
  dailyExpensesEstimate: replace<number>(() => 0),
  /** Name of the hotel the current itinerary was routed around; lets a re-plan spot a hotel change. */
  itineraryHotel: replace<string | null>(() => null),

  totalCost: replace<number>(() => 0),
  retryCount: replace<number>(() => 0),
  searchMode: replace<'standard' | 'cheaper'>(() => 'standard'),
  overBudgetBy: replace<number>(() => 0),
  passes: append<BudgetPass>(),
  suggestions: replace<Suggestions | null>(() => null),
  status: replace<TripStatus>(() => 'parsing'),
  error: replace<string | null>(() => null),
  warnings: append<string>(),
  /** Topics the agents have confirmed so far; the Budget Auditor confirms whatever is missing at the end. */
  confirmed: append<DecisionTopic>(),
  logs: append<LogEntry>(),
  messages: append<ChatMessage>(),
});

export type TravelAgentState = typeof TravelAgentStateAnnotation.State;
export type TravelAgentUpdate = typeof TravelAgentStateAnnotation.Update;

/** Every graph node: reads the state, returns only the keys it changes (including its own `logs`). */
export type TravelNode = (state: TravelAgentState, config?: LangGraphRunnableConfig) => Promise<TravelAgentUpdate>;

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

/** Builds a chat `ChatMessage` for the current step. Pass the node's `logs` so it shares their `step`. */
export function say(
  state: Pick<TravelAgentState, 'logs'>,
  agent: AgentName,
  text: string,
  { decision = null, callout = null }: { decision?: DecisionTopic | null; callout?: Callout | null } = {},
): ChatMessage {
  return { timestamp: new Date().toISOString(), agent, text, step: nextStep(state), decision, callout };
}

/** The `DRAFT` packet for the state so far: only fields an agent has already produced. */
export function toDraft(values: Partial<TravelAgentState>): DraftPayload {
  const draft: DraftPayload = {};
  if (values.destination) draft.destination = values.destination;
  if (values.origin) draft.origin = values.origin;
  if (values.budget) draft.budget = values.budget;
  if (values.durationDays) draft.durationDays = values.durationDays;
  if (values.startDate) draft.startDate = values.startDate;
  if (values.flights?.length) draft.flights = values.flights;
  if (values.hotels?.length) draft.hotels = values.hotels;
  if (values.transfers?.length) draft.transfers = values.transfers;
  if (values.itinerary?.length) draft.itinerary = values.itinerary;
  if (values.dailyExpensesEstimate) draft.dailyExpensesEstimate = values.dailyExpensesEstimate;
  if (values.totalCost) draft.totalCost = values.totalCost;
  return draft;
}

/** "$1,000" — whole dollars with thousands separators; cents only when present. */
export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Log line that tells the user the live provider failed and estimates are shown instead (web turns it into a banner). */
export function searchFallbackLog(state: Pick<TravelAgentState, 'logs'>, agent: AgentName, what: string): LogEntry {
  return log(state, agent, `Live ${what} prices unavailable, using estimates.`, 'warn', 'search-fallback');
}

/** Log line for a run that used the fallback model (web turns it into the "Running on fallback model" banner). */
export function llmFallbackLog(state: Pick<TravelAgentState, 'logs'>, agent: AgentName, model: string): LogEntry {
  return log(state, agent, `Primary model unavailable, used ${model}`, 'warn', 'llm-fallback');
}
