import { normalizeKey } from '../utils/ttlCache.js';

/**
 * Names people type that the geocoder does not know as places (it has no "England", only villages called that),
 * mapped to the country it should resolve to.
 */
const ALIASES: Record<string, string> = {
  england: 'United Kingdom',
  scotland: 'United Kingdom',
  wales: 'United Kingdom',
  'northern ireland': 'United Kingdom',
  britain: 'United Kingdom',
  'great britain': 'United Kingdom',
  uk: 'United Kingdom',
  usa: 'United States',
  us: 'United States',
  america: 'United States',
  holland: 'Netherlands',
  uae: 'United Arab Emirates',
};

/** The country a typed name stands for, or `undefined` when it is not an alias. */
export const aliasFor = (name: string): string | undefined => ALIASES[normalizeKey(name)];
