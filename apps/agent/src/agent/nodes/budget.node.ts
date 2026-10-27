import { nightsFor } from '../../utils/dates.js';
import { budgetFinal, cheapestFound, flightConfirmed, hotelConfirmed, overBudget, transfersConfirmed } from '../messages.js';
import { MAX_BUDGET_RETRIES, formatUsd, log, say, type ChatMessage, type TravelAgentState, type TravelNode } from '../state.js';

const round = (value: number) => Math.round(value * 100) / 100;

/** flight + hotel × days + Σ transfers + daily × days, in USD to the cent. */
export function computeTotalCost(
  state: Pick<TravelAgentState, 'flights' | 'hotels' | 'transfers' | 'dailyExpensesEstimate' | 'durationDays'>,
): number {
  const flight = state.flights[0]?.price ?? 0;
  const hotel = (state.hotels[0]?.pricePerNight ?? 0) * nightsFor(state.durationDays);
  const transfers = state.transfers.reduce((sum, transfer) => sum + transfer.priceUsd, 0);
  return round(flight + hotel + transfers + state.dailyExpensesEstimate * state.durationDays);
}

function flightLabel(state: TravelAgentState): string {
  const flight = state.flights[0];
  if (!flight) return '$0';
  const stops = flight.outbound.stops;
  return `${formatUsd(flight.price)} ${stops.length === 0 ? 'direct' : `via ${stops.map((stop) => stop.airport.code).join(', ')}`}`;
}

type FinalTopic = 'flight' | 'hotel' | 'transfers' | 'budget';

/** Confirms every flight / hotel / transfers decision not yet made, then the final budget. */
function finalMessages(state: TravelAgentState, totalCost: number, exhausted: boolean): { messages: ChatMessage[]; confirmed: FinalTopic[] } {
  const messages: ChatMessage[] = [];
  const confirmed: FinalTopic[] = [];
  const flight = state.flights[0];
  const hotel = state.hotels[0];
  if (exhausted) messages.push(say(state, 'BudgetAuditor', cheapestFound));
  if (flight && !state.confirmed.includes('flight')) {
    messages.push(say(state, 'FlightAgent', flightConfirmed(flight, undefined), { decision: 'flight' }));
    confirmed.push('flight');
  }
  if (hotel && !state.confirmed.includes('hotel')) {
    messages.push(say(state, 'HotelAgent', hotelConfirmed(hotel, undefined, nightsFor(state.durationDays)), { decision: 'hotel' }));
    confirmed.push('hotel');
  }
  if (state.transfers.length > 0 && !state.confirmed.includes('transfers')) {
    messages.push(say(state, 'Planner', transfersConfirmed(state.transfers), { decision: 'transfers' }));
    confirmed.push('transfers');
  }
  messages.push(say(state, 'BudgetAuditor', budgetFinal(totalCost, state.budget), { decision: 'budget' }));
  confirmed.push('budget');
  return { messages, confirmed };
}

/** Pure cost check and re-plan decision (ARCHITECTURE.md §4.3). No I/O. */
export const budgetNode = (): TravelNode => async (state) => {
  const totalCost = computeTotalCost(state);
  const hotelNightly = state.hotels[0]?.pricePerNight ?? 0;
  const pass = {
    pass: Math.min(state.retryCount + 1, 3),
    flight: state.flights[0]?.price ?? 0,
    hotel: round(hotelNightly * nightsFor(state.durationDays)),
    transfers: round(state.transfers.reduce((sum, transfer) => sum + transfer.priceUsd, 0)),
    daily: round(state.dailyExpensesEstimate * state.durationDays),
    totalCost,
    flightLabel: flightLabel(state),
    hotelLabel: `${nightsFor(state.durationDays)} × ${formatUsd(hotelNightly)}`,
  };

  if (totalCost <= state.budget) {
    return {
      totalCost,
      status: 'completed',
      passes: [pass],
      logs: [log(state, 'BudgetAuditor', `Total ${formatUsd(totalCost)} fits the ${formatUsd(state.budget)} budget.`)],
      ...finalMessages(state, totalCost, false),
    };
  }

  const overBudgetBy = round(totalCost - state.budget);

  if (state.retryCount < MAX_BUDGET_RETRIES) {
    const notice = overBudget({ totalCost, budget: state.budget, overBudgetBy, attempt: state.retryCount + 1, max: MAX_BUDGET_RETRIES });
    return {
      messages: [say(state, 'BudgetAuditor', notice.text, { callout: { tone: 'warn', label: notice.label } })],
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
    ...finalMessages(state, totalCost, true),
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
