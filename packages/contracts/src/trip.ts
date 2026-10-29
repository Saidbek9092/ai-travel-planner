import { z } from 'zod';

/** Where an option came from. `mock` means live prices were unavailable. */
export const DataSourceSchema = z.enum(['serpapi', 'mock']);

/** Weather bucket the UI maps to an icon. Shared by the top bar and the per-day forecast. */
export const WeatherIconSchema = z.enum(['clear', 'partly-cloudy', 'cloudy', 'fog', 'rain', 'snow', 'storm']);

/** Why the picker chose an option. Tags only, so the model cannot state wrong facts; the UI words them. */
export const PickReasonSchema = z.enum([
  'direct',
  'short_layover',
  'daytime',
  'cheaper',
  'central',
  'high_rating',
  'quiet_area',
  'family_friendly',
]);

export const AirportSchema = z.object({
  /** IATA code, e.g. "TAS". */
  code: z.string().min(3).max(4),
  /** e.g. "Tashkent International". */
  name: z.string().min(1),
});

/** An intermediate stop of a flight leg. */
export const FlightStopSchema = z.object({
  airport: AirportSchema,
  layoverMinutes: z.number().int().nonnegative(),
});

/** One direction of a round trip. */
export const FlightLegSchema = z.object({
  from: AirportSchema,
  to: AirportSchema,
  /** ISO 8601 date-time; airline-local offsets are allowed. */
  departure: z.iso.datetime({ offset: true }),
  arrival: z.iso.datetime({ offset: true }),
  /** Arrival terminal, when the provider reports it. */
  terminal: z.string().min(1).nullable(),
  /** Empty array = direct. */
  stops: z.array(FlightStopSchema),
});

export const FlightSchema = z.object({
  airline: z.string().min(1),
  /** USD, round trip, one traveller. */
  price: z.number().nonnegative(),
  outbound: FlightLegSchema,
  /** `null` when the provider returned the outbound leg only. */
  return: FlightLegSchema.nullable(),
  /** "View fare" link, when the provider gives one. */
  bookingUrl: z.url().nullable(),
  source: DataSourceSchema,
  /** When the tool fetched this option. */
  fetchedAt: z.iso.datetime({ offset: true }).nullish(),
  /** Set only when the traveller's preferences decided the pick ("Picked for you"). */
  picked: z.array(PickReasonSchema).nullish(),
});

export const PlaceSchema = z.object({
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Short hint shown next to the stop, e.g. "Morning". */
  note: z.string().min(1).nullable(),
  /** Official website, passed through from tool data. */
  url: z.url().nullish(),
  fetchedAt: z.iso.datetime({ offset: true }).nullish(),
  /** Small thumbnail; `null`/absent = none found, the UI shows a placeholder. */
  photoUrl: z.url().nullish(),
  /** Who to credit for the photo, as the source's licence requires. */
  photoCredit: z.object({ name: z.string().min(1), url: z.url() }).nullish(),
});

export const HotelSchema = z.object({
  name: z.string().min(1),
  /** Neighbourhood, e.g. "11th arrondissement". */
  area: z.string().min(1).nullable(),
  /** USD. */
  pricePerNight: z.number().nonnegative(),
  /** 0–10 (Google Hotels' 0–5 is doubled by the tool). */
  rating: z.number().min(0).max(10),
  photoUrl: z.url().nullable(),
  /** HH:mm, 24 h. */
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  /** Nearest public transport, e.g. "République · lines 3, 5, 8, 9, 11". */
  transit: z.string().min(1).nullable(),
  /** For the hotel marker on the map. */
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable(),
  bookingUrl: z.url().nullable(),
  source: DataSourceSchema,
  /** When the tool fetched this option. */
  fetchedAt: z.iso.datetime({ offset: true }).nullish(),
  /** Set only when the traveller's preferences decided the pick ("Picked for you"). */
  picked: z.array(PickReasonSchema).nullish(),
});

export const TransferModeSchema = z.enum(['taxi', 'train', 'metro', 'bus', 'shuttle', 'walk']);

