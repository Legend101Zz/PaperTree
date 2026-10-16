/**
 * v0.2 prototype steps 6–8 (frame 12, #202) on the FAUX agent: select a sentence on p. 1 of
 * "Attention Is All You Need" → Explain → the exchange (call slip, AI slip with numbered markers,
 * coverage, trace) → hovering marker 2 lights trace row 2 → Show in paper scrolls to passage 2 and
 * flashes it, with the margin tab "from marker 2 in the answer" beside it; the faint outline stays
 * until the next action.
 *
 * The faux model quotes the first two seed passages the API planned for the selection, so the
 * answer has exactly the markers 1 and 2: this proves the wiring (numbering, lighting, the flash),
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

test.describe('v0.2 steps 6–8: select → Explain → marker 2 lights passage 2 (faux agent)', () => {
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
    await expect(exchange.locator('.pt-coverage')).toContainText('Stands on 2 passages');
    await expect(exchange.locator('[data-usage-line]')).toContainText('(estimate)');
    const text = (await panel.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/\[b\d+\]|\bmsg_|\bthr_|\brun_|\bblk_|\{"/);
    expect(text).not.toMatch(/\bverified\b(?<!not verified)|fact-checked|\baccurate\b/i);
    expect(await panel.locator('.pt-chip').count()).toBe(0);
    await page.screenshot({ path: shot('v02-trace-01-exchange-1440.png') });

    // ── step 8: marker 2 lights passage 2, and Show in paper flashes it ──
    const marker2 = exchange.locator('[data-passage="2"] button').first();
    const row2 = exchange.locator('.pt-trace-row[data-n="2"]');
    await marker2.hover();
    await expect(row2).toHaveAttribute('data-lit', 'true');
    await expect(exchange.locator('.pt-trace-row[data-n="1"]')).not.toHaveAttribute(
      'data-lit',
      'true',
    );
    await page.screenshot({ path: shot('v02-trace-02-marker2-lit-1440.png') });

    await row2.getByRole('button', { name: 'Show in paper, passage 2' }).click();
    const flash = page.locator('svg [data-flash="true"] polygon.pt-flash');
    await expect(flash.first()).toBeVisible({ timeout: 10_000 });
    const tab = page.locator('[data-flash-tab="2"]');
    await expect(tab).toContainText('from marker 2 in the answer');
    // After the 240 ms scroll the flashed passage is on screen, its tab level with it in the margin.
    await page.waitForTimeout(500);
    const [box, tabBox] = await Promise.all([flash.first().boundingBox(), tab.boundingBox()]);
    expect((box?.y ?? -1) >= 0 && (box?.y ?? 1e9) < 900).toBe(true);
    expect(box).not.toBeNull();
    expect(tabBox).not.toBeNull();
    expect((tabBox?.x ?? 0) + (tabBox?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + 1);
    expect(Math.abs((tabBox?.y ?? 0) - (box?.y ?? 0))).toBeLessThan(40);
    await page.screenshot({ path: shot('v02-trace-03-flash-1440.png') });

    // After in 180 + hold 900 + out 600 a faint outline stays, until the next action.
    await page.waitForTimeout(1_400);
    await expect(flash.first()).toBeVisible();
    const rest = await flash.first().evaluate((el) => getComputedStyle(el).strokeOpacity);
    expect(Number(rest)).toBeGreaterThan(0);
    expect(Number(rest)).toBeLessThan(1);
    await page.mouse.click(5, 450);
    await expect(page.locator('svg [data-flash="true"]')).toHaveCount(0);
    await expect(tab).toHaveCount(0);
    await context.close();
  });
});
