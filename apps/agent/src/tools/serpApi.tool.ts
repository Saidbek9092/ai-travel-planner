import { FlightSchema, HotelSchema, type Flight, type FlightLeg, type Hotel } from '@ai-travel/contracts';
import { z } from 'zod';
import { airportFor, iataFor } from './airports.js';
import { ToolUnavailableError, type FlightQuery, type HotelQuery, type SearchTool } from './types.js';

const ENDPOINT = 'https://serpapi.com/search.json';
const REQUEST_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [500, 1500];

const FlightSegmentSchema = z.looseObject({
  departure_airport: z.looseObject({ name: z.string(), id: z.string(), time: z.string() }),
  arrival_airport: z.looseObject({ name: z.string(), id: z.string(), time: z.string() }),
  airline: z.string().optional(),
});
const FlightOptionSchema = z.looseObject({
  flights: z.array(FlightSegmentSchema).min(1),
  layovers: z.array(z.looseObject({ duration: z.number(), name: z.string(), id: z.string().optional() })).optional(),
  price: z.number(),
});
const FlightsResponseSchema = z.looseObject({
  best_flights: z.array(z.unknown()).optional(),
  other_flights: z.array(z.unknown()).optional(),
  search_metadata: z.looseObject({ google_flights_url: z.string().optional() }).optional(),
});

const PropertySchema = z.looseObject({
  name: z.string(),
  link: z.string().optional(),
  overall_rating: z.number().optional(),
  neighborhood: z.string().optional(),
  check_in_time: z.string().optional(),
  check_out_time: z.string().optional(),
  rate_per_night: z.looseObject({ extracted_lowest: z.number().optional() }).optional(),
  gps_coordinates: z.looseObject({ latitude: z.number(), longitude: z.number() }).optional(),
  images: z.array(z.looseObject({ thumbnail: z.string().optional() })).optional(),
  nearby_places: z
    .array(
      z.looseObject({
        name: z.string(),
        transportations: z.array(z.looseObject({ type: z.string().optional(), duration: z.string().optional() })).optional(),
      }),
    )
    .optional(),
});
const HotelsResponseSchema = z.looseObject({ properties: z.array(z.unknown()).optional() });

/** "2026-11-12 06:30" → "2026-11-12T06:30:00Z" (Google Flights reports airport-local times without an offset). */
const toIso = (value: string) => `${value.trim().replace(' ', 'T')}:00Z`;

