import type { Flight, FlightLeg, Hotel } from '@ai-travel/contracts';
import { airportFor } from './airports.js';
import type { FlightQuery, HotelQuery, TravelSearchTool } from './types.js';

const DELAY_MS = 300;
const CHEAPER_FACTOR = 0.85;
const MIN_FLIGHT_PRICE = 60;
const MIN_HOTEL_PRICE = 25;

const AIRLINES = ['Uzbekistan Airways', 'Turkish Airlines', 'Lufthansa', 'Qatar Airways', 'Air France'];
const HUBS = [
  { code: 'IST', name: 'Istanbul Airport' },
  { code: 'DOH', name: 'Doha Hamad International' },
  { code: 'FRA', name: 'Frankfurt Airport' },
];
const HOTEL_NAMES = ['Grand Central', 'Maison Lumière', 'City Garden Inn', 'Riverside Suites', 'Old Town Lodge'];
const AREAS = ['City Centre', 'Old Town', 'Riverside', 'Station District', 'Museum Quarter'];

/** FNV-1a: small, stable across runs and platforms. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (const char of text) {
    value ^= char.codePointAt(0)!;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** Deterministic pseudo-random sequence for one query. */
function sequence(seed: string): () => number {
  let state = hash(seed) || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function leg(from: ReturnType<typeof airportFor>, to: ReturnType<typeof airportFor>, date: string, rand: () => number, direct: boolean): FlightLeg {
  const departHour = 5 + Math.floor(rand() * 14);
  const durationHours = direct ? 3 + Math.floor(rand() * 5) : 6 + Math.floor(rand() * 6);
  const arriveHour = departHour + durationHours;
  const pad = (n: number) => String(n).padStart(2, '0');
  const arrivalDate = arriveHour >= 24 ? new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : date;
  const hub = HUBS[Math.floor(rand() * HUBS.length)]!;
  return {
    from,
    to,
    departure: `${date}T${pad(departHour)}:${pad(Math.floor(rand() * 4) * 15)}:00Z`,
    arrival: `${arrivalDate}T${pad(arriveHour % 24)}:${pad(Math.floor(rand() * 4) * 15)}:00Z`,
    terminal: rand() > 0.4 ? String(1 + Math.floor(rand() * 3)) : null,
    stops: direct ? [] : [{ airport: hub, layoverMinutes: 60 + Math.floor(rand() * 4) * 30 }],
  };
}

/** Deterministic offline engine. Same query, same options; `cheaper` mode lands at least 15% under the cap. */
export function createMockTravelTool(options: { delayMs?: number } = {}): TravelSearchTool {
  const delayMs = options.delayMs ?? DELAY_MS;

  return {
    name: 'mock',

    async searchFlights(query: FlightQuery, signal?: AbortSignal): Promise<Flight[]> {
      await sleep(delayMs, signal);
      const rand = sequence(`flight|${query.origin}|${query.destination}|${query.departDate}`);
      const from = airportFor(query.origin);
      const to = airportFor(query.destination);
      const count = 3 + Math.floor(rand() * 3);
      const cap = query.mode === 'cheaper' && query.maxPrice !== undefined ? query.maxPrice * CHEAPER_FACTOR : undefined;

      return Array.from({ length: count }, (_, index) => {
        const direct = rand() > 0.5;
        const base = 280 + rand() * 520;
        const price = cap === undefined ? base : cap * (0.6 + rand() * 0.4);
        return {
          airline: AIRLINES[(hash(query.origin + query.destination) + index) % AIRLINES.length]!,
          price: round(Math.max(MIN_FLIGHT_PRICE, direct ? price * 1.1 : price)),
          outbound: leg(from, to, query.departDate, rand, direct),
          return: leg(to, from, query.returnDate, rand, direct),
          bookingUrl: null,
          source: 'mock' as const,
        };
      }).map((flight) =>
        cap !== undefined && flight.price > cap ? { ...flight, price: round(Math.max(MIN_FLIGHT_PRICE, cap)) } : flight,
      );
    },

    async searchHotels(query: HotelQuery, signal?: AbortSignal): Promise<Hotel[]> {
      await sleep(delayMs, signal);
      const rand = sequence(`hotel|${query.destination}|${query.checkIn}`);
      const count = 3 + Math.floor(rand() * 3);
      const cap =
        query.mode === 'cheaper' && query.maxPricePerNight !== undefined ? query.maxPricePerNight * CHEAPER_FACTOR : undefined;

      return Array.from({ length: count }, (_, index) => {
        const base = 45 + rand() * 135;
        const price = cap === undefined ? base : cap * (0.6 + rand() * 0.4);
        return {
          name: `${HOTEL_NAMES[index % HOTEL_NAMES.length]} ${query.destination}`,
          area: AREAS[(index + hash(query.destination)) % AREAS.length]!,
          pricePerNight: round(Math.max(MIN_HOTEL_PRICE, Math.min(price, cap ?? Infinity))),
          rating: Math.round((6 + rand() * 3.5) * 10) / 10,
          photoUrl: null,
          checkInTime: '15:00',
          checkOutTime: '11:00',
          transit: null,
          location: null,
          bookingUrl: null,
          source: 'mock' as const,
        };
      });
    },

    async getForecast(_destination, _startDate, days) {
      return Array.from({ length: days }, () => null);
    },
  };
}
