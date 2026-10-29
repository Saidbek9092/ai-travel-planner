import type { BaseMessageLike } from '@langchain/core/messages';
import type { z } from 'zod';
import type { LlmFactory, ModelTier } from '../../src/agent/llm.js';

/** What the Supervisor "reads" from the prompt; the defaults are a complete Paris trip. */
export interface ParsedTrip {
  origin: string | null;
  destination: string | null;
  budget: number | null;
  durationDays: number | null;
  startDate: string | null;
  directOnly: boolean;
  maxStops: number | null;
  notes: string | null;
}

export const PARIS_TRIP: ParsedTrip = {
  origin: 'Tashkent',
  destination: 'Paris',
  budget: 5_000,
  durationDays: 3,
  startDate: null,
  directOnly: false,
  maxStops: null,
  notes: null,
};

const PRIMARY = 'fake-primary';
const FAST = 'fake-fast';

function lastUserText(messages: BaseMessageLike[]): string {
  const last = messages.at(-1) as { content?: unknown } | undefined;
  return typeof last?.content === 'string' ? last.content : '';
}

/** Canned answer for each structured call the nodes make. Unknown calls throw so a new node call cannot go unnoticed. */
function answer(name: string, brief: string, trip: ParsedTrip): unknown {
  switch (name) {
    case 'parse_trip':
      return trip;
    case 'plan_transfers': {
      const last = Number(/day (\d+) hotel to airport/.exec(brief)?.[1] ?? 1);
      return {
        transfers: [
          { day: 1, mode: 'taxi', description: 'Airport → hotel', durationMinutes: 45, note: null },
          { day: last, mode: 'train', description: 'Hotel → airport', durationMinutes: 50, note: 'Leave by 16:00' },
        ],
      };
    }
    case 'plan_day': {
      const day = Number(/Plan day (\d+)/.exec(brief)?.[1] ?? 1);
      return {
        title: `Day ${day} highlights`,
        places: [0, 1, 2].map((i) => ({ name: `Sight ${day}.${i + 1}`, lat: 48.85 + day * 0.01 + i * 0.001, lng: 2.35 + i * 0.001, note: i === 0 ? 'Morning' : null })),
      };
    }
    case 'pick_flight':
    case 'pick_hotel':
      return { index: 0, reasons: [] };
    default:
      throw new Error(`fake LLM has no answer for "${name}"`);
  }
}

export interface FakeLlm extends LlmFactory {
  /** Names of the structured calls made so far, in order. */
  readonly calls: string[];
}

/** Deterministic `LlmFactory`: no network, no tokens. `fast` calls answer as the fast model, so no fallback logs appear. */
export function createFakeLlm(trip: Partial<ParsedTrip> = {}): FakeLlm {
  const parsed = { ...PARIS_TRIP, ...trip };
  const calls: string[] = [];
  return {
    primaryModel: PRIMARY,
    fastModel: FAST,
    calls,
    structured<S extends z.ZodType>(schema: S, name: string, tier: ModelTier = 'primary') {
      return {
        async invoke(messages: BaseMessageLike[], signal?: AbortSignal) {
          signal?.throwIfAborted();
          calls.push(name);
          return { data: schema.parse(answer(name, lastUserText(messages), parsed)) as z.infer<S>, model: tier === 'fast' ? FAST : PRIMARY };
        },
      };
    },
  };
}
