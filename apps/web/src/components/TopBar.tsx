'use client';

import type { TripContext } from '@ai-travel/contracts';
import { ClockIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/hooks/useNow';
import type { TripContextStatus } from '@/hooks/useTripContext';
import { WEATHER_ICONS, formatRate, formatTemperature } from '@/lib/labels';
import { localTime } from '@/lib/time';
import { addDays, cn, formatDay, nightsFor } from '@/lib/utils';

interface TopBarProps {
  status: TripContextStatus;
  data: TripContext | null;
  startDate: string | null;
  durationDays: number | null;
  /** Departure city, named in the time-difference line. */
  origin: string | null;
}

/** One column of the band: mono caps label, a large value line and a muted second line. */
function Chip({ icon, label, title, heading, children }: { icon?: ReactNode; label: string; title?: string; heading: ReactNode; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      title={title}
      className="flex min-w-0 items-center gap-4 py-4 sm:px-8 sm:first:pl-0 lg:border-l lg:border-white/15 lg:first:border-l-0"
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 text-white">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="label-mono flex items-center gap-2 text-white/60">{heading}</p>
        {children}
      </div>
    </div>
  );
}

const Big = ({ children }: { children: ReactNode }) => (
  <p className="mt-1 truncate text-[22px] leading-7 font-semibold tracking-tight text-white sm:text-[26px] sm:leading-8">{children}</p>
);
const Small = ({ children }: { children: ReactNode }) => <span className="ml-1.5 text-base font-normal tracking-normal">{children}</span>;
const Sub = ({ children, mono }: { children: ReactNode; mono?: boolean }) => (
  <p className={cn('mt-0.5 truncate text-[13px] leading-[18px] text-white/75', mono && 'font-mono')}>{children}</p>
);

function dateRange(startDate: string, durationDays: number): string {
  const nights = nightsFor(durationDays);
  const end = addDays(startDate, nights);
  return `${formatDay(startDate, 'short')} – ${formatDay(end)} · ${nights} ${nights === 1 ? 'night' : 'nights'}`;
}

/** The destination band under the header: place, weather, currency and local time. Each chip shows only with data. */
export function TopBar({ status, data, startDate, durationDays, origin }: TopBarProps) {
  const minute = useNow(60_000, status === 'ready');
  const now = minute === 0 ? null : new Date(minute);

  if (status === 'loading') {
    return (
      <div className="bg-foreground" aria-busy="true" aria-label="Loading destination info">
        <div className="mx-auto grid w-full max-w-[1360px] gap-4 px-4 py-5 sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:px-8">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg bg-white/10" />
          ))}
        </div>
      </div>
    );
  }
  if (status !== 'ready' || !data) return null;

  const { weather, currency, exchangeRate, timeZone } = data;
  const local = timeZone && now ? localTime(timeZone, data.originTimeZone, origin, now) : null;
  const place = data.location.split(',')[0];
  const chips: ReactNode[] = [
    <Chip
      key="place"
      label={`Destination: ${data.location}`}
      heading={
        <>
          <span className="size-1.5 rounded-full bg-live" aria-hidden="true" /> Destination{data.source === 'live' ? ' · Live' : ' · Estimate'}
        </>
      }
    >
      <Big>{data.location}</Big>
      {startDate && durationDays ? <Sub>{dateRange(startDate, durationDays)}</Sub> : null}
    </Chip>,
  ];
  if (weather) {
    const Icon = WEATHER_ICONS[weather.icon] ?? WEATHER_ICONS.cloudy;
    chips.push(
      <Chip
        key="weather"
        icon={<Icon className="size-9 text-live" strokeWidth={1.5} />}
        label={`Weather in ${place}: ${Math.round(weather.temperatureC)} degrees, ${weather.condition.toLowerCase()}`}
        heading="Weather"
      >
        <Big>
          {formatTemperature(weather.temperatureC)}
          <Small>{weather.condition}</Small>
        </Big>
        <Sub>
          Today {Math.round(weather.todayLowC)}–{formatTemperature(weather.todayHighC)}
          {weather.outlook && ` · ${weather.outlook}`}
        </Sub>
      </Chip>,
    );
  }
  if (currency) {
    chips.push(
      <Chip
        key="currency"
        icon={
          <span className="flex size-9 items-center justify-center rounded-full border-2 border-white text-base font-semibold">
            {currency.symbol ?? currency.code.slice(0, 1)}
          </span>
        }
        label={`Currency: ${currency.code}${exchangeRate ? `, ${formatRate(exchangeRate.rate, exchangeRate.quote)}` : ''}`}
        title={exchangeRate ? `Updated ${new Date(exchangeRate.asOf).toLocaleString()}` : undefined}
        heading="Currency"
      >
        <Big>
          {currency.code}
          {currency.symbol && ` (${currency.symbol})`}
        </Big>
        {exchangeRate && <Sub mono>{formatRate(exchangeRate.rate, exchangeRate.quote)}</Sub>}
      </Chip>,
    );
  }
  if (local) {
    chips.push(
      <Chip key="time" icon={<ClockIcon className="size-9" strokeWidth={1.5} />} label={`Local time in ${place}: ${local.time}`} heading="Local time">
        <Big>
          <span className="font-mono">{local.time}</span>
          <Small>
            {place} ({local.offset})
          </Small>
        </Big>
        {local.difference && <Sub>{local.difference}</Sub>}
      </Chip>,
    );
  }
  return (
    <section aria-label="Destination" className="bg-foreground">
      <div className="mx-auto grid w-full max-w-[1360px] px-4 py-[5px] sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:px-8">{chips}</div>
    </section>
  );
}
