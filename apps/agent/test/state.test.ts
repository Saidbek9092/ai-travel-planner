import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/agent/graph.js';
import { MemorySaver } from '@langchain/langgraph';
import { initialState, log, nextStep, TravelAgentStateAnnotation, type LogEntry } from '../src/agent/state.js';
import { testGraph } from './helpers/testGraph.js';

const entry = (step: number): LogEntry => ({
  timestamp: '2026-10-25T10:25:00Z',
  agent: 'Supervisor',
  message: 'x',
  step,
  level: 'info',
  kind: 'log',
});

describe('initialState', () => {
  it('splits the prompt from the explicit overrides', () => {
    expect(initialState({ prompt: '5 days in Paris', budget: 900, origin: 'Tashkent' })).toEqual({
      prompt: '5 days in Paris',
      overrides: { budget: 900, origin: 'Tashkent' },
    });
  });
});

describe('nextStep / log', () => {
  it('starts at 1 and continues after the last log, including across re-plans', () => {
    expect(nextStep({ logs: [] })).toBe(1);
    expect(nextStep({ logs: [entry(1), entry(2), entry(2)] })).toBe(3);
    expect(nextStep({ logs: [entry(1), entry(2), entry(3), entry(4), entry(5), entry(6)] })).toBe(7);
  });

  it('builds an entry for the current step with defaults', () => {
    const built = log({ logs: [entry(4)] }, 'FlightAgent', 'hi');
    expect(built).toMatchObject({ agent: 'FlightAgent', message: 'hi', step: 5, level: 'info', kind: 'log' });
    expect(Number.isNaN(Date.parse(built.timestamp))).toBe(false);
    expect(log({ logs: [] }, 'System', 'bad', 'error', 'checkpoint')).toMatchObject({ level: 'error', kind: 'checkpoint' });
  });
});

describe('reducers', () => {
  it('append logs and warnings, replace everything else', async () => {
    const graph = buildGraph({
      checkpointer: new MemorySaver(),
      nodes: {
        flightAgent: async () => ({ warnings: ['a'], totalCost: 1 }),
        hotelAgent: async () => ({ warnings: ['b'], totalCost: 2 }),
      },
    });
    const final = await graph.invoke(initialState({ prompt: 'Paris' }), { configurable: { thread_id: 'reducers' } });

    expect(final.warnings).toEqual(['a', 'b']);
    expect(final.logs.map((l) => l.agent)).toEqual(['Supervisor', 'Planner', 'BudgetAuditor']);
    // Later writes win: the auditor's total (no flight or hotel here: 2 × 15 + 5 × 20) replaces 1 and 2.
    expect(final.totalCost).toBe(130);
  });
});

describe('graph compilation', () => {
  it('uses no node name that is also a state key (LangGraph would throw)', () => {
    const nodeNames = ['supervisorAgent', 'flightAgent', 'hotelAgent', 'itineraryPlanner', 'budgetAuditor'];
    const stateKeys = Object.keys(TravelAgentStateAnnotation.spec);
    expect(nodeNames.filter((name) => stateKeys.includes(name))).toEqual([]);
    expect(() => testGraph()).not.toThrow();
  });
});
