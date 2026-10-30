import { FlightLegSchema, FlightSchema, HotelSchema, type Flight, type FlightLeg, type Hotel } from '@ai-travel/contracts';
import { z } from 'zod';
import { AIRPORT_WORD, airportFor, iataFor } from './airports.js';
import { assertProviderUp, markProviderDown, markProviderUp, ProviderDownError } from '../utils/circuitBreaker.js';
import { WEEKDAYS, minutesOf, type Weekday } from '../utils/dates.js';
import { haversineKm, type LatLng } from '../utils/geo.js';
import { recordMetric } from '../utils/runMetrics.js';
import { normalizeKey, TtlCache } from '../utils/ttlCache.js';
import {
  flightKey,
  ToolUnavailableError,
  UnknownAirportError,
  type FlightQuery,
  type HotelQuery,
  type PlaceCheck,
  type ReturnOptions,
  type SearchTool,
} from './types.js';

const ENDPOINT = 'https://serpapi.com/search.json';
const PROVIDER = 'serpapi.com';
const REQUEST_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [500, 1500];
/** Airports of a city change rarely; one lookup per city a week is plenty. */
const AIRPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Return-search tokens kept per process (oldest dropped first); one per outbound option found. */
const MAX_RETURN_TOKENS = 500;
/** A Google Maps match further than this from where the planner put the stop is a different place. */
const MAX_MATCH_KM = 5;
/**
 * Google's single confident match this close to the planned spot is the same place even when the names share no
 * word: with `hl=en` it answers "Padrão dos Descobrimentos" as "Monument to the Discoveries".
 */
const SAME_SPOT_KM = 1.5;

const FlightSegmentSchema = z.looseObject({
  departure_airport: z.looseObject({ name: z.string(), id: z.string(), time: z.string() }),
  arrival_airport: z.looseObject({ name: z.string(), id: z.string(), time: z.string() }),
  airline: z.string().optional(),
  flight_number: z.string().optional(),
});
const FlightOptionSchema = z.looseObject({
  flights: z.array(FlightSegmentSchema).min(1),
  layovers: z.array(z.looseObject({ duration: z.number(), name: z.string(), id: z.string().optional() })).optional(),
  price: z.number(),
  /** Whole itinerary, layovers included. */
  total_duration: z.number().optional(),
  /** Pass back as `departure_token` to list the return flights that pair with this outbound. */
  departure_token: z.string().optional(),
});
const FlightsResponseSchema = z.looseObject({
  best_flights: z.array(z.unknown()).optional(),
  other_flights: z.array(z.unknown()).optional(),
  search_metadata: z.looseObject({ google_flights_url: z.string().optional() }).optional(),
});
const AutocompleteSchema = z.looseObject({
  suggestions: z
    .array(
      z.looseObject({
        type: z.string().optional(),
        id: z.string().optional(),
        airports: z.array(z.looseObject({ id: z.string() })).optional(),
      }),
    )
    .optional(),
});

const NearbySchema = z.looseObject({
  name: z.string(),
  transportations: z.array(z.looseObject({ type: z.string().optional(), duration: z.string().optional() })).optional(),
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
  nearby_places: z.array(NearbySchema).optional(),
});
const HotelsResponseSchema = z.looseObject({ properties: z.array(z.unknown()).optional() });

const MapsPlaceSchema = z.looseObject({
  title: z.string(),
  gps_coordinates: z.looseObject({ latitude: z.number(), longitude: z.number() }),
  open_state: z.string().optional(),
  /** `place_results`: one `{ weekday: hours }` object per day; `local_results`: a status line such as "Temporarily closed". */
  hours: z.union([z.string(), z.array(z.record(z.string(), z.string()))]).optional(),
  operating_hours: z.record(z.string(), z.string()).optional(),
  website: z.string().optional(),
});
const MapsResponseSchema = z.looseObject({
  place_results: z.unknown().optional(),
  local_results: z.array(z.unknown()).optional(),
});

/** Google Hotels lists stations, sights and the airport together; only names that say what they are can be told apart. */
const STATION = /(?<!\p{L})(gare|station|metro|métro|subway|underground|bahnhof|hbf|estación|stazione|u-bahn|s-bahn)(?!\p{L})/iu;
/** Walking further than this to a station is not "getting around". */
const MAX_STATION_WALK_MINUTES = 15;

