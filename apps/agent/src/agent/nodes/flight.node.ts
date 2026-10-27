import { formatUsd, log, searchFallbackLog, type TravelNode } from '../state.js';
import { addDays } from '../../utils/dates.js';
import type { TravelSearchTool } from '../../tools/index.js';

export interface FlightNodeDeps {
  tools: TravelSearchTool;
}

const FALLBACK_WARNING = 'Live flight prices were unavailable; flight prices are estimates.';

export const flightNode =
  ({ tools }: FlightNodeDeps): TravelNode =>
  async (state, config) => {
    const previous = state.flights[0];
    const cheaper = state.searchMode === 'cheaper' && previous !== undefined;

    const found = await tools.searchFlights(
      {
        origin: state.origin ?? '',
        destination: state.destination,
        departDate: state.startDate ?? '',
        returnDate: addDays(state.startDate ?? '', state.durationDays),
        mode: state.searchMode,
        ...(cheaper && { maxPrice: previous.price }),
      },
      config?.signal,
    );

    const sorted = [...found].sort((a, b) => a.price - b.price);
    const candidates = cheaper ? sorted.filter((flight) => flight.price < previous.price) : sorted;

    const logs = [];
    let flights = candidates;
    if (candidates.length === 0) {
      // Nothing cheaper (or nothing at all): never replace the selection with a worse one.
      flights = previous ? state.flights : sorted;
      if (previous) logs.push(log(state, 'FlightAgent', `No cheaper flight found, keeping ${formatUsd(previous.price)} option.`));
    }

    const best = flights[0];
    if (best && candidates.length > 0) {
      logs.push(log(state, 'FlightAgent', `Found a ${formatUsd(best.price)} flight on the ${state.origin} -> ${state.destination} route.`));
    }

    const estimated = tools.name !== 'mock' && found.some((flight) => flight.source === 'mock');
    if (estimated) logs.push(searchFallbackLog(state, 'FlightAgent', 'flight'));

    return {
      flights,
      status: 'searching',
      logs,
      ...(estimated && !state.warnings.includes(FALLBACK_WARNING) && { warnings: [FALLBACK_WARNING] }),
    };
  };

