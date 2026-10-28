'use client';

import type { Hotel, ItineraryDay } from '@ai-travel/contracts';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { HotelPin, StopPin } from '@/components/MapPins';
import { dayColor } from '@/lib/labels';
import { boundsOf, dayPoints, framePoints, type LngLat } from '@/lib/map';

interface SchematicMapProps {
  itinerary: ItineraryDay[];
  hotel: Hotel | null;
  /** `null` = every day in its colour (live run). */
  activeDay: number | null;
  /** Show stop names next to the selected day's pins. */
  labels: boolean;
}

/**
 * Map without a Mapbox token: the stops plotted from their coordinates on a plain ground, framed like `fitBounds`.
 * Routes are straight legs hotel → stops → hotel, as on the real map.
 */
export function SchematicMap({ itinerary, hotel, activeDay, labels }: SchematicMapProps) {
  const [zoom, setZoom] = useState(1);
  const project = useMemo(() => {
    const frame = boundsOf(framePoints(itinerary, hotel, activeDay));
    if (!frame) return null;
    const [[w, s], [e, n]] = frame;
    // Pad more around a single day so neighbouring days stay in view, faded.
    const pad = activeDay === null ? 0.12 : 0.35;
    const sx = (Math.max(e - w, 0.01) * (1 + 2 * pad)) / zoom;
    const sy = (Math.max(n - s, 0.006) * (1 + 2 * pad)) / zoom;
    const x0 = (w + e) / 2 - sx / 2;
    const y0 = (n + s) / 2 + sy / 2;
    return ([lng, lat]: LngLat) => ({ x: ((lng - x0) / sx) * 100, y: ((y0 - lat) / sy) * 100 });
  }, [itinerary, hotel, activeDay, zoom]);

  if (!project) return <div className="size-full bg-map-ground" />;
  const home = hotel?.location ? project([hotel.location.lng, hotel.location.lat]) : null;
  const routeDays = activeDay === null ? itinerary : itinerary.filter((d) => d.day === activeDay);

  return (
    <div className="relative size-full overflow-hidden bg-map-ground">
      {/* Plain street-grid texture so the ground doesn't read as an empty box. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(255 255 255 / 0.9) 2px, transparent 2px), linear-gradient(to bottom, rgb(255 255 255 / 0.9) 2px, transparent 2px)',
          backgroundSize: '160px 120px',
        }}
      />
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {routeDays.map((day) => {
          const points = dayPoints(day).map(project);
          const path = home ? [home, ...points, home] : points;
          return (
            <polyline
              key={day.day}
              points={path.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={dayColor(day.day)}
              strokeWidth={activeDay === null ? 2.5 : 3.5}
              strokeOpacity={activeDay === null ? 0.5 : 1}
              strokeDasharray="2 6"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {itinerary.flatMap((day) =>
        day.places.map((place, i) => {
          const p = project([place.lng, place.lat]);
          const selected = activeDay === day.day;
          const look = activeDay === null ? 'dot' : selected ? 'numbered' : 'muted';
          return (
            <span
              key={`${day.day}-${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-300 motion-reduce:transition-none"
              style={{ left: `${p.x}%`, top: `${p.y}%`, zIndex: selected ? 2 : 1 }}
            >
              <StopPin day={day.day} index={i} name={place.name} look={look} showLabel={labels && selected} />
            </span>
          );
        }),
      )}
      {home && hotel && (
        <span
          className="absolute z-[3] -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-300 motion-reduce:transition-none"
          style={{ left: `${home.x}%`, top: `${home.y}%` }}
        >
          <HotelPin name={hotel.name} showLabel={labels} />
        </span>
      )}
      <div className="absolute top-4 right-4 z-[4] flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= 4}
          onClick={() => setZoom((z) => Math.min(4, z * 1.5))}
          className="flex size-10 items-center justify-center text-ink-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
        >
          <PlusIcon className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= 1}
          onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
          className="flex size-10 items-center justify-center border-t text-ink-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
        >
          <MinusIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
      <p className="absolute bottom-2 left-3 font-mono text-[11px] text-muted-foreground">Schematic · straight-line legs</p>
    </div>
  );
}
