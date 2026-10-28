/**
 * Preview parser for the start page. It only guesses what the Supervisor will read from the same sentence;
 * after submit, the Supervisor's parse is the source of truth.
 */
export interface ParsedTrip {
  destination: string | null;
  origin: string | null;
  durationDays: number | null;
  budget: number | null;
  /** 0-based month index, or `null`. */
  month: number | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const PLACE = String.raw`([\p{L}][\p{L}'.\- ]*?)(?=\s+(?:from|for|with|in|on|under|budget|during|around|at|to)\b|[,.;$\d]|$)`;
const DESTINATION = new RegExp(String.raw`\b(?:in|to)\s+${PLACE}`, 'iu');
const ORIGIN = new RegExp(String.raw`\bfrom\s+${PLACE}`, 'iu');
const MONTH = new RegExp(String.raw`\b(${MONTHS.map((m) => `${m}[a-z]*`).join('|')})\b`, 'i');

const isMonth = (word: string) => MONTHS.some((m) => word.toLowerCase().startsWith(m) && MONTH.test(word));

function titleCase(place: string): string {
  return place
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function place(text: string, pattern: RegExp): string | null {
  for (const match of text.matchAll(new RegExp(pattern.source, 'giu'))) {
    const value = match[1]?.trim();
    if (value && value.length >= 2 && !isMonth(value)) return titleCase(value);
  }
  return null;
}

function parseBudget(text: string): number | null {
  const match =
    /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?/i.exec(text) ??
    /\b(\d[\d,]*(?:\.\d+)?)\s?(k\b)?\s?(?:usd|dollars?|bucks)\b/i.exec(text) ??
    /\bbudget\s+(?:of\s+)?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?/i.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, '')) * (match[2] ? 1000 : 1);
  return value > 0 && Number.isFinite(value) ? value : null;
}

function parseDays(text: string): number | null {
  const explicit = /\b(\d{1,2})\s*-?\s*(day|night|week)s?\b/i.exec(text);
  if (explicit?.[1] && explicit[2]) {
    const n = Number(explicit[1]);
    return explicit[2].toLowerCase() === 'week' ? n * 7 : n;
  }
  if (/\bweekend\b/i.test(text)) return 2;
  if (/\b(?:a|one)\s+week\b/i.test(text)) return 7;
  return null;
}

export function parseTrip(text: string): ParsedTrip {
  const month = MONTH.exec(text)?.[1];
  return {
    destination: place(text, DESTINATION),
    origin: place(text, ORIGIN),
    durationDays: parseDays(text),
    budget: parseBudget(text),
    month: month ? MONTHS.findIndex((m) => month.toLowerCase().startsWith(m)) : null,
  };
}

/** First day of the next occurrence of `month` (today's date when it is the current month), as YYYY-MM-DD. */
export function startDateForMonth(month: number, today = new Date()): string {
  const year = month < today.getMonth() ? today.getFullYear() + 1 : today.getFullYear();
  if (month === today.getMonth()) return today.toISOString().slice(0, 10);
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}
