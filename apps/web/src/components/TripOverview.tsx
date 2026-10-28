'use client';

import type { DecisionTopic, Hotel, ItineraryDay, MessagePayload, ProgressPayload, ResultPayload } from '@ai-travel/contracts';
import dynamic from 'next/dynamic';
import { PlaneIcon } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { BudgetMeter } from '@/components/BudgetMeter';
import { SelectedFlightCard, SelectedHotelCard } from '@/components/FlightHotelCards';
import { DayCards, DayList, DayPanel } from '@/components/ItineraryTimeline';
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

function Card({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`overflow-hidden rounded-xl border bg-card ${className ?? ''}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {aside && <div className="text-[13px] text-ink-2">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

type Decisions = Partial<Record<DecisionTopic, MessagePayload>>;

interface LiveOverviewProps {
  trip: TripView;
  decisions: Decisions;
  progress: ProgressPayload | null;
  activeDay: number | null;
  onSelectDay: (day: number | null) => void;
}

/** Right column while agents work: sections appear as their data arrives in `DRAFT` packets. */
export function LiveOverview({ trip, decisions, progress, activeDay, onSelectDay }: LiveOverviewProps) {
  const itinerary = trip.itinerary ?? [];
  const placed = itinerary.filter((d) => d.places.length > 0);
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
          {placed.length > 0 && (
            <Card
              title="Map"
              aside={activeDay !== null ? `Showing Day ${activeDay}` : placed.length === 1 ? 'Day 1 placed' : `Days 1–${placed.length} placed`}
            >
              <div className="h-80 lg:h-[460px]">
                <MapArea itinerary={itinerary} hotel={trip.hotels?.[0] ?? null} activeDay={activeDay} labels={false} />
              </div>
            </Card>
          )}
          {trip.durationDays ? (
            <DayList
              itinerary={itinerary}
              pendingDays={{ drafting: progress?.currentStatus === 'planning' ? draftingDay(progress.detail) : null, total: trip.durationDays }}
              activeDay={activeDay}
              onSelectDay={onSelectDay}
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
  activeDay: number | null;
  onSelectDay: (day: number | null) => void;
  /** The chat summary card (left column). */
  chat: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

/** The finished trip: title + budget, chat summary, flights, hotel, map with the selected day, day cards. */
export function FinishedOverview({ result, decisions, activeDay, onSelectDay, chat, headingRef }: FinishedOverviewProps) {
  const { itinerary } = result;
  const shown = itinerary.find((d) => d.day === activeDay) ?? itinerary[0] ?? null;
  const index = shown ? itinerary.indexOf(shown) : -1;
  const hotel = result.hotels[0] ?? null;
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

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,302fr)_minmax(0,609fr)_minmax(0,341fr)] lg:items-start">
        <div className="lg:row-span-3">{chat}</div>
        <div className="lg:self-stretch">
          <SelectedFlightCard
            flights={result.flights}
            transfers={result.transfers}
            firstDay={itinerary[0]?.day ?? 1}
            confirmed={confirmed('flight')}
            confirmedTransfers={confirmed('transfers')}
            variant="full"
          />
        </div>
        <div className="lg:self-stretch">
          <SelectedHotelCard hotels={result.hotels} durationDays={result.durationDays} startDate={result.startDate} confirmed={confirmed('hotel')} variant="full" />
        </div>

        {shown && (
          <section aria-labelledby="map-title" className="overflow-hidden rounded-xl border bg-card lg:col-span-2">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-[13px]">
              <h2 id="map-title" className="text-lg font-semibold">
                Map
              </h2>
              <p className="text-sm text-ink-2">
                Showing <span className="font-semibold text-foreground">Day {shown.day}</span>
                {' · '}pick a day below to change the route
              </p>
            </header>
            <div className="lg:grid lg:min-h-[580px] lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="h-[580px]">
                <MapArea itinerary={itinerary} hotel={hotel} activeDay={shown?.day ?? null} labels />
              </div>
              <div className="border-l">
                <DayPanel
                  day={shown}
                  transfers={result.transfers}
                  dailySpend={result.dailyExpensesEstimate || null}
                  onPrev={index > 0 ? () => onSelectDay(itinerary[index - 1]!.day) : null}
                  onNext={index < itinerary.length - 1 ? () => onSelectDay(itinerary[index + 1]!.day) : null}
                />
              </div>
            </div>
          </section>
        )}
        {itinerary.length > 0 && shown && (
          <div className="lg:col-span-2">
            <DayCards itinerary={itinerary} activeDay={shown.day} onSelectDay={onSelectDay} />
          </div>
        )}
      </div>
    </div>
  );
}
