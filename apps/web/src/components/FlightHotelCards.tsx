'use client';

import type { Flight, FlightLeg, Hotel, Transfer } from '@ai-travel/contracts';
import { motion, useReducedMotion } from 'motion/react';
import { BedDoubleIcon, CarIcon, CheckIcon, PlaneIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ExternalLink } from '@/components/ExternalLink';
import { ConfirmedTag, EstimateTag } from '@/components/Tags';
import { AGENT_AVATAR_COLORS, TRANSFER_MODES, ratingWord } from '@/lib/labels';
import { mapUrl, safeUrl, sourceLabel } from '@/lib/links';
import { addDays, cn, dayDifference, formatDay, formatDuration, formatLegTime, formatUsd, nightsFor } from '@/lib/utils';

const Dots = () => <span aria-hidden="true" className="mt-3 h-px min-w-4 flex-1 border-t-2 border-dotted border-border" />;

function Appear({ children, index }: { children: ReactNode; index: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: reduceMotion ? 0 : index * 0.05 }}
      className="min-w-0"
    >
      {children}
    </motion.div>
  );
}

function legLabel(leg: FlightLeg): string {
  const stops = leg.stops.map((s) => `${s.airport.code} ${formatDuration(s.layoverMinutes)} layover`).join(', ');
  return `${leg.from.name} ${formatLegTime(leg.departure)} to ${leg.to.name} ${formatLegTime(leg.arrival)}${stops ? `, via ${stops}` : ', direct'}`;
}

/** `TAS 06:40 ┄ IST 1 h 50 m ┄ CDG 13:55 · T1`. `full` adds airport names and the stop box. */
function RouteStrip({ leg, full }: { leg: FlightLeg; full: boolean }) {
  const nextDay = dayDifference(leg.departure, leg.arrival);
  const arrival = `${formatLegTime(leg.arrival)}${nextDay > 0 ? ` · +${nextDay} day` : ''}${leg.terminal ? ` · T${leg.terminal}` : ''}`;
  return (
    <div className="flex items-start gap-3" role="img" aria-label={legLabel(leg)}>
      <div className="min-w-0 shrink">
        <p className={cn('font-mono font-semibold', full ? 'text-[28px] leading-8' : 'text-[22px] leading-7')}>{leg.from.code}</p>
        <p className={cn(full ? 'text-[15px] leading-5 font-semibold' : 'text-[13px] leading-[18px] text-muted-foreground')}>{formatLegTime(leg.departure)}</p>
        {full && <p className="text-[13px] leading-[18px] text-muted-foreground">{leg.from.name}</p>}
      </div>
      <Dots />
      {leg.stops.length === 0 ? (
        <p className="mt-1.5 shrink-0 text-xs text-muted-foreground">Direct</p>
      ) : (
        leg.stops.map((stop, i) => (
          <div key={stop.airport.code} className="contents">
            {i > 0 && <Dots />}
            <div className={cn('min-w-0 shrink text-center', full && 'rounded-lg bg-muted px-3 py-1.5')}>
              <p className="font-mono text-[15px] font-semibold">{stop.airport.code}</p>
              <p className="text-xs text-muted-foreground">
                {formatDuration(stop.layoverMinutes)}
                {full && ' layover'}
              </p>
              {full && <p className="text-xs leading-4 text-muted-foreground">{stop.airport.name}</p>}
            </div>
          </div>
        ))
      )}
      <Dots />
      <div className="min-w-0 shrink text-right">
        <p className={cn('font-mono font-semibold', full ? 'text-[28px] leading-8' : 'text-[22px] leading-7')}>{leg.to.code}</p>
        <p className={cn(full ? 'text-[15px] leading-5 font-semibold' : 'text-[13px] leading-[18px] text-muted-foreground')}>{arrival}</p>
        {full && <p className="text-[13px] leading-[18px] text-muted-foreground">{leg.to.name}</p>}
      </div>
    </div>
  );
}

/** `45` → `45 min`, `95` → `1 h 35 m` (transfers read in minutes, as in the design). */
function transferDuration(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : formatDuration(minutes);
}

