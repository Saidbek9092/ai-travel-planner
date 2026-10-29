import { z } from 'zod';
import { fetchJson } from '../utils/fetchJson.js';
import { normalizeKey, TtlCache } from '../utils/ttlCache.js';
import type { WeatherDeps } from './weather.js';

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const THUMBNAIL_PX = 240;
const PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PlacePhoto {
  url: string;
  credit: { name: string; url: string };
}

const SearchSchema = z.looseObject({
  query: z
    .looseObject({
      pages: z.array(z.looseObject({ title: z.string(), thumbnail: z.looseObject({ source: z.url() }).optional() })),
    })
    .optional(),
});

const words = (text: string) => normalizeKey(text).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4);

/** The article must share a real word with the place, otherwise a search for an obscure cafe returns a country flag. */
const sameSubject = (place: string, title: string) => {
  const titleWords = new Set(words(title));
  return words(place).some((word) => titleWords.has(word));
};

/** `null` is cached too: a place without a photo is not asked again. */
const photoCache = new TtlCache<PlacePhoto | null>(PHOTO_TTL_MS);

/**
 * One Wikipedia lead image for a place (images on Wikipedia are free to reuse with credit; the credit links to the
 * article, which lists each image's author and licence). Cached by place and destination. Rejects on provider failure.
 */
export function placePhoto(name: string, destination: string, deps: Pick<WeatherDeps, 'fetch'>, signal?: AbortSignal): Promise<PlacePhoto | null> {
  return photoCache.remember(normalizeKey(`${name}|${destination}`), async () => {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: `${name} ${destination}`,
      gsrlimit: '1',
      prop: 'pageimages',
      piprop: 'thumbnail',
      pithumbsize: String(THUMBNAIL_PX),
      format: 'json',
      formatversion: '2',
    });
    const page = SearchSchema.parse(await fetchJson(deps.fetch, `${WIKIPEDIA_API}?${params}`, signal)).query?.pages[0];
    if (!page?.thumbnail || !sameSubject(name, page.title)) return null;
    return {
      url: page.thumbnail.source,
      credit: { name: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` },
    };
  });
}
