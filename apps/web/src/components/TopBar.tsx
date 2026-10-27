'use client';

import type { TripContext } from '@ai-travel/contracts';
import { BanknoteIcon, ClockIcon, MapPinIcon } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { TripContextStatus } from '@/hooks/useTripContext';
import { WEATHER_ICONS, formatRate, formatTemperature } from '@/lib/labels';
import { localTime } from '@/lib/time';
import { nightsFor } from '@/lib/utils';

interface TopBarProps {
  status: TripContextStatus;
  data: TripContext | null;
  startDate: string | null;
  durationDays: number | null;
  /** Departure city, named in the time-difference line. */
  origin: string | null;
}

function Chip({ icon, label, title, children }: { icon: ReactNode; label: string; title?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} title={title} className="flex min-w-0 items-start gap-2 rounded-lg border bg-card px-3 py-2">
      <span aria-hidden="true" className="mt-0.5 text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

const Sub = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

function dateRange(startDate: string, durationDays: number): string {
  const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const start = new Date(`${startDate}T00:00:00Z`);
  const nights = nightsFor(durationDays);
  const end = new Date(start.getTime() + nights * 86_400_000);
  return `${fmt.format(start)} – ${fmt.format(end)} · ${nights} ${nights === 1 ? 'night' : 'nights'}`;
}

/** Clock tick once a minute; `0` on the server so hydration matches. */
function subscribeToMinute(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
}
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

export function TopBar({ status, data, startDate, durationDays, origin }: TopBarProps) {
  const minute = useSyncExternalStore(subscribeToMinute, currentMinute, () => 0);
  const now = minute === 0 ? null : new Date(minute);

  if (status === 'loading') {
    return (
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading destination info">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }
  if (status !== 'ready' || !data) return null;

  const { weather, currency, exchangeRate, timeZone } = data;
  const local = timeZone && now ? localTime(timeZone, data.originTimeZone, origin, now) : null;
  const place = data.location.split(',')[0];
  const chips: ReactNode[] = [
    <Chip key="place" icon={<MapPinIcon className="size-4" />} label={`Destination: ${data.location}`}>
      <p className="truncate font-medium">{data.location}</p>
      {startDate && durationDays && <Sub>{dateRange(startDate, durationDays)}</Sub>}
    </Chip>,
  ];
  if (weather) {
    const Icon = WEATHER_ICONS[weather.icon] ?? WEATHER_ICONS.cloudy;
    chips.push(
      <Chip
        key="weather"
        icon={<Icon className="size-4" />}
        label={`Weather in ${place}: ${Math.round(weather.temperatureC)} degrees, ${weather.condition.toLowerCase()}`}
      >
        <p className="font-medium">
          {formatTemperature(weather.temperatureC)} · {weather.condition}
        </p>
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
        icon={<BanknoteIcon className="size-4" />}
        label={`Currency: ${currency.code}${exchangeRate ? `, ${formatRate(exchangeRate.rate, exchangeRate.quote)}` : ''}`}
        title={exchangeRate ? `Updated ${new Date(exchangeRate.asOf).toLocaleString()}` : undefined}
      >
        <p className="font-medium">
          {currency.code}
          {currency.symbol && ` (${currency.symbol})`}
        </p>
        {exchangeRate && <Sub>{formatRate(exchangeRate.rate, exchangeRate.quote)}</Sub>}
      </Chip>,
    );
  }
  if (local) {
    chips.push(
      <Chip key="time" icon={<ClockIcon className="size-4" />} label={`Local time in ${place}: ${local.time}`}>
        <p className="font-medium">
          {local.time} · {place} ({local.offset})
        </p>
        {local.difference && <Sub>{local.difference}</Sub>}
      </Chip>,
    );
  }
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{chips}</div>;
}
