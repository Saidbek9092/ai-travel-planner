import type { Config } from '../config.js';
import { createMockTravelTool } from './mockTravel.tool.js';
import { createSerpApiTool } from './serpApi.tool.js';
import { ToolUnavailableError, type SearchTool, type TravelSearchTool } from './types.js';
import { getForecast, mockForecast } from './weather.js';

export * from './types.js';

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

/** `mock` → offline engine; `live` → SerpAPI only; `auto` → SerpAPI with mock fallback when a key is set, else mock. */
function createSearchTool(config: Pick<Config, 'TOOLS_MODE' | 'SERPAPI_API_KEY' | 'NODE_ENV'>, onFallback?: (reason: string) => void): SearchTool {
  const mock = createMockTravelTool(config.NODE_ENV === 'test' ? { delayMs: 0 } : {});
  const key = config.SERPAPI_API_KEY;

  if (config.TOOLS_MODE === 'mock' || key === undefined) return mock;
  const live = createSerpApiTool({ apiKey: key });
  return config.TOOLS_MODE === 'live' ? live : withFallback(live, mock, onFallback);
}

/**
 * Search tool plus the daily forecast. The forecast is keyless (Open-Meteo) so it does not depend on the search
 * provider: only `TOOLS_MODE=mock` swaps it for the fixed fixture.
 */
export function createTravelTool(
  config: Pick<Config, 'TOOLS_MODE' | 'SERPAPI_API_KEY' | 'NODE_ENV'>,
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
  };
}
