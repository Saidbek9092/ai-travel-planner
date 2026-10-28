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

// ── The design's Paris trip ─────────────────────────────────────────────────

type Source = 'serpapi' | 'mock';

const airport = (code: string, name: string) => ({ code, name });
const TAS = airport('TAS', 'Tashkent International');
const CDG = airport('CDG', 'Paris Charles de Gaulle');
const IST = airport('IST', 'Istanbul Airport');

const START = '2026-11-12';
const DAYS = 5;
const NIGHTS = DAYS - 1;

function turkish(source: Source) {
  return {
    airline: 'Turkish Airlines',
    price: 420,
    outbound: {
      from: TAS,
      to: CDG,
      departure: '2026-11-12T06:40:00+05:00',
      arrival: '2026-11-12T13:55:00+01:00',
      terminal: '1',
      stops: [{ airport: IST, layoverMinutes: 110 }],
    },
    return: {
      from: CDG,
      to: TAS,
      departure: '2026-11-16T19:10:00+01:00',
      arrival: '2026-11-17T06:20:00+05:00',
      terminal: null,
      stops: [{ airport: IST, layoverMinutes: 125 }],
    },
    bookingUrl: 'https://www.google.com/travel/flights',
    source,
  };
}

function uzbekistan(source: Source) {
  return {
    airline: 'Uzbekistan Airways',
    price: 500,
    outbound: { from: TAS, to: CDG, departure: '2026-11-12T07:10:00+05:00', arrival: '2026-11-12T11:45:00+01:00', terminal: '2E', stops: [] },
    return: { from: CDG, to: TAS, departure: '2026-11-16T13:20:00+01:00', arrival: '2026-11-16T23:55:00+05:00', terminal: null, stops: [] },
    bookingUrl: 'https://www.google.com/travel/flights',
    source,
  };
}

function hotel(name: string, area: string, pricePerNight: number, rating: number, source: Source, location: { lat: number; lng: number }) {
  return {
    name,
    area,
    pricePerNight,
    rating,
    photoUrl: null,
    checkInTime: '15:00',
    checkOutTime: '11:00',
    transit: area === 'Le Marais' ? 'Saint-Paul · line 1' : 'République · lines 3, 5, 8, 9, 11',
    location,
    bookingUrl: 'https://www.google.com/travel/hotels',
    source,
  };
}

const canal = (source: Source) => hotel('Hôtel Canal République', '11th arrondissement', 80, 8.2, source, { lat: 48.8675, lng: 2.3636 });
const lumiere = (source: Source) => hotel('Hôtel Lumière Marais', 'Le Marais', 105, 8.6, source, { lat: 48.8578, lng: 2.3622 });

const taxiIn = {
  day: 1,
  mode: 'taxi',
  description: 'CDG Terminal 1 → hotel',
  priceUsd: 61,
  durationMinutes: 45,
  note: 'Fixed fare €56 to the Right Bank',
} as const;
const trainOut = {
  day: DAYS,
  mode: 'train',
  description: 'RER B · Gare du Nord → CDG Terminal 1',
  priceUsd: 14,
  durationMinutes: 35,
  note: 'Leave the hotel by 16:00',
} as const;

