import { flightConfirmed, flightProposal } from '../messages.js';
import type { LlmFactory } from '../llm.js';
import { applyPick, matchesStops, reasonsText, softPreferences } from '../pick.js';
import { describeBreakdown, rankFlights } from '../ranking.js';
import { formatUsd, llmFallbackLog, log, say, searchFallbackLog, type TravelNode } from '../state.js';
import { addDays, nightsFor } from '../../utils/dates.js';
import { iataFor } from '../../tools/airports.js';
import type { TravelSearchTool } from '../../tools/index.js';

export interface FlightNodeDeps {
  tools: TravelSearchTool;
  llm: LlmFactory;
}

const FALLBACK_WARNING = 'Live flight prices were unavailable; flight prices are estimates.';

export const flightNode =
  ({ tools, llm }: FlightNodeDeps): TravelNode =>
  async (state, config) => {
    const previous = state.flights[0];
    const cheaper = state.searchMode === 'cheaper' && previous !== undefined;

    const found = await tools.searchFlights(
      {
        origin: state.origin ?? '',
        destination: state.destination,
        departDate: state.startDate ?? '',
        returnDate: addDays(state.startDate ?? '', nightsFor(state.durationDays)),
        mode: state.searchMode,
        ...(cheaper && { maxPrice: previous.price }),
      },
      config?.signal,
    );

    // Cheaper mode stays strict: only cheaper options are candidates, the score just orders them.
    const eligible = cheaper ? found.filter((flight) => flight.price < previous.price) : found;
    const logs = [];
    // Hard preferences ("direct only") are a code filter. If nothing matches, show the best of the rest and say so.
    const matching = eligible.filter((flight) => matchesStops(flight, state.preferences));
    const noMatch = eligible.length > 0 && matching.length === 0;
    if (noMatch) logs.push(log(state, 'FlightAgent', 'No flight matches the stop preference; showing the closest options.', 'warn'));
    const ranked = rankFlights(noMatch ? eligible : matching, { budget: state.budget });

    const outcome = await applyPick({
      llm,
      kind: 'flight',
      ranked: ranked.map(({ item }) => item),
      preferences: softPreferences(state.preferences, state.overrides.interests),
      isAllowed: (flight) => !cheaper || flight.price < previous.price,
      signal: config?.signal,
    });
    const candidates = outcome.options;
    if (outcome.failure) logs.push(log(state, 'FlightAgent', `Kept the top-scored flight: ${outcome.failure}.`, 'warn'));
    if (outcome.model && outcome.model !== llm.primaryModel) logs.push(llmFallbackLog(state, 'FlightAgent', outcome.model));

    let flights = candidates;
    if (candidates.length === 0) {
      // Nothing cheaper (or nothing at all): never replace the selection with a worse one.
      flights = previous ? state.flights : [];
      if (previous) logs.push(log(state, 'FlightAgent', `No cheaper flight found, keeping ${formatUsd(previous.price)} option.`));
    }

    const best = flights[0];
    if (best && candidates.length > 0) {
      logs.push(log(state, 'FlightAgent', `Found a ${formatUsd(best.price)} flight on the ${state.origin} -> ${state.destination} route.`));
      const scored = ranked.find(({ item }) => item.outbound === best.outbound);
      if (scored) logs.push(log(state, 'FlightAgent', `Score ${describeBreakdown(scored.breakdown)}`, 'info'));
    }

    const estimated = tools.name !== 'mock' && found.some((flight) => flight.source === 'mock');
    if (estimated) logs.push(searchFallbackLog(state, 'FlightAgent', 'flight'));

    // A place with no known airport can only be answered with estimates; say which one.
    const unknownPlaces = tools.name === 'mock' ? [] : [state.origin ?? '', state.destination].filter((place) => place && iataFor(place) === undefined);
    const unknownWarnings = unknownPlaces.map((place) => `No airport found for "${place}", so flight prices are estimates.`);
    for (const warning of unknownWarnings) logs.push(log(state, 'FlightAgent', warning, 'warn'));

    // First pass proposes; a re-plan pass confirms the pick (only when it actually changed).
    const messages = [];
    if (best) {
      const why = best.picked?.length ? ` Picked for you: ${reasonsText(best.picked)}.` : '';
      if (state.retryCount === 0) messages.push(say(state, 'FlightAgent', flightProposal(flights, state.budget) + why));
      else if (candidates.length > 0) {
        messages.push(say(state, 'FlightAgent', flightConfirmed(best, previous) + why, { decision: 'flight' }));
      }
    }

    return {
      flights,
      status: 'searching',
      logs,
      messages,
      ...(messages.some((message) => message.decision) && { confirmed: ['flight' as const] }),
      ...(() => {
        const warnings = [...(estimated && unknownWarnings.length === 0 ? [FALLBACK_WARNING] : []), ...unknownWarnings].filter(
          (warning) => !state.warnings.includes(warning),
        );
        return warnings.length > 0 ? { warnings } : {};
      })(),
    };
  };

