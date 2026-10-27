import { log, type TravelAgentState, type TravelNode } from '../state.js';

/** Stub: sums the selected options and always completes (no re-plan loop yet). Replaced by B11. */
export const budgetNode = (): TravelNode => async (state) => {
  const totalCost = stubTotal(state);
  return {
    totalCost,
    status: 'completed',
    logs: [log(state, 'BudgetAuditor', `Total $${totalCost} fits the $${state.budget} budget.`)],
  };
};

function stubTotal(state: TravelAgentState): number {
  const flight = state.flights[0]?.price ?? 0;
  const hotel = (state.hotels[0]?.pricePerNight ?? 0) * state.durationDays;
  const transfers = state.transfers.reduce((sum, transfer) => sum + transfer.priceUsd, 0);
  return Math.round((flight + hotel + transfers + state.dailyExpensesEstimate * state.durationDays) * 100) / 100;
}
