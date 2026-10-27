import { ResultPayloadSchema, type ResultPayload } from '@ai-travel/contracts';
import { env } from '@/lib/env';

/** `GET /api/trips/:id` for a deep link. `null` on any failure, so a bad link just opens an empty dashboard. */
export async function fetchTripResult(threadId: string): Promise<ResultPayload | null> {
  if (env.agentUrl === null) return null;
  try {
    const response = await fetch(`${env.agentUrl}/api/trips/${encodeURIComponent(threadId)}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const parsed = ResultPayloadSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
