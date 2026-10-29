import { describe, expect, it } from 'vitest';
import {
  DraftPayloadSchema,
  ErrorBodySchema,
  ErrorCodeSchema,
  parseStoredResult,
  RESULT_SCHEMA_VERSION,
  TripListResponseSchema,
  TripRecordSchema,
  SseEventSchema,
  TripContextQuerySchema,
  TripContextSchema,
  TripRequestSchema,
  type Flight,
  type Hotel,
  type ResultPayload,
} from '../src/index.js';

const flight: Flight = {
  airline: 'Turkish Airlines',
  price: 420,
  outbound: {
    from: { code: 'TAS', name: 'Tashkent International' },
    to: { code: 'CDG', name: 'Paris Charles de Gaulle' },
    departure: '2026-11-12T06:40:00+05:00',
    arrival: '2026-11-12T13:55:00+01:00',
    terminal: 'T1',
    stops: [{ airport: { code: 'IST', name: 'Istanbul Airport' }, layoverMinutes: 110 }],
  },
  return: null,
  bookingUrl: null,
  source: 'serpapi',
};

const hotel: Hotel = {
  name: 'Hôtel Canal République',
  area: '11th arrondissement',
  pricePerNight: 66,
  rating: 8.2,
  photoUrl: null,
  checkInTime: '15:00',
  checkOutTime: '11:00',
  transit: 'République · lines 3, 5, 8, 9, 11',
  location: { lat: 48.8675, lng: 2.3636 },
  bookingUrl: null,
  source: 'mock',
};

const result: ResultPayload = {
  schemaVersion: RESULT_SCHEMA_VERSION,
  threadId: '7f1c2a4e-3b5d-4c6e-8f90-1a2b3c4d5e6f',
  status: 'completed',
  origin: 'Tashkent',
  destination: 'Paris',
  durationDays: 5,
  startDate: '2026-11-12',
  totalCost: 975,
  budget: 1000,
  currency: 'USD',
  flights: [flight],
  hotels: [hotel],
  transfers: [
    { day: 1, mode: 'taxi', description: 'CDG Terminal 1 → hotel', priceUsd: 61, durationMinutes: 45, note: 'Fixed fare €56' },
    { day: 5, mode: 'train', description: 'Gare du Nord → CDG Terminal 1 (RER B)', priceUsd: 14, durationMinutes: 35, note: null },
  ],
  itinerary: [
    {
      day: 1,
      date: '2026-11-12',
      title: 'Arrive and Le Marais',
      weather: { highC: 14, lowC: 9, condition: 'Partly cloudy', icon: 'partly-cloudy' },
      places: [{ name: 'Place des Vosges', lat: 48.8556, lng: 2.3655, note: 'Afternoon' }],
    },
  ],
  dailyExpensesEstimate: 30,
  replans: 1,
  passes: [
    { pass: 1, flight: 500, hotel: 475, transfers: 122, daily: 150, totalCost: 1247, flightLabel: '$500 direct', hotelLabel: '5 × $95' },
    { pass: 2, flight: 420, hotel: 330, transfers: 75, daily: 150, totalCost: 975, flightLabel: '$420 via IST', hotelLabel: '5 × $66' },
  ],
  suggestions: null,
  warnings: [],
  error: null,
};

