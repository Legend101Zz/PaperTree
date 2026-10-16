/**
 * v0.2 S7b (#217, frames 07a–07c) on the FAUX agent: select §3.2.1's first paragraph on p. 4 of
 * "Attention Is All You Need" → Explain with a diagram → the six parts of `[faux:diagram]` arrive on
 * the plate → tap part B → its passage flashes in the paper with "from part B" beside it → Send to
 * board → the board shows the diagram card with the plate drawn small and its counts.
 *
 * The toolbar sends the server's default ask; this walk adds the faux scenario's tag to that one
 * request (`page.route`), so the faux model draws the frames' plate instead of its generic one.
 * Everything else is the real stack. The PDF is the committed corpus's; the spec SKIPS, loudly,
 * without it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import {
  drag,
  pointsFor,
  register,
  REPO,
  reveal,
  shotPath,
  upload,
  waitParsed,
} from '../s4/support';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');

test.describe('v0.2 S7b: Explain with a diagram → the plate → tap a part → Send to board', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );

  test('the plate builds, a part flashes its passage, and lands on the board', async ({
    browser,
    stack,
  }, info) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, info.outputPath('shots'));

    const token = await register(
      stack.apiUrl,
      `e2e-v02-plate-${String(Date.now())}@papertree.test`,
    );
    const paperId = await upload(stack.apiUrl, token, ATTENTION);
    await waitParsed(stack.apiUrl, token, paperId);

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem('papertree.session', t);
      } catch {
        /* a context without storage is not this walk */
      }
    }, token);
    const page = await context.newPage();
    await page.route(`**/papers/${paperId}/threads`, async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() ?? '{}') as { kind?: string; question?: string };
      if (request.method() !== 'POST' || body.kind !== 'diagram') return route.continue();
      body.question = '[faux:diagram] Explain with a diagram.';
      return route.continue({ postData: JSON.stringify(body) });
    });
    await page.goto(`/paper/${paperId}/read`);
    await expect
      .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
        timeout: 180_000,
      })
      .toBeGreaterThan(50);
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');

    // ── select §3.2.1 ¶1 and ask for a diagram (07a) ──
    await reveal(page, 'We call our particular attention');
    const points = await pointsFor(page, 'We call our particular attention', 'weights on the');
    await drag(page, points.from, points.to);
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' });
    await toolbar.getByRole('button', { name: 'Explain with a diagram' }).click();
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel).toBeVisible();

    // ── the six parts arrive on the plate (07b → 07c) ──
    const plate = panel.locator('[data-plate-phase="complete"]');
    await expect(plate).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.pt-plate-key [data-letter]')).toHaveCount(6);
    await expect(panel.locator('[data-plate-readout]')).toHaveText(
      '6 parts · 5 cited · drawn by AI from p. 4',
    );
    await expect(panel.locator('[data-letter="F"]')).toContainText('Inferred, no passage');
    await expect(panel.locator('[data-usage-line]')).toContainText('(estimate)');
    const text = (await panel.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/\bmsg_|\bthr_|\brun_|\bblk_|\{"/);
    expect(text).not.toMatch(/\bverified\b(?<!not verified)|fact-checked|\baccurate\b/i);
    await page.screenshot({ path: shot('v02-plate-01-done-1440.png') });

    // ── tap part B: its passage flashes, the margin tab names the part ──
    await panel.getByRole('button', { name: /^Part B, / }).click();
    const flash = page.locator('svg [data-flash="true"] polygon.pt-flash');
    await expect(flash.first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-flash-tab]')).toContainText('from part B');
    await page.waitForTimeout(500);
    const box = await flash.first().boundingBox();
    expect((box?.y ?? -1) >= 0 && (box?.y ?? 1e9) < 900).toBe(true);
    await page.screenshot({ path: shot('v02-plate-02-flash-B-1440.png') });

    // ── Send to board → the board shows the diagram card ──
    await panel.getByRole('button', { name: 'Send to board' }).click();
    await expect(panel.getByRole('button', { name: 'On your board' })).toBeVisible();
    await page.goto(`/paper/${paperId}/board`);
    const card = page.locator('[data-plate-mini="6"]');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('6 parts · 5 cited')).toBeVisible();
    await expect(page.getByText('Scaled dot-product attention').first()).toBeVisible();
    await page.screenshot({ path: shot('v02-plate-03-board-1440.png') });
    await context.close();
  });
});
