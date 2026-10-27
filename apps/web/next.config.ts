import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

/**
 * Local dev derives the agent URL from the Conductor port block (web = CONDUCTOR_PORT, agent = +1).
 * Deployed builds get no default: without NEXT_PUBLIC_AGENT_URL the app runs in UI-only mode.
 */
export default function nextConfig(phase: string): NextConfig {
  const agentPort = process.env.CONDUCTOR_PORT ? Number(process.env.CONDUCTOR_PORT) + 1 : 4000;
  const devDefault = phase === PHASE_DEVELOPMENT_SERVER ? `http://localhost:${agentPort}` : undefined;
  const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL ?? devDefault;

  return {
    cacheComponents: true,
    partialPrefetching: true,
    env: agentUrl ? { NEXT_PUBLIC_AGENT_URL: agentUrl } : {},
    turbopack: {
      rules: {
        '*.css': {
          loaders: ['@tailwindcss/turbopack'],
          as: '*.css',
        },
      },
    },
  };
}
