import type { AgentName, DecisionTopic, DraftPayload, LogPayload, ProgressPayload, ResultPayload, TripRequest } from '@ai-travel/contracts';
import { AGENT_ORDER, DECISION_AGENTS, PHASES, TRANSFER_MODES } from '@/lib/labels';
import { formatUsd, nightsFor } from '@/lib/utils';

/** What the Trip Overview reads: the result when it is in, the draft before that. */
export type TripView = DraftPayload | ResultPayload;

export interface BudgetParts {
  flight: number;
  hotel: number;
  transfers: number;
  daily: number;
}

/** Display-only breakdown; the agent's `totalCost` is authoritative. */
export function budgetParts(trip: TripView): BudgetParts {
  const days = trip.durationDays ?? 0;
  return {
    flight: trip.flights?.[0]?.price ?? 0,
    hotel: (trip.hotels?.[0]?.pricePerNight ?? 0) * (days ? nightsFor(days) : 0),
    transfers: (trip.transfers ?? []).reduce((sum, t) => sum + t.priceUsd, 0),
    daily: (trip.dailyExpensesEstimate ?? 0) * days,
  };
}

/**
 * The agent's `totalCost` once the Budget Auditor has the final word (`final`); before that the running total of the
 * parts known so far, because a draft's `totalCost` can be from an earlier pass.
 */
export function tripTotal(trip: TripView, final: boolean): number {
  if (final && trip.totalCost !== undefined && trip.totalCost > 0) return trip.totalCost;
  const p = budgetParts(trip);
  return p.flight + p.hotel + p.transfers + p.daily;
}

/** `"Day 4 of 5"` → `4`. */
export function draftingDay(detail: string | null | undefined): number | null {
  const match = detail ? /day\s+(\d+)/i.exec(detail) : null;
  return match ? Number(match[1]) : null;
}

export type AgentRunStatus = 'waiting' | 'running' | 'done' | 'failed';

export interface AgentRow {
  agent: AgentName;
  status: AgentRunStatus;
  latest: LogPayload | null;
  /** Logged in a re-plan pass (`pass 2` tag). */
  rerun: boolean;
}

/** Board rows, derived from the logs (never sent): done = logged this pass, running = first agent without a log. */
export function agentRows(
  logs: LogPayload[],
  passStart: number,
  progress: ProgressPayload | null,
  status: 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'completed' | 'failed' | 'aborted',
): AgentRow[] {
  const pass = progress?.pass ?? 1;
  const current = logs.slice(passStart);
  const lastError = status === 'failed' ? [...logs].reverse().find((l) => l.level === 'error') : undefined;
  const live = status === 'connecting' || status === 'streaming' || status === 'reconnecting';
  let runningGiven = false;
  return AGENT_ORDER.map((agent) => {
    const latest = [...logs].reverse().find((l) => l.agent === agent) ?? null;
    const loggedNow = current.some((l) => l.agent === agent);
    // The Supervisor runs once; re-plan passes start at the search agents.
    // A completed run (also a reopened one, which has no logs) finished every agent.
    const done = loggedNow || (agent === 'Supervisor' && latest !== null) || status === 'completed';
    let rowStatus: AgentRunStatus = done ? 'done' : 'waiting';
    if (lastError?.agent === agent) rowStatus = 'failed';
    else if (!done && live && !runningGiven) {
      rowStatus = 'running';
      runningGiven = true;
    }
    return { agent, status: rowStatus, latest, rerun: pass > 1 && loggedNow && agent !== 'Supervisor' };
  });
}

export type PhaseState = 'done' | 'current' | 'pending';

/**
 * Phase chips: done when the decision is confirmed or its data is already in the draft (the agents confirm flight,
 * hotel and transfers only at the end of a first-pass run), budget check when the result is in; current = first not done.
 */
export function phaseStates(
  decisions: Partial<Record<DecisionTopic, unknown>>,
  trip: TripView,
  progress: ProgressPayload | null,
  hasResult: boolean,
): { topic: DecisionTopic; label: string; state: PhaseState }[] {
  const auditing = progress?.currentStatus === 'auditing' || progress?.currentStatus === 'completed';
  const reached: Record<DecisionTopic, boolean> = {
    trip: !!decisions.trip || !!trip.destination,
    flight: !!decisions.flight || (trip.flights?.length ?? 0) > 0,
    hotel: !!decisions.hotel || (trip.hotels?.length ?? 0) > 0,
    transfers: !!decisions.transfers || (trip.transfers?.length ?? 0) > 0,
    itinerary: !!decisions.itinerary || ((trip.itinerary?.length ?? 0) > 0 && auditing),
    budget: hasResult,
  };
  let currentGiven = false;
  return PHASES.map(({ topic, label }) => {
    if (reached[topic]) return { topic, label, state: 'done' as const };
    if (currentGiven) return { topic, label, state: 'pending' as const };
    currentGiven = true;
    return { topic, label, state: 'current' as const };
  });
}

