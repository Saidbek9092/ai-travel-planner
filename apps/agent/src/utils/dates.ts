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