type Stop = readonly [name: string, lat: number, lng: number, note: string];
const PLAN: { title: string; weather: [number, number, string, string]; places: Stop[] }[] = [
  {
    title: 'Arrive and Le Marais',
    weather: [12, 8, 'Partly cloudy', 'partly-cloudy'],
    places: [
      ['Place des Vosges', 48.8556, 2.3655, 'Late afternoon'],
      ['Musée Carnavalet', 48.8576, 2.3626, 'Before closing'],
      ['Rue des Rosiers', 48.8571, 2.359, 'Dinner'],
    ],
  },
  {
    title: 'Louvre and the Seine',
    weather: [13, 9, 'Cloudy', 'cloudy'],
    places: [
      ['Musée du Louvre', 48.8606, 2.3376, 'Morning, timed entry'],
      ['Jardin des Tuileries', 48.8635, 2.3275, 'Walk and lunch'],
      ["Musée d'Orsay", 48.86, 2.3266, 'Afternoon'],
    ],
  },
  {
    title: 'Indoor day for the rain',
    weather: [11, 8, 'Rain', 'rain'],
    places: [
      ['Centre Pompidou', 48.8606, 2.3522, 'Morning'],
      ['Opéra Garnier', 48.872, 2.3316, 'Guided tour'],
      ['Galeries Lafayette', 48.8738, 2.332, 'Rooftop view'],
    ],
  },
  {
    title: 'Eiffel Tower and the river',
    weather: [12, 7, 'Partly cloudy', 'partly-cloudy'],
    places: [
      ['Trocadéro', 48.8616, 2.2893, 'Morning photos'],
      ['Eiffel Tower', 48.8584, 2.2945, 'Summit, pre-booked'],
      ['Seine cruise', 48.8638, 2.3017, 'Sunset'],
    ],
  },
  {
    title: 'Montmartre',
    weather: [10, 4, 'Sunny', 'clear'],
    places: [
      ['Sacré-Cœur', 48.8867, 2.3431, 'Morning'],
      ['Place du Tertre', 48.8865, 2.3408, 'Painters and lunch'],
      ['Moulin Rouge', 48.8841, 2.3322, 'Before the train'],
    ],
  },
];

function itinerary(days: number) {
  return PLAN.slice(0, days).map((d, i) => ({
    day: i + 1,
    date: `2026-11-${12 + i}`,
    title: d.title,
    weather: { highC: d.weather[0], lowC: d.weather[1], condition: d.weather[2], icon: d.weather[3] },
    places: d.places.map(([name, lat, lng, note]) => ({ name, lat, lng, note })),
  })) as unknown as ResultPayload['itinerary'];
}

const DAILY = 30;
const PASS1 = { flight: 500, hotel: 105 * NIGHTS, transfers: 0, daily: DAILY * DAYS };
const PASS2 = { flight: 420, hotel: 80 * NIGHTS, transfers: taxiIn.priceUsd + trainOut.priceUsd, daily: DAILY * DAYS };
const total = (p: typeof PASS1) => p.flight + p.hotel + p.transfers + p.daily;

export interface ResultOptions {
  status?: 'completed' | 'failed';
  source?: Source;
  replans?: number;
  overBudget?: boolean;
  error?: string | null;
}

export function resultPayload(threadId: string, options: ResultOptions = {}): ResultPayload {
  const { status = 'completed', source = 'serpapi', replans = 1, overBudget = false, error = null } = options;
  const failed = status === 'failed';
  const budget = overBudget ? 900 : 1000;
  const totalCost = failed ? 0 : total(PASS2);
  const passes = Array.from({ length: replans + 1 }, (_, i) => {
    const p = i === 0 ? PASS1 : PASS2;
    return {
      pass: i + 1,
      ...p,
      totalCost: total(p),
      flightLabel: i === 0 ? '$500 direct' : '$420 via IST',
      hotelLabel: `${NIGHTS} × ${i === 0 ? '$105' : '$80'}`,
    };
  });
  return {
    threadId,
    status,
    origin: 'Tashkent',
    destination: 'Paris',
    durationDays: DAYS,
    startDate: START,
    totalCost,
    budget,
    currency: 'USD',
    flights: failed ? [] : [turkish(source), uzbekistan(source)],
    hotels: failed ? [] : [canal(source), lumiere(source)],
    transfers: failed ? [] : [taxiIn, trainOut],
    itinerary: failed ? [] : itinerary(DAYS),
    dailyExpensesEstimate: DAILY,
    replans: failed ? 0 : replans,
    passes: failed ? [] : passes,
    suggestions: overBudget ? { raiseBudgetTo: 1000, tryDays: 4 } : null,
    warnings: overBudget
      ? [`Trip is ${'$'}${totalCost - budget} over budget after 2 re-plans.`]
      : source === 'mock'
        ? ['Live prices were unavailable; showing estimates.']
        : [],
    error: failed ? (error ?? 'The Flight agent could not find any flights.') : null,
  };
}

export function resultPacket(threadId: string, options: ResultOptions = {}): SseEvent {
  return SseEventSchema.parse({ type: 'RESULT', payload: resultPayload(threadId, options) });
}

