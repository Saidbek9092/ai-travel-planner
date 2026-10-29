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
    private readonly maxEntries = 500,
  ) {}

  async remember(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const value = await load();
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    this.prune();
    return value;
  }

  /** Drops expired entries, then the oldest ones, so the cache cannot grow without bound. */
  private prune(): void {
    if (this.entries.size <= this.maxEntries) return;
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}

/** Cache key for a place name: trimmed, lower-cased, spaces collapsed. */
export const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
