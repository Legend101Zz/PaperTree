/**
 * S2h (#199) on the real stack at 390 × 844, touch: the stacked phone library (search, title,
 * tabs, Reading now, the books lying flat) → Continue on a Reading-now row opens the reader at its
 * page → back → a flat book taken down opens its card as a bottom sheet (Read focused, Put it back)
 * → the Table tab scrolls sideways in its own region while the page never does.
 *
 * The brief names the demo account; the e2e stack has none (as for S2f), so a new account holds
 * two corpus PDFs (Attention, 15 pages, and ResNet, 12) and the server is told the person is on
 * p. 3 of Attention (`PUT /papers/{id}/reading-state`, the reader's own write). With the sample
 * papers on (harness/stack.ts) they lie in the stacks too. The PDFs are the committed corpus's;
 * the spec SKIPS, loudly, without them.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { register, REPO, SCROLLER, shotPath, upload, waitParsed } from '../s4/support';
import { tokenInit } from '../s7/support';

const CORPUS = join(REPO, 'research', 'benchmarks', 'corpus');
const ATTENTION = join(CORPUS, 'attention-is-all-you-need.pdf');
const RESNET = join(CORPUS, 'resnet-cvpr-2col.pdf');

test.use({
  actionTimeout: 20_000,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

/** The page itself never scrolls sideways; only a region of its own may. */
const pageWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

/**
 * The PDF page whose top edge is nearest the reader's top edge. `topLine` cannot be used at 390:
 * fit-width body text is under its 8 px floor there, so it finds no line at all.
 */
const pageAtTop = (page: Page) =>
  page.evaluate((selector) => {
    const top = document.querySelector(selector)?.getBoundingClientRect().top ?? 0;
    const pages = Array.from(document.querySelectorAll('.papertree-page'), (el) => ({
      index: Number(el.getAttribute('data-page-index')),
      gap: Math.abs(el.getBoundingClientRect().top - top),
    }));
    return pages.sort((a, b) => a.gap - b.gap)[0]?.index ?? null;
  }, SCROLLER);

test('390: stacked library → Continue opens p. 3 → back → a flat book opens the sheet → Table scrolls sideways', async ({
  page,
  stack,
}, info) => {
  test.skip(
    !existsSync(ATTENTION) || !existsSync(RESNET),
    'SKIPPED: the corpus PDFs attention-is-all-you-need.pdf and resnet-cvpr-2col.pdf are absent. Run research/benchmarks/fetch_corpus.sh.',
  );
  test.setTimeout(600_000);
  const shot = (name: string) => shotPath(name, info.outputPath('shots'));
  const token = await register(stack.apiUrl, `e2e-s2h-${String(Date.now())}@papertree.test`);
  const attention = await upload(stack.apiUrl, token, ATTENTION);
  const resnet = await upload(stack.apiUrl, token, RESNET);
  await waitParsed(stack.apiUrl, token, attention);
  await waitParsed(stack.apiUrl, token, resnet);
  const placed = await fetch(`${stack.apiUrl}/papers/${attention}/reading-state`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_page: 2 }),
  });
  expect(placed.status).toBe(204);
  await tokenInit(page, token);

  // ── the stacked library: search, title, tabs, Reading now, then the books lying flat ──
  await page.goto('/dashboard');
  const shelf = page.getByRole('toolbar', { name: 'Shelf' });
  await expect(shelf).toHaveAttribute('aria-orientation', 'vertical', { timeout: 60_000 });
  const strip = page.getByRole('region', { name: 'Reading now' });
  const tops = await Promise.all(
    [
      page.getByRole('searchbox', { name: 'Search the library' }),
      page.getByRole('heading', { name: 'Your library' }),
      page.getByRole('group', { name: 'View' }),
      strip,
      shelf,
    ].map(async (l) => (await l.boundingBox())?.y ?? Number.NaN),
  );
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  const book = shelf.locator(`button[data-paper-id="${resnet}"]`);
  await expect(book).toHaveClass(/pt-flatbook/);
  await expect(shelf.locator('.pt-spine, .pt-cover')).toHaveCount(0);
  // Every book and every view tab is a 44 px target; the page is 390 wide.
  for (const target of [
    ...(await shelf.locator('button[data-paper-id]').all()),
    ...(await page.getByRole('group', { name: 'View' }).getByRole('button').all()),
  ]) {
    expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(await pageWidth(page)).toBe(390);
  await page.screenshot({ path: shot('s2h-library-390.png') });

  // ── Continue on the Reading-now row opens the reader at p. 3 ──
  const row = strip.locator(`[data-reading-paper-id="${attention}"]`);
  await expect(row).toContainText('p. 3 of 15');
  // Continue uses the server's place, not one this browser kept (the other-device path).
  await page.evaluate((id) => window.localStorage.removeItem(`papertree/reader/${id}`), attention);
  await row.getByRole('button', { name: 'Continue reading Attention Is All You Need' }).tap();
  await page.waitForURL(`**/paper/${attention}/read`);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await expect(page.locator('.papertree-text-layer span[data-item-index]').first()).toBeAttached({
    timeout: 120_000,
  });
  await expect.poll(() => pageAtTop(page), { timeout: 30_000 }).toBe(2);
  await page.screenshot({ path: shot('s2h-continue-p3-390.png') });

  // ── back: a flat book taken down opens its card as a bottom sheet ──
  await page.goBack();
  await expect(book).toBeVisible({ timeout: 60_000 });
  await book.tap();
  const sheet = page.locator(`[data-card-paper-id="${resnet}"]`);
  await expect(sheet).toHaveClass(/pt-catalogue--sheet/);
  await expect(book).toHaveAttribute('aria-expanded', 'true');
  await expect(sheet.getByRole('button', { name: /^Read / })).toBeFocused();
  const box = await sheet.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
  expect(Math.round(box?.width ?? 0)).toBe(390);
  expect(await pageWidth(page)).toBe(390);
  await page.screenshot({ path: shot('s2h-sheet-390.png') });
  await sheet.getByRole('button', { name: 'Put it back' }).tap();
  await expect(sheet).toHaveCount(0);
  await expect(book).toBeFocused();

  // ── the Table tab: its region scrolls sideways, the page does not ──
  await page.getByRole('button', { name: 'Table', exact: true }).tap();
  const table = page.getByRole('table', { name: 'Papers' });
  await expect(table.locator(`tr[data-row-id="${resnet}"]`)).toBeVisible();
  const region = page.locator('.pt-libtable__scroll');
  const widths = await region.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(widths.scroll).toBeGreaterThan(widths.client);
  await region.evaluate((el) => el.scrollBy({ left: 300 }));
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await pageWidth(page)).toBe(390);
  await page.screenshot({ path: shot('s2h-table-scrolled-390.png') });
});
