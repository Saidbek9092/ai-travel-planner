'use client';

import type { Flight, FlightLeg, Hotel, Transfer } from '@ai-travel/contracts';
import { motion, useReducedMotion } from 'motion/react';
import { CheckIcon, HotelIcon, PlaneIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ratingWord } from '@/lib/labels';
import { cn, dayDifference, formatDuration, formatLegTime, formatUsd } from '@/lib/utils';

function EstimateBadge() {
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" />}>Estimate</TooltipTrigger>
      <TooltipContent>Live prices were unavailable</TooltipContent>
    </Tooltip>
  );
}

function SelectedBadge() {
  return (
    <Badge>
      <CheckIcon aria-hidden="true" /> Selected
    </Badge>
  );
}

function stopsLabel(leg: FlightLeg): string {
  if (leg.stops.length === 0) return 'Direct';
  const codes = leg.stops.map((s) => s.airport.code).join(', ');
  return `${leg.stops.length} stop${leg.stops.length > 1 ? 's' : ''} · ${codes}`;
}

function LegStrip({ leg, label }: { leg: FlightLeg; label: string }) {
  const nextDay = dayDifference(leg.departure, leg.arrival);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground uppercase">{label}</span>
      <p className="font-mono">
        <span title={leg.from.name}>{leg.from.code}</span> {formatLegTime(leg.departure)}
        {leg.stops.map((stop) => (
          <span key={stop.airport.code} className="text-muted-foreground">
            {' — '}
            <span title={stop.airport.name}>{stop.airport.code}</span> {formatDuration(stop.layoverMinutes)} layover
          </span>
        ))}
        {' — '}
        <span title={leg.to.name}>{leg.to.code}</span> {formatLegTime(leg.arrival)}
        {nextDay > 0 && <span className="text-muted-foreground"> +{nextDay} day</span>}
        {leg.terminal && <span className="text-muted-foreground"> · T{leg.terminal}</span>}
      </p>
      <p className="text-xs text-muted-foreground">{stopsLabel(leg)}</p>
    </div>
  );
}

function FlightCard({ flight, selected, transfers }: { flight: Flight; selected: boolean; transfers: Transfer[] }) {
  return (
    <Card className={cn(selected && 'ring-2 ring-primary')}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <PlaneIcon className="size-4" aria-hidden="true" />
          {flight.airline}
          <span className="text-xs font-normal text-muted-foreground">round trip</span>
          {selected && <SelectedBadge />}
          {flight.source === 'mock' && <EstimateBadge />}
          <span className="ml-auto font-mono">{formatUsd(flight.price)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <LegStrip leg={flight.outbound} label="Outbound" />
        {flight.return && <LegStrip leg={flight.return} label="Return" />}
        {selected && transfers.length > 0 && (
          <ul className="flex flex-col gap-1 border-t pt-3 text-sm">
            {transfers.map((t) => (
              <li key={`${t.day}-${t.description}`}>
                <span className="capitalize">{t.mode}</span> · {t.description} · {formatUsd(t.priceUsd)}
                {t.durationMinutes && <span className="text-muted-foreground"> · about {formatDuration(t.durationMinutes)}</span>}
                {t.note && <span className="text-muted-foreground"> · {t.note}</span>}
              </li>
            ))}
          </ul>
        )}
        {flight.bookingUrl && (
          <a href={flight.bookingUrl} target="_blank" rel="noreferrer" className="text-sm text-primary underline-offset-4 hover:underline">
            View fare
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function HotelCard({ hotel, selected, durationDays }: { hotel: Hotel; selected: boolean; durationDays: number }) {
  const total = hotel.pricePerNight * durationDays;
  return (
    <Card className={cn(selected && 'ring-2 ring-primary')}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <HotelIcon className="size-4" aria-hidden="true" />
          {hotel.name}
          {selected && <SelectedBadge />}
          {hotel.source === 'mock' && <EstimateBadge />}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote hotel photos come from arbitrary hosts */}
        {hotel.photoUrl && <img src={hotel.photoUrl} alt="" className="h-32 w-full rounded-lg object-cover" />}
        {hotel.area && <p className="text-muted-foreground">{hotel.area}</p>}
        <p>
          <span className="font-mono font-semibold">{hotel.rating.toFixed(1)}</span> / 10 · {ratingWord(hotel.rating)}
        </p>
        {(hotel.checkInTime || hotel.checkOutTime) && (
          <p className="text-muted-foreground">
            {hotel.checkInTime && `Check-in ${hotel.checkInTime}`}
            {hotel.checkInTime && hotel.checkOutTime && ' · '}
            {hotel.checkOutTime && `Check-out ${hotel.checkOutTime}`}
          </p>
        )}
        {hotel.transit && <p className="text-muted-foreground">{hotel.transit}</p>}
        <p className="font-mono">
          {formatUsd(hotel.pricePerNight)} × {durationDays} night{durationDays === 1 ? '' : 's'} = {formatUsd(total)}
        </p>
        {hotel.bookingUrl && (
          <a href={hotel.bookingUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
            View rooms
          </a>
        )}
      </CardContent>
    </Card>
  );
}

interface FlightHotelCardsProps {
  flights: Flight[];
  hotels: Hotel[];
  transfers: Transfer[];
  durationDays: number;
}

export function FlightHotelCards({ flights, hotels, transfers, durationDays }: FlightHotelCardsProps) {
  const reduceMotion = useReducedMotion();
  const item = (i: number) => ({
    initial: reduceMotion ? false : ({ opacity: 0, y: 8 } as const),
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.2, delay: reduceMotion ? 0 : i * 0.05 },
  });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-label="Flights" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Flights</h3>
        {flights.map((flight, i) => (
          <motion.div key={`${flight.airline}-${flight.price}-${i}`} {...item(i)}>
            <FlightCard flight={flight} selected={i === 0} transfers={transfers} />
          </motion.div>
        ))}
      </section>
      <section aria-label="Hotels" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Hotels</h3>
        {hotels.map((hotel, i) => (
          <motion.div key={`${hotel.name}-${i}`} {...item(i)}>
            <HotelCard hotel={hotel} selected={i === 0} durationDays={durationDays} />
          </motion.div>
        ))}
      </section>
    </div>
  );
}
