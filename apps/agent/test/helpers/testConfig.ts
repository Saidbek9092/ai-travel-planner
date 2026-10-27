import { parseConfig, type Config } from '../../src/config.js';

export const TEST_WEB_ORIGIN = 'http://localhost:3000';

/** A valid config for tests; `env` entries override the defaults. */
export function testConfig(env: Record<string, string> = {}): Config {
  return parseConfig({
    NODE_ENV: 'test',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    TOOLS_MODE: 'mock',
    WEB_ORIGIN: TEST_WEB_ORIGIN,
    ...env,
  });
}