/** Airport ↔ hotel leg chosen by the Planner. */
export const TransferSchema = z.object({
  /** Itinerary day the transfer happens on (arrival day, departure day). */
  day: z.number().int().min(1),
  mode: TransferModeSchema,
  /** e.g. "CDG Terminal 1 → hotel". */
  description: z.string().min(1),
  /** USD, whole leg. */
  priceUsd: z.number().nonnegative(),
  durationMinutes: z.number().int().positive().nullable(),
  /** e.g. "Fixed fare €56" or "Leave the hotel by 16:00". */
  note: z.string().min(1).nullable(),
  /** Official taxi or train information, passed through from tool data. */
  url: z.url().nullish(),
  /** `estimate` = the planner's own figure, not a published fare. Shown as "Estimated". */
  source: z.literal('estimate').nullish(),
  /** When the figure was produced. */
  fetchedAt: z.iso.datetime({ offset: true }).nullish(),
});

/** Forecast for one itinerary day. */
export const DayWeatherSchema = z.object({
  highC: z.number(),
  lowC: z.number(),
  /** Short label for display, e.g. "Partly cloudy". */
  condition: z.string().min(1),
  icon: WeatherIconSchema,
});

export const ItineraryDaySchema = z.object({
  day: z.number().int().min(1),
  /** YYYY-MM-DD; `null` when the trip has no start date. */
  date: z.iso.date().nullable(),
  title: z.string().min(1),
  /** `null` when the date is beyond the forecast range or the lookup failed. */
  weather: DayWeatherSchema.nullable(),
  places: z.array(PlaceSchema),
});

export const TripStatusSchema = z.enum([
  'parsing',
  'searching',
  'planning',
  'auditing',
  'completed',
  'failed',
]);

export const AgentNameSchema = z.enum([
  'System',
  'Supervisor',
  'FlightAgent',
  'HotelAgent',
  'Planner',
  'BudgetAuditor',
]);

/** What a confirmed decision is about. */
export const DecisionTopicSchema = z.enum(['trip', 'flight', 'hotel', 'transfers', 'itinerary', 'budget']);

/** Optional interests the traveller ticks on the start page. */
export const InterestSchema = z.enum(['museums', 'food', 'walking', 'nightlife', 'shopping', 'nature']);

/** POST /api/trips body. Explicit fields override what the Supervisor parses from `prompt`. */
export const TripRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(1000),
  origin: z.string().trim().min(2).max(100).optional(),
  budget: z.number().positive().max(1_000_000).optional(),
  durationDays: z.number().int().min(1).max(30).optional(),
  /** YYYY-MM-DD */
  startDate: z.iso.date().optional(),
  /** How the traveller described the timing, e.g. "March" or "Flexible". Display only; `startDate` drives the plan. */
  when: z.string().trim().min(1).max(40).optional(),
  interests: z.array(InterestSchema).max(6).optional(),
});

export type PickReason = z.infer<typeof PickReasonSchema>;
export type Interest = z.infer<typeof InterestSchema>;
export type DecisionTopic = z.infer<typeof DecisionTopicSchema>;
export type DataSource = z.infer<typeof DataSourceSchema>;
export type WeatherIcon = z.infer<typeof WeatherIconSchema>;
export type Airport = z.infer<typeof AirportSchema>;
export type FlightStop = z.infer<typeof FlightStopSchema>;
export type FlightLeg = z.infer<typeof FlightLegSchema>;
export type Flight = z.infer<typeof FlightSchema>;
export type Hotel = z.infer<typeof HotelSchema>;
export type TransferMode = z.infer<typeof TransferModeSchema>;
export type Transfer = z.infer<typeof TransferSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type DayWeather = z.infer<typeof DayWeatherSchema>;
export type ItineraryDay = z.infer<typeof ItineraryDaySchema>;
export type TripStatus = z.infer<typeof TripStatusSchema>;
export type AgentName = z.infer<typeof AgentNameSchema>;
export type TripRequest = z.infer<typeof TripRequestSchema>;
