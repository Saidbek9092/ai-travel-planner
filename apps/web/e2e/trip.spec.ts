import { expect, test, type Page } from '@playwright/test';

// The mock agent's "happy" scenario: 5 days in Paris from Tashkent (test/fixtures/packets.ts).
const PROMPT = '5 days in Paris from Tashkent, $1000';
const TITLE = '5 days in Paris';

async function planTrip(page: Page) {
  await page.goto('/');
  await page.getByLabel('Describe your trip').fill(PROMPT);
  await page.getByRole('button', { name: /Plan my trip/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\?trip=[0-9a-f-]{36}/);
}

/** Nothing on the page may be wider than the screen (no sideways scrolling on a phone). */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page is wider than the viewport').toBeLessThanOrEqual(0);
}

test('plan a trip, see the result, reload, and find it in My trips', async ({ page }) => {
  await planTrip(page);
  await expect(page.getByText('Confirmed by the agents').first()).toBeVisible();

  // A reload reopens the stored trip, chat included.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  await page.getByRole('button', { name: 'Open full chat' }).click();
  await expect(page.getByText(/Got it/).first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My trips' }).click();
  const entry = page.getByRole('list', { name: 'Trips' }).getByRole('link', { name: new RegExp(TITLE) });
  await expect(entry.first()).toBeVisible();
  await entry.first().click();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
});

test('the "another device" link shows the same trips in a fresh browser', async ({ page, browser, baseURL, context }) => {
  await planTrip(page);
  const threadId = new URL(page.url()).searchParams.get('trip')!;
  const owner = (await context.cookies()).find((cookie) => cookie.name === 'ai-travel-owner')?.value;
  expect(owner).toBeTruthy();

  const other = await browser.newContext({ baseURL });
  const phone = await other.newPage();
  await phone.goto(`/trips?owner=${owner}`);
  await expect(phone.getByRole('list', { name: 'Trips' }).locator(`a[href*="${threadId}"]`)).toBeVisible();
  await other.close();
});

test('the start page, the live run and the finished trip fit the screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Describe your trip')).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.getByLabel('Describe your trip').fill(PROMPT);
  await page.getByRole('button', { name: /Plan my trip/ }).click();
  await expect(page.getByRole('region', { name: 'Planning progress' })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible({ timeout: 30_000 });
  await expectNoSidewaysScroll(page);
  await page.goto('/trips');
  await expectNoSidewaysScroll(page);
});
