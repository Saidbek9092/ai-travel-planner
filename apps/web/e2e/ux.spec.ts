import { expect, test } from '@playwright/test';

// UX and accessibility regressions found in the TP-38 audit, against the mock agent's "happy" scenario.
const PROMPT = '5 days in Paris from Tashkent, $1000';
const TITLE = '5 days in Paris';

test('leaving a live run for My trips and coming back catches up with it', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your trip').fill(PROMPT);
  await page.getByRole('button', { name: /Plan my trip/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Planning your trip' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My trips' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Trips you planned' })).toBeVisible();
  await page.goBack();

  // Before the fix the page kept showing the percent it had when the user left, forever.
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveTitle(`${TITLE} · AI Travel Planner`);
});

test('a value the agents cannot use says why instead of disappearing', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your trip').fill('Paris from Tashkent, $1000');
  await page.getByRole('button', { name: /How long/ }).click();
  await page.keyboard.type('45');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('button', { name: /How long.*45 days.*1 to 30 days/ })).toBeVisible();
  await expect(page.getByText('A trip can be 1 to 30 days long.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Plan my trip/ })).toBeDisabled();
});

test('keyboard only: skip link, plan with Ctrl+Enter, focus lands on the result', async ({ page }) => {
  await page.goto('/');
  // Keystrokes before hydration would be lost: wait until the page has loaded everything.
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Describe your trip')).toBeFocused();
  await page.keyboard.type(PROMPT);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeFocused({ timeout: 30_000 });
});

test('the Re-plan dialog keeps focus inside and gives it back on Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your trip').fill(PROMPT);
  await page.getByRole('button', { name: /Plan my trip/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible({ timeout: 30_000 });

  const trigger = page.getByRole('button', { name: 'Re-plan' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Plan this trip again?' });
  await expect(dialog.getByRole('button', { name: 'Keep this trip' })).toBeFocused();
  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect(dialog.locator(':focus')).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('a link to a trip that does not exist says so, without offering Resume', async ({ page }) => {
  await page.goto('/?trip=not-a-real-id');
  await expect(page.getByRole('status').filter({ hasText: "We couldn't find this trip" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
  await expect(page.getByLabel('Describe your trip')).toBeEditable();
});

test('Tab moves on past a toast instead of looping back into the page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your trip').fill(PROMPT);
  await page.getByRole('button', { name: /Plan my trip/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible({ timeout: 30_000 });
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Trip ready' });
  await expect(toast).toBeVisible();

  // From the last control of the page: the toast, its Dismiss button, then out of the page (no element focused).
  await page.locator('main a[href], main button:not([disabled])').last().focus();
  await page.keyboard.press('Tab');
  await expect(toast).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(toast.getByRole('button', { name: 'Dismiss' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('main :focus')).toHaveCount(0);

  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toBeHidden();
});
