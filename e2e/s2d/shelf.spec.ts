/**
 * S2d (#195) on the real stack: the shelf's search lights matches in place ("2 of N", nothing
 * reorders, Esc clears), the keyboard walks the shelf (one tab stop, ←/→), Space takes a parsed
 * book off the shelf and opens it with focus on Read (v0.3 #337: no catalogue card), Esc puts it
 * back with focus on its spine, and a PDF dropped anywhere on the page is uploaded. Shots go to
 * the test's output folder.
 *
 * The shelf is spines at every size (v0.3), so the books are counted by `data-paper-id`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { register, shotPath, upload, waitParsed } from '../s4/support';
import { tokenInit } from '../s7/support';

const BENCH = join(__dirname, '..', '..', 'research', 'benchmarks');
const PAPERS = [
  join(BENCH, 'corpus', 'attention-is-all-you-need.pdf'),
  join(BENCH, 'fresh', 'pdfs', 'flashattention-2205.14135.pdf'),
  join(BENCH, 'corpus', 'resnet-cvpr-2col.pdf'),
];
const GARBAGE = '%PDF-1.4\nthis is not a real pdf\n%%EOF\n';

test.use({ actionTimeout: 20_000 });

test('search lights the shelf, the keyboard walks it, a drop anywhere uploads', async ({
  page,
  stack,
}, testInfo) => {
  test.setTimeout(600_000);
  const missing = PAPERS.filter((pdf) => !existsSync(pdf));
  test.skip(
    missing.length > 0,
    `SKIPPED: ${missing.join(', ')} absent; run ./research/benchmarks/fetch_corpus.sh and ./research/benchmarks/fresh/fetch_fresh.sh first.`,
  );
  const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
  const token = await register(stack.apiUrl, `e2e-s2d-${String(Date.now())}@papertree.test`);
  const mine: string[] = [];
  for (const pdf of PAPERS) {
    const id = await upload(stack.apiUrl, token, pdf);
    await waitParsed(stack.apiUrl, token, id);
    mine.push(id);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await tokenInit(page, token);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  const shelf = page.getByRole('toolbar', { name: 'Shelf' });
  const spines = shelf.locator('button[data-paper-id]');
  await expect(spines.nth(PAPERS.length - 1)).toBeVisible({ timeout: 30_000 });
  const ids = () => spines.evaluateAll((all) => all.map((el) => el.getAttribute('data-paper-id')));
  const order = await ids();
  // With the fixtures flag on, the sample papers stand on the shelf too; count from the names.
  const total = order.length;
  const titled = await spines.evaluateAll((all) =>
    all.map((el) => (el.getAttribute('aria-label') ?? '').split(',')[0] ?? ''),
  );
  const expected = titled.filter((title) => /atten/i.test(title)).length;
  expect(expected).toBeGreaterThanOrEqual(2);

  // "/" focuses the search; "atten" lights the matches, dims the rest and reorders nothing.
  await page.locator('body').press('/');
  const search = page.getByRole('searchbox', { name: 'Search the library' });
  await expect(search).toBeFocused();
  await search.fill('atten');
  await expect(shelf.locator('[data-match="true"]')).toHaveCount(expected);
  await expect(shelf.locator('[data-match="false"]')).toHaveCount(total - expected);
  await expect(
    page.getByText(`${String(expected)} of ${String(total)}`, { exact: true }),
  ).toBeVisible();
  expect(await ids()).toEqual(order);
  await page.screenshot({ path: shot('s2d-search-atten-1440.png') });
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(shelf.locator('[data-match]')).toHaveCount(0);

  // The books are one tab stop (the rest are -1); ← → along the shelf; Space takes one of ours
  // (parsed: a sample is read, not opened) off the shelf and opens it; Esc puts it back.
  await expect(spines.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
  await expect(spines.and(page.locator('[tabindex="-1"]'))).toHaveCount(total - 1);
  await spines.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(spines.nth(1)).toBeFocused();
  const book = shelf.locator(`button[data-paper-id="${mine[0] ?? ''}"]`);
  await book.focus();
  await page.keyboard.press('Space');
  const opened = page.locator('[role="dialog"][data-book-stage="open"]');
  await expect(opened).toBeVisible();
  await expect(page.locator('[data-card-paper-id]')).toHaveCount(0);
  await expect(book).toHaveAttribute('data-pulled', 'true');
  await expect(opened.getByRole('button', { name: /^Read / })).toBeFocused();
  await page.screenshot({ path: shot('s2d-book-open-1440.png') });
  await page.keyboard.press('Escape');
  await expect(opened).toHaveCount(0);
  await expect(book).toBeFocused();

  // A PDF dropped anywhere goes up through the library's upload path, and its spine appears.
  const posted = page.waitForResponse(
    (r) => r.url() === `${stack.apiUrl}/papers` && r.request().method() === 'POST',
  );
  await page.evaluate((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'dropped.pdf', { type: 'application/pdf' }));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      document.body.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    }
  }, GARBAGE);
  expect((await posted).status()).toBe(202);
  await expect(spines).toHaveCount(total + 1, { timeout: 30_000 });
  await expect(shelf.getByRole('button', { name: /^dropped,/ })).toBeVisible();
});
