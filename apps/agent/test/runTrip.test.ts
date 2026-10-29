import { SseEventSchema, type DecisionTopic, type ResultPayload, type SseEvent } from '@ai-travel/contracts';
import { describe, expect, it } from 'vitest';
import { runTrip } from '../src/agent/runTrip.js';
import type { ChatMessage } from '../src/agent/state.js';
import { testGraph } from './helpers/harness.js';

const RUN = { model: 'fake-primary', checkpointer: 'memory' as const };

/** One full graph run on mock tools; returns every packet (validated) and what `onResult` received. */
async function fullRun(trip: Parameters<typeof testGraph>[0], prompt = '3 days in Paris from Tashkent') {
  const { graph, llm } = testGraph(trip);
  const events: SseEvent[] = [];
  const saved: { result: ResultPayload; messages: ChatMessage[] }[] = [];
  await runTrip({
    graph,
    threadId: crypto.randomUUID(),
    run: RUN,
    request: { prompt },
    emit: (event) => events.push(SseEventSchema.parse(event)),
    onResult: async (result, messages) => void saved.push({ result, messages }),
  });
  const results = events.filter((event) => event.type === 'RESULT');
  return { events, results, result: results[0]!.payload, saved, llm };
}

const topics = (events: SseEvent[]) =>
  events.flatMap((event) => (event.type === 'MESSAGE' && event.payload.decision ? [event.payload.decision] : [])) as DecisionTopic[];

describe('full graph run (mock tools, fake LLM, MemorySaver)', () => {
  it('completes within budget and ends with exactly one RESULT', async () => {
    const { events, results, result, llm } = await fullRun({ budget: 50_000 });
    expect(results).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('RESULT');
    expect(result).toMatchObject({ status: 'completed', destination: 'Paris', origin: 'Tashkent', durationDays: 3, replans: 0, error: null, suggestions: null });
    expect(result.flights.length).toBeGreaterThan(0);
    expect(result.hotels.length).toBeGreaterThan(0);
    expect(result.transfers).toHaveLength(2);
    expect(result.itinerary.map((day) => day.day)).toEqual([1, 2, 3]);
    expect(result.passes).toHaveLength(1);
    expect(result.totalCost).toBe(result.passes[0]!.totalCost);
    // Supervisor once, transfers once, one call per day; no preference pick without notes.
    expect(llm.calls.filter((name) => name === 'plan_day')).toHaveLength(3);
    expect(llm.calls).not.toContain('pick_flight');
  });

  it('confirms every decision topic', async () => {
    const { events } = await fullRun({ budget: 50_000 });
    expect(new Set(topics(events))).toEqual(new Set(['trip', 'flight', 'hotel', 'transfers', 'itinerary', 'budget']));
  });

  it('never moves progress backwards and ends at 100', async () => {
    const { events } = await fullRun({ budget: 50_000 });
    const percents = events.flatMap((event) => (event.type === 'PROGRESS' ? [event.payload.progressPercent] : []));
    expect(percents[0]).toBe(5);
    expect(percents.at(-1)).toBe(100);
    for (let i = 1; i < percents.length; i += 1) expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]!);
  });

  it('sends a DRAFT and a "Day N of M" progress for every planned day', async () => {
    const { events } = await fullRun({ budget: 50_000 });
    const details = events.flatMap((event) => (event.type === 'PROGRESS' && event.payload.detail ? [event.payload.detail] : []));
    expect(details).toEqual(['Day 1 of 3', 'Day 2 of 3', 'Day 3 of 3']);
    const firstDraft = events.find((event) => event.type === 'DRAFT');
    expect(firstDraft?.payload).toMatchObject({ destination: 'Paris', budget: 50_000, durationDays: 3 });
  });

  it('moves the rainy day indoors with a weather callout', async () => {
    // The mock forecast rains on day 3.
    const { events } = await fullRun({ budget: 50_000 });
    const callouts = events.flatMap((event) => (event.type === 'MESSAGE' && event.payload.callout ? [event.payload.callout.label] : []));
    expect(callouts.some((label) => label.includes('Day 3'))).toBe(true);
  });

  it('re-plans twice when the budget cannot be met, then returns the cheapest trip with suggestions', async () => {
    const { result, events } = await fullRun({ budget: 50 });
    expect(result.status).toBe('completed');
    expect(result.replans).toBe(2);
    expect(result.passes.map((pass) => pass.pass)).toEqual([1, 2, 3]);
    // A cheaper pass never costs more than the one before it.
    for (let i = 1; i < result.passes.length; i += 1) expect(result.passes[i]!.totalCost).toBeLessThanOrEqual(result.passes[i - 1]!.totalCost);
    expect(result.suggestions).not.toBeNull();
    expect(result.warnings.some((warning) => warning.startsWith('Budget exceeded by'))).toBe(true);
    const passes = events.flatMap((event) => (event.type === 'PROGRESS' ? [event.payload.pass] : []));
    expect(Math.max(...passes)).toBe(3);
  });

  it('fails without a decision when the prompt lacks details', async () => {
    const { result, events } = await fullRun({ budget: null, durationDays: null }, 'Paris');
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/total budget/);
    expect(topics(events)).toEqual([]);
  });

  it('hands the result and the whole chat to onResult once', async () => {
    const { saved, result, events } = await fullRun({ budget: 50_000 });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.result).toEqual(result);
    expect(saved[0]!.messages).toHaveLength(events.filter((event) => event.type === 'MESSAGE').length);
  });
});
