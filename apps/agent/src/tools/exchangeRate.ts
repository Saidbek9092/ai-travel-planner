import type { ExchangeRate } from '@ai-travel/contracts';
import { z } from 'zod';
import { fetchJson } from '../utils/fetchJson.js';
import { TtlCache } from '../utils/ttlCache.js';

/**
 * open.er-api.com: free, keyless, USD base, lists UZS. Its terms ask for attribution and allow
 * one update a day, which the 6 h cache respects. https://www.exchangerate-api.com/docs/free
 */
const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const RATE_TTL_MS = 6 * 60 * 60 * 1000;

const ResponseSchema = z.looseObject({
  result: z.literal('success'),
  time_last_update_unix: z.number(),
  rates: z.record(z.string(), z.number()),
});

// One USD table serves every currency, so the cache has a single key.
const cache = new TtlCache<z.infer<typeof ResponseSchema>>(RATE_TTL_MS);

/** USD → `quote`. Rejects when the provider fails or does not list the currency (the caller turns that into `null`). */
export async function getExchangeRate(quote: string, deps: { fetch: typeof fetch }, signal?: AbortSignal): Promise<ExchangeRate> {
  const table = await cache.remember('usd', async () => ResponseSchema.parse(await fetchJson(deps.fetch, ENDPOINT, signal)));
  const rate = table.rates[quote];
  if (rate === undefined || rate <= 0) throw new Error(`No rate for ${quote}`);
  return { base: 'USD', quote, rate, asOf: new Date(table.time_last_update_unix * 1000).toISOString() };
}
