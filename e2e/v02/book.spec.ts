/**
 * S3 (#200, v0.3 #337) on the real stack: the shelf → Enter on Attention's spine → the book is
 * taken out and opened in one motion, landing on the spread (02) with Read focused, which shows
 * the real meta line ("2017 · arXiv 1706.03762 · 15 pages", the figures the parser found) and the
 * abstract's first sentences, with no catalogue card in between → the bookplate asks whose library
 * it is (never a name from the email) → "Use Figure 1 (p. 3) as the plate" → Esc → back on the
 * spine; then Read opens the reader, and the abstract's tab flashes the abstract there. axe finds
 * no serious or critical violation with the book open, at 1440 and 390, in both schemes.
 *
 * The e2e web runs with the sample papers on (harness/stack.ts); the uploaded book is found by
 * its paper id. The PDF is the committed corpus's; the spec SKIPS, loudly, without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { register, REPO, shotPath, upload, waitParsed } from '../s4/support';
import { tokenInit } from '../s7/support';
import { settle } from './flow-support';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const AXE = join(REPO, 'apps', 'web', 'node_modules', 'axe-core', 'axe.min.js');

test.use({ actionTimeout: 20_000 });

test('shelf → Enter → the spread → Figure 1 as the plate → Esc → Read', async ({
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

  // ── Enter: the book comes off the shelf and opens, with no card in between ──
  await book.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Attention Is All You Need' });
  await expect(page.locator('[data-card-paper-id]')).toHaveCount(0);
  await expect(book).toHaveAttribute('data-pulled', 'true');
  await expect(dialog).toHaveAttribute('data-book-stage', 'open');
  await expect(dialog.getByRole('button', { name: /^(Read|Continue at p\. \d+) / })).toBeFocused();
  await expect(dialog.locator('[data-book-meta]')).toContainText(
    '2017 · arXiv 1706.03762 · 15 pages',
  );
  await expect(dialog.locator('[data-book-figures]')).toHaveText(
    '5 figures found · Figure 1 (p. 3), Figure 2 (p. 4)',
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
      // An axe pass mid-fade measures the fade, not the page (the scheme's colours and the
      // spread's own motion run for a moment after the change): wait until nothing is moving.
      await settle(page);
      expect(await axeSerious(page), `${String(width)} ${colorScheme}`).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });

  // ── Use Figure 1 as the plate: the left page shows the paper's figure ──
  const stored = page.waitForResponse(
    (r) => r.url().endsWith(`/papers/${paperId}/plate`) && r.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Use Figure 1 (p. 3) as the plate' }).click();
  expect((await stored).status()).toBe(204);
  await expect(dialog.locator('[data-plate] img')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('button', { name: 'Use the typographic cover' })).toBeFocused();
  await page.screenshot({ path: shot('s3-02-plate-1440.png') });

  // ── Esc: put back (420 ms), focus on the spine, the slot filled again ──
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(book).toBeFocused();
  await expect(book).not.toHaveAttribute('data-pulled', 'true');
  await page.screenshot({ path: shot('s3-shelf-after-1440.png') });

  // ── Read opens the reader; the abstract's tab flashes the abstract there ──
  await book.click();
  await expect(dialog).toHaveAttribute('data-book-stage', 'open');
  await dialog.getByRole('button', { name: /^(Read|Continue at p\. \d+) / }).click();
  await page.waitForURL(`**/paper/${paperId}/read`);
  await page.goto('/dashboard');
  await book.click();
  await expect(dialog).toHaveAttribute('data-book-stage', 'open');
  await dialog.getByRole('link', { name: /^p\. 1, Abstract/ }).click();
  await page.waitForURL(`**/paper/${paperId}/read?from=book&at=abstract`);
  await expect(page.locator('svg [data-flash] polygon').first()).toBeAttached({ timeout: 60_000 });
});

test('the spread’s ⋯ menu: Esc order, Rename persists, Delete → Undo restores, Delete goes after 10 s', async ({
  page,
  stack,
}) => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );
  test.setTimeout(600_000);
  const token = await register(stack.apiUrl, `e2e-337-${String(Date.now())}@papertree.test`);
  const paperId = await upload(stack.apiUrl, token, ATTENTION);
  await waitParsed(stack.apiUrl, token, paperId);
  await page.setViewportSize({ width: 1440, height: 900 });
  await tokenInit(page, token);
  await page.goto('/dashboard');
  const book = page.locator(`[aria-label="Your shelf"] button[data-paper-id="${paperId}"]`);
  await expect(book).toHaveAttribute('data-spine-state', 'ready', { timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Attention Is All You Need' });
  // The book's name follows a rename, so after it the dialog is found by its role alone: it is the
  // only one on the page.
  const open = page.getByRole('dialog');
  const more = () => open.getByRole('button', { name: /^More: rename, topic, delete/ });
  const deletes: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'DELETE' && r.url().endsWith(`/papers/${paperId}`)) deletes.push(r.url());
  });

  // ── ⋯ is reached by keyboard; Esc closes the menu first, the second Esc puts the book back ──
  await book.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveAttribute('data-book-stage', 'open');
  await more().focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('menuitem', { name: 'Rename…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('menu')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(more()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(book).toBeFocused();

  // ── Rename: Enter saves (PATCH), the spine and the title follow, and it survives a reload ──
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveAttribute('data-book-stage', 'open');
  await more().click();
  await dialog.getByRole('menuitem', { name: 'Rename…' }).click();
  const field = dialog.getByRole('textbox', { name: 'Title' });
  await expect(field).toBeFocused();
  const patched = page.waitForResponse(
    (r) => r.url().endsWith(`/papers/${paperId}`) && r.request().method() === 'PATCH',
  );
  await field.fill('  My Attention  ');
  await page.keyboard.press('Enter');
  expect((await patched).status()).toBe(200);
  const renamed = page.getByRole('dialog', { name: 'My Attention' });
  await expect(renamed.getByRole('heading', { name: 'My Attention' })).toBeVisible();
  // Saved: the field is gone and focus is back on ⋯. Until then an Esc would be the field's own
  // "cancel", so wait on the focused element, not on time.
  await expect(renamed.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
  await expect(more()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(renamed).toHaveCount(0);
  await page.reload();
  await expect(book).toHaveAttribute('aria-label', /My Attention/);

  // ── Delete asks nothing: the book closes, the spine goes, Undo brings it back untouched ──
  await book.click();
  await more().click();
  await open.getByRole('menuitem', { name: /^Delete this paper/ }).click();
  const toast = page.getByText(/^Deleted “My Attention”/);
  await expect(toast).toBeVisible();
  await expect(book).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(book).toBeVisible();
  await expect(book).toBeFocused();
  expect(deletes).toEqual([]); // nothing was sent while Undo was on offer

  // ── Delete again and let the 10 s run out: only then does the request go ──
  await book.click();
  await more().click();
  const gone = page.waitForResponse(
    (r) => r.url().endsWith(`/papers/${paperId}`) && r.request().method() === 'DELETE',
    { timeout: 30_000 },
  );
  await open.getByRole('menuitem', { name: /^Delete this paper/ }).click();
  await expect(book).toHaveCount(0);
  expect(deletes).toEqual([]);
  expect((await gone).status()).toBe(204);
  const listed = (await (
    await fetch(`${stack.apiUrl}/papers`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { paper_id: string }[];
  expect(listed.map((p) => p.paper_id)).not.toContain(paperId);
});

test('the spread’s At a glance sheet: made when the paper was added, every field, p. n › on hover, a click opens the reader there, the abstract folds', async ({
  page,
  stack,
}) => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );
  test.setTimeout(600_000);
  const token = await register(stack.apiUrl, `e2e-glance-${String(Date.now())}@papertree.test`);
  const paperId = await upload(stack.apiUrl, token, ATTENTION);
  await waitParsed(stack.apiUrl, token, paperId);
  await page.setViewportSize({ width: 1440, height: 900 });
  await tokenInit(page, token);
  await page.goto('/dashboard');
  const book = page.locator(`[aria-label="Your shelf"] button[data-paper-id="${paperId}"]`);
  await expect(book).toHaveAttribute('data-spine-state', 'ready', { timeout: 60_000 });
  // Reading the library started the run in the background (the faux agent writes the canned sheet
  // of `services/agent/src/faux.ts`, `FAUX_GLANCE`); the sheet is cached, never asked for twice.
  await expect
    .poll(
      async () => {
        const answer = await fetch(`${stack.apiUrl}/papers/${paperId}/glance`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return ((await answer.json()) as { state: string }).state;
      },
      { timeout: 90_000 },
    )
    .toBe('ready');

  await book.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Attention Is All You Need' });
  await expect(dialog).toHaveAttribute('data-book-stage', 'open');
  const section = dialog.getByRole('region', { name: 'Paper at a glance' });
  const sheet = section.locator('[data-glance="ready"]');
  await expect(sheet).toBeVisible();
  // The abstract is the paper, above the sheet; the sheet is the AI, with a quiet model line.
  await expect(section.getByText(/^M3/)).toBeVisible();
  await expect(sheet).toContainText('A canned glance for the tests: one sentence');
  for (const label of ['Problem', 'Idea', 'How it works', 'Results', 'Limits', 'Read first']) {
    await expect(sheet.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(sheet.getByText('Words to know')).toBeVisible();
  await expect(sheet.getByText('0.42%')).toBeVisible();
  await expect(sheet.getByText('faux error, MNIST')).toBeVisible();
  await expect(sheet.getByText('0.22M')).toBeVisible();
  await expect(sheet.locator('.pt-glance__term')).toHaveText([
    'ODE',
    'Euler method',
    'adjoint method',
    'normalizing flow',
    'Lipschitz',
  ]);
  await expect(sheet.locator('.pt-math .katex')).toHaveCount(1); // $f(x) = x^2$, typeset
  await expect(sheet).not.toContainText(/stands on|verified|\$/i);

  // No page mark at rest; hover shows `p. 1 ›` (Problem cites the abstract); a click opens the reader.
  const problem = sheet.locator('a[data-glance-page="1"]').first();
  const mark = problem.locator('.pt-glance__page');
  await expect(mark).toHaveText('p. 1 ›');
  await expect(mark).toHaveCSS('opacity', '0');
  await problem.hover();
  await expect(mark).toHaveCSS('opacity', '1');

  // The abstract folds to two lines; "all of it" unfolds it.
  const fold = dialog.locator('.pt-bookdetails__fold');
  await expect(fold).toHaveAttribute('data-folded', 'true');
  await dialog.getByRole('button', { name: /all of it/ }).click();
  await expect(fold).toHaveAttribute('data-folded', 'false');
  await dialog.getByRole('button', { name: /fold it/ }).click();
  await expect(fold).toHaveAttribute('data-folded', 'true');
  // A paper not yet started says Read, with no "from the start".
  await expect(dialog.getByRole('link', { name: /from the start/ })).toHaveCount(0);

  await problem.click();
  await page.waitForURL(`**/paper/${paperId}/read?from=book&page=1`);
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
