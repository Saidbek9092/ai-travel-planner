import { expect, test, type Browser, type Page } from '@playwright/test';

// The mock agent's "happy" scenario: 5 days in Paris from Tashkent (test/fixtures/packets.ts).
const PROMPT = '5 days in Paris from Tashkent, $1000';
const TITLE = '5 days in Paris';

/** A new browser profile that is signed in as `id`. The mock agent trusts `mock-session:<id>`; the real one checks a signed token. */
async function signedInAs(browser: Browser, id: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ id }) => {
      localStorage.setItem(
        'ai-travel:session',
        JSON.stringify({ token: `mock-session:${id}`, expiresAt: Date.now() + 86_400_000, user: { id, email: `${id}@example.com`, name: null, picture: null } }),
      );
    },
    { id },
  );
  return context.newPage();
}

test('each account sees only its own trips, and cannot open another account’s link', async ({ browser }) => {
  // The mock agent keeps its trips across projects and retries, so each run gets accounts of its own.
  const run = Math.random().toString(36).slice(2, 8);
  const alice = await signedInAs(browser, `alice-${run}`);
  await alice.goto('/');
  await alice.getByLabel('Describe your trip').fill(PROMPT);
  await alice.getByRole('button', { name: /Plan my trip/ }).click();
  await expect(alice.getByRole('heading', { level: 1, name: TITLE })).toBeVisible({ timeout: 30_000 });
  const tripUrl = alice.url();

  // Alice finds it in My trips, and a reload (server-rendered link) still opens it for her.
  await alice.goto('/trips');
  await expect(alice.getByRole('list', { name: 'Trips' }).getByRole('link', { name: new RegExp(TITLE) })).toBeVisible();
  await alice.goto(tripUrl);
  await expect(alice.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();

  // Bob has none, and Alice's link is "not found" for him.
  const bob = await signedInAs(browser, `bob-${run}`);
  await bob.goto('/trips');
  await expect(bob.getByText('No trips yet')).toBeVisible();
  await bob.goto(tripUrl);
  await expect(bob.getByRole('heading', { level: 1, name: TITLE })).toHaveCount(0);

  // A guest cannot open it either.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(tripUrl);
  await expect(guest.getByRole('heading', { level: 1, name: TITLE })).toHaveCount(0);

  await Promise.all([alice.context().close(), bob.context().close(), guestContext.close()]);
});
