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
  /**
   * ISO 8601 date-time as the airport shows it. An offset is optional: SerpAPI reports airport-local times
   * without one, and they are kept that way rather than mislabelled as UTC. Never subtract two of them to
   * get a duration across time zones; use `durationMinutes`.
   */
  departure: z.iso.datetime({ offset: true, local: true }),
  arrival: z.iso.datetime({ offset: true, local: true }),
  /** Gate-to-gate travel time including layovers, when the provider reports it. */
  durationMinutes: z.number().int().positive().nullish(),
  /** Arrival terminal, when the provider reports it. */
  terminal: z.string().min(1).nullable(),
  /** Empty array = direct. */
  stops: z.array(FlightStopSchema),
  /** Marketing flight number of each segment in order, e.g. ["TK 369", "TK 1833"], when the provider reports them. */
  flightNumbers: z.array(z.string().min(1)).nullish(),
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
  /** Opening hours on this day as Google Maps lists them, e.g. "9 AM–6 PM"; absent when unknown or not checked. */
  hours: z.string().min(1).nullish(),
  /** `serpapi` = name, position and opening day confirmed on Google Maps; absent = the planner's suggestion, not checked. */
  source: DataSourceSchema.nullish(),
});

export const HotelSchema = z.object({
  name: z.string().min(1),
  /** Neighbourhood, e.g. "11th arrondissement". */
  area: z.string().min(1).nullable(),
  /** USD. V1 is USD-only on purpose: providers are asked for USD and the web app shows the destination rate beside it. */
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
  /** The airport the provider lists near the hotel, with its travel times from the hotel in minutes. */
  airport: z
    .object({
      name: z.string().min(1),
      taxiMinutes: z.number().int().positive().nullable(),
      transitMinutes: z.number().int().positive().nullable(),
    })
    .nullish(),
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
  /** Why a day has no stops (a travel day, landing too late, leaving too early); `null` when it has stops. */
  note: z.string().min(1).nullish(),
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

/** The itinerary day the traveller lands on: the earliest transfer's day (day 2 after an overnight flight), else 1. */
export function arrivalDay(transfers: Pick<Transfer, 'day'>[]): number {
  return transfers.length > 0 ? Math.min(...transfers.map((transfer) => transfer.day)) : 1;
}

/** Days with daily spend: from the landing day to the last day. Days spent on the plane cost nothing on the ground. */
export function spendDays(durationDays: number, transfers: Pick<Transfer, 'day'>[]): number {
  return Math.max(0, durationDays - (arrivalDay(transfers) - 1));
}
