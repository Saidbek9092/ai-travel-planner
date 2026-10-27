interface Entry<T> {
  value: T;
  expiresAt: number;
}

/** Tiny in-process cache. `remember` caches only successful results, so a failed lookup is retried next time. */
export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async remember(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const value = await load();
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }
}

/** Cache key for a place name: trimmed, lower-cased, spaces collapsed. */
export const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
