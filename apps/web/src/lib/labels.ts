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

/** Day colours 1–5, cycled for longer trips; map pins also carry the stop number. */
export const DAY_COLORS = ['#0F7B5F', '#2952CC', '#C46A00', '#7A4CD9', '#C2361F'] as const;

export function dayColor(day: number): string {
  return DAY_COLORS[(day - 1) % DAY_COLORS.length] ?? DAY_COLORS[0];
}

/** Rating word shown next to the 0–10 hotel score. */
export function ratingWord(rating: number): string {
  if (rating >= 9) return 'Superb';
  if (rating >= 8) return 'Very good';
  if (rating >= 7) return 'Good';
  return 'Fair';
}
