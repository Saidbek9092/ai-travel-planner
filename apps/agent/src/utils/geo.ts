const EARTH_RADIUS_KM = 6371;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const median = (values: number[]) => {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

/** Keeps places within `maxKm` of the day's median point; drops model-invented outliers. */
export function dropOutliers<T extends LatLng>(places: T[], maxKm = 100): T[] {
  if (places.length < 2) return places;
  const center = { lat: median(places.map((p) => p.lat)), lng: median(places.map((p) => p.lng)) };
  return places.filter((place) => haversineKm(center, place) <= maxKm);
}
