/**
 * RFIX screens: every state this track touches, at 1440x900 and 390x844, light and dark, with the
 * real-mouse R1 drag asserted at both sizes. Screenshots go to PAPERTREE_E2E_SHOTS.
 */
import { expect, test } from '../harness/test';
import { drag, shotPath } from '../s4/support';
import { clearSelection, register, revealText, spanBox, upload, waitParsed, yolo } from './support';

const YOLO = yolo();

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

test.describe('RFIX screens', () => {
  test.skip(
    YOLO === null,
    'SKIPPED: the YOLO PDF is not present (research/benchmarks/fresh/pdfs).',
  );

  test('selection ending in blank space, and the two PDF errors, in both sizes and themes', async ({
    browser,
    stack,
  }, testInfo) => {
    test.setTimeout(900_000);
    const note = (line: string): void => console.log(`[e2e rfix screens] ${line}`);
    const shot = (name: string): string => shotPath(name, testInfo.outputPath('shots'));
    const { token, paperId } = await (async () => {
      const t = await register(
        stack.apiUrl,
        `e2e-rfix-screens-${String(Date.now())}@papertree.test`,
      );
      const id = await upload(stack.apiUrl, t, YOLO as string);
      await waitParsed(stack.apiUrl, t, id);
      return { token: t, paperId: id };
    })();

    for (const size of SIZES) {
      for (const scheme of SCHEMES) {
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
        const tag = `${size.name}-${scheme}`;

        // ── the reader with a drag that ends in blank space ──
        const page = await context.newPage();
        await page.goto(`/paper/${paperId}/read`);
        await expect
          .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
            timeout: 180_000,
          })
          .toBeGreaterThan(50);
        expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
        if (size.width > 600) {
          await page.getByLabel('Zoom level').selectOption('1.25');
          await page.waitForTimeout(800);
        }
        await revealText(page, 'We reframe object detection');
        await page.waitForTimeout(700);
        const first = await spanBox(page, 'We reframe object detection');
        const last = await spanBox(page, 'present and where they are.');
        await drag(
          page,
          { x: first.left + 0.5, y: (first.top + first.bottom) / 2 },
          { x: last.right + 30, y: (last.top + last.bottom) / 2 },
        );
        const text = (await page.evaluate(() => window.getSelection()?.toString() ?? '')).replace(
          /\s+/gu,
          ' ',
        );
        note(
          `${tag}: drag ending right of the short last line selected ${JSON.stringify(text.slice(0, 30))} … ${JSON.stringify(text.slice(-30))}`,
        );
        expect(text.startsWith('We reframe object detection')).toBe(true);
        expect(text.trim().endsWith('where they are.')).toBe(true);
        expect(text).not.toContain('classifier for that object');
        expect(text).not.toContain('Figure 1');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
        await page.screenshot({ path: shot(`rfix-selection-blank-end-${tag}.png`) });
        await clearSelection(page);
        await page.close();

        // ── the engine error ──
        const enginePage = await context.newPage();
        await context.route('**/pdf.worker.min.mjs', (route) =>
          route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }),
        );
        await enginePage.goto(`/paper/${paperId}/read`);
        await expect(enginePage.locator('.pt-state[role="alert"]')).toContainText(
          'could not start its PDF engine',
          { timeout: 120_000 },
        );
        expect(await enginePage.evaluate(() => document.documentElement.scrollWidth)).toBe(
          size.width,
        );
        await enginePage.screenshot({ path: shot(`rfix-engine-error-${tag}.png`) });
        await context.unroute('**/pdf.worker.min.mjs');
        await enginePage.close();

        // ── the file error ──
        const filePage = await context.newPage();
        await context.route(`**/papers/${paperId}/file`, (route) =>
          route.fulfill({ status: 200, contentType: 'application/pdf', body: 'not a pdf' }),
        );
        await filePage.goto(`/paper/${paperId}/read`);
        await expect(filePage.locator('.pt-state[role="alert"]')).toContainText(
          'This PDF could not be opened',
          { timeout: 120_000 },
        );
        expect(await filePage.evaluate(() => document.documentElement.scrollWidth)).toBe(
          size.width,
        );
        await filePage.screenshot({ path: shot(`rfix-file-error-${tag}.png`) });
        await context.close();
      }
    }
  });
});
