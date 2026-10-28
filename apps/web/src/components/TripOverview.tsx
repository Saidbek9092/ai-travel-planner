'use client';

import type { DecisionTopic, Hotel, ItineraryDay, MessagePayload, ProgressPayload, ResultPayload, Transfer } from '@ai-travel/contracts';
import dynamic from 'next/dynamic';
import { PlaneIcon } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { BudgetMeter } from '@/components/BudgetMeter';
import { SelectedFlightCard, SelectedHotelCard } from '@/components/FlightHotelCards';
import { DayList, DayPanel, DayStrip, type DaySelection } from '@/components/ItineraryTimeline';
import { SchematicMap } from '@/components/SchematicMap';
import { Skeleton } from '@/components/ui/skeleton';
import { env } from '@/lib/env';
import { budgetParts, draftingDay, timesWord, tripTitle, tripTotal, type TripView } from '@/lib/trip';

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
function DayExplorer({ itinerary, totalDays, hotel, transfers, dailySpend, selected, onSelect, drafting, mapHeight }: DayExplorerProps) {
  const day = selected === 'all' ? null : (itinerary.find((d) => d.day === selected) ?? null);
  const index = day ? itinerary.indexOf(day) : -1;
  return (
    <section aria-labelledby="day-explorer-title" className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-3">
        <h2 id="day-explorer-title" className="text-lg font-semibold">
          Day by day
        </h2>
        <span className="text-[13px] text-ink-2">{day ? `Showing Day ${day.day}` : 'Showing all days'}</span>
      </header>
      <DayStrip itinerary={itinerary} totalDays={totalDays} selected={selected} onSelect={onSelect} />
      <div role="tabpanel" aria-labelledby={`day-tab-${selected}`}>
        {itinerary.some((d) => d.places.length > 0) && (
          <div className={mapHeight}>
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

type Decisions = Partial<Record<DecisionTopic, MessagePayload>>;

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
          <SelectedFlightCard
            flights={trip.flights ?? []}
            transfers={trip.transfers ?? []}
            firstDay={1}
            confirmed={!!decisions.flight}
            confirmedTransfers={!!decisions.transfers}
            variant="live"
          />
          <SelectedHotelCard
            hotels={trip.hotels ?? []}
            durationDays={trip.durationDays ?? 1}
            startDate={trip.startDate ?? null}
            confirmed={!!decisions.hotel}
            variant="live"
          />
          {trip.durationDays ? (
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
          ) : null}
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
        <div className="lg:sticky lg:top-5">{chat}</div>
        <div className="flex min-w-0 flex-col gap-5">
          <SelectedFlightCard
            flights={result.flights}
            transfers={result.transfers}
            firstDay={itinerary[0]?.day ?? 1}
            confirmed={confirmed('flight')}
            confirmedTransfers={confirmed('transfers')}
            variant="full"
          />
          <SelectedHotelCard hotels={result.hotels} durationDays={result.durationDays} startDate={result.startDate} confirmed={confirmed('hotel')} variant="full" />
          {itinerary.length > 0 && (
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
          )}
        </div>
      </div>
    </div>
  );
}
