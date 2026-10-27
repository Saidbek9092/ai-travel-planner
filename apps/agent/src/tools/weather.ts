import type { DayWeather, Weather, WeatherIcon } from '@ai-travel/contracts';
import { z } from 'zod';
import { addDays } from '../utils/dates.js';
import { notFound } from '../utils/errors.js';
import { fetchJson } from '../utils/fetchJson.js';
import { normalizeKey, TtlCache } from '../utils/ttlCache.js';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;
const WEATHER_TTL_MS = 30 * 60 * 1000;
/** Open-Meteo answers about 16 days ahead. */
const FORECAST_DAYS = 16;
const OUTLOOK_DAYS = 7;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface WeatherDeps {
  fetch: typeof fetch;
  now: () => Date;
}

export interface GeoPlace {
  name: string;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  timezone: string | null;
}

/** WMO weather code → label and icon bucket. */
export function describeCode(code: number): { condition: string; icon: WeatherIcon } {
  if (code === 0) return { condition: 'Clear', icon: 'clear' };
  if (code <= 2) return { condition: 'Partly cloudy', icon: 'partly-cloudy' };
  if (code === 3) return { condition: 'Cloudy', icon: 'cloudy' };
  if (code === 45 || code === 48) return { condition: 'Fog', icon: 'fog' };
  if (code >= 51 && code <= 57) return { condition: 'Drizzle', icon: 'rain' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { condition: 'Rain', icon: 'rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { condition: 'Snow', icon: 'snow' };
  if (code >= 95) return { condition: 'Thunderstorm', icon: 'storm' };
  return { condition: 'Cloudy', icon: 'cloudy' };
}

const GeocodeSchema = z.looseObject({
  results: z
    .array(
      z.looseObject({
        name: z.string(),
        country: z.string().optional(),
        country_code: z.string().optional(),
        latitude: z.number(),
        longitude: z.number(),
        timezone: z.string().optional(),
      }),
    )
    .optional(),
});

const geocodeCache = new TtlCache<GeoPlace | null>(GEOCODE_TTL_MS);

/** Open-Meteo geocoding. `null` when nothing matches; rejects when the provider fails. */
export async function geocode(name: string, deps: Pick<WeatherDeps, 'fetch'>, signal?: AbortSignal): Promise<GeoPlace | null> {
  return geocodeCache.remember(normalizeKey(name), async () => {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
    const first = GeocodeSchema.parse(await fetchJson(deps.fetch, url, signal)).results?.[0];
    return first
      ? {
          name: first.name,
          country: first.country ?? null,
          countryCode: first.country_code ?? null,
          lat: first.latitude,
          lng: first.longitude,
          timezone: first.timezone ?? null,
        }
      : null;
  });
}

/** Like `geocode`, but a miss is a `404`. */
export async function requirePlace(name: string, deps: Pick<WeatherDeps, 'fetch'>, signal?: AbortSignal): Promise<GeoPlace> {
  const place = await geocode(name, deps, signal);
  if (!place) throw notFound(`Could not find "${name}"`);
  return place;
}

const CurrentSchema = z.looseObject({
  current: z.looseObject({ temperature_2m: z.number(), weather_code: z.number() }),
  daily: z.looseObject({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
  }),
});

const weatherCache = new TtlCache<Weather>(WEATHER_TTL_MS);

/** "rain Saturday" for the first rainy / snowy / stormy day in the next week; `null` when nothing notable. */
function outlookFor(dates: string[], codes: number[]): string | null {
  for (let i = 1; i < Math.min(dates.length, OUTLOOK_DAYS, codes.length); i++) {
    const { condition, icon } = describeCode(codes[i] ?? 0);
    if (icon === 'rain' || icon === 'snow' || icon === 'storm') {
      const weekday = WEEKDAYS[new Date(`${dates[i]}T00:00:00Z`).getUTCDay()];
      return `${condition === 'Thunderstorm' ? 'storms' : condition.toLowerCase()} ${weekday}`;
    }
  }
  return null;
}

/** Current temperature, today's range and a short outlook. Rejects on provider failure (the caller maps it to `null`). */
export async function getCurrentWeather(place: GeoPlace, deps: Pick<WeatherDeps, 'fetch'>, signal?: AbortSignal): Promise<Weather> {
  return weatherCache.remember(`now:${place.lat},${place.lng}`, async () => {
    const url =
      `${FORECAST_URL}?latitude=${place.lat}&longitude=${place.lng}&current=temperature_2m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=${OUTLOOK_DAYS}&timezone=auto`;
    const data = CurrentSchema.parse(await fetchJson(deps.fetch, url, signal));
    const { condition, icon } = describeCode(data.current.weather_code);
    return {
      temperatureC: Math.round(data.current.temperature_2m),
      condition,
      icon,
      todayLowC: Math.round(data.daily.temperature_2m_min[0] ?? data.current.temperature_2m),
      todayHighC: Math.round(data.daily.temperature_2m_max[0] ?? data.current.temperature_2m),
      outlook: outlookFor(data.daily.time, data.daily.weather_code),
    };
  });
}

const forecastCache = new TtlCache<(DayWeather | null)[]>(WEATHER_TTL_MS);

/** Fixed forecast for `TOOLS_MODE=mock`: a rainy day 3. */
export function mockForecast(days: number): (DayWeather | null)[] {
  return Array.from({ length: days }, (_, index) =>
    index === 2
      ? { highC: 10, lowC: 7, condition: 'Rain', icon: 'rain' as const }
      : { highC: 14, lowC: 9, condition: 'Partly cloudy', icon: 'partly-cloudy' as const },
  );
}

/**
 * One `DayWeather | null` per trip day. Dates beyond Open-Meteo's range, a missing `startDate`, an unknown
 * destination or any provider failure give `null` for every day: the Planner just carries on without weather.
 */
export async function getForecast(
  destination: string,
  startDate: string | null,
  days: number,
  deps: WeatherDeps,
  signal?: AbortSignal,
): Promise<(DayWeather | null)[]> {
  const none = Array.from<DayWeather | null>({ length: days }).fill(null);
  if (!startDate || days < 1) return none;

  const lastDate = addDays(startDate, days - 1);
  const horizon = addDays(deps.now().toISOString().slice(0, 10), FORECAST_DAYS - 1);
  if (lastDate > horizon) return none;

  try {
    const place = await geocode(destination, deps, signal);
    if (!place) return none;
    return await forecastCache.remember(`${place.lat},${place.lng}:${startDate}:${days}`, async () => {
      const url =
        `${FORECAST_URL}?latitude=${place.lat}&longitude=${place.lng}` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min&start_date=${startDate}&end_date=${lastDate}&timezone=auto`;
      const { daily } = CurrentSchema.pick({ daily: true }).parse(await fetchJson(deps.fetch, url, signal));
      return Array.from({ length: days }, (_, index) => {
        const code = daily.weather_code[index];
        const high = daily.temperature_2m_max[index];
        const low = daily.temperature_2m_min[index];
        if (code === undefined || high === undefined || low === undefined) return null;
        return { highC: Math.round(high), lowC: Math.round(low), ...describeCode(code) };
      });
    });
  } catch {
    return none;
  }
}
