import type { Flight, Hotel, ItineraryDay, Transfer } from '@ai-travel/contracts';
import { addDays } from '../utils/dates.js';
import { formatUsd } from './state.js';

/**
 * Pure text builders for the friendly chat stream (ARCHITECTURE.md §4.6). English only, no LLM:
 * the nodes pass the result to `say()`. Money always goes through `formatUsd`.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Above this share of the budget a flight gets a "that is a lot" remark. */
const EXPENSIVE_FLIGHT_SHARE = 0.4;

const time = (iso: string) => iso.slice(11, 16);

/** A 6-day trip from 12 November → "12–17 November"; "28 November – 3 December" across months. Day 1 is the start date. */
function dateRange(startDate: string, days: number): string {
  const [, startMonth = 1, startDay = 1] = startDate.split('-').map(Number);
  const [, endMonth = 1, endDay = 1] = addDays(startDate, Math.max(0, days - 1)).split('-').map(Number);
  const start = MONTHS[startMonth - 1] ?? '';
  const end = MONTHS[endMonth - 1] ?? '';
  return startMonth === endMonth ? `${startDay}–${endDay} ${start}` : `${startDay} ${start} – ${endDay} ${end}`;
}

/** 110 → "1 h 50 m", 120 → "2 h", 45 → "45 m". */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} h` : '', m > 0 ? `${m} m` : ''].filter(Boolean).join(' ');
}

const route = (flight: Flight) =>
  flight.outbound.stops.length === 0 ? 'direct' : `via ${flight.outbound.stops.map((stop) => stop.airport.name.replace(/ International.*$/, '')).join(', ')}`;

export function tripConfirmed(args: { destination: string; origin: string; durationDays: number; startDate: string; budget: number }): string {
  const { destination, origin, durationDays, startDate, budget } = args;
  return `Got it — ${durationDays} days in ${destination} from ${origin}, ${dateRange(startDate, durationDays)}, ${formatUsd(budget)} all-in. @Flight Agent and @Hotel Agent, you're up.`;
}

export function missingDetails(error: string): string {
  return `I need a bit more to get started. ${error}`;
}

export function flightProposal(flights: Flight[], budget: number): string {
  const best = flights[0];
  if (!best) return 'I could not find any flights for these dates.';
  const parts = [
    `I found ${flights.length} flight${flights.length === 1 ? '' : 's'} — the best option is ${best.airline} at ${formatUsd(best.price)}.`,
  ];
  if (best.price > budget * EXPENSIVE_FLIGHT_SHARE) {
    const lead = best.outbound.stops.length === 0 ? 'Direct, but that' : 'That';
    parts.push(`${lead} is ${best.price >= budget / 2 ? 'half the budget' : 'a big share of the budget'}.`);
  }
  if (best.return && best.source !== 'mock') parts.push(`The flight home leaves ${best.return.from.code} at ${time(best.return.departure)}.`);
  if (flights.some((flight) => flight.source === 'mock')) parts.push("Live prices weren't available, so these are estimates.");
  return parts.join(' ');
}

export function flightConfirmed(flight: Flight, previous: Flight | undefined): string {
  const outbound = flight.outbound;
  const stop = outbound.stops[0];
  const parts = [`${flight.airline} ${route(flight)} is ${formatUsd(flight.price)}.`];
  if (stop) parts.push(`The layover at ${stop.airport.name} is ${duration(stop.layoverMinutes)}.`);
  parts.push(`It lands at ${outbound.to.code}${outbound.terminal ? ` Terminal ${outbound.terminal}` : ''} at ${time(outbound.arrival)}.`);
  if (previous && previous.price > flight.price) parts.push(`That saves ${formatUsd(previous.price - flight.price)}.`);
  return parts.join(' ');
}

export function hotelProposal(hotel: Hotel, nights: number, budget: number): string {
  const where = hotel.area ? ` in ${hotel.area}` : '';
  const heavy = hotel.pricePerNight * nights > budget * EXPENSIVE_FLIGHT_SHARE;
  return `${hotel.name}${where} is ${formatUsd(hotel.pricePerNight)}/night, rated ${hotel.rating}${heavy ? ' — that pushes the budget.' : '.'}`;
}

