/**
 * RFIX2 R9 - Guided shows a figure ONCE: the outermost crop and one caption.
 *
 * The parser reports a multi-panel figure as the whole crop AND each panel, all claiming one caption.
 * Guided used to render the whole 'Figure 2' crop, then each panel (x_T, x_t-1, x_0) as a separate
 * image card, then the caption again. The cards are counted in the live Guided DOM against the
 * paper's own IR (the figure blocks on the page), on DDPM page 2 and YOLO pages 1 and 2.
 */
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { REPO, shotPath } from '../s4/support';
import { openReader, yolo } from './support';

const DDPM = join(REPO, 'research', 'benchmarks', 'fresh', 'pdfs', 'ddpm-2006.11239.pdf');
const YOLO = yolo();

interface IrBlock {
  block_id: string;
  type: string;
  page_index: number;
  text?: string;
}

async function figureCards(page: Page, ids: readonly string[], captionStart: string) {
  return page.evaluate(
    ([figureIds, caption]) => {
      const cards = Array.from(document.querySelectorAll('[data-guided-para]')) as HTMLElement[];
      const mine = cards.filter((c) => (figureIds as string[]).includes(c.getAttribute('data-guided-para') ?? ''));
      const scroller = document.querySelector('[data-guided-scroller]') as HTMLElement;
      const text = scroller.textContent ?? '';
      let captions = 0;
      for (let at = text.indexOf(caption as string); at !== -1; at = text.indexOf(caption as string, at + 1)) captions += 1;
      return {
        cards: mine.length,
        images: mine.reduce((n, c) => n + c.querySelectorAll('img').length, 0),
        captions,
        first: mine[0]?.getBoundingClientRect().height ?? 0,
      };
    },
    [ids, captionStart] as const,
  );
}

const CASES = [
  { name: 'DDPM page 2, Figure 2', pdf: () => DDPM, pageIndex: 1, caption: 'Figure 2: The directed graphical model' },
  { name: 'YOLO page 1, Figure 1', pdf: () => YOLO, pageIndex: 0, caption: 'Figure 1: The YOLO Detection System' },
  { name: 'YOLO page 2, Figure 2', pdf: () => YOLO, pageIndex: 1, caption: 'Figure 2: The Model' },
] as const;

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`RFIX2 R9 - one crop, one caption, ${String(size.width)}px`, () => {
    for (const c of CASES) {
      test(c.name, async ({ browser, stack }, testInfo) => {
        test.skip(c.pdf() === null, 'SKIPPED: the PDF is not present.');
        test.setTimeout(600_000);
        const { page, token, paperId } = await openReader(
          browser,
          stack.apiUrl,
          c.pdf() as string,
          size,
          `r9-${String(size.width)}`,
          1,
          size.width < 600 ? 'fit-width' : '1.25',
        );
        const ir = (await (
          await fetch(`${stack.apiUrl}/papers/${paperId}/ir`, { headers: { Authorization: `Bearer ${token}` } })
        ).json()) as { blocks: IrBlock[] };
        const figureIds = ir.blocks.filter((b) => b.page_index === c.pageIndex && b.type === 'figure').map((b) => b.block_id);
        expect(figureIds.length, 'the IR reports the figure and its panels as separate blocks').toBeGreaterThan(1);

        await page.getByRole('radio', { name: 'Guided' }).click();
        await page.waitForSelector('[data-guided-scroller]');
        await page.waitForTimeout(1500);
        const seen = await figureCards(page, figureIds, c.caption);
        console.log(
          `[e2e rfix2 R9] ${c.name} ${String(size.width)}px: IR figure blocks ${String(figureIds.length)}; ` +
            `Guided cards ${String(seen.cards)}, images ${String(seen.images)}, caption x${String(seen.captions)}`,
        );
        expect(seen.cards, 'one card for the whole figure').toBe(1);
        expect(seen.images, 'one crop').toBeLessThanOrEqual(1);
        expect(seen.captions, 'one caption').toBe(1);

        // Look at it: the figure card scrolled into view.
        await page.evaluate((ids) => {
          const el = Array.from(document.querySelectorAll('[data-guided-para]')).find((c) =>
            ids.includes(c.getAttribute('data-guided-para') ?? ''),
          );
          el?.scrollIntoView({ block: 'center' });
        }, figureIds);
        await page.waitForTimeout(600);
        await page.screenshot({
          path: shotPath(`r9-${c.name.replace(/[^a-z0-9]+/giu, '-')}-${String(size.width)}.png`, testInfo.outputPath('shots')),
        });
      });
    }
  });
}