// ── Scenarios ───────────────────────────────────────────────────────────────

export type Step = { packet: SseEvent; delayMs?: number } | { raw: string; delayMs?: number } | { end: true } | { drop: true };

export type Scenario = (threadId: string) => Step[];

const s = (packet: SseEvent, delayMs = 450): Step => ({ packet, delayMs });
const run = (lastCheckpointStep: number | null) => ({ model: 'claude-sonnet-5-5', checkpointer: 'memory' as const, lastCheckpointStep });
const checkpoint = (step: number) => s(logPacket(step, 'System', `state saved after step ${step} · MemorySaver`, { kind: 'checkpoint' }), 150);

interface RunOptions {
  source?: Source;
  overBudget?: boolean;
  llmFallback?: boolean;
}

/** Brief → pass 1 (over budget) → re-plan with confirmations → days 1…5 → audit. Ends before PROGRESS 100 / RESULT. */
function designRun(o: RunOptions = {}): Step[] {
  const source = o.source ?? 'serpapi';
  const budget = o.overBudget ? 900 : 1000;
  const p1 = total(PASS1);
  const p2 = total(PASS2);
  const brief = { origin: 'Tashkent', destination: 'Paris', durationDays: DAYS, startDate: START, budget };
  const steps: Step[] = [
    s(progressPacket(4, 'parsing', { run: run(null) }), 300),
    s(logPacket(1, 'Supervisor', `Parsed brief → { destination: "Paris", budget: ${budget}, durationDays: ${DAYS} }`)),
    s(draftPacket(brief), 150),
    s(
      messagePacket(1, 'Supervisor', `Got it — ${DAYS} days in Paris from Tashkent, 12–16 November, $${budget.toLocaleString('en-US')} all-in. @Flight Agent and @Hotel Agent, you're up.`, {
        decision: 'trip',
        callout: { tone: 'info', label: `Paris · ${DAYS} days · $${budget.toLocaleString('en-US')}` },
      }),
    ),
    checkpoint(1),
    s(progressPacket(12, 'searching', { run: run(1) })),
  ];
  if (o.llmFallback) {
    steps.push(s(logPacket(2, 'System', 'Primary model unavailable (503) → fallback claude-haiku-5-5', { level: 'warn', kind: 'llm-fallback' })));
  }
  if (source === 'mock') {
    steps.push(s(logPacket(2, 'FlightAgent', 'SerpAPI unavailable → estimated prices', { level: 'warn', kind: 'search-fallback' })));
  }
  steps.push(
    s(logPacket(2, 'FlightAgent', 'Found a $500 flight on the Tashkent → Paris route (direct)')),
    s(draftPacket({ flights: [uzbekistan(source)] }), 150),
    s(
      messagePacket(
        2,
        'FlightAgent',
        source === 'mock'
          ? "Direct first: Uzbekistan Airways, $500 round trip. Live prices weren't available, so these are estimates."
          : "Direct first: Uzbekistan Airways, Tashkent (TAS) to Paris Charles de Gaulle (CDG), $500 round trip. Easy, but it's half the budget.",
      ),
    ),
    s(progressPacket(24, 'searching', { run: run(2) })),
    s(logPacket(3, 'HotelAgent', `${NIGHTS} nights × $105 = $${105 * NIGHTS} · Le Marais · rated 8.6`)),
    s(draftPacket({ hotels: [lumiere(source)], dailyExpensesEstimate: DAILY }), 150),
    s(messagePacket(3, 'HotelAgent', 'Hôtel Lumière in Le Marais is $105/night, which is pushing the budget. Let me check the République area…')),
    s(progressPacket(34, 'auditing', { run: run(3) })),
    s(logPacket(4, 'BudgetAuditor', `Total $${p1} > budget $${budget} (flights 500 + hotel ${PASS1.hotel} + daily ${PASS1.daily})`)),
    s(draftPacket({ totalCost: p1 }), 150),
    s(
      messagePacket(4, 'BudgetAuditor', `Heads up: with daily costs that's $${p1.toLocaleString('en-US')} against $${budget.toLocaleString('en-US')}. We need to find about $${p1 - budget} before we lock anything in.`, {
        callout: { tone: 'warn', label: `Over budget by $${p1 - budget} · re-plan 1 of 2` },
      }),
    ),
    s(logPacket(4, 'BudgetAuditor', 'retryCount 0 → 1 · loop back: find cheaper flights and hotels', { level: 'warn' })),
    checkpoint(4),
    s(progressPacket(42, 'searching', { pass: 2, run: run(4) })),
    s(logPacket(5, 'FlightAgent', 'SerpAPI 429 · retrying in 2s (1 of 3)', { level: 'warn' }), 700),
    s(logPacket(5, 'FlightAgent', 'Found $420 via Istanbul (1 stop) · saves $80')),
    s(draftPacket({ flights: [turkish(source), uzbekistan(source)] }), 150),
    s(
      messagePacket(5, 'FlightAgent', 'Turkish Airlines via Istanbul is $420. The layover at Istanbul Airport (IST) is 1 h 50 m — enough to change gates without rushing. It lands at CDG Terminal 1 at 13:55.', {
        decision: 'flight',
        callout: { tone: 'info', label: 'TAS → IST → CDG · $420 · saves $80' },
      }),
    ),
    s(progressPacket(50, 'searching', { pass: 2, run: run(5) })),
    s(logPacket(6, 'HotelAgent', `${NIGHTS} nights × $80 = $${80 * NIGHTS} · République · rated 8.2 · saves $${PASS1.hotel - PASS2.hotel}`)),
    s(draftPacket({ hotels: [canal(source), lumiere(source)] }), 150),
    s(
      messagePacket(6, 'HotelAgent', `Found a great stay near République for $80/night! Rated 8.2, saving us $${PASS1.hotel - PASS2.hotel}. Five metro lines stop right outside.`, {
        decision: 'hotel',
        callout: { tone: 'info', label: `Hôtel Canal République · ${NIGHTS} nights · $${PASS2.hotel}` },
      }),
    ),
    checkpoint(6),
    s(progressPacket(56, 'planning', { pass: 2, detail: 'Transfers', run: run(6) })),
    s(logPacket(7, 'Planner', 'Transfer in: taxi CDG T1 → hotel · €56 fixed (~$61)')),
    s(draftPacket({ transfers: [taxiIn] }), 150),
    s(messagePacket(7, 'Planner', "Landing at 13:55 with bags, a taxi is the simplest way in. Paris airport taxis charge a fixed €56 to the Right Bank, and it's about 45 minutes to the hotel.")),
    s(messagePacket(7, 'BudgetAuditor', `A taxi both ways takes us to $${(p2 - trainOut.priceUsd + taxiIn.priceUsd).toLocaleString('en-US')}. @Itinerary Planner, can we do the trip home differently?`)),
    s(logPacket(7, 'Planner', 'Transfer out: RER B Gare du Nord → CDG T1 · $14')),
    s(draftPacket({ transfers: [taxiIn, trainOut] }), 150),
    s(
      messagePacket(7, 'Planner', 'Sure — on Monday the RER B train runs from Gare du Nord straight to CDG for about $14. Taxi in, train out.', {
        decision: 'transfers',
        callout: { tone: 'info', label: `taxi in, RER B out · $${PASS2.transfers}` },
      }),
    ),
    s(logPacket(7, 'Planner', 'Forecast Sat 14 Nov: rain, 11°C → day 3 indoors')),
    s(
      messagePacket(7, 'Planner', 'Saturday looks wet, around 11°C, so Day 3 is now an indoor day: Centre Pompidou and Opéra Garnier. Pack a light waterproof jacket.', {
        callout: { tone: 'info', label: 'Weather prep · Day 3 moved indoors' },
      }),
    ),
  );
  for (let day = 1; day <= DAYS; day++) {
    steps.push(
      s(progressPacket(58 + day * 6, 'planning', { pass: 2, detail: `Day ${day} of ${DAYS}`, run: run(7) }), 300),
      s(logPacket(7, 'Planner', `Drafted day ${day} · ${PLAN[day - 1]!.places.length} places with coordinates`), 900),
      s(draftPacket({ itinerary: itinerary(day) }), 150),
    );
  }
  steps.push(
    s(
      messagePacket(7, 'Planner', 'Your 5-day plan is ready: Le Marais, the Louvre, an indoor rain day, the Eiffel Tower and Montmartre.', {
        decision: 'itinerary',
        callout: { tone: 'info', label: `${DAYS} days · 15 stops` },
      }),
    ),
    checkpoint(7),
    s(progressPacket(92, 'auditing', { pass: 2, run: run(7) })),
    s(logPacket(8, 'BudgetAuditor', `Total $${p2} ${p2 > budget ? '>' : '≤'} budget $${budget} (flights 420 + hotel ${PASS2.hotel} + transfers ${PASS2.transfers} + daily ${PASS2.daily})`, o.overBudget ? { level: 'warn' } : {})),
    s(draftPacket({ totalCost: p2 }), 150),
  );
  if (o.overBudget) {
    steps.push(
      s(messagePacket(8, 'BudgetAuditor', `Still $${p2 - budget} over. One more try for cheaper options.`, { callout: { tone: 'warn', label: `Over budget by $${p2 - budget} · re-plan 2 of 2` } })),
      s(progressPacket(94, 'searching', { pass: 3, run: run(8) })),
      s(logPacket(9, 'FlightAgent', 'No cheaper flight than $420 via Istanbul')),
      s(logPacket(10, 'HotelAgent', 'No cheaper hotel rated ≥ 7.5 than $80/night')),
      s(logPacket(11, 'Planner', 'Kept the itinerary; transfers unchanged')),
      s(progressPacket(97, 'auditing', { pass: 3, run: run(11) })),
      s(logPacket(12, 'BudgetAuditor', `Total $${p2} > budget $${budget} after 2 re-plans → stop`, { level: 'warn' })),
      s(messagePacket(12, 'BudgetAuditor', 'This is the cheapest combination I could find.')),
      s(messagePacket(12, 'BudgetAuditor', `Best I could do is $${p2}, $${p2 - budget} over budget.`, { decision: 'budget' })),
    );
  } else {
    steps.push(s(messagePacket(8, 'BudgetAuditor', `All in, that's $${p2} of $${budget.toLocaleString('en-US')} with $${budget - p2} to spare. Approved — enjoy Paris!`, { decision: 'budget' })));
  }
  return steps;
}

