/**
 * S2e (#196, v0.3 #337) on the real stack: a new account → one corpus PDF goes up → it stands on
 * the shelf as a spine → a click takes it off the shelf and opens it, Read goes to p. 3 → back in
 * the library the Reading now strip says "p. 3 of 15" with Continue → Continue opens the reader on
 * p. 3, from the place the server stored (the browser's own place is cleared first, so this is the
 * cross-device path, not the reader restoring itself).
 *
 * The e2e web runs with the committed sample papers ON (harness/stack.ts), for every spec at once,
 * so a new account is not empty: it shows the three samples, and that is asserted as it is. On a
 * web without samples the same spec walks the accession slip (01b) instead. The slip itself is
 * covered by apps/web/test/library-states.spec.tsx either way. One sample shares its title with
 * the upload ("Attention Is All You Need"), so the uploaded book is found by its paper id only.
 *
 * Reading now stands above the spines at every size (owner decision D). The PDF is the committed corpus's; the spec SKIPS, loudly, without it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Locator } from '@playwright/test';

import { expect, test } from '../harness/test';
import { register, REPO, shotPath, topLine, waitParsed } from '../s4/support';
import { tokenInit } from '../s7/support';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');

test.use({ actionTimeout: 20_000 });

test('empty → upload → read to p. 3 → the library says p. 3 → Continue opens p. 3', async ({
  page,
  stack,
}, info) => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );
  test.setTimeout(600_000);
  const shot = (name: string) => shotPath(name, info.outputPath('shots'));
  const token = await register(stack.apiUrl, `e2e-s2e-${String(Date.now())}@papertree.test`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await tokenInit(page, token);

  // ── a new account: the accession slip, or (samples on) the samples and no slip ──
  await page.goto('/dashboard');
  const shelf = page.getByRole('toolbar', { name: 'Shelf' });
  const slip = page.getByRole('region', { name: 'Drop PDFs here or choose files' });
  await expect(slip.or(shelf)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Shelf' })).toBeVisible();
  let choose: Locator;
  if (await slip.isVisible()) {
    await expect(page.getByText('No papers yet', { exact: true })).toBeVisible();
    choose = slip.getByRole('button', { name: 'choose files' });
  } else {
    const samples = await shelf
      .locator('button[data-paper-id]')
      .evaluateAll((all) => all.map((el) => el.getAttribute('data-paper-id') ?? ''));
    const note = `sample papers are on (${samples.join(', ')}): no accession slip on this stack`;
    console.log(`[e2e s2e] ${note}; the empty slip is covered by library-states.spec.tsx`);
    info.annotations.push({ type: 'samples', description: note });
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.some((id) => id.startsWith('ppr_'))).toBe(false);
    await expect(slip).toHaveCount(0);
    choose = page.getByRole('button', { name: 'Add papers', exact: true });
  }
  await page.screenshot({ path: shot('s2e-new-account-1440.png') });

  // ── the picker; the PDF goes up and stands as a spine ──
  const chooser = page.waitForEvent('filechooser');
  await choose.click();
  const posted = page.waitForResponse(
    (r) => r.url() === `${stack.apiUrl}/papers` && r.request().method() === 'POST',
  );
  await (await chooser).setFiles(ATTENTION);
  const paperId = ((await (await posted).json()) as { paper_id: string }).paper_id;
  await waitParsed(stack.apiUrl, token, paperId);
  const spine = shelf.locator(`button[data-paper-id="${paperId}"]`);
  await expect(spine).toHaveClass(/pt-spine/, { timeout: 60_000 });
  await expect(spine).toHaveAttribute('data-spine-state', 'ready', { timeout: 60_000 });

  // ── take it off the shelf and open it, then Read; the reader tells the server ──
  await spine.click();
  await page
    .locator('[role="dialog"][data-book-stage="open"]')
    .getByRole('button', { name: /^(Read|Continue at p\. \d+) / })
    .click();
  await page.waitForURL(`**/paper/${paperId}/read`);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await expect(page.locator('.papertree-text-layer span[data-item-index]').first()).toBeAttached({
    timeout: 120_000,
  });
  await page.getByRole('button', { name: /^Contents/ }).click();
  await page.getByRole('tab', { name: 'Pages' }).click();
  const stored = page.waitForResponse(
    (r) =>
      r.url() === `${stack.apiUrl}/papers/${paperId}/reading-state` &&
      r.request().method() === 'PUT' &&
      (r.request().postDataJSON() as { last_page?: number }).last_page === 2,
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Go to page 3' }).click();
  await page.keyboard.press('Escape');
  expect((await stored).status()).toBe(204);

  // ── back in the library: the Reading now strip says where you are ──
  // Clear this browser's own place, so Continue must use the server's (the other-device path).
  await page.evaluate((id) => window.localStorage.removeItem(`papertree/reader/${id}`), paperId);
  await page.goto('/dashboard');
  const strip = page.locator(`[data-reading-paper-id="${paperId}"]`);
  await expect(strip).toContainText('p. 3 of 15', { timeout: 60_000 });
  await expect(spine.locator('.pt-spine__ribbon')).toBeAttached();
  await expect(page.locator('.pt-libtitle__stats')).toContainText('1 reading now');
  await page.screenshot({ path: shot('s2e-reading-p3-1440.png') });

  // ── the opened book says it too: Read has become "Continue at p. 3", with focus on it ──
  await spine.click();
  const reopened = page.locator('[role="dialog"][data-book-stage="open"]');
  await expect(reopened.getByRole('button', { name: /^Continue at p\. 3 / })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(reopened).toHaveCount(0);

  // ── Continue opens the reader on p. 3 ──
  await strip.getByRole('button', { name: 'Continue reading Attention Is All You Need' }).click();
  await page.waitForURL(`**/paper/${paperId}/read`);
  await expect(page.locator('.papertree-text-layer span[data-item-index]').first()).toBeAttached({
    timeout: 120_000,
  });
  await expect.poll(async () => (await topLine(page)).page, { timeout: 30_000 }).toBe(2);
  await page.screenshot({ path: shot('s2e-continue-p3-1440.png') });
});
