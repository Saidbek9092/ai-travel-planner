// Canned, contract-valid trip data for the stub nodes (B6). Each real node (B11–B14) replaces one
// stub; this file goes away with the last of them (B15).
import type { Flight, FlightLeg, Hotel, ItineraryDay, Transfer } from '@ai-travel/contracts';

const TAS = { code: 'TAS', name: 'Tashkent International' };
const CDG = { code: 'CDG', name: 'Paris Charles de Gaulle' };

export const STUB_FLIGHT_PRICE = 300;
export const STUB_HOTEL_PRICE_PER_NIGHT = 80;
export const STUB_DAILY_EXPENSES = 20;

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const leg = (from: FlightLeg['from'], to: FlightLeg['to'], date: string, terminal: string | null): FlightLeg => ({
  from,
  to,
  departure: `${date}T06:30:00+05:00`,
  arrival: `${date}T10:40:00+01:00`,
  terminal,
  stops: [],
});

export function stubFlights(startDate: string, durationDays: number): Flight[] {
  return [
    {
      airline: 'Uzbekistan Airways',
      price: STUB_FLIGHT_PRICE,
      outbound: leg(TAS, CDG, startDate, '2E'),
      return: leg(CDG, TAS, addDays(startDate, durationDays), null),
      bookingUrl: null,
      source: 'mock',
    },
  ];
}

export function stubHotels(): Hotel[] {
  return [
    {
      name: 'Hôtel Lumière',
      area: 'Le Marais',
      pricePerNight: STUB_HOTEL_PRICE_PER_NIGHT,
      rating: 8.2,
      photoUrl: null,
      checkInTime: '15:00',
      checkOutTime: '11:00',
      transit: null,
      location: { lat: 48.8566, lng: 2.3522 },
      bookingUrl: null,
      source: 'mock',
    },
  ];
}

export function stubTransfers(durationDays: number): Transfer[] {
  return [
    { day: 1, mode: 'train', description: 'CDG Terminal 2E → hotel', priceUsd: 15, durationMinutes: 50, note: null },
    { day: durationDays, mode: 'train', description: 'Hotel → CDG Terminal 2E', priceUsd: 15, durationMinutes: 50, note: null },
  ];
}

const PARIS_STOPS = [
  { name: 'Louvre Museum', lat: 48.8606, lng: 2.3376 },
  { name: 'Eiffel Tower', lat: 48.8584, lng: 2.2945 },
  { name: 'Notre-Dame', lat: 48.853, lng: 2.3499 },
  { name: 'Montmartre', lat: 48.8867, lng: 2.3431 },
];

export function stubItinerary(startDate: string, durationDays: number): ItineraryDay[] {
  return Array.from({ length: durationDays }, (_, index) => {
    const first = PARIS_STOPS[index % PARIS_STOPS.length]!;
    const second = PARIS_STOPS[(index + 1) % PARIS_STOPS.length]!;
    return {
      day: index + 1,
      date: addDays(startDate, index),
      title: `Day ${index + 1} in Paris`,
      weather: null,
      places: [
        { ...first, note: 'Morning' },
        { ...second, note: 'Afternoon' },
      ],
    };
  });
}
