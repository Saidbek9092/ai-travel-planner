'use client';

import type { DecisionTopic, Flight, Hotel, ItineraryDay, MessagePayload, ProgressPayload, ResultPayload, Transfer } from '@ai-travel/contracts';
import dynamic from 'next/dynamic';
import { BedDoubleIcon, CalendarDaysIcon, CarIcon, MapIcon, MapPinOffIcon, PlaneIcon, type LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { BudgetMeter } from '@/components/BudgetMeter';
import { SelectedFlightCard, SelectedHotelCard, TransfersCard } from '@/components/FlightHotelCards';
import { DayList, DayPanel, DayStrip, useArrowKeys, type DaySelection } from '@/components/ItineraryTimeline';
import { SchematicMap } from '@/components/SchematicMap';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { env } from '@/lib/env';
import { cn, formatUsd } from '@/lib/utils';
import { arrivalDay, budgetParts, draftingDay, timesWord, tripTitle, tripTotal, type TripView } from '@/lib/trip';

const MapboxViewer = dynamic(() => import('@/components/MapboxViewer'), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

/** Street map with a token, the schematic plot without one. */
function MapArea(props: { itinerary: ItineraryDay[]; hotel: Hotel | null; activeDay: number | null; labels: boolean }) {
  return env.mapboxToken ? <MapboxViewer {...props} /> : <SchematicMap {...props} />;
}

interface DayExplorerProps {
  itinerary: ItineraryDay[];
  totalDays: number;
  hotel: Hotel | null;
  transfers: Transfer[];
  dailySpend: number | null;
  selected: DaySelection;
  onSelect: (day: DaySelection) => void;
  drafting: number | null;
  mapHeight: string;
}

/** Day strip first, then the map and stop list for the selected day ("All days" shows every route, faded). */
/** "3 stops", or "travel day" for a day spent on the plane before an overnight flight lands. */
const dayCount = (day: ItineraryDay, transfers: Transfer[]) =>
  day.day < arrivalDay(transfers) ? 'travel day' : `${day.places.length} ${day.places.length === 1 ? 'stop' : 'stops'}`;

function DayExplorer({ itinerary, totalDays, hotel, transfers, dailySpend, selected, onSelect, drafting, mapHeight }: DayExplorerProps) {
  const day = selected === 'all' ? null : (itinerary.find((d) => d.day === selected) ?? null);
  const index = day ? itinerary.indexOf(day) : -1;
  // The map is optional: the day's details come first, the map opens on request.
  const [showMap, setShowMap] = useState(false);
  const hasPlaces = itinerary.some((d) => d.places.length > 0);
  return (
    <section aria-labelledby="day-explorer-title" className="overflow-hidden rounded-xl border bg-card">
      <h2 id="day-explorer-title" className="sr-only">
        Day by day
      </h2>
      <DayStrip itinerary={itinerary} totalDays={totalDays} selected={selected} onSelect={onSelect} />
      {hasPlaces && (
        <div className="flex items-center justify-between gap-2 border-b px-4 pb-3">
          <span className="text-[13px] text-ink-2">{day ? `Day ${day.day} · ${dayCount(day, transfers)}` : 'All days'}</span>
          <Button variant="outline" className="h-9 bg-card pointer-coarse:h-11" aria-expanded={showMap} aria-controls="day-map" onClick={() => setShowMap((v) => !v)}>
            {showMap ? <MapPinOffIcon aria-hidden="true" /> : <MapIcon aria-hidden="true" />}
            {showMap ? 'Hide map' : 'Show map'}
          </Button>
        </div>
      )}
      <div role="tabpanel" aria-labelledby={`day-tab-${selected}`}>
        {hasPlaces && showMap && (
          <div id="day-map" className={cn('border-b', mapHeight)}>
            <MapArea itinerary={itinerary} hotel={hotel} activeDay={day?.day ?? null} labels={day !== null} />
          </div>
        )}
        {day ? (
          <div className="border-t">
            <DayPanel
              day={day}
              transfers={transfers}
              dailySpend={dailySpend}
              onPrev={index > 0 ? () => onSelect(itinerary[index - 1]!.day) : null}
              onNext={index < itinerary.length - 1 ? () => onSelect(itinerary[index + 1]!.day) : null}
            />
          </div>
        ) : (
          <div className="border-t px-1">
            <DayList itinerary={itinerary} pendingDays={{ drafting, total: totalDays }} activeDay={null} onSelectDay={onSelect} />
          </div>
        )}
      </div>
    </section>
  );
}

type SectionId = 'flight' | 'hotel' | 'transfers' | 'days';

interface SectionTab {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  /// Small hint on the tab ("3 days"); null while the agent has nothing yet.
  hint: string | null;
  content: ReactNode;
}

/** Height of the sticky site header (`h-16`), which the section tabs stick under. */
const HEADER_PX = 64;

/** Flight, Hotel, Transfers and Days as tabs: one section at a time. Arrow keys move between tabs. */
function SectionTabs({ tabs, initial }: { tabs: SectionTab[]; initial: SectionId }) {
  const [active, setActive] = useState<SectionId>(initial);
  const rootRef = useRef<HTMLDivElement>(null);
  const keys = useArrowKeys(tabs.length);
  const current = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const select = (id: SectionId) => {
    setActive(id);
    // Scrolled past the tabs (they are stuck under the header): show the new section from its top, not from the
    // middle of the page where the old, longer section left off.
    const top = rootRef.current?.getBoundingClientRect().top ?? 0;
    if (top < HEADER_PX) window.scrollBy({ top: top - HEADER_PX });
  };
  return (
    <div ref={rootRef} className="@container flex min-w-0 flex-col gap-5">
      <div role="tablist" aria-label="Trip sections" className="sticky top-16 z-30 -mx-1 flex gap-1 border-b bg-background/95 px-1 backdrop-blur">
        {tabs.map((tab, i) => {
          const selected = tab.id === current.id;
          return (
            <button
              key={tab.id}
              ref={keys.ref(i)}
              type="button"
              role="tab"
              id={`section-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls="section-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id)}
              onKeyDown={(e) => keys.onKeyDown(e, i)}
              className={cn(
                '-mb-px flex min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-2 py-3 text-[15px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                selected ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-ink-2 hover:text-foreground',
              )}
            >
              <tab.icon className="size-4 shrink-0" aria-hidden="true" />
              {tab.label}
              {/* Only where there is room for it: a clipped price ("$4…") would read as a different price. */}
              {tab.hint && <span className="hidden rounded-full bg-muted px-2 py-0.5 text-xs font-normal whitespace-nowrap text-ink-2 @2xl:inline">{tab.hint}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="section-panel" aria-labelledby={`section-tab-${current.id}`} className="min-w-0">
        {current.content}
      </div>
    </div>
  );
}

const WAITING = (what: string) => (
  <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed bg-card/60 p-10 text-center text-ink-2">
    <p>{what} appears here when the agent has decided.</p>
  </div>
);

type Decisions = Partial<Record<DecisionTopic, MessagePayload>>;

interface SectionInput {
  flights: Flight[];
  hotels: Hotel[];
  transfers: Transfer[];
  durationDays: number;
  startDate: string | null;
  firstDay: number;
  confirmed: { flight: boolean; hotel: boolean; transfers: boolean };
  days: ReactNode;
  dayCount: number;
  totalDays: number;
}

function sectionTabs(i: SectionInput): SectionTab[] {
  const flight = i.flights[0];
  const hotel = i.hotels[0];
  return [
    {
      id: 'flight',
      label: 'Flight',
      icon: PlaneIcon,
      hint: flight ? formatUsd(flight.price) : null,
      content: flight ? (
        <SelectedFlightCard flights={i.flights} transfers={[]} firstDay={i.firstDay} confirmed={i.confirmed.flight} confirmedTransfers={false} variant="full" />
      ) : (
        WAITING('The flight')
      ),
    },
    {
      id: 'hotel',
      label: 'Hotel',
      icon: BedDoubleIcon,
      hint: hotel ? `${formatUsd(hotel.pricePerNight)}/night` : null,
      content: hotel ? (
        <SelectedHotelCard hotels={i.hotels} durationDays={i.durationDays} startDate={i.startDate} confirmed={i.confirmed.hotel} variant="full" />
      ) : (
        WAITING('The hotel')
      ),
    },
    {
      id: 'transfers',
      label: 'Transfer',
      icon: CarIcon,
      hint: i.transfers.length > 0 ? `${i.transfers.length} ${i.transfers.length === 1 ? 'ride' : 'rides'}` : null,
      content: i.transfers.length > 0 ? <TransfersCard transfers={i.transfers} firstDay={i.firstDay} confirmed={i.confirmed.transfers} /> : WAITING('The transfers'),
    },
    {
      id: 'days',
      label: 'Days',
      icon: CalendarDaysIcon,
      hint: i.dayCount > 0 ? `${i.dayCount}${i.totalDays > i.dayCount ? `/${i.totalDays}` : ''} planned` : null,
      content: i.days ?? WAITING('The itinerary'),
    },
  ];
}

interface LiveOverviewProps {
  trip: TripView;
  decisions: Decisions;
  progress: ProgressPayload | null;
  selectedDay: DaySelection;
  onSelectDay: (day: DaySelection) => void;
}

/** Right column while agents work: sections appear as their data arrives in `DRAFT` packets. */
export function LiveOverview({ trip, decisions, progress, selectedDay, onSelectDay }: LiveOverviewProps) {
  const itinerary = trip.itinerary ?? [];
  const empty = !trip.destination;
  return (
    <section aria-labelledby="overview-title" className="flex flex-col gap-[18px]">
      <header className="-mb-1.5 flex items-baseline justify-between gap-2 px-1">
        <h2 id="overview-title" className="text-lg font-semibold">
          Trip Overview
        </h2>
        <span className="text-[13px] text-ink-2">fills in as agents decide</span>
      </header>
      {empty ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/60 p-10 text-center text-ink-2">
          <PlaneIcon className="size-7" aria-hidden="true" />
          <p>The budget, flight, hotel, map and days appear here one by one.</p>
        </div>
      ) : (
        <>
          {trip.budget && tripTotal(trip, !!decisions.budget) > 0 ? (
            <BudgetMeter
              totalCost={tripTotal(trip, !!decisions.budget)}
              budget={trip.budget}
              parts={budgetParts(trip)}
              passes={'passes' in trip ? trip.passes : []}
              final={!!decisions.budget}
            />
          ) : null}
          <SectionTabs
            initial="flight"
            tabs={sectionTabs({
              flights: trip.flights ?? [],
              hotels: trip.hotels ?? [],
              transfers: trip.transfers ?? [],
              durationDays: trip.durationDays ?? 1,
              startDate: trip.startDate ?? null,
              firstDay: arrivalDay(trip.transfers ?? []),
              confirmed: { flight: !!decisions.flight, hotel: !!decisions.hotel, transfers: !!decisions.transfers },
              days: trip.durationDays ? (
                <DayExplorer
                  itinerary={itinerary}
                  totalDays={trip.durationDays}
                  hotel={trip.hotels?.[0] ?? null}
                  transfers={trip.transfers ?? []}
                  dailySpend={null}
                  selected={selectedDay}
                  onSelect={onSelectDay}
                  drafting={progress?.currentStatus === 'planning' ? draftingDay(progress.detail) : null}
                  mapHeight="h-72 lg:h-[340px]"
                />
              ) : null,
              dayCount: itinerary.length,
              totalDays: trip.durationDays ?? 0,
            })}
          />
        </>
      )}
    </section>
  );
}

interface FinishedOverviewProps {
  result: ResultPayload;
  decisions: Decisions;
  selectedDay: DaySelection;
  onSelectDay: (day: DaySelection) => void;
  /** The chat summary card (left column). */
  chat: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

/** The finished trip: title + budget on top; collapsed chat on the left; flights, hotel, days and map on the right. */
export function FinishedOverview({ result, decisions, selectedDay, onSelectDay, chat, headingRef }: FinishedOverviewProps) {
  const { itinerary } = result;
  // A reopened trip has no chat: every section of a completed result is confirmed.
  const confirmed = (topic: DecisionTopic) => !!decisions[topic] || result.status === 'completed';
  const subtitle = [
    result.origin ? `${result.origin} → ${result.destination}` : result.destination,
    'planned by 5 agents',
    result.replans > 0 ? `re-planned ${timesWord(result.replans)} to fit your budget` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="label-mono text-muted-foreground">Trip overview</p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-[28px] leading-9 font-semibold tracking-tight outline-none sm:text-4xl sm:leading-10">
            {tripTitle(result)}
          </h1>
          <p className="mt-1 text-[15px] text-ink-2">{subtitle}</p>
        </div>
        <div className="lg:w-[448px] lg:shrink-0">
          <BudgetMeter totalCost={result.totalCost} budget={result.budget} parts={budgetParts(result)} passes={result.passes} final variant="compact" />
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <div className="lg:sticky lg:top-20">{chat}</div>
        <div className="flex min-w-0 flex-col gap-5">
          <SectionTabs
            initial="days"
            tabs={sectionTabs({
              flights: result.flights,
              hotels: result.hotels,
              transfers: result.transfers,
              durationDays: result.durationDays,
              startDate: result.startDate,
              firstDay: arrivalDay(result.transfers),
              confirmed: { flight: confirmed('flight'), hotel: confirmed('hotel'), transfers: confirmed('transfers') },
              days:
                itinerary.length > 0 ? (
                  <DayExplorer
                    itinerary={itinerary}
                    totalDays={itinerary.length}
                    hotel={result.hotels[0] ?? null}
                    transfers={result.transfers}
                    dailySpend={result.dailyExpensesEstimate || null}
                    selected={selectedDay}
                    onSelect={onSelectDay}
                    drafting={null}
                    mapHeight="h-[420px]"
                  />
                ) : null,
              dayCount: itinerary.length,
              totalDays: itinerary.length,
            })}
          />
        </div>
      </div>
    </div>
  );
}