/** "2026-11-12 06:30" → "2026-11-12T06:30:00": Google Flights reports airport-local times, so no offset is added. */
const toIso = (value: string) => `${value.trim().replace(' ', 'T')}:00`;

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

/** "1 hr 5 min" → 65, "34 min" → 34; `null` when it is not a duration. */
function durationMinutes(value: string | undefined): number | null {
  const hours = value?.match(/(\d+)\s*h/i);
  const minutes = value?.match(/(\d+)\s*min/i);
  if (!hours && !minutes) return null;
  const total = Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0);
  return total > 0 ? total : null;
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

type Request = (params: Record<string, string>, runSignal?: AbortSignal) => Promise<unknown>;

/** GET with a per-request timeout, retrying network errors, 429 and 5xx; other 4xx fail at once. */
function createRequest({ apiKey, fetch: fetchImpl = fetch }: SerpApiOptions): Request {
  return async function request(params, runSignal) {
    try {
      assertProviderUp(PROVIDER);
    } catch (error) {
      if (error instanceof ProviderDownError) throw new ToolUnavailableError(error.message);
      throw error;
    }
    const url = `${ENDPOINT}?${new URLSearchParams({ ...params, api_key: apiKey })}`;
    let lastError: unknown;
    recordMetric((metrics) => (metrics.searchCalls += 1));

    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      const signal = AbortSignal.any([...(runSignal ? [runSignal] : []), AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      try {
        const response = await fetchImpl(url, { signal });
        if (response.ok) {
          const body: unknown = await response.json();
          markProviderUp(PROVIDER);
          return body;
        }
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
    markProviderDown(PROVIDER);
    throw new ToolUnavailableError(
      `SerpAPI unavailable: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  };
}

export function createSerpApiTool(options: SerpApiOptions): SearchTool {
  const request = createRequest(options);
  const airportIds = new TtlCache<string>(AIRPORT_TTL_MS);
  const returnTokens = new Map<string, string>();

  /** IATA code from the table, else Google Flights' own id for the city (all its airports) via autocomplete. */
  async function airportId(place: string, signal?: AbortSignal): Promise<string> {
    const known = iataFor(place);
    if (known) return known;
    return airportIds.remember(normalizeKey(place), async () => {
      const body = AutocompleteSchema.safeParse(await request({ engine: 'google_flights_autocomplete', q: place, hl: 'en' }, signal));
      const match = body.success ? body.data.suggestions?.find((suggestion) => suggestion.airports?.length) : undefined;
      const id = match?.type === 'city' && match.id ? match.id : match?.airports?.[0]?.id;
      if (!id) throw new UnknownAirportError(place);
      return id;
    });
  }

  async function flightParams(query: FlightQuery, signal?: AbortSignal): Promise<Record<string, string>> {
    const [departureId, arrivalId] = await Promise.all([airportId(query.origin, signal), airportId(query.destination, signal)]);
    return {
      engine: 'google_flights',
      departure_id: departureId,
      arrival_id: arrivalId,
      outbound_date: query.departDate,
      return_date: query.returnDate,
      type: '1',
      currency: 'USD',
      hl: 'en',
    };
  }

  function rememberToken(flight: Flight, token: string) {
    const key = flightKey(flight);
    returnTokens.delete(key);
    returnTokens.set(key, token);
    const oldest = returnTokens.keys().next().value;
    if (returnTokens.size > MAX_RETURN_TOKENS && oldest !== undefined) returnTokens.delete(oldest);
  }

  return {
    name: 'serpapi',

    async searchFlights(query: FlightQuery, signal?: AbortSignal): Promise<Flight[]> {
      const body = FlightsResponseSchema.safeParse(await request(await flightParams(query, signal), signal));
      if (!body.success) throw new ToolUnavailableError('SerpAPI returned an unexpected flights response');

      const bookingUrl = body.data.search_metadata?.google_flights_url;
      const flights = [...(body.data.best_flights ?? []), ...(body.data.other_flights ?? [])]
        .map((raw) => FlightOptionSchema.safeParse(raw))
        .flatMap((parsed) => {
          if (!parsed.success) return [];
          const checked = FlightSchema.safeParse(mapFlight(parsed.data, bookingUrl));
          if (!checked.success) return [];
          if (parsed.data.departure_token) rememberToken(checked.data, parsed.data.departure_token);
          return [checked.data];
        });
      if (flights.length === 0) throw new ToolUnavailableError('SerpAPI returned no usable flights');
      return flights;
    },

    async completeReturn(query: FlightQuery, flight: Flight, { maxStops }: ReturnOptions, signal?: AbortSignal): Promise<Flight> {
      const token = returnTokens.get(flightKey(flight));
      if (!token) throw new ToolUnavailableError('No return search is available for this flight');
      const body = FlightsResponseSchema.safeParse(
        await request({ ...(await flightParams(query, signal)), departure_token: token }, signal),
      );
      if (!body.success) throw new ToolUnavailableError('SerpAPI returned an unexpected return-flights response');

      const options = [...(body.data.best_flights ?? []), ...(body.data.other_flights ?? [])]
        .map((raw) => FlightOptionSchema.safeParse(raw))
        .flatMap((parsed) => {
          if (!parsed.success) return [];
          const leg = FlightLegSchema.safeParse(mapLeg(parsed.data));
          return leg.success ? [{ leg: leg.data, price: parsed.data.price }] : [];
        });
      const choice = pickReturn(options, maxStops);
      if (!choice) throw new ToolUnavailableError('SerpAPI returned no return flights for this outbound');
      return {
        ...flight,
        price: choice.price,
        return: choice.leg,
        bookingUrl: body.data.search_metadata?.google_flights_url ?? flight.bookingUrl,
      };
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

/**
 * Google Maps lookup for a planned stop (`engine=google_maps`). Throws `ToolUnavailableError` when SerpAPI cannot
 * answer; `{ found: false }` when it answered and nothing by that name is near `near`.
 */
export function createSerpApiPlaceCheck(options: SerpApiOptions) {
  const request = createRequest(options);
  return async (name: string, destination: string, near: LatLng, signal?: AbortSignal): Promise<PlaceCheck> => {
    const body = MapsResponseSchema.safeParse(
      await request({ engine: 'google_maps', type: 'search', q: `${name}, ${destination}`, ll: `@${near.lat},${near.lng},15z`, hl: 'en' }, signal),
    );
    if (!body.success) throw new ToolUnavailableError('SerpAPI returned an unexpected maps response');

    // `place_results` is Google's single confident match; `local_results` is a list to choose from by name.
    const exact = body.data.place_results !== undefined;
    const candidates = (exact ? [body.data.place_results] : (body.data.local_results ?? []).slice(0, 5)).flatMap((raw) => {
      const parsed = MapsPlaceSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    });
    const best = candidates
      .map((place) => ({ place, score: nameScore(name, place.title) }))
      .filter(({ place, score }) => {
        const km = haversineKm(near, { lat: place.gps_coordinates.latitude, lng: place.gps_coordinates.longitude });
        if (exact) return km <= SAME_SPOT_KM || (km <= MAX_MATCH_KM && score > 0);
        return km <= MAX_MATCH_KM && score >= 0.5;
      })
      .sort((a, b) => b.score - a.score)[0]?.place;
    if (!best) return { found: false };

    const status = [best.open_state, typeof best.hours === 'string' ? best.hours : ''].join(' ');
    return {
      found: true,
      name: best.title,
      location: { lat: best.gps_coordinates.latitude, lng: best.gps_coordinates.longitude },
      hours: weeklyHours(best),
      closed: /permanently closed/i.test(status) ? 'permanently' : /temporarily closed/i.test(status) ? 'temporarily' : null,
      website: best.website ?? null,
    };
  };
}

function weeklyHours(place: z.infer<typeof MapsPlaceSchema>): Partial<Record<Weekday, string>> | null {
  const entries = Array.isArray(place.hours) ? place.hours.flatMap((day) => Object.entries(day)) : Object.entries(place.operating_hours ?? {});
  const week: Partial<Record<Weekday, string>> = {};
  for (const [day, text] of entries) {
    const weekday = WEEKDAYS.find((name) => name === day.trim().toLowerCase());
    if (weekday) week[weekday] = text;
  }
  return Object.keys(week).length > 0 ? week : null;
}

const NAME_STOP_WORDS = new Set(['the', 'le', 'la', 'les', 'de', 'du', 'des', 'd', 'l', 'of', 'and', 'et']);

/** Words in brackets count too: "Sé de Lisboa (Lisbon Cathedral)" carries its English name. */
function nameTokens(name: string): Set<string> {
  const plain = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return new Set(plain.split(/[^a-z0-9]+/).filter((token) => token && !NAME_STOP_WORDS.has(token)));
}

/** Share of the shorter name's words found in the other: "Breizh Café" vs "Breizh Café Le Marais" → 1. */
function nameScore(a: string, b: string): number {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Cheapest return first; at the same price one that leaves between 10:00 and 22:00, then the shortest trip. */
function pickReturn(options: { leg: FlightLeg; price: number }[], maxStops: number | null) {
  const allowed = maxStops === null ? options : options.filter(({ leg }) => leg.stops.length <= maxStops);
  const pool = allowed.length > 0 ? allowed : options;
  const awkward = (leg: FlightLeg) => {
    const leaves = minutesOf(leg.departure);
    return leaves < 10 * 60 || leaves >= 22 * 60 ? 1 : 0;
  };
  return [...pool].sort(
    (a, b) =>
      a.price - b.price ||
      awkward(a.leg) - awkward(b.leg) ||
      (a.leg.durationMinutes ?? Number.MAX_SAFE_INTEGER) - (b.leg.durationMinutes ?? Number.MAX_SAFE_INTEGER),
  )[0];
}

function mapLeg(option: z.infer<typeof FlightOptionSchema>): FlightLeg {
  const first = option.flights[0]!;
  const last = option.flights.at(-1)!;
  const flightNumbers = option.flights.flatMap((segment) => (segment.flight_number ? [segment.flight_number] : []));
  return {
    from: { code: first.departure_airport.id, name: first.departure_airport.name },
    to: { code: last.arrival_airport.id, name: last.arrival_airport.name },
    departure: toIso(first.departure_airport.time),
    arrival: toIso(last.arrival_airport.time),
    durationMinutes: option.total_duration ? Math.round(option.total_duration) : null,
    terminal: null,
    stops: (option.layovers ?? []).map((layover) => ({
      airport: { code: layover.id ?? airportFor(layover.name).code, name: layover.name },
      layoverMinutes: Math.round(layover.duration),
    })),
    flightNumbers: flightNumbers.length === option.flights.length ? flightNumbers : null,
  };
}

function mapFlight(option: z.infer<typeof FlightOptionSchema>, bookingUrl: string | undefined) {
  return {
    airline: option.flights[0]!.airline ?? 'Unknown airline',
    price: option.price,
    outbound: mapLeg(option),
    return: null,
    bookingUrl: bookingUrl ?? null,
    source: 'serpapi' as const,
  };
}

function mapHotel(property: z.infer<typeof PropertySchema>) {
  const nearby = property.nearby_places ?? [];
  const minutesBy = (place: z.infer<typeof NearbySchema>, type: string) =>
    durationMinutes(place.transportations?.find((transport) => transport.type === type)?.duration);
  const station = nearby
    .filter((place) => STATION.test(place.name))
    .map((place) => ({ name: place.name, walk: minutesBy(place, 'Walking') }))
    .find(({ walk }) => walk !== null && walk <= MAX_STATION_WALK_MINUTES);
  const airport = nearby.find((place) => AIRPORT_WORD.test(place.name));
  return {
    name: property.name,
    area: property.neighborhood ?? null,
    pricePerNight: property.rate_per_night?.extracted_lowest ?? Number.NaN,
    rating: Math.round(Math.min(5, property.overall_rating ?? 0) * 2 * 10) / 10,
    photoUrl: property.images?.[0]?.thumbnail ?? null,
    checkInTime: to24h(property.check_in_time),
    checkOutTime: to24h(property.check_out_time),
    transit: station ? `${station.name} · ${station.walk} min walk` : null,
    location: property.gps_coordinates
      ? { lat: property.gps_coordinates.latitude, lng: property.gps_coordinates.longitude }
      : null,
    airport: airport
      ? { name: airport.name, taxiMinutes: minutesBy(airport, 'Taxi'), transitMinutes: minutesBy(airport, 'Public transport') }
      : null,
    bookingUrl: property.link ?? null,
    source: 'serpapi' as const,
  };
}
