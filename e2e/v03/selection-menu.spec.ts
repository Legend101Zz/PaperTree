/**
 * v0.3 #346 / #349 - the selection menu and the selection paint, on a real paper.
 *
 * "Attention Is All You Need", abstract. A drag across it is painted as ONE band per line in the
 * page's selection token (the native highlight goes transparent), the ends on whole words; the menu
 * sits in the desk margin beside the selection, never over it, in the prototype's order (Explain,
 * Ask..., Send to board, Note, five colours). Send to board offers Board beside and Just send;
 * Just send stays on the paper and toasts "Added" with Show. Esc clears the selection and the menu.
 * In a narrow window the menu docks as a compact row that stays on one line inside the pane.
 *
 * The corpus PDF is fetched, not committed; the spec SKIPS, loudly, without it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { drag, pointsFor, readingControls, REPO, reveal, SCROLLER } from '../s4/support';
import { openReader } from '../rfix/support';

const PDF = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const BAR = '[role="toolbar"][aria-label="Selection actions"]';
const FROM = 'The dominant sequence transduction';
const TO = 'decoder.';

async function selectAbstract(page: Page): Promise<void> {
  await reveal(page, FROM);
  const points = await pointsFor(page, FROM, TO);
  await drag(page, points.from, points.to);
  await expect(page.locator(BAR)).toBeVisible();
}

test.describe('v0.3 #346 - the selection menu and the selection paint', () => {
  test.skip(
    !existsSync(PDF),
    `SKIPPED: ${PDF} is absent. The corpus PDFs are fetched, not committed - run ` +
      './research/benchmarks/fetch_corpus.sh, then re-run this spec.',
  );

  test('one band per line, the menu beside the selection in prototype order, Just send, Esc', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(600_000);
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      PDF,
      { width: 1440, height: 900 },
      'sel-menu',
    );
    await selectAbstract(page);

    // The paint: custom bands in the selection token, one per line, native paint made transparent.
    await expect(page.locator(`${SCROLLER}[data-pt-selpaint]`)).toHaveCount(1);
    const paint = await page.evaluate((bar) => {
      const fills = Array.from(document.querySelectorAll('svg .pt-sel polygon.pt-sel-fill')).map(
        (p) => (p as SVGPolygonElement).getBoundingClientRect(),
      );
      const selection = window.getSelection();
      const rects =
        selection === null || selection.rangeCount === 0
          ? []
          : Array.from(selection.getRangeAt(0).getClientRects()).filter(
              (r) => r.width > 1 && r.height > 1 && r.height < 40,
            );
      // Rows of text: rects whose vertical centres are within 4 px are one line.
      const centres = rects.map((r) => (r.top + r.bottom) / 2).sort((a, b) => a - b);
      const rows = centres.filter((c, i) => i === 0 || c - (centres[i - 1] as number) > 4).length;
      const menu = (document.querySelector(bar) as HTMLElement).getBoundingClientRect();
      return {
        bands: fills.length,
        rows,
        overlap: fills.some((a, i) =>
          fills.some(
            (b, j) =>
              i < j &&
              a.left < b.right &&
              b.left < a.right &&
              a.top + 1 < b.bottom &&
              b.top + 1 < a.bottom,
          ),
        ),
        covered: rects.some(
          (r) =>
            r.left < menu.right &&
            menu.left < r.right &&
            r.top < menu.bottom &&
            menu.top < r.bottom,
        ),
        placement: (document.querySelector(bar) as HTMLElement).getAttribute('data-placement'),
      };
    }, BAR);
    expect(paint.bands).toBeGreaterThan(0);
    expect(paint.bands, 'no more bands than lines of text').toBeLessThanOrEqual(paint.rows);
    expect(paint.overlap, 'a band never reaches into the next').toBe(false);
    expect(paint.placement).toBe('margin');
    expect(paint.covered, 'the menu is beside the selection, not over it').toBe(false);

    // The menu: prototype order, no Copy, no diagram.
    const names = await page
      .locator(`${BAR} button`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(names).toEqual([
      'Explain',
      'Ask…',
      'Send to board',
      'Note',
      'Highlight in amber',
      'Highlight in green',
      'Highlight in blue',
      'Highlight in pink',
      'Highlight in purple',
    ]);
    // It fits its longest label: no item is wider than the menu.
    const fits = await page.evaluate((bar) => {
      const el = document.querySelector(bar) as HTMLElement;
      return Array.from(el.querySelectorAll('button')).every(
        (b) => b.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5,
      );
    }, BAR);
    expect(fits).toBe(true);

    // Send to board: two choices; Just send stays on the paper and says Added, with Show.
    await page.getByRole('button', { name: 'Send to board', exact: true }).click();
    const choices = page.getByRole('group', { name: 'Send to board' });
    await expect(choices.getByRole('button', { name: /^Board beside/ })).toBeVisible();
    await choices.getByRole('button', { name: /^Just send/ }).click();
    const toast = page.getByTestId('canvas-toast');
    await expect(toast).toContainText('Added');
    await expect(toast.getByRole('link', { name: 'Show' })).toHaveAttribute(
      'href',
      /\/board\?card=cn_/,
    );
    expect(page.url()).toContain('/read');
    await expect(page.locator(BAR)).toHaveCount(0);

    // Esc clears the selection and its menu, and the native paint comes back.
    await selectAbstract(page);
    await page.keyboard.press('Escape');
    await expect(page.locator(BAR)).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await expect(page.locator(`${SCROLLER}[data-pt-selpaint]`)).toHaveCount(0);
  });

  test('with no margin the menu docks as one compact row inside the pane', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(600_000);
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      PDF,
      { width: 760, height: 900 },
      'sel-dock',
    );
    // 760 px is the phone layout (below 768): the zoom lives in the header's Reading options menu.
    await readingControls(page, (controls) =>
      controls.getByLabel('Zoom level').selectOption('fit-width'),
    );
    await page.waitForTimeout(1500);
    await selectAbstract(page);
    const bar = page.locator(BAR);
    await expect(bar).toHaveAttribute('data-placement', 'docked');
    const box = await bar.boundingBox();
    const pane = await page.locator(SCROLLER).boundingBox();
    if (box === null || pane === null) throw new Error('no box');
    expect(box.x).toBeGreaterThanOrEqual(pane.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width + 0.5);
    expect(box.height, 'one row, not wrapped').toBeLessThan(70);
    // Its names are the same whole words, labels short or not.
    await expect(bar.getByRole('button', { name: 'Send to board', exact: true })).toBeVisible();
  });
});