const finish = (id: string, options: ResultOptions = {}): Step[] => [
  s(progressPacket(100, 'completed', { pass: options.overBudget ? 3 : 2, run: run(options.overBudget ? 12 : 8) }), 300),
  s(resultPacket(id, options), 150),
];

export const scenarios: Record<string, Scenario> = {
  happy: (id) => [...designRun(), ...finish(id)],
  overBudget: (id) => [...designRun({ overBudget: true }), ...finish(id, { replans: 2, overBudget: true })],
  mockData: (id) => [...designRun({ source: 'mock' }), ...finish(id, { source: 'mock' })],
  fallback: (id) => [...designRun({ llmFallback: true }), ...finish(id)],
  failed: (id) => [
    ...designRun().slice(0, 7),
    s(logPacket(2, 'FlightAgent', 'SerpAPI 503 after 3 retries · no flights', { level: 'error' })),
    s(messagePacket(2, 'FlightAgent', "I couldn't reach any flight search right now. Could you try again in a few minutes?")),
    s(resultPacket(id, { status: 'failed' })),
  ],
  /** The run itself is lost: the stream ends without a RESULT and reconnects get 404. */
  dropped: () => [...designRun().slice(0, 10), { end: true }],
  /** The connection drops mid-run; the run keeps going and a reconnect catches up. */
  drop: (id) => {
    const steps = [...designRun(), ...finish(id)];
    steps.splice(18, 0, { drop: true });
    return steps;
  },
  invalidPacket: (id) => [
    ...designRun().slice(0, 5),
    { raw: JSON.stringify({ type: 'LOG', payload: { nope: true } }), delayMs: 200 },
    ...designRun().slice(5),
    ...finish(id),
  ],
};

export const newThreadId = () => randomUUID();
