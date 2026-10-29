import type { AgentName, DecisionTopic, LogLevel, PickReason, TransferMode, TripStatus, WeatherIcon } from '@ai-travel/contracts';
import {
  BedDoubleIcon,
  BusIcon,
  CarIcon,
  CloudFogIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  FootprintsIcon,
  MapIcon,
  PlaneIcon,
  SunIcon,
  TextAlignStartIcon,
  TrainFrontIcon,
  TramFrontIcon,
  CpuIcon,
  WalletIcon,
  type LucideIcon,
} from 'lucide-react';

/** The five graph nodes in run order (System is not an agent). */
export const AGENT_ORDER = ['Supervisor', 'FlightAgent', 'HotelAgent', 'Planner', 'BudgetAuditor'] as const satisfies readonly AgentName[];

/** Agent name colours on the dark terminal ground (Foundations board). */
export const AGENT_COLORS: Record<AgentName, string> = {
  System: 'text-[#8A9BB0]',
  Supervisor: 'text-[#9DB4FF]',
  FlightAgent: 'text-[#F2B53C]',
  HotelAgent: 'text-[#5FD0AE]',
  Planner: 'text-[#C3A6FF]',
  BudgetAuditor: 'text-[#FF9A85]',
};

/** Avatar ground per agent in the chat (white icon on top). */
export const AGENT_AVATAR_COLORS: Record<AgentName, string> = {
  System: '#5F6B7A',
  Supervisor: '#0B1726',
  FlightAgent: '#2952CC',
  HotelAgent: '#7A4CD9',
  Planner: '#C46A00',
  BudgetAuditor: '#B8336A',
};

export const AGENT_ICONS: Record<AgentName, LucideIcon> = {
  System: CpuIcon,
  Supervisor: TextAlignStartIcon,
  FlightAgent: PlaneIcon,
  HotelAgent: BedDoubleIcon,
  Planner: MapIcon,
  BudgetAuditor: WalletIcon,
};

/** Message colours per log level on the terminal; levels also get a text prefix so colour is never the only signal. */
export const LOG_LEVEL_STYLES: Record<LogLevel, { className: string; prefix: string }> = {
  info: { className: 'text-white/90', prefix: '' },
  warn: { className: 'text-live', prefix: 'WARN' },
  error: { className: 'text-[#FF9A85]', prefix: 'ERROR' },
};

/** Progress label per run status. */
export const STATUS_LABELS: Record<TripStatus, string> = {
  parsing: 'Understanding your request',
  searching: 'Searching flights & hotels',
  planning: 'Building your itinerary',
  auditing: 'Checking the budget',
  completed: 'Done',
  failed: 'Something went wrong',
};

/** Which agent is at work for a run status (the chat's "… is drafting" line). */
export const STATUS_AGENTS: Record<TripStatus, AgentName> = {
  parsing: 'Supervisor',
  searching: 'FlightAgent',
  planning: 'Planner',
  auditing: 'BudgetAuditor',
  completed: 'BudgetAuditor',
  failed: 'System',
};

/** The six phase chips above the run, in order. `budget` is done when the result is in. */
export const PHASES = [
  { topic: 'trip', label: 'Brief' },
  { topic: 'flight', label: 'Flights' },
  { topic: 'hotel', label: 'Hotel' },
  { topic: 'transfers', label: 'Transfers' },
  { topic: 'itinerary', label: 'Itinerary' },
  { topic: 'budget', label: 'Budget check' },
] as const satisfies readonly { topic: DecisionTopic; label: string }[];

/** Day colours 1–5 as in the design's day tabs, cycled for longer trips; map pins also carry the stop number. */
export const DAY_COLORS = ['#2952CC', '#C46A00', '#7A4CD9', '#0F7B5F', '#C2361F'] as const;

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

/** Text of the decision chip under a chat message ("Flight confirmed", "Budget approved" / "Over budget"). */
export function decisionChipLabel(topic: DecisionTopic, overBudget = false): string {
  if (topic === 'budget') return overBudget ? 'Budget checked · over budget' : 'Budget approved';
  return `${decisionLabels[topic]} confirmed`;
}

/** Agent names as people read them (the contract names are identifiers). */
export const agentDisplayNames: Record<AgentName, string> = {
  System: 'System',
  Supervisor: 'Supervisor',
  FlightAgent: 'Flight Agent',
  HotelAgent: 'Hotel Agent',
  Planner: 'Itinerary Planner',
  BudgetAuditor: 'Budget Auditor',
};

/** Who owns each decision, for the "Confirmed by the agents" list. */
export const DECISION_AGENTS: Record<DecisionTopic, AgentName> = {
  trip: 'Supervisor',
  flight: 'FlightAgent',
  hotel: 'HotelAgent',
  transfers: 'Planner',
  itinerary: 'Planner',
  budget: 'BudgetAuditor',
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

export const TRANSFER_MODES: Record<TransferMode, { label: string; icon: LucideIcon }> = {
  taxi: { label: 'Taxi', icon: CarIcon },
  train: { label: 'Train', icon: TrainFrontIcon },
  metro: { label: 'Metro', icon: TramFrontIcon },
  bus: { label: 'Bus', icon: BusIcon },
  shuttle: { label: 'Shuttle', icon: BusIcon },
  walk: { label: 'Walk', icon: FootprintsIcon },
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

const PICK_REASONS: Record<PickReason, string> = {
  direct: 'direct',
  short_layover: 'short layover',
  daytime: 'daytime',
  cheaper: 'cheaper',
  central: 'central',
  high_rating: 'high rating',
  quiet_area: 'quiet area',
  family_friendly: 'family friendly',
};

/** "Picked for you: direct, daytime"; `null` when the traveller's preferences did not decide the pick. */
export function pickedLine(reasons: PickReason[] | null | undefined): string | null {
  return reasons?.length ? `Picked for you: ${reasons.map((reason) => PICK_REASONS[reason]).join(', ')}` : null;
}