export function hotelConfirmed(hotel: Hotel, previous: Hotel | undefined, nights: number): string {
  const where = hotel.area ? `near ${hotel.area} ` : '';
  const parts = [`Found a great stay ${where}for ${formatUsd(hotel.pricePerNight)}/night! Rated ${hotel.rating}`];
  if (previous && previous.pricePerNight > hotel.pricePerNight) {
    parts[0] += `, saving us ${formatUsd((previous.pricePerNight - hotel.pricePerNight) * nights)}.`;
  } else parts[0] += '.';
  if (hotel.transit) parts.push(`Nearest station: ${hotel.transit}.`);
  return parts.join(' ');
}

export function transferProposal(flight: Flight, transfers: Transfer[]): string {
  const [arrival, departure] = transfers;
  if (!arrival) return 'No transfers needed.';
  const intro = `Landing at ${time(flight.outbound.arrival)}, ${arrival.mode === 'taxi' ? 'a taxi is the simplest way in' : `the ${arrival.mode} gets us to the hotel`}.`;
  const fare = arrival.note ? ` ${arrival.note.replace(/[.\s]+$/, '')}.` : '';
  const back = departure
    ? ` For the way back: ${departure.mode}, ${formatUsd(departure.priceUsd)}.${departure.note ? ` ${departure.note.replace(/[.\s]+$/, '')}.` : ''}`
    : '';
  return `${intro}${fare}${back}`;
}

export function transfersConfirmed(transfers: Transfer[]): string {
  const [arrival, departure] = transfers;
  if (!arrival) return 'No transfers needed.';
  const total = transfers.reduce((sum, transfer) => sum + transfer.priceUsd, 0);
  const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  return `${cap(arrival.mode)} in${departure ? `, ${departure.mode} out` : ''}. About ${formatUsd(total)} for both.`;
}

export function weatherPrep(day: number, condition: string): { text: string; label: string } {
  return {
    text: `${condition} is forecast for Day ${day}, so I moved it indoors.`,
    label: `Weather prep · Day ${day} moved indoors`,
  };
}

/** "I checked your 14 stops on Google Maps and swapped 3 that are closed on your dates: Louvre Museum (closed on Tuesdays), …". */
export function placesSwapped(checked: number, swapped: string[]): string {
  const shown = swapped.slice(0, 3).join(', ');
  const more = swapped.length > 3 ? ` and ${swapped.length - 3} more` : '';
  return `I checked ${checked} stops on Google Maps and swapped ${swapped.length} that would not work on your dates: ${shown}${more}.`;
}

export function itineraryReady(itinerary: ItineraryDay[]): string {
  const names = itinerary.flatMap((day) => day.places.map((place) => place.name));
  const highlights = names.slice(0, 2);
  const tail = names.length > 2 ? ' and more' : '';
  return `Your ${itinerary.length}-day plan is ready${highlights.length > 0 ? `: ${highlights.join(', ')}${tail}` : ''}.`;
}

export function overBudget(args: { totalCost: number; budget: number; overBudgetBy: number; attempt: number; max: number }): {
  text: string;
  label: string;
} {
  const { totalCost, budget, overBudgetBy, attempt, max } = args;
  return {
    text: `That comes to ${formatUsd(totalCost)} against ${formatUsd(budget)}. We need to find about ${formatUsd(overBudgetBy)} before we lock anything in.`,
    label: `Finding cheaper options, try ${attempt} of ${max}`,
  };
}

export const cheapestFound = 'This is the cheapest combination I could find.';

export function budgetFinal(totalCost: number, budget: number): string {
  return totalCost <= budget
    ? `All in, that's ${formatUsd(totalCost)} of ${formatUsd(budget)} with ${formatUsd(budget - totalCost)} to spare. Approved!`
    : `Best I could do is ${formatUsd(totalCost)}, ${formatUsd(totalCost - budget)} over budget.`;
}
