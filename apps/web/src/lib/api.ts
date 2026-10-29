import {
  parseStoredResult,
  TripListResponseSchema,
  TripRecordSchema,
  type MessagePayload,
  type ResultPayload,
  type TripSummary,
} from '@ai-travel/contracts';
import { env } from '@/lib/env';
import { ownerHeaders } from '@/lib/owner';

export interface StoredTrip {
  result: ResultPayload;
  /** The chat of the run, oldest first; empty when the agent has none. */
  messages: MessagePayload[];
}

/**
 * A trip by id for a deep link: the stored record (result + chat), else the plain result from an older agent.
 * Both go through the contracts' stored-result migration. An unfinished trip comes back as a `failed` result.
 * `'not-found'`: the agent has no such trip (both lookups `404`). `null`: no answer (UI-only, offline, error, bad body).
 */
export async function fetchStoredTrip(threadId: string): Promise<StoredTrip | 'not-found' | null> {
  if (env.agentUrl === null) return null;
  const base = `${env.agentUrl}/api/trips/${encodeURIComponent(threadId)}`;
  try {
    const record = await fetch(`${base}/record`, { cache: 'no-store' });
    if (record.ok) {
      const parsed = TripRecordSchema.safeParse(await record.json());
      if (parsed.success) return { result: parsed.data.result, messages: parsed.data.messages };
    }
    if (record.status !== 404) return null;
    const plain = await fetch(base, { cache: 'no-store' });
    if (plain.status === 404) return 'not-found';
    if (!plain.ok) return null;
    const result = parseStoredResult(await plain.json());
    return result ? { result, messages: [] } : null;
  } catch {
    return null;
  }
}

/** "My trips" for this browser's owner id, newest first; `null` when the agent cannot be asked (UI-only, offline, error). Browser only. */
export async function fetchMyTrips(signal?: AbortSignal): Promise<TripSummary[] | null> {
  if (env.agentUrl === null) return null;
  try {
    const response = await fetch(`${env.agentUrl}/api/trips`, { headers: ownerHeaders(), cache: 'no-store', ...(signal && { signal }) });
    if (!response.ok) return null;
    const parsed = TripListResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.trips : null;
  } catch {
    return null;
  }
}