function transferSub(t: Transfer): string {
  return [t.note, formatUsd(t.priceUsd), t.durationMinutes ? `about ${transferDuration(t.durationMinutes)}` : null].filter(Boolean).join(' · ');
}

/** "Taxi · CDG Terminal 1 → hotel"; a description that already names the service ("RER B · …") stands alone. */
function transferTitle(t: Transfer): string {
  return t.description.includes(' · ') ? t.description : `${TRANSFER_MODES[t.mode].label} · ${t.description}`;
}

/** Dashed box: "Taxi · CDG Terminal 1 → hotel / Fixed fare €56 · $61 · about 45 m". */
function TransferRow({ transfer, confirmed }: { transfer: Transfer; confirmed: boolean }) {
  const mode = TRANSFER_MODES[transfer.mode];
  const Icon = mode.icon;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-2.5">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          transfer.mode === 'taxi' ? 'bg-live-soft text-live-foreground' : 'bg-primary-soft text-primary',
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[15px] leading-5 font-semibold" title={transferTitle(transfer)}>
          {transferTitle(transfer)}
        </p>
        <p className="line-clamp-2 text-sm leading-5 text-ink-2" title={transferSub(transfer)}>
          {transferSub(transfer)}
        </p>
        {transfer.source === 'estimate' && <EstimateTag className="mt-1" />}
        {safeUrl(transfer.url) && <ExternalLink href={safeUrl(transfer.url)!}>Timetable and fares</ExternalLink>}
      </div>
      {confirmed && (
        <>
          <CheckIcon className="size-5 shrink-0 text-success" aria-hidden="true" />
          <span className="sr-only">Confirmed</span>
        </>
      )}
    </div>
  );
}

interface TransfersCardProps {
  transfers: Transfer[];
  /** Arrival transfers are on this itinerary day; the rest are on the way home. */
  firstDay: number;
  confirmed: boolean;
}

/** Every transfer of the trip, from the airport in and back out. */
export function TransfersCard({ transfers, firstDay, confirmed }: TransfersCardProps) {
  if (transfers.length === 0) return null;
  const groups = [
    { title: 'Arrival', items: transfers.filter((t) => t.day <= firstDay) },
    { title: 'Departure', items: transfers.filter((t) => t.day > firstDay) },
  ].filter((g) => g.items.length > 0);
  return (
    <Appear index={0}>
      <section aria-labelledby="transfers-title" className="flex flex-col gap-3 rounded-xl border bg-card px-6 pt-4 pb-[18px]">
        <header className="flex flex-wrap items-center gap-2">
          <CarIcon className="size-5 text-primary" aria-hidden="true" />
          <h2 id="transfers-title" className="text-xl font-semibold">
            Transfers
          </h2>
          <span className="ml-auto flex gap-2">{confirmed && <ConfirmedTag />}</span>
        </header>
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-2.5">
            <p className="label-mono text-muted-foreground">{g.title}</p>
            {g.items.map((t) => (
              <TransferRow key={`${t.day}-${t.description}`} transfer={t} confirmed={confirmed} />
            ))}
          </div>
        ))}
      </section>
    </Appear>
  );
}

function stopsWord(leg: FlightLeg): string {
  return leg.stops.length === 0 ? 'direct' : `${leg.stops.length} stop${leg.stops.length > 1 ? 's' : ''} · ${leg.stops.map((s) => s.airport.code).join(', ')}`;
}

interface FlightCardProps {
  flights: Flight[];
  transfers: Transfer[];
  /** Arrival transfers are on this itinerary day; the rest are on the way home. */
  firstDay: number;
  confirmed: boolean;
  confirmedTransfers: boolean;
  variant: 'live' | 'full';
}

