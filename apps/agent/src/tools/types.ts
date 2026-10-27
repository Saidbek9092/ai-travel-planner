import type { DayWeather, Flight, Hotel } from '@ai-travel/contracts';

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

export interface TravelSearchTool {
  readonly name: 'serpapi' | 'mock';
  searchFlights(query: FlightQuery, signal?: AbortSignal): Promise<Flight[]>;
  searchHotels(query: HotelQuery, signal?: AbortSignal): Promise<Hotel[]>;
  /** One entry per trip day; `null` when no forecast is available (filled in by B23). */
  getForecast(
    destination: string,
    startDate: string | null,
    days: number,
    signal?: AbortSignal,
  ): Promise<(DayWeather | null)[]>;
}

/** The live provider could not answer; the caller may fall back to the mock tool. */
export class ToolUnavailableError extends Error {
  override readonly name = 'ToolUnavailableError';
}
