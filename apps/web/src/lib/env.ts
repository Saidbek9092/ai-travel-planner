import { z } from 'zod';

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_AGENT_URL: optional(z.url({ protocol: /^https?$/ })),
  NEXT_PUBLIC_MAPBOX_TOKEN: optional(z.string().trim().min(1)),
  NEXT_PUBLIC_SHOW_TECH_LOG: optional(z.enum(['true', 'false'])),
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: optional(z.string().trim().min(1)),
});

export interface PublicEnv {
  /** Agent base URL without a trailing slash; `null` means UI-only mode. */
  agentUrl: string | null;
  /** Public Mapbox token; `null` means the map renders a placeholder. */
  mapboxToken: string | null;
  /** Shows the "Technical log" toggle and panel; off unless explicitly `true`. */
  showTechLog: boolean;
  /** Google OAuth web client id; `null` hides "Sign in with Google" (everyone is a guest). */
  googleClientId: string | null;
}

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const result = PublicEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid public environment variables:\n${z.prettifyError(result.error)}`);
  }
  return {
    agentUrl: result.data.NEXT_PUBLIC_AGENT_URL?.replace(/\/+$/, '') ?? null,
    mapboxToken: result.data.NEXT_PUBLIC_MAPBOX_TOKEN ?? null,
    showTechLog: result.data.NEXT_PUBLIC_SHOW_TECH_LOG === 'true',
    googleClientId: result.data.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null,
  };
}

// Each variable is referenced literally so Next.js can inline it into the client bundle.
export const env: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_AGENT_URL: process.env.NEXT_PUBLIC_AGENT_URL,
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  NEXT_PUBLIC_SHOW_TECH_LOG: process.env.NEXT_PUBLIC_SHOW_TECH_LOG,
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
});
