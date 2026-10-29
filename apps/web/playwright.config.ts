import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against the mock agent (`test/mock-agent`), so they need no keys or network.
 * Ports are fixed and away from `pnpm dev`; CI runs a production build, locally `next dev` is enough.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const AGENT_PORT = Number(process.env.E2E_AGENT_PORT ?? 3101);
const AGENT_URL = `http://localhost:${AGENT_PORT}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Travel is mostly planned on phones: the smallest common width (iPhone SE / mini).
    { name: 'mobile', use: { ...devices['iPhone 13 Mini'], defaultBrowserType: 'chromium', viewport: { width: 375, height: 812 } } },
  ],
  webServer: [
    {
      command: 'node --experimental-transform-types --disable-warning=ExperimentalWarning test/mock-agent/server.ts',
      url: `${AGENT_URL}/api/trips/00000000-0000-4000-8000-000000000000`,
      env: { PORT: String(AGENT_PORT), MOCK_DELAY_SCALE: '0.3' },
      reuseExistingServer: !CI,
    },
    {
      command: CI ? `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}` : `pnpm exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: { NEXT_PUBLIC_AGENT_URL: AGENT_URL },
      timeout: 180_000,
      reuseExistingServer: !CI,
    },
  ],
});