/** "3:00 PM" → "15:00". */
function to24h(value: string | undefined): string | null {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

export interface SerpApiOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

export function createSerpApiTool({ apiKey, fetch: fetchImpl = fetch }: SerpApiOptions): SearchTool {
  /** GET with a per-request timeout, retrying network errors, 429 and 5xx; other 4xx fail at once. */
  async function request(params: Record<string, string>, runSignal?: AbortSignal): Promise<unknown> {
    const url = `${ENDPOINT}?${new URLSearchParams({ ...params, api_key: apiKey })}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      const signal = AbortSignal.any([...(runSignal ? [runSignal] : []), AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      try {
        const response = await fetchImpl(url, { signal });
        if (response.ok) return await response.json();
        if (response.status !== 429 && response.status < 500) {
          throw new ToolUnavailableError(`SerpAPI rejected the request (${response.status})`);
        }
        lastError = new ToolUnavailableError(`SerpAPI error ${response.status}`);
      } catch (error) {
        if (error instanceof ToolUnavailableError) throw error;
        if (runSignal?.aborted) throw error;
        lastError = error;
      }
      const wait = BACKOFF_MS[attempt];
      if (wait === undefined) break;
      await delay(wait + Math.random() * 250, runSignal ?? new AbortController().signal);
    }
    throw new ToolUnavailableError(
      `SerpAPI unavailable: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  return {
    name: 'serpapi',

    async searchFlights(query: FlightQuery, signal?: AbortSignal): Promise<Flight[]> {
      const body = FlightsResponseSchema.safeParse(
        await request(
          {
            engine: 'google_flights',
            departure_id: iataFor(query.origin) ?? query.origin,
            arrival_id: iataFor(query.destination) ?? query.destination,
            outbound_date: query.departDate,
            return_date: query.returnDate,
            type: '1',
            currency: 'USD',
            hl: 'en',
          },
          signal,
        ),
      );
      if (!body.success) throw new ToolUnavailableError('SerpAPI returned an unexpected flights response');

      const bookingUrl = body.data.search_metadata?.google_flights_url;
      const flights = [...(body.data.best_flights ?? []), ...(body.data.other_flights ?? [])]
        .map((raw) => FlightOptionSchema.safeParse(raw))
        .flatMap((parsed) => (parsed.success ? [mapFlight(parsed.data, bookingUrl)] : []))
        .flatMap((candidate) => {
          const checked = FlightSchema.safeParse(candidate);
          return checked.success ? [checked.data] : [];
        });
      if (flights.length === 0) throw new ToolUnavailableError('SerpAPI returned no usable flights');
      return flights;
    },

    async searchHotels(query: HotelQuery, signal?: AbortSignal): Promise<Hotel[]> {
      const body = HotelsResponseSchema.safeParse(
        await request(
          {
            engine: 'google_hotels',
            q: `Hotels in ${query.destination}`,
            check_in_date: query.checkIn,
            check_out_date: query.checkOut,
            adults: '1',
            currency: 'USD',
            hl: 'en',
          },
          signal,
        ),
      );
      if (!body.success) throw new ToolUnavailableError('SerpAPI returned an unexpected hotels response');

      const hotels = (body.data.properties ?? [])
        .map((raw) => PropertySchema.safeParse(raw))
        .flatMap((parsed) => (parsed.success ? [mapHotel(parsed.data)] : []))
        .flatMap((candidate) => {
          const checked = HotelSchema.safeParse(candidate);
          return checked.success ? [checked.data] : [];
        });
      if (hotels.length === 0) throw new ToolUnavailableError('SerpAPI returned no usable hotels');
      return hotels;
    },
  };
}

function mapFlight(option: z.infer<typeof FlightOptionSchema>, bookingUrl: string | undefined) {
  const first = option.flights[0]!;
  const last = option.flights.at(-1)!;
  const outbound: FlightLeg = {
    from: { code: first.departure_airport.id, name: first.departure_airport.name },
    to: { code: last.arrival_airport.id, name: last.arrival_airport.name },
    departure: toIso(first.departure_airport.time),
    arrival: toIso(last.arrival_airport.time),
    terminal: null,
    stops: (option.layovers ?? []).map((layover) => ({
      airport: { code: layover.id ?? airportFor(layover.name).code, name: layover.name },
      layoverMinutes: Math.round(layover.duration),
    })),
  };
  return {
    airline: first.airline ?? 'Unknown airline',
    price: option.price,
    outbound,
    return: null,
    bookingUrl: bookingUrl ?? null,
    source: 'serpapi' as const,
  };
}

function mapHotel(property: z.infer<typeof PropertySchema>) {
  const nearby = property.nearby_places?.find((place) => place.transportations?.length);
  return {
    name: property.name,
    area: property.neighborhood ?? null,
    pricePerNight: property.rate_per_night?.extracted_lowest ?? Number.NaN,
    rating: Math.round(Math.min(5, property.overall_rating ?? 0) * 2 * 10) / 10,
    photoUrl: property.images?.[0]?.thumbnail ?? null,
    checkInTime: to24h(property.check_in_time),
    checkOutTime: to24h(property.check_out_time),
    transit: nearby ? `${nearby.name}` : null,
    location: property.gps_coordinates
      ? { lat: property.gps_coordinates.latitude, lng: property.gps_coordinates.longitude }
      : null,
    bookingUrl: property.link ?? null,
    source: 'serpapi' as const,
  };
}