describe('SseEventSchema', () => {
  it('accepts the blueprint LOG example and defaults level and kind', () => {
    const parsed = SseEventSchema.parse({
      type: 'LOG',
      payload: {
        step: 2,
        agent: 'FlightAgent',
        message: 'Found a $500 flight on the Tashkent -> Paris route.',
        timestamp: '2026-10-25T10:25:00Z',
      },
    });
    expect(parsed.type).toBe('LOG');
    expect(parsed.type === 'LOG' && parsed.payload.level).toBe('info');
    expect(parsed.type === 'LOG' && parsed.payload.kind).toBe('log');
  });

  it('accepts a checkpoint LOG', () => {
    expect(
      SseEventSchema.safeParse({
        type: 'LOG',
        payload: {
          step: 5,
          agent: 'System',
          message: 'State saved after step 5 · PostgresSaver',
          timestamp: '2026-10-25T10:25:11Z',
          kind: 'checkpoint',
        },
      }).success,
    ).toBe(true);
  });

  it('accepts an ordinary MESSAGE and defaults decision and callout to null', () => {
    const parsed = SseEventSchema.parse({
      type: 'MESSAGE',
      payload: {
        step: 2,
        agent: 'FlightAgent',
        text: 'I found 4 flights — the best option is Uzbekistan Airways at $500.',
        timestamp: '2026-10-25T10:25:00Z',
      },
    });
    expect(parsed.type === 'MESSAGE' && parsed.payload.decision).toBeNull();
    expect(parsed.type === 'MESSAGE' && parsed.payload.callout).toBeNull();
  });

  it('accepts a confirmed-decision MESSAGE with a callout', () => {
    expect(
      SseEventSchema.safeParse({
        type: 'MESSAGE',
        payload: {
          step: 6,
          agent: 'Planner',
          text: 'Saturday looks wet, so Day 3 is now an indoor day.',
          timestamp: '2026-10-25T10:26:00Z',
          decision: 'transfers',
          callout: { tone: 'info', label: 'Weather prep · Day 3 moved indoors' },
        },
      }).success,
    ).toBe(true);
  });

  it('accepts the blueprint PROGRESS example and defaults the new fields', () => {
    const parsed = SseEventSchema.parse({
      type: 'PROGRESS',
      payload: { progressPercent: 65, currentStatus: 'planning' },
    });
    expect(parsed.type === 'PROGRESS' && parsed.payload).toMatchObject({ detail: null, pass: 1, run: null });
  });

  it('accepts PROGRESS with detail, pass and run info', () => {
    expect(
      SseEventSchema.safeParse({
        type: 'PROGRESS',
        payload: {
          progressPercent: 70,
          currentStatus: 'planning',
          detail: 'Day 4 of 5',
          pass: 2,
          run: { model: 'claude-opus-5-5', checkpointer: 'postgres', lastCheckpointStep: 5 },
        },
      }).success,
    ).toBe(true);
  });

  it('accepts a partial DRAFT and an empty one', () => {
    expect(
      SseEventSchema.safeParse({ type: 'DRAFT', payload: { destination: 'Paris', flights: [flight] } }).success,
    ).toBe(true);
    expect(SseEventSchema.safeParse({ type: 'DRAFT', payload: {} }).success).toBe(true);
    expect(DraftPayloadSchema.safeParse({ budget: -5 }).success).toBe(false);
  });

  it('accepts a full RESULT packet', () => {
    expect(SseEventSchema.safeParse({ type: 'RESULT', payload: result }).success).toBe(true);
  });

  it('accepts a RESULT with suggestions for an over-budget trip', () => {
    expect(
      SseEventSchema.safeParse({
        type: 'RESULT',
        payload: { ...result, totalCost: 1084, replans: 2, suggestions: { raiseBudgetTo: 1100, tryDays: 4 } },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['unknown type', { type: 'DEBUG', payload: {} }],
    ['missing payload', { type: 'LOG' }],
    ['unknown agent', { type: 'LOG', payload: { step: 1, agent: 'Hacker', message: 'x', timestamp: '2026-10-25T10:25:00Z' } }],
    ['the old ItineraryPlanner name', { type: 'LOG', payload: { step: 1, agent: 'ItineraryPlanner', message: 'x', timestamp: '2026-10-25T10:25:00Z' } }],
    ['step 0', { type: 'LOG', payload: { step: 0, agent: 'System', message: 'x', timestamp: '2026-10-25T10:25:00Z' } }],
    ['non-ISO timestamp', { type: 'LOG', payload: { step: 1, agent: 'System', message: 'x', timestamp: 'yesterday' } }],
    ['unknown log kind', { type: 'LOG', payload: { step: 1, agent: 'System', message: 'x', timestamp: '2026-10-25T10:25:00Z', kind: 'banner' } }],
    ['unknown decision topic', { type: 'MESSAGE', payload: { step: 1, agent: 'Supervisor', text: 'x', timestamp: '2026-10-25T10:25:00Z', decision: 'weather' } }],
    ['empty message text', { type: 'MESSAGE', payload: { step: 1, agent: 'Supervisor', text: '', timestamp: '2026-10-25T10:25:00Z' } }],
    ['bad callout tone', { type: 'MESSAGE', payload: { step: 1, agent: 'Supervisor', text: 'x', timestamp: '2026-10-25T10:25:00Z', callout: { tone: 'loud', label: 'x' } } }],
    ['percent above 100', { type: 'PROGRESS', payload: { progressPercent: 101, currentStatus: 'planning' } }],
    ['fractional percent', { type: 'PROGRESS', payload: { progressPercent: 10.5, currentStatus: 'planning' } }],
    ['unknown status', { type: 'PROGRESS', payload: { progressPercent: 10, currentStatus: 'sleeping' } }],
    ['pass 4', { type: 'PROGRESS', payload: { progressPercent: 10, currentStatus: 'searching', pass: 4 } }],
    ['non-UUID threadId', { type: 'RESULT', payload: { ...result, threadId: 'abc' } }],
    ['in-progress status in RESULT', { type: 'RESULT', payload: { ...result, status: 'planning' } }],
    ['latitude out of range', {
      type: 'RESULT',
      payload: {
        ...result,
        itinerary: [{ day: 1, date: null, title: 'x', weather: null, places: [{ name: 'x', lat: 91, lng: 0, note: null }] }],
      },
    }],
    ['negative price', { type: 'RESULT', payload: { ...result, flights: [{ ...flight, price: -1 }] } }],
    ['rating above 10', { type: 'RESULT', payload: { ...result, hotels: [{ ...hotel, rating: 10.5 }] } }],
    ['bad check-in time', { type: 'RESULT', payload: { ...result, hotels: [{ ...hotel, checkInTime: '3pm' }] } }],
    ['unknown transfer mode', { type: 'RESULT', payload: { ...result, transfers: [{ ...result.transfers[0], mode: 'teleport' }] } }],
    ['3 re-plans', { type: 'RESULT', payload: { ...result, replans: 3 } }],
    ['non-USD currency', { type: 'RESULT', payload: { ...result, currency: 'EUR' } }],
    ['missing schemaVersion on the wire', { type: 'RESULT', payload: { ...result, schemaVersion: undefined } }],
    ['unknown schemaVersion', { type: 'RESULT', payload: { ...result, schemaVersion: 99 } }],
  ])('rejects %s', (_name, packet) => {
    expect(SseEventSchema.safeParse(packet).success).toBe(false);
  });
});

describe('TripRequestSchema', () => {
  it('accepts a prompt-only request and trims it', () => {
    expect(TripRequestSchema.parse({ prompt: '  5 days in Paris  ' })).toEqual({ prompt: '5 days in Paris' });
  });

  it('accepts all optional overrides', () => {
    const request = { prompt: 'Paris trip', origin: 'Tashkent', budget: 1000, durationDays: 5, startDate: '2026-11-20' };
    expect(TripRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    ['too short prompt', { prompt: 'hi' }],
    ['too long prompt', { prompt: 'x'.repeat(1001) }],
    ['zero budget', { prompt: 'Paris trip', budget: 0 }],
    ['31 days', { prompt: 'Paris trip', durationDays: 31 }],
    ['fractional days', { prompt: 'Paris trip', durationDays: 2.5 }],
    ['bad date', { prompt: 'Paris trip', startDate: '20/11/2026' }],
  ])('rejects %s', (_name, request) => {
    expect(TripRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe('TripContextSchema', () => {
  const context = {
    location: 'Paris, France',
    weather: {
      temperatureC: 12,
      condition: 'Partly cloudy',
      icon: 'partly-cloudy',
      todayLowC: 9,
      todayHighC: 14,
      outlook: 'rain Saturday',
    },
    currency: { code: 'EUR', symbol: '€' },
    exchangeRate: { base: 'USD', quote: 'EUR', rate: 0.92, asOf: '2026-10-27T08:00:00Z' },
    timeZone: 'Europe/Paris',
    originTimeZone: 'Asia/Tashkent',
    source: 'live',
  };

  it('accepts a full context', () => {
    expect(TripContextSchema.safeParse(context).success).toBe(true);
  });

  it('accepts every nullable field as null', () => {
    expect(
      TripContextSchema.safeParse({
        ...context,
        weather: null,
        currency: null,
        exchangeRate: null,
        timeZone: null,
        originTimeZone: null,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['non-USD base', { ...context, exchangeRate: { ...context.exchangeRate, base: 'EUR' } }],
    ['zero rate', { ...context, exchangeRate: { ...context.exchangeRate, rate: 0 } }],
    ['unknown weather icon', { ...context, weather: { ...context.weather, icon: 'tornado' } }],
    ['unknown source', { ...context, source: 'cached' }],
  ])('rejects %s', (_name, value) => {
    expect(TripContextSchema.safeParse(value).success).toBe(false);
  });
});

describe('TripContextQuerySchema', () => {
  it('accepts a destination with an optional origin and trims both', () => {
    expect(TripContextQuerySchema.parse({ destination: ' Paris ', origin: ' Tashkent ' })).toEqual({
      destination: 'Paris',
      origin: 'Tashkent',
    });
  });

  it('rejects a one-letter destination', () => {
    expect(TripContextQuerySchema.safeParse({ destination: 'P' }).success).toBe(false);
  });
});

describe('stored results (schemaVersion migration)', () => {
  const { schemaVersion: _version, ...v0 } = result;

  it('upgrades a result stored before versioning (v0) to the current version', () => {
    expect(parseStoredResult(v0)).toEqual(result);
  });

  it('keeps a current result as it is', () => {
    expect(parseStoredResult(result)).toEqual(result);
  });

  it.each([
    ['null', null],
    ['an array', [result]],
    ['a broken result', { ...v0, threadId: 'abc' }],
    ['a result from a newer agent', { ...result, schemaVersion: RESULT_SCHEMA_VERSION + 1 }],
  ])('returns null for %s', (_name, value) => {
    expect(parseStoredResult(value)).toBeNull();
  });

  it('upgrades the result inside a trip record', () => {
    const record = { result: v0, messages: [], createdAt: '2026-10-29T10:00:00Z', updatedAt: '2026-10-29T10:01:00Z' };
    expect(TripRecordSchema.parse(record).result.schemaVersion).toBe(RESULT_SCHEMA_VERSION);
  });
});

describe('TripListResponseSchema', () => {
  const summary = {
    threadId: result.threadId,
    status: 'completed',
    origin: 'Tashkent',
    destination: 'Paris',
    durationDays: 5,
    startDate: '2026-11-12',
    totalCost: 940,
    budget: 1000,
    createdAt: '2026-10-29T10:00:00Z',
    updatedAt: '2026-10-29T10:01:00Z',
  };

  it('accepts a list of summaries', () => {
    expect(TripListResponseSchema.safeParse({ trips: [summary] }).success).toBe(true);
  });

  it('rejects an in-progress status', () => {
    expect(TripListResponseSchema.safeParse({ trips: [{ ...summary, status: 'planning' }] }).success).toBe(false);
  });
});

describe('ErrorBodySchema', () => {
  it('accepts every error code', () => {
    for (const code of ErrorCodeSchema.options) {
      expect(ErrorBodySchema.safeParse({ error: { code, message: 'x' } }).success).toBe(true);
    }
  });

  it('accepts retryAfterSeconds on a rate limit', () => {
    expect(ErrorBodySchema.safeParse({ error: { code: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 42 } }).success).toBe(true);
  });

  it('rejects an unknown code', () => {
    expect(ErrorBodySchema.safeParse({ error: { code: 'TEAPOT', message: 'x' } }).success).toBe(false);
  });
});
