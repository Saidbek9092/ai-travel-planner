import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from '@/lib/env';

describe('parsePublicEnv', () => {
  it('returns nulls when nothing is set (UI-only mode, map placeholder)', () => {
    expect(parsePublicEnv({})).toEqual({ agentUrl: null, mapboxToken: null });
  });

  it('treats empty strings as unset', () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_AGENT_URL: '', NEXT_PUBLIC_MAPBOX_TOKEN: '' })).toEqual({
      agentUrl: null,
      mapboxToken: null,
    });
  });

  it('strips trailing slashes from the agent URL', () => {
    expect(
      parsePublicEnv({ NEXT_PUBLIC_AGENT_URL: 'https://ai-travel-agent.onrender.com/', NEXT_PUBLIC_MAPBOX_TOKEN: 'pk.abc' }),
    ).toEqual({ agentUrl: 'https://ai-travel-agent.onrender.com', mapboxToken: 'pk.abc' });
  });

  it.each(['not a url', 'ftp://example.com', 'javascript:alert(1)'])('rejects agent URL %s', (url) => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_AGENT_URL: url })).toThrow(/NEXT_PUBLIC_AGENT_URL/);
  });
});
