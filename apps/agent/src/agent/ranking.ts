import type { Flight, FlightLeg, Hotel } from '@ai-travel/contracts';
import { haversineKm, type LatLng } from '../utils/geo.js';

/**
 * Deterministic flight and hotel scoring. Pure: no I/O, no LLM. Lowest score = best.
 * Every factor is in "points"; the weights below are the only knobs.
 */

/** Points for spending the whole budget on this one item; scales linearly with the share of the budget. */
const PRICE_POINTS_AT_FULL_BUDGET = 10;
/** Points per hour of total door-to-door flying time (both directions). */
const TRAVEL_POINTS_PER_HOUR = 0.3;
/** Points per stop, both directions together. */
const STOP_POINTS = 1.5;
/** A layover up to this long is just a connection; beyond it each extra hour hurts. */
const LONG_LAYOVER_MINUTES = 4 * 60;
const LONG_LAYOVER_POINTS_PER_HOUR = 0.5;
/** Departing or landing between 00:00 and 05:59 local, per occurrence. */
const RED_EYE_POINTS = 1.5;
/** Landing before this local hour means waiting for the hotel room. */
const EARLY_ARRIVAL_HOUR = 12;
const EARLY_ARRIVAL_POINTS = 0.3;
/** Hard filter: flights with a layover over this are dropped unless nothing else is left. */
const MAX_LAYOVER_MINUTES = 12 * 60;

/** Points for a hotel rated 0 against 10; scales linearly. */
const RATING_POINTS_PER_STEP = 0.6;
/** Points per km from the destination centre. */
const DISTANCE_POINTS_PER_KM = 0.25;
/** Missing data scores neutral: a middling rating, a 6 km distance. */
const NEUTRAL_RATING = 7;
const NEUTRAL_DISTANCE_KM = 6;
/** No public transport listed nearby. */
const NO_TRANSIT_POINTS = 0.5;
/** Hotels rated below this are skipped when anything better exists. */
export const MIN_PREFERRED_RATING = 7;

export interface Scored<T> {
  item: T;
  score: number;
  /** Points per factor, e.g. `price 4.2 · time 3.6 · stops 1.5 · red-eye 0`. */
  breakdown: Record<string, number>;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function describeBreakdown(breakdown: Record<string, number>): string {
  return Object.entries(breakdown)
    .map(([name, points]) => `${name} ${round1(points)}`)
    .join(' · ');
}

const sumBreakdown = (breakdown: Record<string, number>) => Object.values(breakdown).reduce((sum, points) => sum + points, 0);
const share = (price: number, budget: number) => (budget > 0 ? price / budget : 1);

/** Local hour of an ISO date-time as the airline wrote it ("2026-11-01T03:10:00+05:00" → 3). */
const localHour = (iso: string) => Number(iso.slice(11, 13));
const isRedEye = (iso: string) => localHour(iso) < 6;
const legs = (flight: Flight): FlightLeg[] => (flight.return ? [flight.outbound, flight.return] : [flight.outbound]);
const longestLayover = (flight: Flight) =>
  Math.max(0, ...legs(flight).flatMap((leg) => leg.stops.map((stop) => stop.layoverMinutes)));

export interface FlightContext {
  /** Whole-trip budget in USD. */
  budget: number;
}

export function flightScore(flight: Flight, { budget }: FlightContext): Scored<Flight> {
  const hours = legs(flight).reduce((sum, leg) => sum + (Date.parse(leg.arrival) - Date.parse(leg.departure)) / 3_600_000, 0);
  const stops = legs(flight).reduce((sum, leg) => sum + leg.stops.length, 0);
  const layoverHours = Math.max(0, longestLayover(flight) - LONG_LAYOVER_MINUTES) / 60;
  const redEyes = legs(flight).reduce((sum, leg) => sum + Number(isRedEye(leg.departure)) + Number(isRedEye(leg.arrival)), 0);
  const early = localHour(flight.outbound.arrival) < EARLY_ARRIVAL_HOUR && !isRedEye(flight.outbound.arrival);

  const breakdown = {
    price: share(flight.price, budget) * PRICE_POINTS_AT_FULL_BUDGET,
    time: Number.isFinite(hours) ? hours * TRAVEL_POINTS_PER_HOUR : 0,
    stops: stops * STOP_POINTS,
    layover: layoverHours * LONG_LAYOVER_POINTS_PER_HOUR,
    'red-eye': redEyes * RED_EYE_POINTS,
    arrival: early ? EARLY_ARRIVAL_POINTS : 0,
  };
  return { item: flight, score: sumBreakdown(breakdown), breakdown };
}

export interface HotelContext {
  budget: number;
  nights: number;
  /** Destination centre; without it the distance factor is neutral. */
  center: LatLng | null;
}

export function hotelScore(hotel: Hotel, { budget, nights, center }: HotelContext): Scored<Hotel> {
  const distanceKm = center && hotel.location ? haversineKm(center, hotel.location) : NEUTRAL_DISTANCE_KM;
  const breakdown = {
    price: share(hotel.pricePerNight * nights, budget) * PRICE_POINTS_AT_FULL_BUDGET,
    rating: (10 - (hotel.rating > 0 ? hotel.rating : NEUTRAL_RATING)) * RATING_POINTS_PER_STEP,
    distance: distanceKm * DISTANCE_POINTS_PER_KM,
    transit: hotel.transit ? 0 : NO_TRANSIT_POINTS,
  };
  return { item: hotel, score: sumBreakdown(breakdown), breakdown };
}

/** Stable order: score, then price, then the original position. */
function byScore<T>(price: (item: T) => number) {
  return (a: Scored<T>, b: Scored<T>) => a.score - b.score || price(a.item) - price(b.item);
}

/** Drops flights with a layover over 12 h; keeps them all when that would leave nothing. */
export function filterFlights(flights: Flight[]): Flight[] {
  const sensible = flights.filter((flight) => longestLayover(flight) <= MAX_LAYOVER_MINUTES);
  return sensible.length > 0 ? sensible : flights;
}

/** Drops hotels rated below 7; keeps them all when that would leave nothing. */
export function filterHotels(hotels: Hotel[]): Hotel[] {
  const preferred = hotels.filter((hotel) => hotel.rating >= MIN_PREFERRED_RATING);
  return preferred.length > 0 ? preferred : hotels;
}

/** Filtered flights, best first. `[0]` is the pick. */
export function rankFlights(flights: Flight[], context: FlightContext): Scored<Flight>[] {
  return filterFlights(flights)
    .map((flight) => flightScore(flight, context))
    .sort(byScore((flight) => flight.price));
}

/** Filtered hotels, best first. `[0]` is the pick. */
export function rankHotels(hotels: Hotel[], context: HotelContext): Scored<Hotel>[] {
  return filterHotels(hotels)
    .map((hotel) => hotelScore(hotel, context))
    .sort(byScore((hotel) => hotel.pricePerNight));
}
