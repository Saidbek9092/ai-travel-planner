import type { Flight, Hotel } from '@ai-travel/contracts';
import { normalizeKey, TtlCache } from '../utils/ttlCache.js';
import { recordMetric } from '../utils/runMetrics.js';
import { flightKey, type FlightQuery, type SearchTool } from './types.js';

/**
 * Reuses flight and hotel searches for `ttlMs`. The key holds exactly what the provider request depends on
 * (route/place and dates): `mode` and the price caps are applied by the nodes afterwards, so a "cheaper"
 * re-plan reuses the first search. Failures are not cached, so an outage is retried on the next call.
 */
export function withSearchCache(tool: SearchTool, ttlMs: number): SearchTool {
  const flights = new TtlCache<Flight[]>(ttlMs);
  const returns = new TtlCache<Flight>(ttlMs);
  const hotels = new TtlCache<Hotel[]>(ttlMs);

  async function cached<T>(cache: TtlCache<T>, key: string, load: () => Promise<T>): Promise<T> {
    let loaded = false;
    const found = await cache.remember(key, async () => ((loaded = true), load()));
    if (!loaded) recordMetric((metrics) => (metrics.searchCacheHits += 1));
    // Callers may annotate what they get, so each one gets its own copy.
    return structuredClone(found);
  }

  const route = (query: FlightQuery) => [query.origin, query.destination, query.departDate, query.returnDate].map(normalizeKey).join('|');

  return {
    name: tool.name,
    searchFlights: (query, signal) => cached(flights, route(query), () => tool.searchFlights(query, signal)),
    completeReturn: (query, flight, options, signal) =>
      cached(returns, [route(query), flightKey(flight), options.maxStops ?? 'any'].join('|'), () =>
        tool.completeReturn(query, flight, options, signal),
      ),
    searchHotels: (query, signal) =>
      cached(hotels, [query.destination, query.checkIn, query.checkOut].map(normalizeKey).join('|'), () =>
        tool.searchHotels(query, signal),
      ),
  };
}
