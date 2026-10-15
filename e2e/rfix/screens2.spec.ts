/**
 * RFIX2 screens: every state this round touches, at 1440x900 and 390x844, light and dark, on DDPM.
 * The 390 px header (H390) is MEASURED: no horizontal scroll, the title on one line, every control
 * of the bar at least 40 px, Source / Guided / Split reachable. Screenshots go to PAPERTREE_E2E_SHOTS.
 */
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { drag, REPO, shotPath } from '../s4/support';
import { register, revealText, spanBoxAny, upload, waitParsed } from './support';

const DDPM = join(REPO, 'research', 'benchmarks', 'fresh', 'pdfs', 'ddpm-2006.11239.pdf');

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

test('RFIX2 screens - the header, a selection, a highlight, Guided with one crop', async ({
  browser,
  stack,
}, testInfo) => {
  test.setTimeout(900_000);
  const note = (line: string): void => console.log(`[e2e rfix2 screens] ${line}`);
  const shot = (name: string): string => shotPath(name, testInfo.outputPath('shots'));
  const token = await register(stack.apiUrl, `e2e-rfix2-screens-${String(Date.now())}@papertree.test`);
  const paperId = await upload(stack.apiUrl, token, DDPM);
  await waitParsed(stack.apiUrl, token, paperId);

  for (const size of SIZES) {
    for (const scheme of SCHEMES) {
      const tag = `${size.name}-${scheme}`;
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1,
        colorScheme: scheme,
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
        .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), { timeout: 180_000 })
        .toBeGreaterThan(50);
      expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
      if (size.width > 600) {
        await page.getByLabel('Zoom level').selectOption('1.25');
        await page.waitForTimeout(800);
      }

      // ── the header ──
      const bar = await page.evaluate(() => {
        const header = document.querySelector('.pt-reader__bar') as HTMLElement;
        const title = header.querySelector('.pt-reader__title') as HTMLElement;
        const controls = Array.from(
          header.querySelectorAll('a, button, select, [role="radio"], label'),
        )
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && !el.classList.contains('sr-only');
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              what: `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}`,
              w: Math.round(r.width),
              h: Math.round(r.height),
              left: Math.round(r.left),
              right: Math.round(r.right),
            };
          });
        const t = title.getBoundingClientRect();
        return {
          docWidth: document.documentElement.scrollWidth,
          titleHeight: Math.round(t.height),
          titleTruncated: title.scrollWidth > title.clientWidth,
          titleWidth: Math.round(t.width),
          headerHeight: Math.round(header.getBoundingClientRect().height),
          controls,
        };
      });
      note(`${tag}: header ${JSON.stringify({ ...bar, controls: undefined })}`);
      note(`${tag}: controls ${bar.controls.map((c) => `${c.what} ${String(c.w)}x${String(c.h)}`).join('; ')}`);
      expect(bar.docWidth, 'no horizontal scroll').toBe(size.width);
      expect(bar.titleHeight, 'the title is one line').toBeLessThan(32);
      for (const c of bar.controls) {
        if (c.what.startsWith('label')) continue;
        expect(c.h, `${c.what} is at least 40 px tall`).toBeGreaterThanOrEqual(40);
        expect(c.right, `${c.what} is inside the window`).toBeLessThanOrEqual(size.width);
      }
      for (const name of ['Source', 'Guided', 'Split']) {
        await expect(page.getByRole('radio', { name })).toBeVisible();
      }
      await page.screenshot({ path: shot(`h390-header-${tag}.png`) });

      // ── a selection and its bar, then the highlight ──
      await revealText(page, 'Since our simplified objective');
      await page.waitForTimeout(700);
      const a = await spanBoxAny(page, 'Since our simplified objective');
      await drag(
        page,
        { x: a.left + 0.5, y: (a.top + a.bottom) / 2 },
        { x: a.right - 2, y: (a.top + a.bottom) / 2 + 40 },
      );
      const button = page.getByRole('button', { name: 'Highlight', exact: true });
      await expect(button).toBeVisible();
      await page.screenshot({ path: shot(`selection-bar-${tag}.png`) });
      const scrollerTop = () =>
        page.evaluate(() => (document.querySelector('[data-papertree-scroller]') as HTMLElement).scrollTop);
      const before = await scrollerTop();
      await button.click();
      await page.waitForTimeout(1200);
      expect(await scrollerTop(), 'Highlight does not move the page').toBe(before);
      await page.screenshot({ path: shot(`highlighted-${tag}.png`) });

      // ── Guided: one crop, one caption, the reading position kept ──
      await page.getByRole('radio', { name: 'Guided' }).click();
      await page.waitForTimeout(1500);
      const guided = await page.evaluate(() => {
        const sc = document.querySelector('[data-guided-scroller]') as HTMLElement;
        return { scrollTop: sc.scrollTop, docWidth: document.documentElement.scrollWidth };
      });
      expect(guided.scrollTop, 'Guided keeps the reading position').toBeGreaterThan(200);
      expect(guided.docWidth).toBe(size.width);
      await page.screenshot({ path: shot(`guided-position-${tag}.png`) });
      await page.evaluate(() => {
        const card = Array.from(document.querySelectorAll('[data-guided-para]')).find((c) =>
          (c.textContent ?? '').includes('Figure 2: The directed graphical model'),
        );
        card?.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(700);
      await page.screenshot({ path: shot(`guided-figure-${tag}.png`) });

      // ── Split keeps the bar usable ──
      await page.getByRole('radio', { name: 'Split' }).click();
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
      await page.screenshot({ path: shot(`split-${tag}.png`) });
      await context.close();
    }
  }
});
