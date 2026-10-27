import type { Hotel, ItineraryDay } from '@ai-travel/contracts';

export type LngLat = [number, number];

/** [west, south, east, north] around the points, or `null` when there are none. */
export function boundsOf(points: LngLat[]): [LngLat, LngLat] | null {
  if (points.length === 0) return null;
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export function dayPoints(day: ItineraryDay): LngLat[] {
  return day.places.map((p) => [p.lng, p.lat]);
}

/** Points to frame: the active day (plus hotel) when one is selected, otherwise every stop. */
export function framePoints(itinerary: ItineraryDay[], hotel: Hotel | null, activeDay: number | null): LngLat[] {
  const days = activeDay === null ? itinerary : itinerary.filter((d) => d.day === activeDay);
  const points = days.flatMap(dayPoints);
  if (hotel?.location) points.push([hotel.location.lng, hotel.location.lat]);
  return points;
}

/** Straight route: hotel → stops of the day in order → hotel. Empty when the day has no stops. */
export function routeLine(day: ItineraryDay | undefined, hotel: Hotel | null) {
  const stops = day ? dayPoints(day) : [];
  if (stops.length === 0) return null;
  const home: LngLat[] = hotel?.location ? [[hotel.location.lng, hotel.location.lat]] : [];
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: [...home, ...stops, ...home] },
  };
}
