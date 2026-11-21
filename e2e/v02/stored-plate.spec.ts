/**
 * v0.2 S7b (#217, frames 07b–07c) on the FAUX agent: a diagram thread STORED by v0.2 still renders
 * in the explain panel. The reader no longer starts a diagram (diagrams live inside answers,
 * #339), so the thread is made through the API (`[faux:diagram]`, as `drawPlate` does) and the
 * reader is opened on it (`?thread=`, the link a dived notebook page's Back to the paper uses) →
 * the six parts of the plate stand in the panel with their counts → tap part B → its passage
 * flashes in the paper with "from part B" beside it → Send to board → the board shows the diagram
 * card with the plate drawn small and its counts.
 *
 * Everything else is the real stack. The PDF is the committed corpus's; the spec SKIPS, loudly,
 * without it.
 */
import { existsSync } from 'node:fs';

import { expect, test } from '../harness/test';
import { register, shotPath, upload, userId, waitParsed } from '../s4/support';
import { ATTENTION, drawPlate, mintAnchor } from './flow-support';

test.describe('v0.2 S7b: a stored plate in the explain panel → tap a part → Send to board', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );

  test('the stored plate reads back, a part flashes its passage, and lands on the board', async ({
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
    const user = await userId(stack.apiUrl, token);
    const plate = await drawPlate(
      stack.apiUrl,
      token,
      paperId,
      mintAnchor(stack.dataRoot, user, paperId, 'We call our particular attention'),
    );

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
    await page.goto(`/paper/${paperId}/read?thread=${plate.threadId}`);
    await expect
      .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
        timeout: 180_000,
      })
      .toBeGreaterThan(50);
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');

    // ── the six parts stand on the plate, read back from the stored thread ──
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('[data-plate-phase="complete"]')).toBeVisible({ timeout: 60_000 });
    await expect(panel.locator('.pt-plate-key [data-letter]')).toHaveCount(6);
    await expect(panel.locator('[data-plate-readout]')).toHaveText(
      '6 parts · drawn by AI from p. 4',
    );
    // A part that came from a passage has one quiet page; the one that did not has none (#340).
    await expect(panel.locator('.pt-plate-key__source')).toHaveCount(5);
    await expect(panel.locator('[data-letter="F"] .pt-plate-key__source')).toHaveCount(0);
    await expect(panel.locator('[data-usage-line]')).toContainText('(estimate)');
    const text = (await panel.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/\bmsg_|\bthr_|\brun_|\bblk_|\{"/);
    expect(text).not.toMatch(/\bverified\b|fact-checked|\baccurate\b|\bgrounded\b|Stands on/i);
    await page.screenshot({ path: shot('v02-plate-01-stored-1440.png') });

    // ── tap part B: its passage flashes (no margin tab) ──
    await panel.getByRole('button', { name: /^Part B:/ }).click();
    // The outline is painted in `flash` (1.7 s) and STAYS in `linger` until the reader's next action
    // (`reader/flash`), so the spec matches both: on a CI runner whose main thread is busy painting
    // page 4 the first paint can land at the very end of the 1.7 s `flash` phase, and a selector
    // pinned to `data-flash="true"` then never matches again (`boundingBox` waited out the 10 min
    // test timeout).
    const flash = page.locator('svg [data-flash] polygon.pt-flash');
    await expect(flash.first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-flash-tab], .pt-flash-tab')).toHaveCount(0);
    // The page is on screen once the scroll has settled: poll the box, never sleep a fixed 500 ms.
    await expect
      .poll(async () => {
        const y = (await flash.first().boundingBox({ timeout: 5_000 }))?.y ?? -1;
        return y >= 0 && y < 900;
      })
      .toBe(true);
    // WHERE it flashed: the text-layer lines under the polygon are §3.2.1 ¶1, which holds B's quote.
    const flashed = await page.evaluate(() => {
      const poly = document.querySelector('svg [data-flash] polygon');
      if (poly === null) return '';
      const b = poly.getBoundingClientRect();
      return Array.from(document.querySelectorAll('.papertree-text-layer span[data-item-index]'))
        .filter((s) => {
          const r = s.getBoundingClientRect();
          return (
            r.bottom > b.top + 1 && r.top < b.bottom - 1 && r.right > b.left && r.left < b.right
          );
        })
        .map((s) => s.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ');
    });
    expect(flashed).toContain('We call our particular attention');
    expect(flashed).toContain('We compute the dot products of the');
    await page.screenshot({ path: shot('v02-plate-02-flash-B-1440.png') });

    // ── Send to board → the board shows the diagram card ──
    await panel.getByRole('button', { name: 'Send to board' }).click();
    await expect(panel.getByRole('button', { name: 'On your board' })).toBeVisible();
    await page.goto(`/paper/${paperId}/board`);
    const card = page.locator('[data-plate-mini="6"]');
    await expect(card).toBeVisible({ timeout: 60_000 });
    // The card counts its parts and claims nothing about how well they are backed (no verdicts).
    const node = page.locator('.react-flow__node-diagram');
    await expect(node).toContainText('6 parts');
    await expect(node).not.toContainText(/cited|verified|supported/i);
    await expect(page.getByText('Scaled dot-product attention').first()).toBeVisible();
    await page.screenshot({ path: shot('v02-plate-03-board-1440.png') });
    await context.close();
  });
});
