/**
 * S2e (#196, review S2; v0.3 #337) on the real stack: a library of thirteen books stands as spines
 * (frame 01's layout, 13 to 40 books), and the keyboard walks it (one tab stop, ← →, Home, End;
 * Space takes a parsed book off the shelf and opens it, with focus on Read and no card in between;
 * Esc puts it back with focus on its spine). The e2e web runs with the sample papers on, so the
 * spec uploads just enough corpus PDFs to make thirteen books, whatever the samples number. It
 * SKIPS, loudly, without the corpus.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { register, REPO, shotPath, upload, waitParsed } from '../s4/support';
import { tokenInit } from '../s7/support';

const BENCH = join(REPO, 'research', 'benchmarks');
// The smallest corpus PDFs first: the spec needs books on the shelf, not their parses.
const PDFS = [
  join(BENCH, 'corpus', 'superglue-tableheavy.pdf'),
  join(BENCH, 'fresh', 'pdfs', 'sbert-1908.10084.pdf'),
  join(BENCH, 'fresh', 'pdfs', 'adam-1412.6980.pdf'),
  join(BENCH, 'corpus', 'bert-2col.pdf'),
  join(BENCH, 'corpus', 'resnet-cvpr-2col.pdf'),
  join(BENCH, 'corpus', 'attention-is-all-you-need.pdf'),
  join(BENCH, 'corpus', 'a3c-algorithmheavy.pdf'),
  join(BENCH, 'fresh', 'pdfs', 'flashattention-2205.14135.pdf'),
  join(BENCH, 'corpus', 'pdf-to-tree-acl2col.pdf'),
  join(BENCH, 'corpus', 'neural-odes-mathheavy.pdf'),
  join(BENCH, 'fresh', 'pdfs', 'yolo-1506.02640.pdf'),
  join(BENCH, 'corpus', 'gpt3-longform-singlecol.pdf'),
  join(BENCH, 'fresh', 'pdfs', 'maskrcnn-1703.06870.pdf'),
];
const BOOKS = 13;

test.use({ actionTimeout: 20_000 });

test('thirteen books stand as spines; the keyboard walks them; Space opens one, Esc puts it back', async ({
  page,
  stack,
}, info) => {
  test.setTimeout(600_000);
  const shot = (name: string) => shotPath(name, info.outputPath('shots'));
  const token = await register(stack.apiUrl, `e2e-s2e-spines-${String(Date.now())}@papertree.test`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await tokenInit(page, token);
  await page.goto('/dashboard');
  const shelf = page.getByRole('toolbar', { name: 'Shelf' });
  const slip = page.getByRole('region', { name: 'Drop PDFs here or choose files' });
  await expect(slip.or(shelf)).toBeVisible({ timeout: 60_000 });
  const books = shelf.locator('button[data-paper-id]');
  const samples = (await slip.isVisible()) ? 0 : await books.count();
  const needed = PDFS.slice(0, BOOKS - samples);
  const missing = needed.filter((pdf) => !existsSync(pdf));
  test.skip(
    missing.length > 0,
    `SKIPPED: ${missing.join(', ')} absent; run ./research/benchmarks/fetch_corpus.sh and ./research/benchmarks/fresh/fetch_fresh.sh first.`,
  );
  const ids: string[] = [];
  for (const pdf of needed) ids.push(await upload(stack.apiUrl, token, pdf));

  // ── thirteen books: spines, one tab stop ──
  await page.reload();
  await expect(books).toHaveCount(BOOKS, { timeout: 60_000 });
  expect(await books.evaluateAll((all) => all.every((b) => b.classList.contains('pt-spine')))).toBe(
    true,
  );
  await expect(books.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
  await page.screenshot({ path: shot('s2e-spines-13-1440.png') });

  // ── ← → Home End along the shelf ──
  await books.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(books.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(books.nth(BOOKS - 1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(books.first()).toBeFocused();

  // ── Space on one of ours, once it is parsed (a book still being read is read, not opened): the
  // book comes off the shelf and opens, focus on Read; Esc puts it back, focus on its spine ──
  const mine = ids[0] ?? '';
  await waitParsed(stack.apiUrl, token, mine);
  await page.reload();
  await expect(books).toHaveCount(BOOKS, { timeout: 60_000 });
  const order = await books.evaluateAll((all) => all.map((b) => b.getAttribute('data-paper-id')));
  const target = order.indexOf(mine);
  expect(target).toBeGreaterThanOrEqual(0);
  await books.first().focus();
  for (let step = 0; step < target; step += 1) await page.keyboard.press('ArrowRight');
  const chosen = books.nth(target);
  await expect(chosen).toBeFocused();
  await page.keyboard.press('Space');
  const book = page.locator('[role="dialog"][data-book-stage]');
  await expect(page.locator('[data-card-paper-id]')).toHaveCount(0);
  await expect(book).toHaveAttribute('data-book-stage', 'open');
  await expect(book.getByRole('button', { name: /^Read / })).toBeFocused();
  await expect(chosen).toHaveAttribute('data-pulled', 'true');
  await page.screenshot({ path: shot('s2e-book-out-1440.png') });
  await page.keyboard.press('Escape');
  await expect(book).toHaveCount(0);
  await expect(chosen).toBeFocused();
  await expect(chosen).not.toHaveAttribute('data-pulled', 'true');
});
