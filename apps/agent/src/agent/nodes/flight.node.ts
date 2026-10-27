import { log, type TravelNode } from '../state.js';
import { stubFlights } from './stubData.js';

/** Stub: one canned flight. Replaced by B12. */
export const flightNode = (): TravelNode => async (state) => {
  const flights = stubFlights(state.startDate ?? '2026-12-01', state.durationDays);
  return {
    flights,
    status: 'searching',
    logs: [log(state, 'FlightAgent', `Found a $${flights[0]!.price} flight on the ${state.origin} -> ${state.destination} route.`)],
  };
};
