/**
 * S4 regression — the selection toolbar is ON TOP of the text layer (slice-plan §S4).
 *
 * THE BASELINE DEFECT, as the walk found it (journey-baseline §B): with a live selection,
 * `document.elementFromPoint()` at the Highlight button's centre returned a text-layer `<span>`. The
 * toolbar lived in the page's `pointer-events: none` overlay slot, so a real mouse click went
 * through it to the text, collapsed the selection, and captured nothing; Playwright's own
 * `locator.click()` refused for 30 s because the span "intercepts pointer events". Only Enter on a
 * focused button worked.
 *
 * So this asserts it the way it failed: the element at the button's centre IS the button — for
 * every toolbar button — and then a real `mouse.click` there creates a highlight (`POST` → 201).
 * On an UPLOADED corpus paper through the real API and worker; the corpus is fetched, not
 * committed, so without it the spec skips and says why.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import {
  REPO,
  drag,
  hitTest,
  pointsFor,
  register,
  reveal,
  shotPath,
  upload,
  waitParsed,
} from './support';

const PDF = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');

test.describe('S4 toolbar hit test', () => {
  test.skip(
    !existsSync(PDF),
    `SKIPPED: ${PDF} is absent. The corpus PDFs are fetched, not committed — run ` +
      './research/benchmarks/fetch_corpus.sh, then re-run this spec.',
  );

  test('the element under each toolbar button is that button, and a mouse click highlights', async ({
    browser,
    stack,
  }, testInfo) => {
    test.setTimeout(420_000);
    const token = await register(stack.apiUrl, `e2e-s4-hit-${String(Date.now())}@papertree.test`);
    const paperId = await upload(stack.apiUrl, token, PDF);
    await waitParsed(stack.apiUrl, token, paperId);

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem('papertree.session', t);
      } catch {
        /* the walk needs storage */
      }
    }, token);
    const page = await context.newPage();
    await page.goto(`/paper/${paperId}/read`);
    await expect
      .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
        timeout: 180_000,
      })
      .toBeGreaterThan(50);
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');

    await reveal(page, 'The dominant sequence transduction');
    const points = await pointsFor(page, 'The dominant sequence transduction', 'decoder.');
    await drag(page, points.from, points.to);
    await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible();

    for (const name of ['Highlight', 'Ask about this passage', 'Send to canvas', 'Copy']) {
      const { hit } = await hitTest(page, name);
      console.log(`[e2e s4] elementFromPoint at the "${name}" button centre: ${hit}`);
      expect(hit, `the element at the "${name}" button's centre must be that button`).toBe(
        'button',
      );
    }
    await page.screenshot({
      path: shotPath('t01-toolbar-hit-test-1440.png', testInfo.outputPath('shots')),
    });

    const { x, y } = await hitTest(page, 'Highlight');
    const posted = page.waitForResponse(
      (r) => r.url().endsWith(`/papers/${paperId}/highlights`) && r.request().method() === 'POST',
    );
    await page.mouse.click(x, y);
    expect((await posted).status()).toBe(201);
    await expect(page.locator('svg .pt-hl')).toHaveCount(1);
    await context.close();
  });
});
