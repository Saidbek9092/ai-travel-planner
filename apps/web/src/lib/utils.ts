export { cn } from 'cn';

const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `1000` → `$1,000`, `49.5` → `$49.50`. The only way money is rendered in this app. */
export function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? usdWhole.format(amount) : usdCents.format(amount);
}

/** Terminal timestamp, always `HH:mm:ss` (24h) in the viewer's time zone unless one is given. */
export function formatTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `2026-11-20` → `Nov 20, 2026` (in the viewer's locale unless one is given).
 * Date-only strings are calendar dates, so they are formatted in UTC to avoid shifting a day.
 */
export function formatDate(iso: string, options: { locale?: string; timeZone?: string } = {}): string {
  const timeZone = options.timeZone ?? (DATE_ONLY.test(iso) ? 'UTC' : undefined);
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

/** `2026-11-12T06:40:00+05:00` → `06:40`: the clock time in the timestamp's own offset. */
export function formatLegTime(iso: string): string {
  return iso.slice(11, 16);
}

/** Whole days between the calendar dates of two ISO timestamps (ignoring offsets). */
export function dayDifference(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} m` : ''].filter(Boolean).join(' ') || '0 m';
}

/** Hotel nights for a trip of `durationDays` days: the last day is the departure day (matches the agent). */
export function nightsFor(durationDays: number): number {
  return Math.max(1, durationDays - 1);
}
