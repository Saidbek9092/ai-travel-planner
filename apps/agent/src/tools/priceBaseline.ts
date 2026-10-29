import type { TransferMode } from '@ai-travel/contracts';

type Tier = 'budget' | 'mid' | 'premium';

interface Baseline {
  tier: Tier;
  /** USD per day for food, local transport and tickets, one traveller. */
  dailyExpensesUsd: number;
  /** USD for one airport ↔ hotel leg by mode. */
  transferUsd: Record<TransferMode, number>;
}

/** Static baseline per price tier. The LLM only picks the mode; the price always comes from here, so reruns agree. */
const TIERS: Record<Tier, Omit<Baseline, 'tier'>> = {
  budget: { dailyExpensesUsd: 45, transferUsd: { taxi: 15, train: 5, metro: 1, bus: 2, shuttle: 8, walk: 0 } },
  mid: { dailyExpensesUsd: 90, transferUsd: { taxi: 40, train: 15, metro: 3, bus: 4, shuttle: 20, walk: 0 } },
  premium: { dailyExpensesUsd: 140, transferUsd: { taxi: 65, train: 22, metro: 4, bus: 5, shuttle: 30, walk: 0 } },
};

const CITY_TIER: Record<string, Tier> = {
  tashkent: 'budget', samarkand: 'budget', almaty: 'budget', bangkok: 'budget', istanbul: 'budget', moscow: 'budget',
  seoul: 'mid', madrid: 'mid', barcelona: 'mid', rome: 'mid', berlin: 'mid', dubai: 'mid',
  paris: 'premium', london: 'premium', tokyo: 'premium', 'new york': 'premium',
};

/** "Paris, France" and "paris" are the same city. */
const normalise = (place: string) => (place.split(',')[0] ?? place).trim().toLowerCase().replace(/\s+/g, ' ');

/** Baseline for a destination; a city outside the table gets the mid tier (`known: false`, so callers can say so). */
export function priceBaselineFor(destination: string): Baseline & { known: boolean } {
  const tier = CITY_TIER[normalise(destination)];
  return { tier: tier ?? 'mid', ...TIERS[tier ?? 'mid'], known: tier !== undefined };
}

/** What a cheaper pass assumes: lunch from a bakery, a day pass instead of single tickets. */
export const CHEAPER_DAILY_FACTOR = 0.85;
