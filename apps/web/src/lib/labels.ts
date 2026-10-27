import type { AgentName, DecisionTopic, LogLevel, TripStatus, WeatherIcon } from '@ai-travel/contracts';
import {
  CloudFogIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  SunIcon,
  type LucideIcon,
} from 'lucide-react';

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

/** Topic names on the "Confirmed" badge in the chat. */
export const decisionLabels: Record<DecisionTopic, string> = {
  trip: 'Brief',
  itinerary: 'Itinerary',
  flight: 'Flight',
  hotel: 'Hotel',
  transfers: 'Transfers',
  budget: 'Budget',
};

/** Agent names as people read them (the contract names are identifiers). */
export const agentDisplayNames: Record<AgentName, string> = {
  System: 'System',
  Supervisor: 'Supervisor',
  FlightAgent: 'Flight Agent',
  HotelAgent: 'Hotel Agent',
  Planner: 'Itinerary Planner',
  BudgetAuditor: 'Budget Auditor',
};

/** Agent name colours on the light chat background. */
export const AGENT_CHAT_COLORS: Record<AgentName, string> = {
  System: 'text-zinc-600',
  Supervisor: 'text-sky-700',
  FlightAgent: 'text-violet-700',
  HotelAgent: 'text-emerald-700',
  Planner: 'text-fuchsia-700',
  BudgetAuditor: 'text-cyan-700',
};

export const WEATHER_ICONS: Record<WeatherIcon, LucideIcon> = {
  clear: SunIcon,
  'partly-cloudy': CloudSunIcon,
  cloudy: CloudIcon,
  fog: CloudFogIcon,
  rain: CloudRainIcon,
  snow: CloudSnowIcon,
  storm: CloudLightningIcon,
};

const celsius = new Intl.NumberFormat('en-US', { style: 'unit', unit: 'celsius', maximumFractionDigits: 0 });
const rateFormat = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 });

export function formatTemperature(value: number): string {
  return celsius.format(value);
}

/** `1 USD = 0.92 EUR` */
export function formatRate(rate: number, quote: string): string {
  return `1 USD = ${rateFormat.format(rate)} ${quote}`;
}
