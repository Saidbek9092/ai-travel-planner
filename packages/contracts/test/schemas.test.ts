import { describe, expect, it } from 'vitest';
import {
  SseEventSchema,
  TripRequestSchema,
  type ResultPayload,
} from '../src/index.js';

const result: ResultPayload = {
  threadId: '7f1c2a4e-3b5d-4c6e-8f90-1a2b3c4d5e6f',
  status: 'completed',
  origin: 'Tashkent',
  destination: 'Paris',
  durationDays: 5,
  startDate: '2026-11-20',
  totalCost: 900,
  budget: 1000,
  currency: 'USD',
  flights: [
    { airline: 'Uzbekistan Airways', price: 500, departure: '2026-11-20T08:30:00+05:00', source: 'serpapi' },
  ],
  hotels: [{ name: 'Hôtel Le Marais', pricePerNight: 50, rating: 4.2, source: 'mock' }],
  itinerary: [
    {
      day: 1,
      title: 'Classic Paris',
      places: [{ name: 'Eiffel Tower', lat: 48.8584, lng: 2.2945 }],
    },
  ],
  dailyExpensesEstimate: 30,
  warnings: [],
  error: null,
};

describe('SseEventSchema', () => {
  it('accepts the blueprint LOG example and defaults level to info', () => {
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
  });

  it('accepts the blueprint PROGRESS example', () => {
    expect(
      SseEventSchema.safeParse({
        type: 'PROGRESS',
        payload: { progressPercent: 65, currentStatus: 'planning' },
      }).success,
    ).toBe(true);
  });

  it('accepts a full RESULT packet', () => {
    expect(SseEventSchema.safeParse({ type: 'RESULT', payload: result }).success).toBe(true);
  });

  it.each([
    ['unknown type', { type: 'DEBUG', payload: {} }],
    ['missing payload', { type: 'LOG' }],
    ['unknown agent', { type: 'LOG', payload: { step: 1, agent: 'Hacker', message: 'x', timestamp: '2026-10-25T10:25:00Z' } }],
    ['step 0', { type: 'LOG', payload: { step: 0, agent: 'System', message: 'x', timestamp: '2026-10-25T10:25:00Z' } }],
    ['non-ISO timestamp', { type: 'LOG', payload: { step: 1, agent: 'System', message: 'x', timestamp: 'yesterday' } }],
    ['percent above 100', { type: 'PROGRESS', payload: { progressPercent: 101, currentStatus: 'planning' } }],
    ['fractional percent', { type: 'PROGRESS', payload: { progressPercent: 10.5, currentStatus: 'planning' } }],
    ['unknown status', { type: 'PROGRESS', payload: { progressPercent: 10, currentStatus: 'sleeping' } }],
    ['non-UUID threadId', { type: 'RESULT', payload: { ...result, threadId: 'abc' } }],
    ['in-progress status in RESULT', { type: 'RESULT', payload: { ...result, status: 'planning' } }],
    ['latitude out of range', {
      type: 'RESULT',
      payload: { ...result, itinerary: [{ day: 1, title: 'x', places: [{ name: 'x', lat: 91, lng: 0 }] }] },
    }],
    ['negative price', {
      type: 'RESULT',
      payload: { ...result, flights: [{ ...result.flights[0], price: -1 }] },
    }],
    ['non-USD currency', { type: 'RESULT', payload: { ...result, currency: 'EUR' } }],
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
