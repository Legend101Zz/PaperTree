/**
 * S3 (#200) on the real stack: the shelf → Enter on Attention → the book comes out with its
 * typographic cover (02a) → Enter → the spread (02) shows the real meta line ("2017 · arXiv
 * 1706.03762 · 15 pages", the figures the parser found) and the abstract's first sentences → the
 * bookplate asks whose library it is (never a name from the email) → "Use Figure 1 (p. 3) as the
 * plate" → the shelf's cover shows the plate → Esc → back on the book; then Read opens the reader,
 * and the abstract's tab flashes the abstract there. axe finds no serious or critical violation
 * with the book open, at 1440 and 390, in both schemes.
 *
 * A one-paper library stands face-out (01c), so the book on the shelf is a cover. The e2e web runs
 * with the sample papers on (harness/stack.ts); the uploaded book is found by its paper id. The
 * PDF is the committed corpus's; the spec SKIPS, loudly, without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { register, REPO, shotPath, upload, waitParsed } from '../s4/support';
import { tokenInit } from '../s7/support';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const AXE = join(REPO, 'apps', 'web', 'node_modules', 'axe-core', 'axe.min.js');

test.use({ actionTimeout: 20_000 });

test('shelf → Enter → the cover → Enter → the spread → Figure 1 as the plate → Esc → Read', async ({
  page,
  stack,
}, info) => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );
  test.setTimeout(600_000);
  const shot = (name: string) => shotPath(name, info.outputPath('shots'));
  const token = await register(stack.apiUrl, `e2e-s3-${String(Date.now())}@papertree.test`);
  const paperId = await upload(stack.apiUrl, token, ATTENTION);
  await waitParsed(stack.apiUrl, token, paperId);
  await page.setViewportSize({ width: 1440, height: 900 });
  await tokenInit(page, token);
  await page.goto('/dashboard');
  const book = page.locator(`[aria-label="Your shelf"] button[data-paper-id="${paperId}"]`);
  await expect(book).toHaveAttribute('data-spine-state', 'ready', { timeout: 60_000 });

  // ── Enter: the book comes out, turned face-out, with its typographic cover ──
  await book.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Attention Is All You Need' });
  await expect(dialog).toHaveAttribute('data-book-stage', 'pulled');
  await expect(dialog.locator('[data-cover="typographic"]')).toContainText(
    '2017 · arXiv 1706.03762',
  );
  await expect(
    dialog.getByRole('button', { name: 'Open Attention Is All You Need' }),
  ).toBeFocused();
  await expect(book).toHaveAttribute('data-pulled', 'true');
  await page.screenshot({ path: shot('s3-02a-pulled-1440.png') });

  // ── Enter again: the spread, with the parse's own facts ──
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveAttribute('data-book-stage', 'open');
  await expect(dialog.getByRole('button', { name: /^Read / })).toBeFocused();
  await expect(dialog.locator('[data-book-meta]')).toContainText(
    '2017 · arXiv 1706.03762 · 15 pages',
  );
  await expect(dialog.locator('[data-book-figures]')).toHaveText(
    '5 figures · found Figure 1 (p. 3), Figure 2 (p. 4)',
  );
  await expect(dialog.locator('blockquote[data-voice="paper"]')).toContainText(
    'The dominant sequence transduction models are based on',
  );
  await expect(dialog.getByRole('link', { name: /^p\. 1, Abstract/ })).toBeVisible();
  // A new account has no name: the plate asks, and the email's local part appears nowhere.
  await expect(dialog.getByLabel('Whose library is this?')).toBeVisible();
  await expect(dialog).not.toContainText('e2e-s3-');
  await page.screenshot({ path: shot('s3-02-open-1440.png') });
  for (const width of [1440, 390]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme });
      expect(await axeSerious(page), `${String(width)} ${colorScheme}`).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });

  // ── Use Figure 1 as the plate: the left page and the shelf's cover show the paper's figure ──
  const stored = page.waitForResponse(
    (r) => r.url().endsWith(`/papers/${paperId}/plate`) && r.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Use Figure 1 (p. 3) as the plate' }).click();
  expect((await stored).status()).toBe(204);
  await expect(dialog.locator('[data-plate] img')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('button', { name: 'Use the typographic cover' })).toBeFocused();
  await page.screenshot({ path: shot('s3-02-plate-1440.png') });

  // ── Esc: put back, focus on the book, whose cover now carries the plate ──
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(book).toBeFocused();
  await expect(book).not.toHaveAttribute('data-pulled', 'true');
  await expect(book.locator('img.pt-cover__plate')).toBeVisible();
  await page.screenshot({ path: shot('s3-shelf-plate-1440.png') });

  // ── Read opens the reader; the abstract's tab flashes the abstract there ──
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: /^Read / }).click();
  await page.waitForURL(`**/paper/${paperId}/read`);
  await page.goto('/dashboard');
  await book.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await dialog.getByRole('link', { name: /^p\. 1, Abstract/ }).click();
  await page.waitForURL(`**/paper/${paperId}/read?from=book&at=abstract`);
  await expect(page.locator('svg [data-flash] polygon').first()).toBeAttached({ timeout: 60_000 });
});

/** axe-core's serious and critical violations on the page (axe from apps/web's devDependencies). */
async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: readFileSync(AXE, 'utf8') });
  return page.evaluate(async () => {
    const run = (
      window as unknown as { axe: { run: (c: Document, o: object) => Promise<AxeResults> } }
    ).axe.run;
    const results = await run(document, { resultTypes: ['violations'] });
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

interface AxeResults {
  readonly violations: readonly {
    readonly id: string;
    readonly impact: string | null;
    readonly nodes: readonly { readonly target: readonly string[] }[];
  }[];
}
