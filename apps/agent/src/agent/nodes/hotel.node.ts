import type { Hotel } from '@ai-travel/contracts';
import { hotelConfirmed, hotelProposal } from '../messages.js';
import { formatUsd, log, say, searchFallbackLog, type TravelNode } from '../state.js';
import { addDays, nightsFor } from '../../utils/dates.js';
import type { TravelSearchTool } from '../../tools/index.js';

export interface HotelNodeDeps {
  tools: TravelSearchTool;
}

/** Ratings are on the contract's 0–10 scale. */
const MIN_PREFERRED_RATING = 7;
const FALLBACK_WARNING = 'Live hotel prices were unavailable; hotel prices are estimates.';

const byPrice = (a: Hotel, b: Hotel) => a.pricePerNight - b.pricePerNight;

/** Well-rated hotels cheapest first, then the rest cheapest first; `[0]` is the pick. */
export function rankHotels(hotels: Hotel[]): Hotel[] {
  const preferred = hotels.filter((hotel) => hotel.rating >= MIN_PREFERRED_RATING).sort(byPrice);
  return preferred.length > 0 ? preferred : [...hotels].sort(byPrice);
}

export const hotelNode =
  ({ tools }: HotelNodeDeps): TravelNode =>
  async (state, config) => {
    const previous = state.hotels[0];
    const cheaper = state.searchMode === 'cheaper' && previous !== undefined;
    const checkIn = state.startDate ?? '';

    const found = await tools.searchHotels(
      {
        destination: state.destination,
        checkIn,
        checkOut: addDays(checkIn, nightsFor(state.durationDays)),
        mode: state.searchMode,
        ...(cheaper && { maxPricePerNight: previous.pricePerNight }),
      },
      config?.signal,
    );

    const candidates = rankHotels(cheaper ? found.filter((hotel) => hotel.pricePerNight < previous.pricePerNight) : found);

    const logs = [];
    let hotels = candidates;
    if (candidates.length === 0 && previous) {
      hotels = state.hotels;
      logs.push(log(state, 'HotelAgent', `No cheaper hotel found, keeping ${formatUsd(previous.pricePerNight)}/night option.`));
    } else if (candidates[0]) {
      const pick = candidates[0];
      logs.push(log(state, 'HotelAgent', `Selected ${pick.name}${pick.area ? ` in ${pick.area}` : ''} at ${formatUsd(pick.pricePerNight)}/night.`));
    }

    const estimated = tools.name !== 'mock' && found.some((hotel) => hotel.source === 'mock');
    if (estimated) logs.push(searchFallbackLog(state, 'HotelAgent', 'hotel'));

    const pick = hotels[0];
    const messages = [];
    if (pick) {
      if (state.retryCount === 0) messages.push(say(state, 'HotelAgent', hotelProposal(pick, nightsFor(state.durationDays), state.budget)));
      else if (candidates.length > 0) {
        messages.push(say(state, 'HotelAgent', hotelConfirmed(pick, previous, nightsFor(state.durationDays)), { decision: 'hotel' }));
      }
    }

    return {
      hotels,
      status: 'planning',
      logs,
      messages,
      ...(messages.some((message) => message.decision) && { confirmed: ['hotel' as const] }),
      ...(estimated && !state.warnings.includes(FALLBACK_WARNING) && { warnings: [FALLBACK_WARNING] }),
    };
  };
