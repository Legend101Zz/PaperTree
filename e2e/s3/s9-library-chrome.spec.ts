/**
 * S9-2 and S9-3 on the real stack:
 *   - no page logs a console error (the 404 for /favicon.ico is gone: the app has an icon);
 *   - a book's screen-reader status text does not begin with stray punctuation (the spine's name,
 *     and, since v0.3 #337, the opened book's state line: there is no catalogue card).
 *
 * Screenshots go to the test's output folder and are looked at by the author.
 */
import { expect, test } from '../harness/test';
import { shotPath } from '../s4/support';
import { seedPaper, tokenInit } from '../s7/support';

test.use({ actionTimeout: 20_000 });

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
] as const;

test('console stays clean and the card status text has no stray period', async ({
  browser,
  stack,
}, testInfo) => {
  test.setTimeout(600_000);
  const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
  const { token, paperId } = await seedPaper(stack.apiUrl, 's9-chrome');
  for (const vp of VIEWPORTS) {
    for (const theme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme,
        ...(vp.mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(`${String(r.status())} ${r.url()}`);
      });
      await tokenInit(page, token);
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
      // #195: the card grid's status badge became the spine's accessible name and, since v0.3,
      // the opened book's state line; the same checks run on both.
      // The seeded book's own spine: the e2e web also shelves sample books, and a sample is read
      // in place, never taken out (`canOpenBook`), so the first spine on the shelf may not open.
      const spine = page.locator(`[aria-label="Your shelf"] button[data-paper-id="${paperId}"]`);
      await expect(spine).toBeVisible();
      await expect(spine).toHaveAttribute('data-processing-state', 'complete');
      const name = (await spine.getAttribute('aria-label')) ?? '';
      expect(name.trim()).toMatch(/^[A-Z]/);
      expect(name).not.toMatch(/\s\.\s|,\s*,/);
      await spine.click();
      await expect(page.locator('[role="dialog"][data-book-stage="open"]')).toBeVisible();
      const state = page.locator('.pt-bookdetails__reading span').first();
      const spoken = (await state.evaluate((el) => (el as HTMLElement).innerText)).replace(
        /\s+/g,
        ' ',
      );
      expect(spoken).not.toMatch(/\s\.\s/);
      expect(spoken).toMatch(/^(Not started|Read|Reading now · p\. \d+ of \d+)$/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(vp.width);
      const icon = await page.request.get('/icon.svg');
      expect(icon.status()).toBe(200);
      expect(await page.locator('link[rel~="icon"]').count()).toBeGreaterThan(0);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
      await page.screenshot({ path: shot(`s9-library-${vp.name}-${theme}.png`) });
      expect(errors, errors.join('\n')).toEqual([]);
      await context.close();
    }
  }
});
