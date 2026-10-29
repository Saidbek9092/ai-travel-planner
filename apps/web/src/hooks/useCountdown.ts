import { useNow } from '@/hooks/useNow';

/** Whole seconds left until `until` (epoch ms); `0` once it has passed or when `until` is `null`. */
export function useCountdown(until: number | null): number {
  const now = useNow(1000, until !== null);
  if (until === null || now === 0) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** `42` → `0:42` */
export function formatCountdown(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  // The daily run cap can mean hours: "21:04:09" rather than "1264:09".
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}
