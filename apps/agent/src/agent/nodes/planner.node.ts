import { log, type TravelNode } from '../state.js';
import { STUB_DAILY_EXPENSES, stubItinerary, stubTransfers } from './stubData.js';

/** Stub: canned transfers and a Paris itinerary with one entry per day. Replaced by B14. */
export const plannerNode = (): TravelNode => async (state) => {
  const itinerary = stubItinerary(state.startDate ?? '2026-12-01', state.durationDays);
  return {
    transfers: stubTransfers(state.durationDays),
    itinerary,
    dailyExpensesEstimate: STUB_DAILY_EXPENSES,
    status: 'auditing',
    logs: [log(state, 'Planner', `Built a ${itinerary.length}-day itinerary.`)],
  };
};
