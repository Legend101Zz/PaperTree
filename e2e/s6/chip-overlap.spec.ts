/**
 * W2UI #141 item 12: two citation chips whose 40 px hit areas overlap. A real mouse click in the
 * overlap must open the chip whose pill is under (or nearest) the pointer, not the later chip.
 *
 * The faux answer's chips rarely land on adjacent text lines, so the geometry is staged: two real
 * chips from the real answer are moved (DOM only) into a probe column inside the answer, 2 px
 * apart, which is exactly what two adjacent lines produce. Each chip records the clicks it
 * receives; the click on the lower edge of the upper pill must reach the UPPER chip.
 */
import { expect, test } from '../harness/test';
import {
  drag,
  pointsFor,
  register,
  reveal,
  shotPath,
  upload,
  waitParsed,
  yoloPdf,
} from '../s4/support';

const YOLO = yoloPdf();

test.describe('S6 chip hit areas', () => {
  test.skip(YOLO === null, 'SKIPPED: the YOLO PDF is not present (see explain-faux.spec.ts).');

  test('a click in the overlap of two chips opens the nearer one', async ({
    browser,
    stack,
  }, testInfo) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const token = await register(
      stack.apiUrl,
      `e2e-w2ui-chip-${String(Date.now())}@papertree.test`,
    );
    const paperId = await upload(stack.apiUrl, token, YOLO as string);
    await waitParsed(stack.apiUrl, token, paperId);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem('papertree.session', t);
      } catch {
        /* not this walk */
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
    await reveal(page, 'We reframe object');
    const points = await pointsFor(page, 'We reframe object', 'class probabilities.');
    await drag(page, points.from, points.to);
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' });
    await toolbar.getByRole('button', { name: /Ask/ }).click();
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel.locator('[data-message-status]').first()).toHaveAttribute(
      'data-message-status',
      'complete',
      {
        timeout: 120_000,
      },
    );
    const chips = panel.locator('.pt-explain__prose [data-citation-id]');
    test.skip((await chips.count()) < 2, 'SKIPPED: the faux answer cited fewer than two passages.');

    const staged = await page.evaluate(() => {
      const prose = document.querySelector<HTMLElement>('[data-explain-panel] .pt-explain__prose');
      const found = Array.from(prose?.querySelectorAll<HTMLElement>('[data-citation-id]') ?? []);
      if (prose === null || found.length < 2) return null;
      const [upper, lower] = found as [HTMLElement, HTMLElement];
      const probe = document.createElement('div');
      probe.setAttribute('data-chip-probe', '');
      probe.style.cssText =
        'display:flex;flex-direction:column;align-items:flex-start;gap:2px;margin:24px 0';
      prose.appendChild(probe);
      probe.append(upper, lower);
      const log: string[] = [];
      (window as unknown as { __chipClicks: string[] }).__chipClicks = log;
      upper.addEventListener('click', () => log.push('upper'));
      lower.addEventListener('click', () => log.push('lower'));
      upper.scrollIntoView({ block: 'center' });
      return true;
    });
    expect(staged).toBe(true);
    await page.waitForTimeout(300);

    const rects = await page.evaluate(() => {
      const [upper, lower] = Array.from(
        document.querySelectorAll<HTMLElement>('[data-chip-probe] .pt-chip'),
      ) as [HTMLElement, HTMLElement];
      const u = upper.getBoundingClientRect();
      const l = lower.getBoundingClientRect();
      return { u: u.toJSON() as DOMRect, l: l.toJSON() as DOMRect };
    });
    // The hit areas really do overlap (that is the staged condition), 6 px above and below a pill.
    expect(rects.l.top - 6).toBeLessThan(rects.u.bottom + 6);
    await page.screenshot({ path: shot('w2-12-chip-overlap-1440.png') });

    const clicks = () =>
      page.evaluate(() => (window as unknown as { __chipClicks: string[] }).__chipClicks.slice());
    const x = rects.u.left + rects.u.width / 2;
    // 3 px above the upper pill's bottom edge: inside the upper pill, and inside the lower chip's
    // 6 px hit padding. The browser hands it to the lower chip; the fix hands it back.
    await page.mouse.click(x, rects.u.bottom - 3);
    await expect.poll(clicks).toEqual(['upper']);
    // 3 px below the lower pill's top edge is the lower pill's own ground.
    await page.mouse.click(x, rects.l.top + 3);
    await expect.poll(clicks).toEqual(['upper', 'lower']);
    // Clearly inside each pill, as before.
    await page.mouse.click(x, rects.u.top + 6);
    await page.mouse.click(x, rects.l.bottom - 6);
    await expect.poll(clicks).toEqual(['upper', 'lower', 'upper', 'lower']);
    await context.close();
  });
});
