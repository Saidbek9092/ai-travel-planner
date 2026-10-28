import type { Airport } from '@ai-travel/contracts';

const KNOWN: Record<string, Airport> = {
  tashkent: { code: 'TAS', name: 'Tashkent International' },
  samarkand: { code: 'SKD', name: 'Samarkand International' },
  paris: { code: 'CDG', name: 'Paris Charles de Gaulle' },
  london: { code: 'LHR', name: 'London Heathrow' },
  istanbul: { code: 'IST', name: 'Istanbul Airport' },
  tokyo: { code: 'HND', name: 'Tokyo Haneda' },
  dubai: { code: 'DXB', name: 'Dubai International' },
  'new york': { code: 'JFK', name: 'New York John F. Kennedy' },
  rome: { code: 'FCO', name: 'Rome Fiumicino' },
  berlin: { code: 'BER', name: 'Berlin Brandenburg' },
  madrid: { code: 'MAD', name: 'Madrid Barajas' },
  barcelona: { code: 'BCN', name: 'Barcelona El Prat' },
  moscow: { code: 'SVO', name: 'Moscow Sheremetyevo' },
  almaty: { code: 'ALA', name: 'Almaty International' },
  seoul: { code: 'ICN', name: 'Seoul Incheon' },
  bangkok: { code: 'BKK', name: 'Bangkok Suvarnabhumi' },
};

/** "Paris, France" (a dropdown label) and "Paris" are the same city. */
const normalise = (city: string) => (city.split(',')[0] ?? city).trim().toLowerCase().replace(/\s+/g, ' ');

/** Airport for a city name or IATA code. Unknown cities get a made-up code from their first letters (mock data only). */
export function airportFor(city: string): Airport {
  const known = KNOWN[normalise(city)];
  if (known) return known;
  const letters = city.replace(/[^a-z]/gi, '').toUpperCase();
  return { code: letters.slice(0, 3).padEnd(3, 'X'), name: `${city.trim()} International` };
}

/** The code to send to a provider: an explicit IATA code, a known city, or `undefined` when we cannot tell. */
export function iataFor(city: string): string | undefined {
  if (/^[A-Za-z]{3}$/.test(city.trim())) return city.trim().toUpperCase();
  return KNOWN[normalise(city)]?.code;
}
