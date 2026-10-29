import type { DayWeather, Flight, Hotel } from '@ai-travel/contracts';
import type { PlacePhoto } from './placePhotos.js';
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

/** Flight and hotel search: what SerpAPI and the mock engine implement. */
export interface SearchTool {
  readonly name: 'serpapi' | 'mock';
  searchFlights(query: FlightQuery, signal?: AbortSignal): Promise<Flight[]>;
  searchHotels(query: HotelQuery, signal?: AbortSignal): Promise<Hotel[]>;
}

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
}

/** The live provider could not answer; the caller may fall back to the mock tool. */
export class ToolUnavailableError extends Error {
  override readonly name = 'ToolUnavailableError';
}

/** No airport is known for this place, so live flight search cannot run; callers fall back to estimates. */
export class UnknownAirportError extends ToolUnavailableError {
  constructor(readonly place: string) {
    super(`No airport found for "${place}"`);
  }
}
