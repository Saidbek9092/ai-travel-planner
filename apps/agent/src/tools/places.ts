import type { PlaceSuggestion } from '@ai-travel/contracts';
import { aliasFor } from './placeAliases.js';
import { normalizeKey, TtlCache } from '../utils/ttlCache.js';
import { searchGeocode, type GeocodeHit, type WeatherDeps } from './weather.js';

const SUGGESTION_TTL_MS = 60 * 60 * 1000;
const MAX_SUGGESTIONS = 8;
/** Ask for more than we show: duplicates and non-settlements are dropped afterwards. */
const FETCH_COUNT = 20;
/** GeoNames feature codes: independent country, first-level region (England, Bavaria) and populated places. */
const COUNTRY = 'PCLI';
const REGION = 'ADM1';
const SETTLEMENT = /^PPL/;

const suggestionCache = new TtlCache<PlaceSuggestion[]>(SUGGESTION_TTL_MS);

function toSuggestion(hit: GeocodeHit): PlaceSuggestion | null {
  if (hit.feature_code === COUNTRY) {
    return { label: hit.country ?? hit.name, name: hit.country ?? hit.name, detail: null, kind: 'country' };
  }
  if (hit.feature_code === REGION) {
    return { label: hit.country ? `${hit.name}, ${hit.country}` : hit.name, name: hit.name, detail: hit.country ?? null, kind: 'region' };
  }
  if (hit.feature_code !== undefined && !SETTLEMENT.test(hit.feature_code)) return null;
  const region = hit.admin1 && hit.admin1 !== hit.name ? hit.admin1 : null;
  return {
    label: hit.country ? `${hit.name}, ${hit.country}` : hit.name,
    name: hit.name,
    detail: [region, hit.country].filter(Boolean).join(', ') || null,
    kind: 'city',
  };
}

/** Cities and countries matching what the user typed, for the search dropdown. Rejects when the provider fails. */
export async function searchPlaces(query: string, deps: Pick<WeatherDeps, 'fetch'>, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  return suggestionCache.remember(normalizeKey(query), async () => {
    const seen = new Set<string>();
    const places: PlaceSuggestion[] = [];
    const alias = aliasFor(query);
    // "England" has no place of its own, so the country it belongs to leads the list.
    const hits = [...(alias ? await searchGeocode(alias, 3, deps, signal) : []), ...(await searchGeocode(query, FETCH_COUNT, deps, signal))];
    for (const hit of hits) {
      const place = toSuggestion(hit);
      if (!place || seen.has(place.label)) continue;
      seen.add(place.label);
      places.push(place);
      if (places.length === MAX_SUGGESTIONS) break;
    }
    return places;
  });
}

/** Fixed answer for `TOOLS_MODE=mock`. */
export function mockPlaces(query: string): PlaceSuggestion[] {
  const all: PlaceSuggestion[] = [
    { label: 'Paris, France', name: 'Paris', detail: 'Île-de-France, France', kind: 'city' },
    { label: 'France', name: 'France', detail: null, kind: 'country' },
    { label: 'London, United Kingdom', name: 'London', detail: 'England, United Kingdom', kind: 'city' },
    { label: 'United Kingdom', name: 'United Kingdom', detail: null, kind: 'country' },
    { label: 'Istanbul, Türkiye', name: 'Istanbul', detail: 'Istanbul, Türkiye', kind: 'city' },
    { label: 'Tokyo, Japan', name: 'Tokyo', detail: 'Tokyo, Japan', kind: 'city' },
    { label: 'Tashkent, Uzbekistan', name: 'Tashkent', detail: 'Tashkent, Uzbekistan', kind: 'city' },
  ];
  const q = query.trim().toLowerCase();
  return all.filter((place) => place.label.toLowerCase().includes(q));
}
