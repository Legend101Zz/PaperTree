/**
 * S0 smoke: the stack comes up, a user can register THROUGH THE UI, the library loads from the live
 * API, and the reader opens a committed fixture paper with a real text layer.
 *
 * Deliberately small — S0 changes no journey. What it pins is that S0's foundations (the lib/api
 * split, the ReaderActions mount, the registers, the system font) did not break the two things
 * every later walk starts from: signing in, and opening the reader.
 *
 * `document.visibilityState === 'visible'` is ASSERTED, not assumed. AGENTS.md §4: a hidden tab
 * starves requestAnimationFrame, pdf.js never settles, and the text layer silently has 0 spans — so
 * a span count without a visibility check measures the tab, not the code.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';

const FIXTURE = 'resnet-cvpr-2col';
const CORPUS_PDF = join(
  __dirname,
  '..',
  '..',
  'research',
  'benchmarks',
  'corpus',
  `${FIXTURE}.pdf`,
);

test.describe('S0 smoke', () => {
  test('register through the UI, load the library, open a fixture paper with a text layer', async ({
    page,
    stack,
  }) => {
    test.skip(
      !existsSync(CORPUS_PDF),
      `SKIPPED: ${CORPUS_PDF} is absent. The corpus PDFs are fetched, not committed — run ` +
        './research/benchmarks/fetch_corpus.sh, then re-run this spec.',
    );

    // ── register, through the real form ────────────────────────────────────────────────────
    const email = `e2e-s0-${String(Date.now())}@papertree.test`;
    await page.goto('/register');
    await page.locator('input[type="email"]').fill(email);
    const passwords = page.locator('input[type="password"]');
    await passwords.nth(0).fill('e2e-password-1');
    await passwords.nth(1).fill('e2e-password-1');

    const registered = page.waitForResponse(
      (response) =>
        response.url() === `${stack.apiUrl}/auth/register` &&
        response.request().method() === 'POST',
    );
    const library = page.waitForResponse(
      (response) =>
        response.url() === `${stack.apiUrl}/papers` && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Create Account' }).click();

    expect((await registered).status()).toBe(201);
    await page.waitForURL('**/dashboard');
    // The library asked the LIVE API for the user's papers, with the new session, and got them.
    expect((await library).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'My papers' })).toBeVisible();

    // ── open a committed fixture paper in the reader ───────────────────────────────────────
    await page.goto(`/paper/${FIXTURE}/read`);
    const spans = page.locator('.papertree-text-layer span');
    await expect
      .poll(async () => spans.count(), {
        message: 'the reader built no text-layer spans (is the tab foregrounded?)',
        timeout: 120_000,
      })
      .toBeGreaterThan(0);

    const visibility = await page.evaluate(() => document.visibilityState);
    const spanCount = await spans.count();
    console.log(
      `[e2e] s0 smoke: visibilityState=${visibility}, text-layer spans=${String(spanCount)}, ` +
        `api=${stack.apiUrl}, agent=${stack.agent}`,
    );
    expect(visibility).toBe('visible');
    expect(spanCount).toBeGreaterThan(0);
  });
});