export function SelectedFlightCard({ flights, transfers, firstDay, confirmed, confirmedTransfers, variant }: FlightCardProps) {
  const flight = flights[0];
  if (!flight) return null;
  const arrivalTransfers = transfers.filter((t) => t.day <= firstDay);
  const departureTransfers = transfers.filter((t) => t.day > firstDay);

  if (variant === 'live') {
    const first = arrivalTransfers[0];
    return (
      <Appear index={0}>
        <section aria-label="Selected flight" className="flex flex-col gap-3 rounded-xl border bg-card px-5 pt-5 pb-4 leading-5">
          <header className="flex flex-wrap items-center gap-2">
            <PlaneIcon className="size-4 text-primary" aria-hidden="true" />
            <h3 className="text-[15px] font-semibold">Selected Flight</h3>
            <span className="sr-only">{flight.airline}</span>
            <span className="ml-auto flex gap-2">
              {flight.source === 'mock' && <EstimateTag />}
              {confirmed && <ConfirmedTag />}
            </span>
          </header>
          <RouteStrip leg={flight.outbound} full={false} />
          <div className="mt-0.5 flex items-center gap-2 border-t pt-3 text-[15px] text-ink-2">
            {first ? (
              <>
                {(() => {
                  const Icon = TRANSFER_MODES[first.mode].icon;
                  return <Icon className="size-4 shrink-0" aria-hidden="true" />;
                })()}
                <span className="min-w-0 truncate">
                  {TRANSFER_MODES[first.mode].label} to hotel · {formatUsd(first.priceUsd)}
                  {first.durationMinutes ? ` · ~${transferDuration(first.durationMinutes)}` : ''}
                </span>
              </>
            ) : (
              <span>{stopsWord(flight.outbound)} · round trip</span>
            )}
            <span className="ml-auto font-mono text-[15px] font-semibold text-foreground">{formatUsd(flight.price)}</span>
          </div>
        </section>
      </Appear>
    );
  }

  return (
    <Appear index={0}>
      <section aria-labelledby="flight-title" className="flex h-full flex-col gap-3 rounded-xl border bg-card px-6 pt-4 pb-[18px]">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PlaneIcon className="size-5 text-primary" aria-hidden="true" />
          <h2 id="flight-title" className="text-xl font-semibold">
            Selected Flights
          </h2>
          <span className="ml-auto flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-2">
              {flight.airline} · {flight.return ? 'round trip' : 'one way'}
            </span>
            {flight.source === 'serpapi' && safeUrl(flight.bookingUrl) && (
              <ExternalLink href={safeUrl(flight.bookingUrl)!} source={sourceLabel(flight.source, 'Flights')}>
                View on Google Flights
              </ExternalLink>
            )}
            <span className="font-mono text-xl font-semibold">{formatUsd(flight.price)}</span>
            {flight.source === 'mock' && <EstimateTag />}
            {confirmed && <ConfirmedTag />}
          </span>
        </header>
        <div className="flex flex-col gap-2.5">
          <p className="label-mono text-muted-foreground">Outbound · {formatDay(flight.outbound.departure)}</p>
          <RouteStrip leg={flight.outbound} full />
          {arrivalTransfers.map((t) => (
            <TransferRow key={`${t.day}-${t.description}`} transfer={t} confirmed={confirmedTransfers} />
          ))}
        </div>
        {flight.return && (
          <div className="flex flex-col gap-2.5 border-t pt-3.5">
            <p className="label-mono text-muted-foreground">Return · {formatDay(flight.return.departure)}</p>
            {departureTransfers.map((t) => (
              <TransferRow key={`${t.day}-${t.description}`} transfer={t} confirmed={confirmedTransfers} />
            ))}
            <RouteStrip leg={flight.return} full />
          </div>
        )}
      </section>
    </Appear>
  );
}

interface HotelCardProps {
  hotels: Hotel[];
  durationDays: number;
  startDate: string | null;
  confirmed: boolean;
  variant: 'live' | 'full';
}

function Photo({ hotel, className }: { hotel: Hotel; className: string }) {
  if (hotel.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- remote hotel photos come from arbitrary hosts
    return <img src={hotel.photoUrl} alt="" className={cn('object-cover', className)} />;
  }
  return (
    <div className={cn('placeholder-hatch flex items-center justify-center', className)} aria-hidden="true">
      <span className="font-mono text-[13px] text-muted-foreground">Hotel photo</span>
    </div>
  );
}

