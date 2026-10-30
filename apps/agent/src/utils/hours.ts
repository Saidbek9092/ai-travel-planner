/** Opening hours as Google Maps writes them ("9 AM–6 PM", "11 AM–2:30 PM, 6–10:30 PM", "Open 24 hours", "Closed"). */

/** Minutes after midnight; `close` goes past 1440 when a place closes after midnight. */
export interface OpenInterval {
  open: number;
  close: number;
}

const TIME = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i;

/** Drops notes such as "(All Saints' Day might affect these hours)" and the narrow spaces Google puts before AM/PM. */
export function cleanHours(text: string): string {
  return text
    .replace(/\([^)]*\)/g, '')
    .replace(/[\u202f\u00a0\u2009]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toMinutes(token: string, meridiem: string | undefined): number | null {
  const match = token.trim().match(TIME);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const half = (match[3] ?? meridiem)?.toUpperCase();
  if (hours > 24 || minutes > 59) return null;
  if (half === 'PM' && hours < 12) hours += 12;
  if (half === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** Intervals for one day; `[]` = closed that day; `null` = a format we cannot read (the caller then trusts the place). */
export function parseHours(text: string): OpenInterval[] | null {
  const value = cleanHours(text);
  if (/^closed$/i.test(value)) return [];
  if (/open 24 hours/i.test(value)) return [{ open: 0, close: 1440 }];

  const intervals: OpenInterval[] = [];
  for (const range of value.split(',')) {
    const [from, to, extra] = range.split(/\s*[–-]\s*/);
    if (!from || !to || extra !== undefined) return null;
    const closeHalf = to.trim().match(TIME)?.[3];
    let open = toMinutes(from, closeHalf);
    let close = toMinutes(to, undefined);
    if (open === null || close === null) return null;
    // "11–2 PM" means 11 AM: an inherited meridiem that puts opening after closing was the wrong half of the day.
    if (!from.trim().match(TIME)?.[3] && closeHalf && open > close) open -= 12 * 60;
    if (close <= open) close += 1440;
    intervals.push({ open, close });
  }
  return intervals.length > 0 ? intervals : null;
}
