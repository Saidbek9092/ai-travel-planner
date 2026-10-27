'use client';

import type { ItineraryDay } from '@ai-travel/contracts';
import { useRef, type KeyboardEvent } from 'react';
import { dayColor } from '@/lib/labels';
import { cn, formatDate } from '@/lib/utils';

interface ItineraryTimelineProps {
  itinerary: ItineraryDay[];
  activeDay: number | null;
  onSelectDay: (day: number | null) => void;
}

export function ItineraryTimeline({ itinerary, activeDay, onSelectDay }: ItineraryTimelineProps) {
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = itinerary.find((d) => d.day === activeDay);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    tabsRef.current[(index + step + itinerary.length) % itinerary.length]?.focus();
  };

  return (
    <section aria-label="Itinerary" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Day by day</h3>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Days">
        {itinerary.map((day, i) => {
          const active = day.day === activeDay;
          return (
            <button
              key={day.day}
              ref={(el) => {
                tabsRef.current[i] = el;
              }}
              type="button"
              aria-pressed={active}
              onClick={() => onSelectDay(active ? null : day.day)}
              onKeyDown={(event) => onKeyDown(event, i)}
              className={cn(
                'flex min-w-24 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                active && 'border-transparent text-white',
              )}
              style={{ borderColor: active ? undefined : dayColor(day.day), backgroundColor: active ? dayColor(day.day) : undefined }}
            >
              <span className="font-semibold">Day {day.day}</span>
              {day.date && <span className="text-xs">{formatDate(day.date, { locale: 'en-US' })}</span>}
              {day.weather && (
                <span className="text-xs">
                  {Math.round(day.weather.highC)}°C · {day.weather.condition}
                </span>
              )}
              <span className="text-xs">{day.places.length} stops</span>
            </button>
          );
        })}
      </div>
      {selected ? (
        <div>
          <h4 className="font-semibold">
            Day {selected.day} · {selected.title}
          </h4>
          <ol className="mt-2 flex flex-col gap-2">
            {selected.places.map((place, i) => (
              <li key={`${place.name}-${i}`} className="flex items-baseline gap-3 text-sm">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: dayColor(selected.day) }}
                >
                  {i + 1}
                </span>
                <span>
                  {place.name}
                  {place.note && <span className="text-muted-foreground"> · {place.note}</span>}
                </span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {place.lat.toFixed(3)}, {place.lng.toFixed(3)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Pick a day to see its stops and route on the map.</p>
      )}
    </section>
  );
}
