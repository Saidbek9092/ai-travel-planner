import {
  SseEventSchema,
  type AgentName,
  type DraftPayload,
  type LogPayload,
  type MessagePayload,
  type ProgressPayload,
  type ResultPayload,
  type SseEvent,
} from '@ai-travel/contracts';
import { randomUUID } from 'node:crypto';

type Input<T> = Partial<T> & Record<string, unknown>;

/** Every builder runs the packet through the contract, so fixtures cannot drift from it. */
export function logPacket(step: number, agent: AgentName, message: string, extra: Input<LogPayload> = {}): SseEvent {
  return SseEventSchema.parse({
    type: 'LOG',
    payload: { step, agent, message, timestamp: new Date().toISOString(), ...extra },
  });
}

export function messagePacket(
  step: number,
  agent: AgentName,
  text: string,
  extra: Input<MessagePayload> = {},
): SseEvent {
  return SseEventSchema.parse({
    type: 'MESSAGE',
    payload: { step, agent, text, timestamp: new Date().toISOString(), ...extra },
  });
}

export function progressPacket(
  progressPercent: number,
  currentStatus: ProgressPayload['currentStatus'],
  extra: Input<ProgressPayload> = {},
): SseEvent {
  return SseEventSchema.parse({ type: 'PROGRESS', payload: { progressPercent, currentStatus, ...extra } });
}

export function draftPacket(payload: DraftPayload): SseEvent {
  return SseEventSchema.parse({ type: 'DRAFT', payload });
}

const airport = (code: string, name: string) => ({ code, name });
const TAS = airport('TAS', 'Tashkent International');
const CDG = airport('CDG', 'Paris Charles de Gaulle');
const IST = airport('IST', 'Istanbul Airport');

function flight(price: number, via: boolean, source: 'serpapi' | 'mock', airline = via ? 'Turkish Airlines' : 'Uzbekistan Airways') {
  const leg = (from: typeof TAS, to: typeof TAS, dep: string, arr: string, stops: { airport: typeof TAS; layoverMinutes: number }[]) => ({
    from,
    to,
    departure: dep,
    arrival: arr,
    terminal: to.code === 'CDG' ? '1' : null,
    stops,
  });
  return {
    airline,
    price,
    outbound: leg(TAS, CDG, '2026-11-12T06:40:00+05:00', '2026-11-12T13:55:00+01:00', via ? [{ airport: IST, layoverMinutes: 110 }] : []),
    return: leg(CDG, TAS, '2026-11-17T15:10:00+01:00', '2026-11-18T00:30:00+05:00', via ? [{ airport: IST, layoverMinutes: 95 }] : []),
    bookingUrl: 'https://www.google.com/travel/flights',
    source,
  };
}

function hotel(name: string, pricePerNight: number, rating: number, source: 'serpapi' | 'mock') {
  return {
    name,
    area: '11th arrondissement',
    pricePerNight,
    rating,
    photoUrl: null,
    checkInTime: '15:00',
    checkOutTime: '11:00',
    transit: 'République · lines 3, 5, 8, 9, 11',
    location: { lat: 48.8675, lng: 2.3636 },
    bookingUrl: 'https://www.google.com/travel/hotels',
    source,
  };
}

const DAYS = [
  { title: 'Arrival and the Marais', places: [['Notre-Dame', 48.8530, 2.3499, 'Afternoon'], ['Place des Vosges', 48.8556, 2.3658, 'Evening']] },
  { title: 'Museums along the Seine', places: [['Louvre Museum', 48.8606, 2.3376, 'Morning'], ['Musée d’Orsay', 48.86, 2.3266, 'Afternoon'], ['Pont des Arts', 48.8583, 2.3375, 'Sunset']] },
  { title: 'Montmartre', places: [['Sacré-Cœur', 48.8867, 2.3431, 'Morning'], ['Place du Tertre', 48.8863, 2.3406, 'Noon'], ['Moulin Rouge', 48.8841, 2.3323, 'Evening']] },
  { title: 'Eiffel Tower and Trocadéro', places: [['Trocadéro', 48.8616, 2.2892, 'Morning'], ['Eiffel Tower', 48.8584, 2.2945, 'Afternoon']] },
  { title: 'Last stroll and departure', places: [['Jardin du Luxembourg', 48.8462, 2.3372, 'Morning'], ['Saint-Germain-des-Prés', 48.8539, 2.3338, 'Noon']] },
] as const;

function itinerary(days: number) {
  return DAYS.slice(0, days).map((d, i) => ({
    day: i + 1,
    date: `2026-11-${12 + i}`,
    title: d.title,
    weather: { highC: 12 - i, lowC: 6, condition: i === 2 ? 'Light rain' : 'Partly cloudy', icon: i === 2 ? 'rain' : 'partly-cloudy' },
    places: d.places.map(([name, lat, lng, note]) => ({ name, lat, lng, note })),
  }));
}

const transfers = [
  { day: 1, mode: 'train', description: 'CDG Terminal 1 → hotel (RER B + metro)', priceUsd: 14, durationMinutes: 55, note: null },
  { day: 5, mode: 'taxi', description: 'Hotel → CDG Terminal 1', priceUsd: 61, durationMinutes: 45, note: 'Leave the hotel by 12:00' },
];

export interface ResultOptions {
  status?: 'completed' | 'failed';
  source?: 'serpapi' | 'mock';
  replans?: number;
  overBudget?: boolean;
  error?: string | null;
}