export function SelectedHotelCard({ hotels, durationDays, startDate, confirmed, variant }: HotelCardProps) {
  const hotel = hotels[0];
  if (!hotel) return null;
  const nights = nightsFor(durationDays);
  const total = hotel.pricePerNight * nights;
  const priceLine = `${formatUsd(hotel.pricePerNight)} × ${nights} ${nights === 1 ? 'night' : 'nights'}`;

  if (variant === 'live') {
    return (
      <Appear index={1}>
        <section aria-label="Selected hotel" className="flex gap-4 rounded-xl border bg-card px-5 py-[17px]">
          <Photo hotel={hotel} className="size-[72px] shrink-0 rounded-lg [&_span]:hidden" />
          <div className="min-w-0 flex-1">
            <header className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold">Selected Hotel</h3>
              <span className="ml-auto flex gap-2">
                {hotel.source === 'mock' && <EstimateTag />}
                {confirmed && <ConfirmedTag />}
              </span>
            </header>
            <p className="mt-1 truncate text-sm">
              {hotel.name} · <span className="font-mono font-semibold">{hotel.rating.toFixed(1)}</span>
            </p>
            <p className="text-[13px] text-ink-2">
              {priceLine} = <span className="font-mono font-semibold text-foreground">{formatUsd(total)}</span>
            </p>
          </div>
        </section>
      </Appear>
    );
  }

  const checkOut = startDate ? addDays(startDate, nights) : null;
  const facts: [string, string][] = [];
  if (hotel.checkInTime || startDate) facts.push(['Check-in', [startDate && formatDay(startDate), hotel.checkInTime && `from ${hotel.checkInTime}`].filter(Boolean).join(' · ')]);
  if (hotel.checkOutTime || checkOut) facts.push(['Check-out', [checkOut && formatDay(checkOut), hotel.checkOutTime && `by ${hotel.checkOutTime}`].filter(Boolean).join(' · ')]);
  if (hotel.transit) facts.push(['Metro', hotel.transit]);

  return (
    <Appear index={1}>
      <section aria-labelledby="hotel-title" className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
        <Photo hotel={hotel} className="h-[150px] w-full" />
        <div className="flex flex-1 flex-col px-5 py-4">
          <header className="flex flex-wrap items-center gap-2">
            <BedDoubleIcon className="size-5" style={{ color: AGENT_AVATAR_COLORS.HotelAgent }} aria-hidden="true" />
            <h2 id="hotel-title" className="text-xl font-semibold whitespace-nowrap">
              Selected Hotel
            </h2>
            <span className="ml-auto flex gap-2">
              {hotel.source === 'mock' && <EstimateTag />}
              {confirmed && <ConfirmedTag />}
            </span>
          </header>
          <div className="mt-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[17px] font-semibold">{hotel.name}</p>
              {hotel.area && <p className="text-sm text-ink-2">{hotel.area}</p>}
            </div>
            <div className="shrink-0 text-right" aria-label={`Rated ${hotel.rating.toFixed(1)} out of 10, ${ratingWord(hotel.rating)}`}>
              <span className="inline-block rounded-lg bg-foreground px-2.5 py-1 font-mono text-[15px] font-semibold text-white">{hotel.rating.toFixed(1)}</span>
              <p className="mt-1 text-[13px] text-ink-2">{ratingWord(hotel.rating)}</p>
            </div>
          </div>
          {facts.length > 0 && (
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[15px] leading-[22px]">
              {facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-2">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {hotel.source === 'serpapi' && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {safeUrl(hotel.bookingUrl) && (
                <ExternalLink href={safeUrl(hotel.bookingUrl)!} source={sourceLabel(hotel.source, 'Hotels')}>
                  View on Google Hotels
                </ExternalLink>
              )}
              {hotel.location && <ExternalLink href={mapUrl(hotel.location, hotel.name)}>View on map</ExternalLink>}
            </div>
          )}
          <div className="mt-auto pt-4">
            <div className="flex items-baseline justify-between border-t pt-3.5">
              <span className="text-[15px] text-ink-2">{priceLine}</span>
              <span className="font-mono text-2xl font-semibold">{formatUsd(total)}</span>
            </div>
          </div>
        </div>
      </section>
    </Appear>
  );
}
