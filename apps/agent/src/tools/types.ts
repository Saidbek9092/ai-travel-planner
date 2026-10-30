import type { DayWeather, Flight, Hotel } from '@ai-travel/contracts';
import type { PlacePhoto } from './placePhotos.js';
import type { Weekday } from '../utils/dates.js';
import type { LatLng } from '../utils/geo.js';

export type SearchMode = 'standard' | 'cheaper';

export interface FlightQuery {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  mode: SearchMode;
  /** Exclusive upper bound in `cheaper` mode. */
  maxPrice?: number;
}

export interface HotelQuery {
  destination: string;
  checkIn: string;
  checkOut: string;
  mode: SearchMode;
  /** Exclusive upper bound in `cheaper` mode. */
  maxPricePerNight?: number;
}

/** What the return search may filter on. */
export interface ReturnOptions {
  /** Most stops allowed on the way back; `null` = no limit. */
  maxStops: number | null;
}

/** Flight and hotel search: what SerpAPI and the mock engine implement. */
export interface SearchTool {
  readonly name: 'serpapi' | 'mock';
  searchFlights(query: FlightQuery, signal?: AbortSignal): Promise<Flight[]>;
  /**
   * The same flight with its real return leg (and the round-trip price for that pair). Google Flights answers a
   * round-trip search with outbound legs only, so the return is a second search for the chosen outbound.
   * Throws `ToolUnavailableError` when it cannot be found; never invents one.
   */
  completeReturn(query: FlightQuery, flight: Flight, options: ReturnOptions, signal?: AbortSignal): Promise<Flight>;
  searchHotels(query: HotelQuery, signal?: AbortSignal): Promise<Hotel[]>;
}

/** Identifies one flight option across copies (the search cache hands out clones). */
export function flightKey(flight: Flight): string {
  const { outbound } = flight;
  return [flight.airline, flight.price, outbound.departure, outbound.arrival, ...(outbound.flightNumbers ?? [])].join('|');
}

/** A place as Google Maps knows it. */
export interface PlaceFacts {
  found: true;
  /** Google's name for it, e.g. "The Centre Pompidou". */
  name: string;
  location: LatLng;
  /** Lower-case weekday → hours text ("9 AM–6 PM", "Closed"); `null` when Google lists none. */
  hours: Partial<Record<Weekday, string>> | null;
  closed: 'temporarily' | 'permanently' | null;
  website: string | null;
}

/** `found: false` = the search worked and nothing by that name is there. */
export type PlaceCheck = PlaceFacts | { found: false };

/** What the nodes see: search plus the daily forecast (Open-Meteo, independent of the search provider). */
export interface TravelSearchTool extends SearchTool {
  /** One entry per trip day; `null` when no forecast is available. */
  getForecast(
    destination: string,
    startDate: string | null,
    days: number,
    signal?: AbortSignal,
  ): Promise<(DayWeather | null)[]>;
  /** Centre of the destination (cached geocoding); `null` when it cannot be found. Never rejects except on abort. */
  /** One photo per place; `null` when there is none or the lookup fails. Never rejects except on abort. */
  getPlacePhoto(name: string, destination: string, signal?: AbortSignal): Promise<PlacePhoto | null>;
  getCenter(destination: string, signal?: AbortSignal): Promise<LatLng | null>;
  /** Looks a planned stop up on Google Maps near `near`; `null` when it cannot be checked (mock mode, no key, outage). Never rejects except on abort. */
  checkPlace(name: string, destination: string, near: LatLng, signal?: AbortSignal): Promise<PlaceCheck | null>;
}

/** The live provider could not answer; the caller may fall back to the mock tool. */
export class ToolUnavailableError extends Error {
  override readonly name = 'ToolUnavailableError';
}

/** No airport could be found for this place, so live flight search cannot run; callers fall back to estimates. */
export class UnknownAirportError extends ToolUnavailableError {
  constructor(readonly place: string) {
    super(`No airport found for "${place}"`);
  }
}
