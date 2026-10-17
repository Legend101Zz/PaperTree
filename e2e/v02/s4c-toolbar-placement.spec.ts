/**
 * S4c (#203): the selection toolbar never covers the lines being read, measured in a real browser,
 * and a highlight opens by a hand's click (#176).
 *
 * The placement is a pure function (`toolbarPlacement.spec`); this checks that its guarantee reaches
 * the screen with the bar's real size and the selection's real lines (review B1, B2):
 *   1. the explain drawer open, Split, Fit width: the column is narrow, the docked bar wraps, and a
 *      selected line sits 70 px under the column top;
 *   2. a selection across a page break, the first page's line 24 px under the column top;
 *   3. a click on a painted highlight that moves 4 px between press and release opens its card (a
 *      hand's jitter; before #176's fix it selected a letter and opened the toolbar instead).
 * "Covers" compares the bar's box with the selection's own client rects of line height (a fully
 * selected container between two pages also reports a page-sized rect, which is not a line).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { drag, REPO, reveal, SCROLLER, shotPath } from '../s4/support';
import { openReader } from '../rfix/support';

import type { Page } from '@playwright/test';

const PDF = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const BAR = '[role="toolbar"][aria-label="Selection actions"]';

/** The bar's box, its form, and the selected lines it covers. */
async function coverage(page: Page) {
  return page.evaluate((selector) => {
    const bar = document.querySelector(selector);
    if (bar === null) return null;
    const b = bar.getBoundingClientRect();
    const selection = window.getSelection();
    const lines =
      selection === null || selection.rangeCount === 0
        ? []
        : Array.from(selection.getRangeAt(0).getClientRects()).filter(
            (r) => r.width > 1 && r.height > 1 && r.height < 40,
          );
    return {
      bar: [b.left, b.top, b.right, b.bottom].map(Math.round),
      placement: bar.getAttribute('data-placement'),
      lines: lines.length,
      covered: lines
        .filter((r) => r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom)
        .map((r) => [r.left, r.top, r.right, r.bottom].map(Math.round)),
    };
  }, BAR);
}

/** Scrolls the reader so the span holding `needle` sits `offset` px under the column's top. */
async function placeLine(page: Page, needle: string, offset: number): Promise<void> {
  await reveal(page, needle);
  await page.evaluate(
    ([selector, text, dy]) => {
      const scroller = document.querySelector(selector as string) as HTMLElement;
      const span = Array.from(
        document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
      ).find((s) => (s.textContent ?? '').includes(text as string));
      if (span === undefined) return;
      scroller.scrollTop +=
        span.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (dy as number);
      scroller.scrollLeft = 0;
    },
    [SCROLLER, needle, offset] as const,
  );
  await page.waitForTimeout(800);
}

/** The client box of the first rendered span holding `needle`, on any page. */
async function box(page: Page, needle: string) {
  const found = await page.evaluate((text) => {
    const span = Array.from(
      document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
    ).find((s) => (s.textContent ?? '').includes(text));
    if (span === undefined) return null;
    const r = span.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, needle);
  if (found === null) throw new Error(`no rendered span contains ${JSON.stringify(needle)}`);
  return found;
}

test.describe('S4c — the selection toolbar on screen', () => {
  test.skip(
    !existsSync(PDF),
    `SKIPPED: ${PDF} is absent. The corpus PDFs are fetched, not committed — run ` +
      './research/benchmarks/fetch_corpus.sh, then re-run this spec.',
  );

  test('never covers a selected line: a wrapped docked bar, a selection across pages; a jittery click opens a highlight', async ({
    browser,
    stack,
  }, testInfo) => {
    test.setTimeout(600_000);
    const note = (line: string): void => console.log(`[e2e s4c toolbar] ${line}`);
    const shot = (name: string): string => shotPath(name, testInfo.outputPath('shots'));
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      PDF,
      { width: 1440, height: 900 },
      's4c-toolbar',
    );

    // ── 1. drawer open, Split, Fit width; the selected line 70 px under the column top ──
    await page.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Explain' })).toBeVisible();
    await page.getByRole('radio', { name: 'Split' }).click();
    await page.waitForTimeout(1500);
    await page.getByLabel('Zoom level').selectOption('fit-width');
    await page.waitForTimeout(1500);
    await placeLine(page, 'In this work we propose the Transformer', 70);
    const line = await box(page, 'In this work we propose the Transformer');
    await drag(
      page,
      { x: line.left + 1, y: (line.top + line.bottom) / 2 },
      { x: line.right - 2, y: (line.top + line.bottom) / 2 },
    );
    await expect(page.locator(BAR)).toBeVisible();
    const docked = await coverage(page);
    note(`1. drawer + Split + Fit width: ${JSON.stringify(docked)}`);
    await page.screenshot({ path: shot('s4c-01-docked-split-fit-1440.png') });
    expect(docked?.lines).toBeGreaterThan(0);
    expect(docked?.covered).toEqual([]);
    await page.keyboard.press('Escape');

    // ── 2. Split at 125 %: from page 1's last line (24 px under the top) to page 2 ──
    await page.getByLabel('Zoom level').selectOption('1.25');
    await page.waitForTimeout(1500);
    await placeLine(page, '31st Conference on Neural Information', 24);
    const start = await box(page, '31st Conference on Neural Information');
    const end = await box(page, 'Recurrent neural networks, long short-term');
    const right = await page.evaluate(
      (selector) => (document.querySelector(selector) as HTMLElement).getBoundingClientRect().right,
      SCROLLER,
    );
    await drag(
      page,
      { x: start.left + 1, y: (start.top + start.bottom) / 2 },
      { x: Math.min(end.right - 2, right - 20), y: (end.top + end.bottom) / 2 },
    );
    await expect(page.locator(BAR)).toBeVisible();
    const across = await coverage(page);
    note(`2. across pages: ${JSON.stringify(across)}`);
    await page.screenshot({ path: shot('s4c-02-across-pages-1440.png') });
    expect(across?.lines).toBeGreaterThan(1);
    expect(across?.covered).toEqual([]);
    await page.keyboard.press('Escape');

    // ── 3. a highlight, then a click that moves 4 px opens its card (#176) ──
    await page.getByRole('radio', { name: 'Source' }).click();
    await page.waitForTimeout(1500);
    await reveal(page, 'The dominant sequence transduction');
    const abstract = await box(page, 'The dominant sequence transduction');
    await drag(
      page,
      { x: abstract.left + 1, y: (abstract.top + abstract.bottom) / 2 },
      { x: abstract.right - 2, y: (abstract.top + abstract.bottom) / 2 },
    );
    const posted = page.waitForResponse(
      (r) => r.url().includes('/highlights') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Highlight in green' }).click();
    expect((await posted).status()).toBe(201);
    const painted = page.locator('svg .pt-hl polygon').first();
    await expect(painted).toBeVisible();
    const hl = await painted.boundingBox();
    if (hl === null) throw new Error('the highlight is not painted');
    const at = { x: hl.x + Math.min(40, hl.width / 2), y: hl.y + hl.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 4, at.y, { steps: 2 });
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: 'Highlight' })).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await expect(page.locator(BAR)).toHaveCount(0);
    note('3. a click that moved 4 px opened the card; nothing selected, no toolbar');
    await page.screenshot({ path: shot('s4c-03-card-by-jittery-click-1440.png') });
  });
});
