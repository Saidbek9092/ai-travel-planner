import { END, MemorySaver } from '@langchain/langgraph';
import type { TripStatus } from '@ai-travel/contracts';
import { describe, expect, it } from 'vitest';
import { buildGraph, routeAfterAudit, routeAfterSupervisor } from '../src/agent/graph.js';
import { initialState, type TravelAgentState, type TravelAgentUpdate } from '../src/agent/state.js';
import { testGraph } from './helpers/testGraph.js';

const record = (calls: string[], name: string) => async (): Promise<TravelAgentUpdate> => {
  calls.push(name);
  return {};
};

const withStatus = (status: TripStatus) => ({ status }) as TravelAgentState;

describe('routeAfterSupervisor', () => {
  it.each<[TripStatus, string]>([
    ['failed', END],
    ['searching', 'flightAgent'],
    ['parsing', 'flightAgent'],
  ])('%s → %s', (status, expected) => {
    expect(routeAfterSupervisor(withStatus(status))).toBe(expected);
  });
});

describe('routeAfterAudit', () => {
  it.each<[TripStatus, string]>([
    ['searching', 'flightAgent'],
    ['completed', END],
    ['failed', END],
  ])('%s → %s', (status, expected) => {
    expect(routeAfterAudit(withStatus(status))).toBe(expected);
  });
});

describe('stub graph', () => {
  const config = (id: string) => ({ configurable: { thread_id: id } });

  it('runs end to end and completes with every part of the trip filled in', async () => {
    const final = await testGraph().invoke(initialState({ prompt: '5 days in Paris' }), config('happy'));

    expect(final.status).toBe('completed');
    expect(final.flights).toHaveLength(1);
    expect(final.hotels).toHaveLength(1);
    expect(final.transfers).toHaveLength(2);
    expect(final.itinerary).toHaveLength(final.durationDays);
    expect(final.totalCost).toBeGreaterThan(0);
    expect(final.totalCost).toBeLessThanOrEqual(final.budget);
    expect(final.logs.map((l) => l.step)).toEqual([1, 2, 3, 4, 5]);
  });

  it('lets explicit request fields win', async () => {
    const final = await testGraph().invoke(
      initialState({ prompt: 'a trip', budget: 2500, durationDays: 3, origin: 'Berlin' }),
      config('overrides'),
    );
    expect(final).toMatchObject({ budget: 2500, durationDays: 3, origin: 'Berlin' });
    expect(final.itinerary).toHaveLength(3);
  });

  it('ends right after a failed Supervisor', async () => {
    const calls: string[] = [];
    const graph = buildGraph({
      checkpointer: new MemorySaver(),
      nodes: {
        supervisorAgent: async (): Promise<TravelAgentUpdate> => ({ status: 'failed', error: 'Please include a budget.' }),
        flightAgent: record(calls, 'flight'),
      },
    });
    const final = await graph.invoke(initialState({ prompt: 'Paris' }), config('failed'));
    expect(final.status).toBe('failed');
    expect(calls).toEqual([]);
  });

  it('loops back to flights while the auditor says searching, and the planner runs on every pass', async () => {
    const calls: string[] = [];
    let audits = 0;
    const graph = buildGraph({
      checkpointer: new MemorySaver(),
      nodes: {
        flightAgent: record(calls, 'flight'),
        hotelAgent: record(calls, 'hotel'),
        itineraryPlanner: record(calls, 'planner'),
        budgetAuditor: async (): Promise<TravelAgentUpdate> => {
          audits += 1;
          return { status: audits < 3 ? 'searching' : 'completed' };
        },
      },
    });
    const final = await graph.invoke(initialState({ prompt: 'Paris' }), config('loop'));

    expect(final.status).toBe('completed');
    expect(calls).toEqual(['flight', 'hotel', 'planner', 'flight', 'hotel', 'planner', 'flight', 'hotel', 'planner']);
  });
});
