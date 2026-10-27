import type { Config } from '../config.js';
import { createMockTravelTool } from './mockTravel.tool.js';
import { createSerpApiTool } from './serpApi.tool.js';
import { ToolUnavailableError, type TravelSearchTool } from './types.js';

export * from './types.js';

/** Tries `primary`; when it reports `ToolUnavailableError` (or times out) it calls `onFallback` and answers from `mock`. */
export function withFallback(
  primary: TravelSearchTool,
  mock: TravelSearchTool,
  onFallback: (reason: string) => void = () => {},
): TravelSearchTool {
  async function attempt<T>(run: (tool: TravelSearchTool) => Promise<T>): Promise<T> {
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
    getForecast: (destination, startDate, days, signal) =>
      attempt((tool) => tool.getForecast(destination, startDate, days, signal)),
  };
}

/** `mock` → offline engine; `live` → SerpAPI only; `auto` → SerpAPI with mock fallback when a key is set, else mock. */
export function createTravelTool(
  config: Pick<Config, 'TOOLS_MODE' | 'SERPAPI_API_KEY' | 'NODE_ENV'>,
  onFallback?: (reason: string) => void,
): TravelSearchTool {
  const mock = createMockTravelTool(config.NODE_ENV === 'test' ? { delayMs: 0 } : {});
  const key = config.SERPAPI_API_KEY;

  if (config.TOOLS_MODE === 'mock' || key === undefined) return mock;
  const live = createSerpApiTool({ apiKey: key });
  return config.TOOLS_MODE === 'live' ? live : withFallback(live, mock, onFallback);
}
