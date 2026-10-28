import { useNow } from '@/hooks/useNow';

/** Whole seconds left until `until` (epoch ms); `0` once it has passed or when `until` is `null`. */
export function useCountdown(until: number | null): number {
  const now = useNow(1000, until !== null);
  if (until === null || now === 0) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** `42` → `0:42` */
export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
