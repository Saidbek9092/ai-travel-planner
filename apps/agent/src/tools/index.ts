import type { Config } from '../config.js';
import { createMockTravelTool } from './mockTravel.tool.js';
import { createSerpApiTool } from './serpApi.tool.js';
import { withSearchCache } from './searchCache.js';
import { ToolUnavailableError, type SearchTool, type TravelSearchTool } from './types.js';
import { placePhoto } from './placePhotos.js';
import { geocode, getForecast, mockForecast } from './weather.js';

export * from './types.js';

const USER_AGENT = 'ai-travel-planner/0.1 (place photos)';

/** Tries `primary`; when it reports `ToolUnavailableError` (or times out) it calls `onFallback` and answers from `mock`. */
export function withFallback(
  primary: SearchTool,
  mock: SearchTool,
  onFallback: (reason: string) => void = () => {},
): SearchTool {
  async function attempt<T>(run: (tool: SearchTool) => Promise<T>): Promise<T> {
    try {
      return await run(primary);
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      if (!(error instanceof ToolUnavailableError) && !timedOut) throw error;
      onFallback(error.message);
      return run(mock);
    }
  }

  return {
    name: primary.name,
    searchFlights: (query, signal) => attempt((tool) => tool.searchFlights(query, signal)),
    searchHotels: (query, signal) => attempt((tool) => tool.searchHotels(query, signal)),
  };
}

type SearchConfig = Pick<Config, 'TOOLS_MODE' | 'SERPAPI_API_KEY' | 'SEARCH_CACHE_TTL_MS'>;

/** `mock` → offline engine; `live` → SerpAPI only; `auto` → SerpAPI with mock fallback when a key is set, else mock. */
function createSearchTool(config: SearchConfig, onFallback?: (reason: string) => void): SearchTool {
  const mock = createMockTravelTool();
  const key = config.SERPAPI_API_KEY;

  if (config.TOOLS_MODE === 'mock' || key === undefined) return mock;
  const live = withSearchCache(createSerpApiTool({ apiKey: key }), config.SEARCH_CACHE_TTL_MS);
  return config.TOOLS_MODE === 'live' ? live : withFallback(live, mock, onFallback);
}

/**
 * Search tool plus the daily forecast. The forecast is keyless (Open-Meteo) so it does not depend on the search
 * provider: only `TOOLS_MODE=mock` swaps it for the fixed fixture.
 */
export function createTravelTool(
  config: SearchConfig,
  onFallback?: (reason: string) => void,
): TravelSearchTool {
  const search = createSearchTool(config, onFallback);
  const deps = { fetch, now: () => new Date() };
  return {
    name: search.name,
    searchFlights: (query, signal) => search.searchFlights(query, signal),
    searchHotels: (query, signal) => search.searchHotels(query, signal),
    getForecast: async (destination, startDate, days, signal) =>
      config.TOOLS_MODE === 'mock' ? mockForecast(days) : getForecast(destination, startDate, days, deps, signal),
    getPlacePhoto: async (name, destination, signal) => {
      if (config.TOOLS_MODE === 'mock') return null;
      try {
        return await placePhoto(name, destination, { fetch: (url, init) => fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT } }) }, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        return null;
      }
    },
    getCenter: async (destination, signal) => {
      if (config.TOOLS_MODE === 'mock') return null;
      try {
        return (await geocode(destination, deps, signal)) ?? null;
      } catch (error) {
        if (signal?.aborted) throw error;
        return null;
      }
    },
  };
}
