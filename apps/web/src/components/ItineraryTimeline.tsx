'use client';

import type { ItineraryDay, Place, Transfer } from '@ai-travel/contracts';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ExternalLink } from '@/components/ExternalLink';
import { Button } from '@/components/ui/button';
import { TRANSFER_MODES, WEATHER_ICONS, dayColor, formatTemperature } from '@/lib/labels';
import { placeLinks, safeUrl } from '@/lib/links';
import { arrivalDay } from '@/lib/trip';
import { cn, formatDay, formatDuration, formatUsd } from '@/lib/utils';

const stops = (n: number) => `${n} ${n === 1 ? 'stop' : 'stops'}`;

function weatherText(day: ItineraryDay): string | null {
  return day.weather ? `${formatTemperature(day.weather.highC)} · ${day.weather.condition}` : null;
}

/** Arrow keys move focus between the day buttons of a group. */
export function useArrowKeys(count: number) {
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
  onSelectDay: (day: number) => void;
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
                  onClick={() => onSelectDay(n)}
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

export type DaySelection = number | 'all';

interface DayStripProps {
  itinerary: ItineraryDay[];
  /** Days still being planned (live run): shown as inactive tabs. */
  totalDays: number;
  selected: DaySelection;
  onSelect: (day: DaySelection) => void;
}

/** Date strip above the map: "All days" plus one tab per day. Arrows move focus, Enter or Space selects. */
export function DayStrip({ itinerary, totalDays, selected, onSelect }: DayStripProps) {
  const days = Array.from({ length: Math.max(totalDays, itinerary.length) }, (_, i) => i + 1);
  const keys = useArrowKeys(days.length + 1);
  // Fade an edge that has more days beyond it, so a cut-off tab reads as "scroll for more".
  const stripRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ before: false, after: false });
  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setMore({ before: el.scrollLeft > 4, after: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, days.length]);
  const fade = `linear-gradient(to right, ${more.before ? 'transparent 0, black 40px' : 'black 0'}, ${more.after ? 'black calc(100% - 40px), transparent 100%' : 'black 100%'})`;
  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Days"
      onScroll={measure}
      // `relative`: the tabs' `sr-only` (absolute) labels must be clipped by this scroller, not widen the page.
      className="relative flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-3"
      style={more.before || more.after ? { maskImage: fade } : undefined}
    >
      {[
        { key: 'all' as const, day: null as ItineraryDay | null, n: 0 },
        ...days.map((n) => ({ key: n, day: itinerary.find((d) => d.day === n) ?? null, n })),
      ].map((tab, i) => {
        const active = selected === tab.key;
        const color = tab.key === 'all' ? null : dayColor(tab.n);
        const Icon = tab.day?.weather ? WEATHER_ICONS[tab.day.weather.icon] : null;
        const planned = tab.key === 'all' || tab.day !== null;
        return (
          <button
            key={tab.key}
            ref={keys.ref(i)}
            type="button"
            role="tab"
            id={`day-tab-${tab.key}`}
            aria-selected={active}
            aria-disabled={!planned}
            tabIndex={active ? 0 : -1}
            onClick={() => planned && onSelect(tab.key)}
            onKeyDown={(e) => keys.onKeyDown(e, i)}
            onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
            className={cn(
              'flex h-10 shrink-0 snap-start items-center gap-2 rounded-full border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11',
              !active && 'border-border bg-card hover:border-muted-foreground/40',
              !planned && 'cursor-default text-muted-foreground hover:border-border',
            )}
            style={active ? { borderColor: color ?? 'var(--foreground)', backgroundColor: color ? `color-mix(in srgb, ${color} 10%, white)` : 'var(--muted)' } : undefined}
          >
            {tab.key === 'all' ? (
              <span className="font-semibold">All days</span>
            ) : (
              <>
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color! }} aria-hidden="true" />
                <span className="font-semibold">Day {tab.n}</span>
                {tab.day ? (
                  <>
                    {tab.day.date && <span className="text-ink-2">{formatDay(tab.day.date, 'short')}</span>}
                    {tab.day.weather && Icon && (
                      <span className="flex items-center gap-1 text-ink-2">
                        <Icon className="size-3.5" aria-hidden="true" />
                        {formatTemperature(tab.day.weather.highC)}
                        <span className="sr-only"> {tab.day.weather.condition}</span>
                      </span>
                    )}
                  </>
                ) : (
                  <span>planning…</span>
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Hours come from Google Maps; a stop the agent could not check says so instead of looking confirmed. */
function PlaceHours({ place }: { place: Place }) {
  if (place.source !== 'serpapi') return <span className="block text-xs text-muted-foreground">Hours not checked</span>;
  if (!place.hours) return null;
  return <span className="block text-xs text-ink-2">Open {place.hours} · Google Maps</span>;
}

function PlaceLinks({ place }: { place: Place }) {
  const { website, map } = placeLinks(place);
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-3">
      {website && <ExternalLink href={website}>Website</ExternalLink>}
      <ExternalLink href={map}>View on map</ExternalLink>
    </span>
  );
}

/** Fixed-size square, so loading never shifts the layout; a missing or broken photo shows the neutral placeholder. */
function PlacePhoto({ place }: { place: Place }) {
  const [failed, setFailed] = useState(false);
  const url = safeUrl(place.photoUrl);
  return (
    <span className="size-14 shrink-0 overflow-hidden rounded-lg">
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote photos come from arbitrary hosts
        <img src={url} alt="" loading="lazy" width={56} height={56} onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <span className="placeholder-hatch flex size-full items-center justify-center text-muted-foreground" aria-hidden="true">
          <ImageIcon className="size-4" />
        </span>
      )}
    </span>
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
        {safeUrl(transfer.url) && <ExternalLink href={safeUrl(transfer.url)!}>Timetable and fares</ExternalLink>}
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
  // An overnight flight lands on day 2, so the arrival day is the earliest transfer's, not always day 1.
  const isArrivalDay = day.day === arrivalDay(transfers);
  const arrival = isArrivalDay ? dayTransfers : [];
  const departure = isArrivalDay ? [] : dayTransfers;
  return (
    <div className="flex h-full flex-col px-6 py-5" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <p className="font-mono text-xs font-semibold tracking-[0.06em] whitespace-nowrap text-foreground uppercase">
          Day {day.day}
          {day.date && ` · ${formatDay(day.date)}`}
        </p>
        <span className="ml-auto flex gap-2">
          <Button variant="outline" size="icon" className="size-10 bg-card pointer-coarse:size-11" disabled={!onPrev} onClick={onPrev ?? undefined} aria-label="Previous day">
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button variant="outline" size="icon" className="size-10 bg-card pointer-coarse:size-11" disabled={!onNext} onClick={onNext ?? undefined} aria-label="Next day">
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
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] leading-6 font-semibold">{place.name}</span>
              {place.note && <span className="block text-sm text-ink-2">{place.note}</span>}
              <PlaceHours place={place} />
              <PlaceLinks place={place} />
              {place.photoUrl && place.photoCredit && safeUrl(place.photoCredit.url) && (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Photo: <ExternalLink href={safeUrl(place.photoCredit.url)!}>{place.photoCredit.name}</ExternalLink>
                </span>
              )}
            </span>
            <PlacePhoto place={place} />
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
