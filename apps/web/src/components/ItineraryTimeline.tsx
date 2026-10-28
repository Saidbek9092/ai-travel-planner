'use client';

import type { ItineraryDay, Transfer } from '@ai-travel/contracts';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { TRANSFER_MODES, WEATHER_ICONS, dayColor, formatTemperature } from '@/lib/labels';
import { cn, formatDay, formatDuration, formatUsd } from '@/lib/utils';

const stops = (n: number) => `${n} ${n === 1 ? 'stop' : 'stops'}`;

function weatherText(day: ItineraryDay): string | null {
  return day.weather ? `${formatTemperature(day.weather.highC)} · ${day.weather.condition}` : null;
}

/** Arrow keys move focus between the day buttons of a group. */
function useArrowKeys(count: number) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step || count === 0) return;
    event.preventDefault();
    refs.current[(index + step + count) % count]?.focus();
  };
  const ref = (i: number) => (el: HTMLButtonElement | null) => {
    refs.current[i] = el;
  };
  return { ref, onKeyDown };
}

interface DayListProps {
  itinerary: ItineraryDay[];
  pendingDays: { drafting: number | null; total: number };
  activeDay: number | null;
  onSelectDay: (day: number | null) => void;
}

/** Live "Day by day": planned days with a check, the day in `progress.detail` "drafting", the rest "waiting". */
export function DayList({ itinerary, pendingDays, activeDay, onSelectDay }: DayListProps) {
  const total = Math.max(pendingDays.total, itinerary.length);
  const keys = useArrowKeys(itinerary.length);
  const rows = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <section aria-labelledby="day-list-title" className="rounded-xl border bg-card px-5 pt-4 pb-1">
      <h3 id="day-list-title" className="text-[15px] leading-5 font-semibold">
        Day by day
      </h3>
      <ul className="mt-0.5 flex flex-col">
        {rows.map((n, i) => {
          const day = itinerary.find((d) => d.day === n);
          if (day) {
            const active = activeDay === n;
            const weekday = day.date ? formatDay(day.date, 'weekday') : null;
            return (
              <li key={n} className="border-b last:border-b-0">
                <button
                  ref={keys.ref(i)}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectDay(active ? null : n)}
                  onKeyDown={(e) => keys.onKeyDown(e, i)}
                  className={cn(
                    '-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-muted',
                    active && 'bg-muted',
                  )}
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: dayColor(n) }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] leading-5">
                      <span className="font-semibold">Day {n}</span> · {day.title}
                    </span>
                    <span className="block truncate text-[13px] leading-[18px] text-muted-foreground">
                      {[weekday, stops(day.places.length), day.weather && `${formatTemperature(day.weather.highC)} ${day.weather.condition.toLowerCase()}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <CheckIcon className="size-5 shrink-0 text-success" aria-hidden="true" />
                  <span className="sr-only">planned</span>
                </button>
              </li>
            );
          }
          const drafting = pendingDays.drafting === n;
          return (
            <li key={n} className="flex items-center gap-3 border-b py-3.5 leading-5 last:border-b-0">
              <span
                className={cn('size-2.5 shrink-0 rounded-full', drafting ? 'bg-live' : 'border-2 border-border')}
                aria-hidden="true"
              />
              <span className={cn('text-[15px] font-semibold', !drafting && 'text-ink-2')}>Day {n}</span>
              {drafting && <span className="h-2 max-w-48 flex-1 rounded-full bg-secondary motion-safe:animate-pulse" aria-hidden="true" />}
              <span className={cn('ml-auto text-[13px]', drafting ? 'font-medium text-live-foreground' : 'text-muted-foreground')}>
                {drafting ? 'drafting' : 'waiting'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Finished trip: one card per day; the selected card takes the day's colour. */
export function DayCards({ itinerary, activeDay, onSelectDay }: { itinerary: ItineraryDay[]; activeDay: number; onSelectDay: (day: number) => void }) {
  const keys = useArrowKeys(itinerary.length);
  const totalStops = itinerary.reduce((sum, d) => sum + d.places.length, 0);
  return (
    <section aria-labelledby="day-cards-title" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 id="day-cards-title" className="text-xl leading-7 font-semibold">
          Day by day
        </h2>
        <span className="text-sm text-ink-2">
          {itinerary.length} days · {stops(totalStops)}
        </span>
      </header>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:auto-cols-fr lg:grid-flow-col lg:gap-3.5 lg:overflow-visible lg:px-0">
        {itinerary.map((day, i) => {
          const active = day.day === activeDay;
          const Icon = day.weather ? WEATHER_ICONS[day.weather.icon] : null;
          const color = dayColor(day.day);
          return (
            <li key={day.day} className="w-44 shrink-0 snap-start lg:w-auto">
              <button
                ref={keys.ref(i)}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectDay(day.day)}
                onKeyDown={(e) => keys.onKeyDown(e, i)}
                className={cn(
                  'flex h-full w-full flex-col gap-1.5 rounded-xl border-2 bg-card px-4 py-3.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                  !active && 'border-border hover:border-muted-foreground/40',
                )}
                style={active ? { borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 10%, white)` } : undefined}
              >
                <span className="flex items-center gap-2 text-[15px] leading-[18px]">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                  <span className="font-semibold">Day {day.day}</span>
                  {day.date && <span className="ml-auto text-[13px] text-muted-foreground">{formatDay(day.date, 'short')}</span>}
                </span>
                <span className="line-clamp-2 min-h-10 text-base leading-5 font-semibold">{day.title}</span>
                <span className="mt-auto flex flex-col gap-0.5 text-sm leading-5 text-ink-2">
                  {day.weather && Icon && (
                    <span className="flex items-center gap-1.5">
                      <Icon className="size-4" aria-hidden="true" />
                      {weatherText(day)}
                    </span>
                  )}
                  <span className="text-[13px] leading-[18px] text-muted-foreground">{stops(day.places.length)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TransferStop({ transfer }: { transfer: Transfer }) {
  const mode = TRANSFER_MODES[transfer.mode];
  const Icon = mode.icon;
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-ink-2" aria-hidden="true">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">
          {transfer.description.includes(' · ') ? transfer.description : `${mode.label} · ${transfer.description}`}
        </span>
        <span className="block text-[13px] text-muted-foreground">
          {formatUsd(transfer.priceUsd)}
          {transfer.durationMinutes ? ` · about ${formatDuration(transfer.durationMinutes)}` : ''}
        </span>
      </span>
    </li>
  );
}

/** The selected day beside the map: heading, weather, numbered stops (with that day's transfers) and daily spend. */
export function DayPanel({
  day,
  transfers,
  dailySpend,
  onPrev,
  onNext,
}: {
  day: ItineraryDay;
  transfers: Transfer[];
  dailySpend: number | null;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const color = dayColor(day.day);
  const dayTransfers = transfers.filter((t) => t.day === day.day);
  const arrival = day.day === 1 ? dayTransfers : [];
  const departure = day.day === 1 ? [] : dayTransfers;
  return (
    <div className="flex h-full flex-col px-6 py-5" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <p className="font-mono text-xs font-semibold tracking-[0.06em] whitespace-nowrap text-foreground uppercase">
          Day {day.day}
          {day.date && ` · ${formatDay(day.date)}`}
        </p>
        <span className="ml-auto flex gap-2">
          <Button variant="outline" size="icon" className="size-10 bg-card" disabled={!onPrev} onClick={onPrev ?? undefined} aria-label="Previous day">
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button variant="outline" size="icon" className="size-10 bg-card" disabled={!onNext} onClick={onNext ?? undefined} aria-label="Next day">
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </span>
      </div>
      <h3 className="mt-5 text-2xl leading-8 font-semibold">{day.title}</h3>
      {day.weather && <p className="mt-4 self-start rounded-full bg-muted px-3 py-1 text-[15px] text-ink-2">{weatherText(day)}</p>}
      <ol className="mt-5 flex flex-col gap-3.5">
        {arrival.map((t) => (
          <TransferStop key={t.description} transfer={t} />
        ))}
        {day.places.map((place, i) => (
          <li key={`${place.name}-${i}`} className="flex gap-3">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[17px] leading-6 font-semibold">{place.name}</span>
              {place.note && <span className="block text-sm text-ink-2">{place.note}</span>}
            </span>
          </li>
        ))}
        {departure.map((t) => (
          <TransferStop key={t.description} transfer={t} />
        ))}
      </ol>
      {dailySpend !== null && (
        <p className="mt-auto flex justify-between border-t pt-4 text-[15px] text-ink-2">
          Daily spend <span className="font-mono text-foreground">~{formatUsd(dailySpend)}</span>
        </p>
      )}
    </div>
  );
}
