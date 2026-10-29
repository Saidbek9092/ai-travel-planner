import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const DEFAULT_AGENT_PORT = 4000;
const DEFAULT_WEB_PORT = 3000;

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();
const secret = z.string().min(1);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: port.optional(),
    CONDUCTOR_PORT: port.optional(),
    WEB_ORIGIN: z.string().optional(),

    ANTHROPIC_API_KEY: secret,
    ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5-5'),
    ANTHROPIC_FALLBACK_MODEL: z.string().min(1).default('claude-sonnet-5-5'),

    SERPAPI_API_KEY: secret.optional(),
    TAVILY_API_KEY: secret.optional(),
    TOOLS_MODE: z.enum(['auto', 'live', 'mock']).default('auto'),
    /** How long a flight or hotel search is reused (re-plans and repeat searches). */
    SEARCH_CACHE_TTL_MS: positiveInt.default(1_800_000),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

    RUN_TIMEOUT_MS: positiveInt.default(120_000),
    RUN_REPLAY_TTL_MS: positiveInt.default(600_000),
    RUN_REPLAY_MAX_EVENTS: positiveInt.default(500),
    RATE_LIMIT_WINDOW_MS: positiveInt.default(900_000),
    RATE_LIMIT_MAX_RUNS: positiveInt.default(10),

    LANGSMITH_TRACING: z.stringbool().default(false),
    LANGSMITH_API_KEY: secret.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.WEB_ORIGIN === undefined) {
      ctx.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'Required in production' });
    }
    if (env.NODE_ENV === 'production' && env.DATABASE_URL === undefined) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Required in production: resuming a run depends on the Postgres checkpointer' });
    }
    if (env.TOOLS_MODE === 'live' && env.SERPAPI_API_KEY === undefined) {
      ctx.addIssue({ code: 'custom', path: ['SERPAPI_API_KEY'], message: 'Required when TOOLS_MODE=live' });
    }
    if (env.LANGSMITH_TRACING && env.LANGSMITH_API_KEY === undefined) {
      ctx.addIssue({ code: 'custom', path: ['LANGSMITH_API_KEY'], message: 'Required when LANGSMITH_TRACING=true' });
    }
  })
  .transform(({ PORT, CONDUCTOR_PORT, WEB_ORIGIN, ...rest }, ctx) => {
    const origins = (WEB_ORIGIN ?? `http://localhost:${CONDUCTOR_PORT ?? DEFAULT_WEB_PORT}`)
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map(toOrigin);

    if (origins.length === 0 || origins.includes(null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'Must be a comma-separated list of http(s) origins',
      });
      return z.NEVER;
    }

    return {
      ...rest,
      PORT: PORT ?? (CONDUCTOR_PORT === undefined ? DEFAULT_AGENT_PORT : CONDUCTOR_PORT + 1),
      CONDUCTOR_PORT,
      WEB_ORIGIN: origins.filter((origin) => origin !== null),
    };
  });

export type Config = z.output<typeof EnvSchema>;

/** Normalises `https://app.example.com/` to `https://app.example.com` (what browsers send in `Origin`). */
function toOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Pure parser: blank values (`KEY=` in `.env`) count as unset. Throws `ZodError` on invalid input. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  return EnvSchema.parse(present);
}

/**
 * Loads `.env`, validates `process.env` and exits on failure. Call once at boot and pass the
 * result down — this is the only place in the agent that reads `process.env`.
 */
export function loadConfig(): Config {
  loadDotenv({ quiet: true });
  try {
    return parseConfig(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`Invalid environment configuration:\n${z.prettifyError(error)}`);
      process.exit(1);
    }
    throw error;
  }
}
