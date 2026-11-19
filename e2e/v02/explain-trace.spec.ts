/**
 * v0.2 prototype steps 6–8 (frame 12, #202, #340) on the FAUX agent: select a sentence on p. 1 of
 * "Attention Is All You Need" → Explain → the exchange (call slip, AI slip, one quiet source line
 * "From the paper: p. …" under the paragraph; no chip, marker, readout or margin flag) → hovering a
 * page peeks the passage → clicking it scrolls to the passage and flashes it, with no margin tab;
 * the faint outline stays until the next action.
 *
 * The faux model quotes the first two seed passages the API planned for the selection, so the
 * paragraph draws on those pages: this proves the wiring (the source line, the peek, the flash),
 * not answer quality. The PDF is the committed corpus's; the spec SKIPS, loudly, without it.
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

test.describe('v0.2 steps 6–8: select → Explain → the source line flashes the passage (faux agent)', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );

  test('the exchange, marker ↔ trace, and the citation flash', async ({ browser, stack }, info) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, info.outputPath('shots'));

    const token = await register(
      stack.apiUrl,
      `e2e-v02-trace-${String(Date.now())}@papertree.test`,
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
    await page.goto(`/paper/${paperId}/read`);
    await expect
      .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
        timeout: 180_000,
      })
      .toBeGreaterThan(50);
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');

    // ── step 6: select a sentence of the abstract with the mouse ──
    await reveal(page, 'We propose a new simple network architecture');
    const points = await pointsFor(
      page,
      'We propose a new simple network architecture',
      'entirely.',
    );
    await drag(page, points.from, points.to);
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' });
    await expect(toolbar).toBeVisible();

    // ── step 7: Explain → the exchange ──
    await toolbar
      .getByRole('button', { name: /Explain|Ask/ })
      .first()
      .click();
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel).toBeVisible();
    const exchange = panel.locator('[data-exchange]').first();
    await expect(exchange.locator('[data-explain-quote] [data-voice="paper"]')).toContainText(
      'We propose a new simple network architecture',
    );
    await expect(exchange.locator('.pt-call-slip [data-voice="you"]')).toHaveText(
      'Explain this passage.',
    );
    await expect(exchange.locator('[data-message-status="complete"]')).toBeVisible({
      timeout: 120_000,
    });
    await expect(exchange.locator('[data-voice="ai"]')).toContainText('The selected passage says');
    // One quiet source line under the paragraph, and nothing that audits the AI.
    const source = exchange.locator('.pt-source[data-source="paper"]').first();
    await expect(source).toContainText('From the paper: p.');
    await expect(exchange.locator('.pt-coverage, .pt-trace-list, .pt-marker')).toHaveCount(0);
    await expect(exchange.locator('[data-usage-line]')).toContainText('(estimate)');
    const text = (await panel.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/\[b\d+\]|\bmsg_|\bthr_|\brun_|\bblk_|\{"/);
    expect(text).not.toMatch(/\bverified\b|fact-checked|\baccurate\b|Stands on|grounded/i);
    expect(await panel.locator('.pt-chip').count()).toBe(0);
    await page.screenshot({ path: shot('v02-trace-01-exchange-1440.png') });

    // ── step 8: hovering a page peeks the passage, and clicking it flashes it ──
    const page1 = source.getByRole('button').first();
    await page1.hover();
    await expect(source.locator('[role="tooltip"]').first()).toBeVisible();
    await page.screenshot({ path: shot('v02-trace-02-peek-1440.png') });

    await page1.click();
    const flash = page.locator('svg [data-flash="true"] polygon.pt-flash');
    await expect(flash.first()).toBeVisible({ timeout: 10_000 });
    // No floating margin tab: the passage flashes on its own.
    await expect(page.locator('[data-flash-tab], .pt-flash-tab')).toHaveCount(0);
    // After the 240 ms scroll the flashed passage is on screen.
    await page.waitForTimeout(500);
    const box = await flash.first().boundingBox();
    expect((box?.y ?? -1) >= 0 && (box?.y ?? 1e9) < 900).toBe(true);
    expect(box).not.toBeNull();
    await page.screenshot({ path: shot('v02-trace-03-flash-1440.png') });

    // After in 180 + hold 900 + out 600 (from the end of the scroll) the ring and wash are over,
    // and a faint outline stays until the next action. Waited out, not sampled mid-fade.
    await expect(page.locator('svg [data-flash="true"]')).toHaveCount(0, { timeout: 4_000 });
    const linger = page.locator('svg [data-flash="linger"] polygon.pt-flash--linger');
    await expect(linger.first()).toBeVisible();
    await page.waitForTimeout(400);
    const rest = await linger.first().evaluate((el) => getComputedStyle(el).strokeOpacity);
    // 0.6: the outline keeps 3:1 on the page (WCAG 1.4.11, #205); 0.35 was 1.8:1.
    expect(Number(rest)).toBeCloseTo(0.6, 2);
    await page.mouse.click(5, 450);
    await expect(page.locator('svg [data-flash]')).toHaveCount(0);
    await context.close();
  });
});
