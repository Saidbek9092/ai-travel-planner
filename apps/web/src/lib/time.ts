const hourMinute = (timeZone: string, now: Date) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(now);

/** Offset of a zone from UTC in minutes at `now` (DST-aware, via `Intl`). */
function offsetMinutes(timeZone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(now.getTime() / 60_000) * 60_000) / 60_000);
}

function isValidZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface LocalTime {
  /** `16:30` */
  time: string;
  /** `GMT+1` */
  offset: string;
  /** "4 hrs behind Tashkent · 20:30 there"; `null` without a valid origin zone or when the zones match. */
  difference: string | null;
}

/** Local time at the destination and its difference to the origin. `null` for an unknown zone. */
export function localTime(timeZone: string, originTimeZone: string | null, originName: string | null, now: Date): LocalTime | null {
  if (!isValidZone(timeZone)) return null;
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short', hour: 'numeric' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  let difference: string | null = null;
  if (originTimeZone && isValidZone(originTimeZone)) {
    const diffMinutes = offsetMinutes(timeZone, now) - offsetMinutes(originTimeZone, now);
    if (diffMinutes !== 0) {
      const hours = Math.abs(diffMinutes) / 60;
      const amount = `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? 'hr' : 'hrs'}`;
      const where = originName ?? 'home';
      difference = `${amount} ${diffMinutes < 0 ? 'behind' : 'ahead of'} ${where} · ${hourMinute(originTimeZone, now)} there`;
    }
  }
  return { time: hourMinute(timeZone, now), offset, difference };
}
