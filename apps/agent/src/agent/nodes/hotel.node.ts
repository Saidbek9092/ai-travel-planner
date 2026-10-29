import { hotelConfirmed, hotelProposal } from '../messages.js';
import type { LlmFactory } from '../llm.js';
import { applyPick, reasonsText, softPreferences } from '../pick.js';
import { describeBreakdown, rankHotels } from '../ranking.js';
import { formatUsd, llmFallbackLog, log, say, searchFallbackLog, type TravelNode } from '../state.js';
import { addDays, nightsFor } from '../../utils/dates.js';
import type { TravelSearchTool } from '../../tools/index.js';

export interface HotelNodeDeps {
  tools: TravelSearchTool;
  llm: LlmFactory;
}

const FALLBACK_WARNING = 'Live hotel prices were unavailable; hotel prices are estimates.';

export const hotelNode =
  ({ tools, llm }: HotelNodeDeps): TravelNode =>
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

    const nights = nightsFor(state.durationDays);
    // Cheaper mode stays strict: only cheaper options are candidates, the score just orders them.
    const eligible = cheaper ? found.filter((hotel) => hotel.pricePerNight < previous.pricePerNight) : found;
    const center = eligible.length > 0 ? await tools.getCenter(state.destination, config?.signal) : null;
    const ranked = rankHotels(eligible, { budget: state.budget, nights, center });

    const logs = [];
    const outcome = await applyPick({
      llm,
      kind: 'hotel',
      ranked: ranked.map(({ item }) => item),
      preferences: softPreferences(state.preferences, state.overrides.interests),
      isAllowed: (hotel) => !cheaper || hotel.pricePerNight < previous.pricePerNight,
      signal: config?.signal,
    });
    const candidates = outcome.options;
    if (outcome.failure) logs.push(log(state, 'HotelAgent', `Kept the top-scored hotel: ${outcome.failure}.`, 'warn'));
    if (outcome.model && outcome.model !== llm.primaryModel) logs.push(llmFallbackLog(state, 'HotelAgent', outcome.model));
    let hotels = candidates;
    if (candidates.length === 0 && previous) {
      hotels = state.hotels;
      logs.push(log(state, 'HotelAgent', `No cheaper hotel found, keeping ${formatUsd(previous.pricePerNight)}/night option.`));
    } else if (candidates[0]) {
      const pick = candidates[0];
      logs.push(log(state, 'HotelAgent', `Selected ${pick.name}${pick.area ? ` in ${pick.area}` : ''} at ${formatUsd(pick.pricePerNight)}/night.`));
      const scored = ranked.find(({ item }) => item.name === pick.name && item.pricePerNight === pick.pricePerNight);
      if (scored) logs.push(log(state, 'HotelAgent', `Score ${describeBreakdown(scored.breakdown)}`, 'info'));
    }

    const estimated = tools.name !== 'mock' && found.some((hotel) => hotel.source === 'mock');
    if (estimated) logs.push(searchFallbackLog(state, 'HotelAgent', 'hotel'));

    const pick = hotels[0];
    const messages = [];
    const why = pick?.picked?.length ? ` Picked for you: ${reasonsText(pick.picked)}.` : '';
    if (pick) {
      if (state.retryCount === 0) messages.push(say(state, 'HotelAgent', hotelProposal(pick, nightsFor(state.durationDays), state.budget) + why));
      else if (candidates.length > 0) {
        messages.push(say(state, 'HotelAgent', hotelConfirmed(pick, previous, nightsFor(state.durationDays)) + why, { decision: 'hotel' }));
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
