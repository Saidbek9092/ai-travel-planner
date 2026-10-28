import type { Place } from '@ai-travel/contracts';

/** Hosts a "View on …" link may point to (the host itself or any subdomain). */
const ALLOWED_HOSTS = [
  'google.com',
  'goo.gl',
  'booking.com',
  'expedia.com',
  'hotels.com',
  'kayak.com',
  'skyscanner.com',
  'tripadvisor.com',
  'trip.com',
  'agoda.com',
  'wikipedia.org',
  'openstreetmap.org',
];

/** The URL when it is https on an allowlisted host, else `null` so the link is not rendered. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Short source label for an option's provider, e.g. "via Google Hotels"; `null` for sample data. */
export function sourceLabel(source: 'serpapi' | 'mock', provider: 'Flights' | 'Hotels'): string | null {
  return source === 'serpapi' ? `via Google ${provider}` : null;
}

/** Map link from coordinates the tools returned. */
export function mapUrl(point: { lat: number; lng: number }, name?: string): string {
  const query = name ? `${name} ${point.lat},${point.lng}` : `${point.lat},${point.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function placeLinks(place: Place): { website: string | null; map: string } {
  return { website: safeUrl(place.url), map: mapUrl(place, place.name) };
}
