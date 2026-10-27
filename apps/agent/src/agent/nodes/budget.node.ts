import { MAX_BUDGET_RETRIES, formatUsd, log, type TravelAgentState, type TravelNode } from '../state.js';

const round = (value: number) => Math.round(value * 100) / 100;

/** flight + hotel × days + Σ transfers + daily × days, in USD to the cent. */
export function computeTotalCost(
  state: Pick<TravelAgentState, 'flights' | 'hotels' | 'transfers' | 'dailyExpensesEstimate' | 'durationDays'>,
): number {
  const flight = state.flights[0]?.price ?? 0;
  const hotel = (state.hotels[0]?.pricePerNight ?? 0) * state.durationDays;
  const transfers = state.transfers.reduce((sum, transfer) => sum + transfer.priceUsd, 0);
  return round(flight + hotel + transfers + state.dailyExpensesEstimate * state.durationDays);
}

function flightLabel(state: TravelAgentState): string {
  const flight = state.flights[0];
  if (!flight) return '$0';
  const stops = flight.outbound.stops;
  return `${formatUsd(flight.price)} ${stops.length === 0 ? 'direct' : `via ${stops.map((stop) => stop.airport.code).join(', ')}`}`;
}

/** Pure cost check and re-plan decision (ARCHITECTURE.md §4.3). No I/O. */
export const budgetNode = (): TravelNode => async (state) => {
  const totalCost = computeTotalCost(state);
  const hotelNightly = state.hotels[0]?.pricePerNight ?? 0;
  const pass = {
    pass: Math.min(state.retryCount + 1, 3),
    flight: state.flights[0]?.price ?? 0,
    hotel: round(hotelNightly * state.durationDays),
    transfers: round(state.transfers.reduce((sum, transfer) => sum + transfer.priceUsd, 0)),
    daily: round(state.dailyExpensesEstimate * state.durationDays),
    totalCost,
    flightLabel: flightLabel(state),
    hotelLabel: `${state.durationDays} × ${formatUsd(hotelNightly)}`,
  };

  if (totalCost <= state.budget) {
    return {
      totalCost,
      status: 'completed',
      passes: [pass],
      logs: [log(state, 'BudgetAuditor', `Total ${formatUsd(totalCost)} fits the ${formatUsd(state.budget)} budget.`)],
    };
  }

  const overBudgetBy = round(totalCost - state.budget);

  if (state.retryCount < MAX_BUDGET_RETRIES) {
    return {
      totalCost,
      overBudgetBy,
      retryCount: state.retryCount + 1,
      searchMode: 'cheaper',
      status: 'searching',
      passes: [pass],
      logs: [
        log(
          state,
          'BudgetAuditor',
          `Over budget by ${formatUsd(overBudgetBy)}, re-planning (attempt ${state.retryCount + 1}/${MAX_BUDGET_RETRIES}).`,
          'warn',
        ),
      ],
    };
  }

  return {
    totalCost,
    overBudgetBy,
    status: 'completed',
    passes: [pass],
    warnings: [`Budget exceeded by ${formatUsd(overBudgetBy)}`],
    suggestions: {
      raiseBudgetTo: (Math.floor(totalCost / 100) + 1) * 100,
      tryDays: Math.max(1, state.durationDays - 1),
    },
    logs: [
      log(
        state,
        'BudgetAuditor',
        `Still over budget by ${formatUsd(overBudgetBy)} after ${MAX_BUDGET_RETRIES} re-plans; returning the cheapest combination.`,
        'warn',
      ),
    ],
  };
};
