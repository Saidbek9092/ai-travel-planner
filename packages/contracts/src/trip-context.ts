import { z } from 'zod';
import { WeatherIconSchema } from './trip.js';

/** Query string of GET /api/trip-context. */
export const TripContextQuerySchema = z.object({
  /** City or place name; the agent geocodes it. */
  destination: z.string().trim().min(2).max(100),
  /** Departure city; only used to work out the time difference. */
  origin: z.string().trim().min(2).max(100).optional(),
});

export const WeatherSchema = z.object({
  temperatureC: z.number(),
  /** Short label for display, e.g. "Partly cloudy". */
  condition: z.string().min(1),
  /** Coarse bucket the UI maps to an icon. */
  icon: WeatherIconSchema,
  todayLowC: z.number(),
  todayHighC: z.number(),
  /** One-line outlook for the next days, e.g. "rain Saturday"; `null` when nothing notable. */
  outlook: z.string().min(1).nullable(),
});

export const CurrencySchema = z.object({
  /** ISO 4217 code of the destination's currency. */
  code: z.string().length(3),
  /** e.g. "€"; `null` when unknown. */
  symbol: z.string().min(1).nullable(),
});

export const ExchangeRateSchema = z.object({
  base: z.literal('USD'),
  /** ISO 4217 code of the destination's currency. */
  quote: z.string().length(3),
  /** 1 USD = `rate` × `quote`. */
  rate: z.number().positive(),
  /** When the provider last updated the rate. */
  asOf: z.iso.datetime(),
});

export const TripContextSchema = z.object({
  /** Resolved place, e.g. "Paris, France". */
  location: z.string().min(1),
  /** `null` when the weather lookup failed. */
  weather: WeatherSchema.nullable(),
  /** `null` when the destination's currency is unknown or already USD. */
  currency: CurrencySchema.nullable(),
  /** `null` when the lookup failed, the currency is unknown, or the destination already uses USD. */
  exchangeRate: ExchangeRateSchema.nullable(),
  /** IANA zone of the destination, e.g. "Europe/Paris"; the browser formats the local time. */
  timeZone: z.string().min(1).nullable(),
  /** IANA zone of `origin`, when it was given and found. */
  originTimeZone: z.string().min(1).nullable(),
  /** `mock` only when the agent runs with `TOOLS_MODE=mock` (tests, e2e). */
  source: z.enum(['live', 'mock']),
  /** When the agent looked this up. */
  fetchedAt: z.iso.datetime({ offset: true }).nullish(),
});

/** Query string of GET /api/places. */
export const PlacesQuerySchema = z.object({
  /** What the user has typed so far in a city / country field. */
  q: z.string().trim().min(2).max(100),
});

export const PlaceSuggestionSchema = z.object({
  /** Text to put in the field, e.g. "Paris, France" or "France". The agent geocodes it back to the same place. */
  label: z.string().min(1),
  /** Short name, e.g. "Paris". */
  name: z.string().min(1),
  /** Second line of the dropdown row, e.g. "Île-de-France, France"; `null` for countries. */
  detail: z.string().min(1).nullable(),
  kind: z.enum(['country', 'region', 'city']),
});

/** Response of GET /api/places. */
export const PlacesResponseSchema = z.object({
  places: z.array(PlaceSuggestionSchema),
});

export type PlacesQuery = z.infer<typeof PlacesQuerySchema>;
export type PlaceSuggestion = z.infer<typeof PlaceSuggestionSchema>;
export type PlacesResponse = z.infer<typeof PlacesResponseSchema>;
export type TripContextQuery = z.infer<typeof TripContextQuerySchema>;
export type Weather = z.infer<typeof WeatherSchema>;
export type Currency = z.infer<typeof CurrencySchema>;
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;
export type TripContext = z.infer<typeof TripContextSchema>;
