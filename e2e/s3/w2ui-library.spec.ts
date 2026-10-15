/**
 * W2UI #141, the library/auth should-fixes on the real stack:
 *
 *   1. the "could not confirm your session" notice RETRIES (2 s, 5 s, 15 s), clears itself when a
 *      check succeeds, and after the last try says so and offers "Try again";
 *   2. a failed card says ONE sentence (no second, near-identical one for a screen reader);
 *   3. after a garbage upload there is no upload row above the paper's own "Could not read" card;
 *   4. Cancel re-reads GET /papers and says it was added when it was.
 *
 * Screenshots go to PAPERTREE_E2E_SHOTS and are looked at by the author.
 */
import { expect, test } from '../harness/test';
import { register, shotPath } from '../s4/support';
import { tokenInit } from '../s7/support';

const GARBAGE = {
  name: 'garbage.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\nthis is not a real pdf\n%%EOF\n'),
};
const GENERIC = 'We could not read this paper. Retry, or open the original PDF.';

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
] as const;

test.use({ actionTimeout: 20_000 });

test('a garbage upload leaves ONE failed card, one sentence, no lingering upload row', async ({
  browser,
  stack,
}, testInfo) => {
  test.setTimeout(600_000);
  const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
  for (const vp of VIEWPORTS) {
    for (const theme of ['light', 'dark'] as const) {
      const token = await register(
        stack.apiUrl,
        `e2e-w2ui-lib-${vp.name}-${theme}-${String(Date.now())}@papertree.test`,
      );
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme,
        ...(vp.mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
      });
      const page = await context.newPage();
      await tokenInit(page, token);
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'My papers' })).toBeVisible();
      await page.locator('[data-upload-dropzone] input[type=file]').setInputFiles(GARBAGE);
      const card = page.locator('article[data-paper-id^="ppr_"]').first();
      await expect(card).toHaveAttribute('data-processing-state', 'failed', { timeout: 120_000 });
      // The transient row is gone as soon as the server row is in the list: one place to look.
      await expect(page.locator('[data-testid=upload-queue] li')).toHaveCount(0);
      await expect(page.getByText('Uploaded - queued for reading')).toHaveCount(0);
      // One sentence: the reason; the generic state sentence is not in the card at all (the
      // badge's screen-reader text included).
      expect(await card.textContent()).not.toContain(GENERIC);
      await expect(card.locator('[data-failure-reason]')).toHaveCount(1);
      await expect(card.getByRole('button', { name: /Retry/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(vp.width);
      await page.screenshot({ path: shot(`w2-02-03-failed-card-${vp.name}-${theme}.png`) });
      await context.close();
    }
  }
});

test('Cancel after the server had the whole body says it is in the library', async ({
  browser,
  stack,
}, testInfo) => {
  test.setTimeout(300_000);
  const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
  const token = await register(
    stack.apiUrl,
    `e2e-w2ui-cancel-${String(Date.now())}@papertree.test`,
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  // The upload reaches the server in full, but the answer is held back, so the page is still
  // "uploading" when the reader presses Cancel.
  await page.route(`${stack.apiUrl}/papers`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const real = await route.fetch();
    await new Promise((done) => setTimeout(done, 6000));
    await route.fulfill({ response: real }).catch(() => undefined);
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'My papers' })).toBeVisible();
  await page.locator('[data-upload-dropzone] input[type=file]').setInputFiles(GARBAGE);
  const cancel = page.getByRole('button', { name: /Cancel/ });
  await expect(cancel).toBeVisible();
  await page.waitForTimeout(1500);
  await cancel.click();
  const row = page.locator('[data-upload-state="cancelled"]');
  await expect(row).toContainText(
    'It had already uploaded; it is in your library. Delete it if you did not mean to add it.',
  );
  // ...and that is TRUE: the paper's card is in the list.
  await expect(page.locator('article[data-paper-id^="ppr_"]')).toHaveCount(1, { timeout: 30_000 });
  await page.screenshot({ path: shot('w2-04-cancel-truth-1440.png') });
  await context.close();
});

test('the unverified-session notice retries, clears itself, and offers Try again at the end', async ({
  browser,
  stack,
}, testInfo) => {
  test.setTimeout(300_000);
  const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
  const token = await register(
    stack.apiUrl,
    `e2e-w2ui-session-${String(Date.now())}@papertree.test`,
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  let failing = true;
  let meCalls = 0;
  await page.route(`${stack.apiUrl}/auth/me`, async (route) => {
    meCalls += 1;
    if (failing) return route.abort();
    return route.continue();
  });
  await page.goto('/dashboard');
  const banner = page.locator('[data-session-banner]');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText('Checking again shortly');
  await page.screenshot({ path: shot('w2-01-session-banner-1440.png') });
  // It really retries: more /auth/me calls arrive without any action from the reader.
  const first = meCalls;
  await expect.poll(() => meCalls, { timeout: 15_000 }).toBeGreaterThan(first);
  // After the last automatic try (2 s + 5 s + 15 s) it says so and offers Try again.
  await expect(banner).toContainText('still not confirmed', { timeout: 45_000 });
  const settled = meCalls;
  await page.waitForTimeout(6000);
  expect(meCalls, 'no automatic tries after the last one').toBe(settled);
  await page.screenshot({ path: shot('w2-01b-session-banner-exhausted-1440.png') });
  // The server is back: Try again clears the notice.
  failing = false;
  await banner.getByRole('button', { name: 'Try again' }).click();
  await expect(banner).toBeHidden({ timeout: 15_000 });
  await context.close();

  // And the other way: the server comes back by itself, during the automatic tries.
  const again = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
  });
  const phone = await again.newPage();
  await tokenInit(phone, token);
  let back = false;
  await phone.route(`${stack.apiUrl}/auth/me`, async (route) => {
    if (!back) return route.abort();
    return route.continue();
  });
  await phone.goto('/dashboard');
  const phoneBanner = phone.locator('[data-session-banner]');
  await expect(phoneBanner).toBeVisible({ timeout: 30_000 });
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await phone.screenshot({ path: shot('w2-01c-session-banner-390-dark.png') });
  back = true;
  await expect(phoneBanner).toBeHidden({ timeout: 30_000 });
  await again.close();
});
