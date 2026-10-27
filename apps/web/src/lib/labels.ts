import type { AgentName, LogLevel, TripStatus } from '@ai-travel/contracts';

/** Agent name colours for the dark terminal panel (bg-zinc-950). */
export const AGENT_COLORS: Record<AgentName, string> = {
  System: 'text-zinc-400',
  Supervisor: 'text-sky-400',
  FlightAgent: 'text-violet-400',
  HotelAgent: 'text-emerald-400',
  Planner: 'text-fuchsia-400',
  BudgetAuditor: 'text-cyan-400',
};

/** Message colours per log level; levels also get a text prefix so colour is never the only signal. */
export const LOG_LEVEL_STYLES: Record<LogLevel, { className: string; prefix: string }> = {
  info: { className: 'text-zinc-100', prefix: '' },
  warn: { className: 'text-amber-400', prefix: 'WARN' },
  error: { className: 'text-red-400', prefix: 'ERROR' },
};

/** Progress bar label per run status. */
export const STATUS_LABELS: Record<TripStatus, string> = {
  parsing: 'Understanding your request',
  searching: 'Searching flights & hotels',
  planning: 'Building your itinerary',
  auditing: 'Checking the budget',
  completed: 'Done',
  failed: 'Something went wrong',
};
