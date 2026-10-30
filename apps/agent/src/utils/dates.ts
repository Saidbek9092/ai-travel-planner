/** `isoDate` (YYYY-MM-DD) plus `days` calendar days, in UTC so DST never shifts the result. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD (UTC). */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** "2026-11-09" → "monday". */
export function weekdayOf(isoDate: string): Weekday {
  return WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()]!;
}

/** "HH:mm" of an airport-local ISO time ("2026-11-08T16:15:00") in minutes after midnight. */
export function minutesOf(iso: string): number {
  const [hours = 0, minutes = 0] = iso.slice(11, 16).split(':').map(Number);
  return hours * 60 + minutes;
}

/** 1110 → "18:30". Values past midnight wrap. */
export function clock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** Hotel nights for a trip of `durationDays` days: the last day is the departure day (at least one night). */
export function nightsFor(durationDays: number): number {
  return Math.max(1, durationDays - 1);
}
