import { describe, expect, it } from 'vitest';
import { formatDate, formatTime, formatUsd } from '@/lib/utils';

describe('formatUsd', () => {
  it.each([
    [1000, '$1,000'],
    [0, '$0'],
    [49.5, '$49.50'],
    [1234.567, '$1,234.57'],
  ])('%s → %s', (amount, expected) => {
    expect(formatUsd(amount)).toBe(expected);
  });
});

describe('formatTime', () => {
  it('formats as 24h HH:mm:ss in the given time zone', () => {
    expect(formatTime('2026-10-25T10:25:00Z', 'UTC')).toBe('10:25:00');
    expect(formatTime('2026-10-25T22:05:09Z', 'Asia/Tashkent')).toBe('03:05:09');
  });
});

describe('formatDate', () => {
  it('keeps date-only strings on the same calendar day in any time zone', () => {
    expect(formatDate('2026-11-20', { locale: 'en-US' })).toBe('Nov 20, 2026');
  });

  it('formats date-times in the given time zone', () => {
    expect(formatDate('2026-11-20T23:30:00Z', { locale: 'en-US', timeZone: 'Asia/Tashkent' })).toBe('Nov 21, 2026');
  });
});
