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
