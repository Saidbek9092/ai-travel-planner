import type { Flight, Hotel, Transfer } from '@ai-travel/contracts';
import { describe, expect, it } from 'vitest';
import { budgetNode, computeTotalCost } from '../src/agent/nodes/budget.node.js';
import type { TravelAgentState } from '../src/agent/state.js';
import { routeAfterAudit } from '../src/agent/graph.js';

const leg = {
  from: { code: 'TAS', name: 'Tashkent International' },
  to: { code: 'CDG', name: 'Paris Charles de Gaulle' },
  departure: '2026-11-12T06:40:00',
  arrival: '2026-11-12T13:55:00',
  terminal: null,
  stops: [],
};
const flight = (price: number): Flight => ({ airline: 'Test Air', price, outbound: leg, return: null, bookingUrl: null, source: 'mock' });
const hotel = (pricePerNight: number): Hotel => ({
  name: 'Test Hotel',
  area: null,
  pricePerNight,
  rating: 8,
  photoUrl: null,
  checkInTime: null,
  checkOutTime: null,
  transit: null,
  location: null,
  bookingUrl: null,
  source: 'mock',
});
const transfer = (day: number, priceUsd: number): Transfer => ({ day, mode: 'taxi', description: 'Airport ↔ hotel', priceUsd, durationMinutes: null, note: null });

/** A complete state as LangGraph would hand it to the node. */
function state(overrides: Partial<TravelAgentState> = {}): TravelAgentState {
  return {
    prompt: '5 days in Paris',
    overrides: {},
    origin: 'Tashkent',
    startDate: '2026-11-12',
    preferences: { directOnly: false, maxStops: null, notes: null },
    itinerary: [],
    itineraryHotel: null,
    totalCost: 0,
    retryCount: 0,
    searchMode: 'standard',
    overBudgetBy: 0,
    passes: [],
    suggestions: null,
    status: 'auditing',
    error: null,
    warnings: [],
    confirmed: [],
    logs: [],
    messages: [],
    destination: 'Paris',
    durationDays: 5,
    budget: 1_000,
    flights: [flight(500)],
    hotels: [hotel(95)],
    transfers: [transfer(1, 40), transfer(5, 35)],
    dailyExpensesEstimate: 60,
    ...overrides,
  };
}

describe('computeTotalCost (ARCHITECTURE.md §4.3)', () => {
  it('is flight + hotel × nights + Σ transfers + daily × days', () => {
    // 500 + 95 × 4 nights + (40 + 35) + 60 × 5 days; the last day is the departure day, so 5 days = 4 nights.
    expect(computeTotalCost(state())).toBe(500 + 380 + 75 + 300);
  });

  it('charges at least one night for a one-day trip', () => {
    expect(computeTotalCost(state({ durationDays: 1, transfers: [] }))).toBe(500 + 95 + 60);
  });

  it('rounds to the cent', () => {
    expect(computeTotalCost(state({ flights: [flight(100.005)], hotels: [hotel(0)], transfers: [], dailyExpensesEstimate: 0 }))).toBe(100.01);
  });

  it('counts a missing flight or hotel as zero', () => {
    expect(computeTotalCost(state({ flights: [], hotels: [], transfers: [], dailyExpensesEstimate: 10, durationDays: 2 }))).toBe(20);
  });
});

describe('budgetNode', () => {
  // The node only returns plain values, never LangGraph's `Overwrite` wrapper.
  const audit = async (overrides: Partial<TravelAgentState>) => (await budgetNode()(state(overrides))) as Partial<TravelAgentState>;

  it('condition 1: within budget → completed, one pass, budget confirmed', async () => {
    const update = await audit({ budget: 2_000 });
    expect(update.status).toBe('completed');
    expect(update.totalCost).toBe(1_255);
    expect(update.passes).toEqual([
      expect.objectContaining({ pass: 1, flight: 500, hotel: 380, transfers: 75, daily: 300, totalCost: 1_255, flightLabel: '$500 direct', hotelLabel: '4 × $95' }),
    ]);
    expect(update.suggestions).toBeUndefined();
    expect(update.confirmed).toEqual(['flight', 'hotel', 'transfers', 'budget']);
    expect(routeAfterAudit({ ...state(), ...update } as TravelAgentState)).toBe('__end__');
  });

  it('condition 1 confirms only the topics not confirmed yet', async () => {
    const update = await audit({ budget: 2_000, confirmed: ['trip', 'flight', 'hotel'] });
    expect(update.confirmed).toEqual(['transfers', 'budget']);
    expect(update.messages?.map((m) => m.decision)).toEqual(['transfers', 'budget']);
  });

  it('exactly on budget counts as within budget', async () => {
    expect((await audit({ budget: 1_255 })).status).toBe('completed');
  });

  it('condition 2: over budget with retries left → cheaper re-plan', async () => {
    const update = await audit({ budget: 1_000, retryCount: 0 });
    expect(update).toMatchObject({ status: 'searching', searchMode: 'cheaper', retryCount: 1, overBudgetBy: 255, totalCost: 1_255 });
    expect(update.messages?.[0]?.callout).toEqual({ tone: 'info', label: 'Finding cheaper options, try 1 of 2' });
    expect(update.confirmed).toBeUndefined();
    expect(routeAfterAudit({ ...state(), ...update } as TravelAgentState)).toBe('flightAgent');
  });

  it('records the pass number of a re-plan round', async () => {
    const update = await audit({ budget: 1_000, retryCount: 1 });
    expect(update.retryCount).toBe(2);
    expect(update.passes?.[0]?.pass).toBe(2);
  });

  it('condition 3: still over budget after 2 re-plans → completed with a warning and suggestions', async () => {
    const update = await audit({ budget: 1_000, retryCount: 2 });
    expect(update.status).toBe('completed');
    expect(update.retryCount).toBeUndefined();
    expect(update.warnings).toEqual(['Budget exceeded by $255']);
    // Next $100 above the total, and one day less.
    expect(update.suggestions).toEqual({ raiseBudgetTo: 1_300, tryDays: 4 });
    expect(update.passes?.[0]?.pass).toBe(3);
    expect(update.confirmed).toContain('budget');
  });

  it('never suggests fewer than one day', async () => {
    const update = await audit({ budget: 10, retryCount: 2, durationDays: 1, transfers: [] });
    expect(update.suggestions?.tryDays).toBe(1);
  });
});