/** Seconds left, from the elapsed time and the percent; `null` below 15 % or when it can't be told. */
export function etaSeconds(percent: number, startedAt: number | null, now: number): number | null {
  if (startedAt === null || now === 0 || percent < 15 || percent >= 100) return null;
  const elapsed = (now - startedAt) / 1000;
  if (elapsed <= 0) return null;
  return Math.max(1, Math.round((elapsed * (100 - percent)) / percent));
}

/** "about 20 s left" / "about 2 min left". */
export function formatEta(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s left`;
  return `about ${Math.round(seconds / 60)} min left`;
}

/** "5 days in Paris" */
export function tripTitle(trip: { durationDays?: number; destination?: string }): string {
  const days = trip.durationDays ?? 0;
  if (!trip.destination) return 'Your trip';
  return days ? `${days} ${days === 1 ? 'day' : 'days'} in ${trip.destination}` : trip.destination;
}

/** "once" / "twice" / "3 times" */
export function timesWord(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

/** "Tashkent → Paris · 5 days · $1,000" */
export function briefLine(trip: TripView): string | null {
  if (!trip.destination) return null;
  return [
    trip.origin ? `${trip.origin} → ${trip.destination}` : trip.destination,
    trip.durationDays ? `${trip.durationDays} days` : null,
    trip.budget ? formatUsd(trip.budget) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The six confirmed decisions of a finished trip, described from the result itself, so a reopened trip
 * (no chat history) still lists them.
 */
export function decisionSummaries(result: ResultPayload): { topic: DecisionTopic; agent: AgentName; summary: string; ok: boolean }[] {
  const first = result.passes[0];
  const parts = budgetParts(result);
  const flight = result.flights[0];
  const hotel = result.hotels[0];
  const saves = (before: number | undefined, now: number) => (before !== undefined && before > now ? `, saves ${formatUsd(before - now)}` : '');
  const rows: [DecisionTopic, string | null][] = [
    ['trip', [result.destination, `${result.durationDays} days`, formatUsd(result.budget)].join(' · ')],
    [
      'flight',
      flight
        ? `${flight.outbound.stops.length ? `Via ${flight.outbound.stops.map((s) => s.airport.code).join(', ')}` : 'Direct'}, ${formatUsd(flight.price)}${saves(first?.flight, flight.price)}`
        : null,
    ],
    ['hotel', hotel ? `${hotel.area ?? hotel.name}, ${formatUsd(hotel.pricePerNight)}/night${saves(first?.hotel, parts.hotel)}` : null],
    [
      'transfers',
      result.transfers.length
        ? `${result.transfers.map((t, i) => `${TRANSFER_MODES[t.mode].label.toLowerCase()} ${i === 0 ? 'in' : 'out'}`).join(', ')}, ${formatUsd(parts.transfers)}`.replace(/^./, (c) => c.toUpperCase())
        : null,
    ],
    [
      'itinerary',
      result.itinerary.length
        ? `${result.itinerary.length} days, ${result.itinerary.reduce((n, d) => n + d.places.length, 0)} stops${result.itinerary.some((d) => d.weather?.icon === 'rain') ? ', rain day indoors' : ''}`
        : null,
    ],
    ['budget', `${formatUsd(result.totalCost)} of ${formatUsd(result.budget)}`],
  ];
  return rows
    .filter((r): r is [DecisionTopic, string] => r[1] !== null)
    .map(([topic, summary]) => ({ topic, agent: DECISION_AGENTS[topic], summary, ok: topic !== 'budget' || result.totalCost <= result.budget }));
}

/** A request that plans the same trip again (Re-plan on a reopened trip, where the original request is unknown). */
export function requestFromResult(result: ResultPayload, today: string): TripRequest {
  const prompt = `${result.durationDays} days in ${result.destination}${result.origin ? ` from ${result.origin}` : ''}, ${formatUsd(result.budget)} budget`;
  return {
    prompt,
    ...(result.origin ? { origin: result.origin } : {}),
    ...(result.budget ? { budget: result.budget } : {}),
    ...(result.durationDays ? { durationDays: result.durationDays } : {}),
    ...(result.startDate && result.startDate >= today ? { startDate: result.startDate } : {}),
  };
}
