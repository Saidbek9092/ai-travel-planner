import { TripContextSchema, type TripContext } from '@ai-travel/contracts';
import { currencyFor } from './currencies.js';
import { getExchangeRate } from './exchangeRate.js';
import { geocode, getCurrentWeather, requirePlace, type WeatherDeps } from './weather.js';

export interface TripContextDeps extends WeatherDeps {
  mode: 'live' | 'mock';
}

/** Fixed answer for `TOOLS_MODE=mock` (tests, e2e). */
const MOCK_CONTEXT: TripContext = {
  location: 'Paris, France',
  weather: { temperatureC: 12, condition: 'Partly cloudy', icon: 'partly-cloudy', todayLowC: 9, todayHighC: 14, outlook: 'rain Saturday' },
  currency: { code: 'EUR', symbol: '€' },
  exchangeRate: { base: 'USD', quote: 'EUR', rate: 0.92, asOf: '2026-01-01T00:00:00.000Z' },
  timeZone: 'Europe/Paris',
  originTimeZone: null,
  source: 'mock',
};

/**
 * Destination bar data: geocode first, then weather ∥ exchange rate. A failing provider only nulls its
 * own field; an unknown destination is a `404`. No mock fallback in live mode — made-up numbers would look real.
 */
export async function lookupTripContext(
  query: { destination: string; origin?: string | undefined },
  deps: TripContextDeps,
  signal?: AbortSignal,
): Promise<TripContext> {
  if (deps.mode === 'mock') return TripContextSchema.parse(MOCK_CONTEXT);

  const place = await requirePlace(query.destination, deps, signal);
  const currency = place.countryCode ? currencyFor(place.countryCode) : null;
  const convertible = currency !== null && currency.code !== 'USD';

  const [weather, rate, origin] = await Promise.allSettled([
    getCurrentWeather(place, deps, signal),
    convertible ? getExchangeRate(currency.code, deps, signal) : Promise.resolve(null),
    query.origin ? geocode(query.origin, deps, signal) : Promise.resolve(null),
  ]);

  return TripContextSchema.parse({
    location: place.country && place.country !== place.name ? `${place.name}, ${place.country}` : place.name,
    weather: weather.status === 'fulfilled' ? weather.value : null,
    currency: convertible ? currency : null,
    exchangeRate: rate.status === 'fulfilled' ? rate.value : null,
    timeZone: place.timezone,
    originTimeZone: origin.status === 'fulfilled' ? (origin.value?.timezone ?? null) : null,
    source: 'live',
  });
}
