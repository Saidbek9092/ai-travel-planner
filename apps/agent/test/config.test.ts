import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseConfig } from '../src/config.js';

const base = { ANTHROPIC_API_KEY: 'sk-ant-test' };

describe('parseConfig', () => {
  it('applies defaults', () => {
    const config = parseConfig(base);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      WEB_ORIGIN: ['http://localhost:3000'],
      ANTHROPIC_MODEL: 'claude-opus-5-5',
      ANTHROPIC_FALLBACK_MODEL: 'claude-sonnet-5-5',
      TOOLS_MODE: 'auto',
      RUN_TIMEOUT_MS: 120_000,
      RATE_LIMIT_WINDOW_MS: 900_000,
      RATE_LIMIT_MAX_RUNS: 10,
      LANGSMITH_TRACING: false,
    });
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.SERPAPI_API_KEY).toBeUndefined();
  });

  it('derives ports and the web origin from CONDUCTOR_PORT', () => {
    const config = parseConfig({ ...base, CONDUCTOR_PORT: '55100' });
    expect(config.PORT).toBe(55101);
    expect(config.WEB_ORIGIN).toEqual(['http://localhost:55100']);
  });

  it('lets an explicit PORT win over CONDUCTOR_PORT', () => {
    expect(parseConfig({ ...base, CONDUCTOR_PORT: '55100', PORT: '8080' }).PORT).toBe(8080);
  });

  it('parses and normalises a comma-separated WEB_ORIGIN list', () => {
    const config = parseConfig({
      ...base,
      WEB_ORIGIN: 'https://travel.example.com/, https://preview.example.com ,',
    });
    expect(config.WEB_ORIGIN).toEqual(['https://travel.example.com', 'https://preview.example.com']);
  });

  it.each(['not a url', 'ftp://example.com', ','])('rejects WEB_ORIGIN=%j', (WEB_ORIGIN) => {
    expect(() => parseConfig({ ...base, WEB_ORIGIN })).toThrow(ZodError);
  });

  it('requires WEB_ORIGIN in production', () => {
    expect(() => parseConfig({ ...base, NODE_ENV: 'production' })).toThrow(/WEB_ORIGIN/);
    expect(
      parseConfig({ ...base, NODE_ENV: 'production', WEB_ORIGIN: 'https://travel.example.com' }).WEB_ORIGIN,
    ).toEqual(['https://travel.example.com']);
  });

  it('requires ANTHROPIC_API_KEY and treats a blank value as missing', () => {
    expect(() => parseConfig({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parseConfig({ ANTHROPIC_API_KEY: '  ' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('treats blank optional values as unset', () => {
    const config = parseConfig({ ...base, SERPAPI_API_KEY: '', DATABASE_URL: '', PORT: '' });
    expect(config.SERPAPI_API_KEY).toBeUndefined();
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.PORT).toBe(4000);
  });

  it('coerces numbers and booleans', () => {
    const config = parseConfig({
      ...base,
      RUN_TIMEOUT_MS: '5000',
      RATE_LIMIT_MAX_RUNS: '3',
      LANGSMITH_TRACING: 'true',
      LANGSMITH_API_KEY: 'ls-test',
    });
    expect(config.RUN_TIMEOUT_MS).toBe(5000);
    expect(config.RATE_LIMIT_MAX_RUNS).toBe(3);
    expect(config.LANGSMITH_TRACING).toBe(true);
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['RUN_TIMEOUT_MS', '0'],
    ['RATE_LIMIT_MAX_RUNS', '1.5'],
    ['TOOLS_MODE', 'fast'],
    ['NODE_ENV', 'staging'],
    ['LANGSMITH_TRACING', 'maybe'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => parseConfig({ ...base, [key]: value })).toThrow(new RegExp(key));
  });

  it('accepts postgres URLs only for DATABASE_URL', () => {
    expect(parseConfig({ ...base, DATABASE_URL: 'postgresql://u:p@db:5432/travel' }).DATABASE_URL).toBe(
      'postgresql://u:p@db:5432/travel',
    );
    expect(parseConfig({ ...base, DATABASE_URL: 'postgres://u:p@db/travel' }).DATABASE_URL).toBeDefined();
    expect(() => parseConfig({ ...base, DATABASE_URL: 'mysql://u:p@db/travel' })).toThrow(/DATABASE_URL/);
  });

  it('requires a SerpAPI key in live mode and a LangSmith key when tracing', () => {
    expect(() => parseConfig({ ...base, TOOLS_MODE: 'live' })).toThrow(/SERPAPI_API_KEY/);
    expect(parseConfig({ ...base, TOOLS_MODE: 'live', SERPAPI_API_KEY: 'serp' }).TOOLS_MODE).toBe('live');
    expect(() => parseConfig({ ...base, LANGSMITH_TRACING: 'true' })).toThrow(/LANGSMITH_API_KEY/);
  });
});
