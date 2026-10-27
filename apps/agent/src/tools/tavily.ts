import { z } from 'zod';

const ENDPOINT = 'https://api.tavily.com/search';
const TIMEOUT_MS = 8_000;

const ResponseSchema = z.looseObject({ results: z.array(z.looseObject({ title: z.string() })) });

/** Top attractions for the Planner's prompts. Optional context: any failure gives an empty list, never an error. */
export async function topAttractions(destination: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: `top tourist attractions in ${destination}`, max_results: 8 }),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(TIMEOUT_MS)]),
    });
    if (!response.ok) return [];
    const parsed = ResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.results.map((result) => result.title) : [];
  } catch {
    return [];
  }
}