export function resultPacket(threadId: string, options: ResultOptions = {}): SseEvent {
  const { status = 'completed', source = 'serpapi', replans = 0, overBudget = false, error = null } = options;
  const failed = status === 'failed';
  const flights = failed ? [] : [flight(overBudget ? 520 : 420, !overBudget, source), flight(500, false, source)];
  const hotels = failed ? [] : [hotel('Hôtel Bastille Speria', overBudget ? 120 : 95, 8.2, source), hotel('Ibis Paris République', 80, 7.4, source)];
  const totalCost = failed ? 0 : overBudget ? 520 + 600 + 75 + 150 : 420 + 475 + 75 + 150;
  const payload: ResultPayload = {
    threadId,
    status,
    origin: 'Tashkent',
    destination: 'Paris',
    durationDays: 5,
    startDate: '2026-11-12',
    totalCost,
    budget: 1200,
    currency: 'USD',
    flights,
    hotels,
    transfers: failed ? [] : (transfers as ResultPayload['transfers']),
    itinerary: failed ? [] : (itinerary(5) as ResultPayload['itinerary']),
    dailyExpensesEstimate: 30,
    replans,
    passes: failed
      ? []
      : Array.from({ length: replans + 1 }, (_, i) => ({
          pass: i + 1,
          flight: 500 - i * 40,
          hotel: 600 - i * 60,
          transfers: 75,
          daily: 150,
          totalCost: 1325 - i * 100,
          flightLabel: i === 0 ? '$500 direct' : '$460 via IST',
          hotelLabel: i === 0 ? '5 × $120' : '5 × $108',
        })),
    suggestions: overBudget ? { raiseBudgetTo: 1400, tryDays: 4 } : null,
    warnings: overBudget ? ['Trip is $25 over budget after 2 re-plans.'] : source === 'mock' ? ['Live prices were unavailable; showing estimates.'] : [],
    error: failed ? (error ?? 'The Flight agent could not find any flights.') : null,
  };
  return SseEventSchema.parse({ type: 'RESULT', payload });
}

export type Step = { packet: SseEvent; delayMs?: number } | { raw: string; delayMs?: number } | { end: true };

export type Scenario = (threadId: string) => Step[];

const s = (packet: SseEvent, delayMs = 350): Step => ({ packet, delayMs });

function baseRun(threadId: string, o: ResultOptions & { extraLogs?: boolean } = {}): Step[] {
  const steps: Step[] = [
    s(progressPacket(5, 'parsing', { run: { model: 'claude-sonnet-5-5', checkpointer: 'memory', lastCheckpointStep: null } })),
    s(logPacket(1, 'Supervisor', 'Parsing request: 5 days in Paris from Tashkent, $1,200')),
    s(draftPacket({ origin: 'Tashkent', destination: 'Paris', durationDays: 5, startDate: '2026-11-12', budget: 1200 })),
    s(messagePacket(1, 'Supervisor', 'Planning 5 days in Paris from Tashkent.', { decision: 'trip' })),
    s(progressPacket(20, 'searching')),
    s(logPacket(2, 'FlightAgent', 'Searching flights TAS → CDG')),
    s(logPacket(3, 'HotelAgent', 'Searching hotels in Paris')),
  ];
  if (o.source === 'mock') {
    steps.push(s(logPacket(2, 'FlightAgent', 'Live search unavailable, using estimates', { level: 'warn', kind: 'search-fallback' })));
  }
  steps.push(
    s(logPacket(4, 'FlightAgent', 'Found $500 direct flight')),
    s(messagePacket(2, 'FlightAgent', 'I picked a direct Uzbekistan Airways flight.', { decision: 'flight' })),
    s(progressPacket(45, 'planning', { detail: 'Day 1 of 5' })),
    s(logPacket(5, 'Planner', 'Building the itinerary')),
    s(progressPacket(70, 'planning', { detail: 'Day 4 of 5' })),
    s(logPacket(6, 'Planner', 'Itinerary ready: 5 days', { kind: 'checkpoint' })),
    s(progressPacket(85, 'auditing')),
  );
  if (o.replans) {
    for (let i = 1; i <= o.replans; i++) {
      steps.push(
        s(logPacket(6 + i * 2, 'BudgetAuditor', `Over budget by $125 — re-plan ${i} of 2`, { level: 'warn' })),
        s(progressPacket(50, 'searching', { pass: i + 1 })),
        s(logPacket(7 + i * 2, 'FlightAgent', `Re-searching cheaper flights (pass ${i + 1})`)),
        s(progressPacket(85, 'auditing', { pass: i + 1 })),
      );
    }
  }
  steps.push(s(logPacket(20, 'BudgetAuditor', o.overBudget ? 'Still $25 over budget' : 'Within budget', o.overBudget ? { level: 'warn' } : {})));
  return steps;
}

export const scenarios: Record<string, Scenario> = {
  happy: (id) => [...baseRun(id), s(progressPacket(100, 'completed')), s(resultPacket(id))],
  overBudget: (id) => [
    ...baseRun(id, { replans: 2, overBudget: true }),
    s(progressPacket(100, 'completed', { pass: 3 })),
    s(resultPacket(id, { replans: 2, overBudget: true })),
  ],
  mockData: (id) => [...baseRun(id, { source: 'mock' }), s(progressPacket(100, 'completed')), s(resultPacket(id, { source: 'mock' }))],
  failed: (id) => [
    ...baseRun(id).slice(0, 7),
    s(logPacket(4, 'FlightAgent', 'No flights found', { level: 'error' })),
    s(resultPacket(id, { status: 'failed' })),
  ],
  dropped: (id) => [...baseRun(id).slice(0, 8), { end: true }],
  invalidPacket: (id) => [
    ...baseRun(id).slice(0, 5),
    { raw: JSON.stringify({ type: 'LOG', payload: { nope: true } }), delayMs: 200 },
    ...baseRun(id).slice(5),
    s(progressPacket(100, 'completed')),
    s(resultPacket(id)),
  ],
};

export const newThreadId = () => randomUUID();
