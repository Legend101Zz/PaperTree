/**
 * RFIX extras: Escape clears the selection and hides the toolbar; a selection at the very top of the
 * window gets a toolbar that is still inside the visible reader.
 */
import { expect, test } from '../harness/test';
import { drag, shotPath } from '../s4/support';
import { clearSelection, openReader, revealText, SCROLLER, spanBox, yolo } from './support';

const YOLO = yolo();

test.describe('RFIX — Escape and the toolbar at the top edge', () => {
  test.skip(
    YOLO === null,
    'SKIPPED: the YOLO PDF is not present (research/benchmarks/fresh/pdfs).',
  );

  test('Escape clears the selection and hides the toolbar; the toolbar stays on screen at the top', async ({
    browser,
    stack,
  }, testInfo) => {
    test.setTimeout(600_000);
    const note = (line: string): void => console.log(`[e2e rfix keys] ${line}`);
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      YOLO as string,
      { width: 1440, height: 900 },
      'keys',
    );
    await revealText(page, 'We reframe object detection');
    await page.waitForTimeout(600);

    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' });
    const selectParagraph = async (): Promise<void> => {
      const first = await spanBox(page, 'We reframe object detection');
      const last = await spanBox(page, 'present and where they are.');
      await drag(
        page,
        { x: first.left + 0.5, y: (first.top + first.bottom) / 2 },
        { x: last.right + 30, y: (last.top + last.bottom) / 2 },
      );
    };

    // ── Escape ──
    await selectParagraph();
    await expect(toolbar).toBeVisible();
    expect(
      (await page.evaluate(() => window.getSelection()?.toString() ?? '')).length,
    ).toBeGreaterThan(50);
    await page.keyboard.press('Escape');
    await expect(toolbar).toBeHidden();
    const left = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    note(`after Escape the selection holds ${JSON.stringify(left)} and the toolbar is hidden`);
    expect(left).toBe('');

    // ── the top edge: the paragraph's first line sits just under the header ──
    await page.evaluate(
      ([selector, text]) => {
        const scroller = document.querySelector(selector as string) as HTMLElement;
        const span = Array.from(
          document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
        ).find((s) => (s.textContent ?? '').includes(text as string));
        if (span === undefined) return;
        scroller.scrollTop +=
          span.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 4;
      },
      [SCROLLER, 'We reframe object detection'] as const,
    );
    await page.waitForTimeout(800);
    await clearSelection(page);
    await selectParagraph();
    await expect(toolbar).toBeVisible();
    const boxes = await page.evaluate((selector) => {
      const bar = document.querySelector(
        '[role="toolbar"][aria-label="Selection actions"]',
      ) as HTMLElement;
      const scroller = document.querySelector(selector) as HTMLElement;
      const b = bar.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return {
        bar: [b.left, b.top, b.right, b.bottom],
        scroller: [s.left, s.top, s.right, s.bottom],
      };
    }, SCROLLER);
    note(`toolbar ${JSON.stringify(boxes.bar)} inside scroller ${JSON.stringify(boxes.scroller)}`);
    await page.screenshot({
      path: shotPath('extras-toolbar-top-1440.png', testInfo.outputPath('shots')),
    });
    expect(boxes.bar[1]).toBeGreaterThanOrEqual((boxes.scroller[1] as number) - 0.5);
    expect(boxes.bar[3]).toBeLessThanOrEqual(boxes.scroller[3] as number);
    // …and it is still the one that works: Highlight is under the pointer, not under the header.
    // (#203: Highlight is no longer the bar's first button, so it is named.)
    const hit = await page.evaluate(() => {
      const bar = document.querySelector(
        '[role="toolbar"][aria-label="Selection actions"] button[aria-label="Highlight"]',
      ) as HTMLElement;
      const r = bar.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return e?.closest('button')?.getAttribute('aria-label') ?? e?.tagName ?? 'nothing';
    });
    expect(hit).toBe('Highlight');
    await page.keyboard.press('Escape');
    await expect(toolbar).toBeHidden();
  });
});
