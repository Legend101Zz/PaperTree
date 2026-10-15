/**
 * RFIX2 R8 — Source -> Guided keeps the reading position (contracts.md section 5: restored by
 * blockId); Guided -> Source already did. DDPM (two columns, figure on page 2) and YOLO.
 *
 * The reader scrolls Source with real WHEEL events until a paragraph sits near the top of the
 * window, presses "Guided", and the paragraph (or, when the top of the window held a figure or a
 * caption, the card just before it) must be on screen in Guided - never the paper's title.
 * Then "Source" again: the same paragraph is back near the top.
 */
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { REPO } from '../s4/support';
import { openReader, revealText, spanBoxAny, yolo } from './support';

const DDPM = join(REPO, 'research', 'benchmarks', 'fresh', 'pdfs', 'ddpm-2006.11239.pdf');
const YOLO = yolo();

/** `needle` is what Source's text layer says; `guided` is what the Guided card says (the IR keeps ligatures). */
const CASES: readonly { name: string; pdf: () => string | null; needle: string; guided: string; top: number }[] = [
  { name: 'DDPM page 2', pdf: () => DDPM, needle: 'This paper presents progress in diffusion', guided: 'This paper presents progress in diffusion', top: 100 },
  { name: 'DDPM page 2 (equation paragraph)', pdf: () => DDPM, needle: 'Training is performed by optimizing', guided: 'Training is performed by optimizing', top: 120 },
  { name: 'DDPM page 5', pdf: () => DDPM, needle: 'Since our simplified objective', guided: 'discards the weighting', top: 90 },
  { name: 'YOLO page 1 (left column)', pdf: () => YOLO, needle: 'Humans glance at an image', guided: 'Humans glance at an image', top: 100 },
  { name: 'YOLO page 4 (left column)', pdf: () => YOLO, needle: 'Our learning rate schedule is as follows', guided: 'Our learning rate schedule is as follows', top: 110 },
];

async function nudgeToTop(page: Page, needle: string, top: number, x: number): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const now = (await spanBoxAny(page, needle)).top;
    if (Math.abs(now - top) < 4) return now;
    await page.mouse.move(x, 450);
    await page.mouse.wheel(0, now - top);
    await page.waitForTimeout(500);
  }
  return (await spanBoxAny(page, needle)).top;
}

/** Where `needle`'s paragraph is in the Guided scroller: its top, relative to the scroller's. */
async function guidedOffset(page: Page, needle: string): Promise<{ top: number; height: number; scrollTop: number } | null> {
  return page.evaluate((text) => {
    const scroller = document.querySelector('[data-guided-scroller]') as HTMLElement | null;
    if (scroller === null) return null;
    const paragraph = Array.from(scroller.querySelectorAll('[data-guided-para]')).find((p) =>
      (p.textContent ?? '').includes(text),
    );
    if (paragraph === undefined) return null;
    const box = scroller.getBoundingClientRect();
    return {
      top: paragraph.getBoundingClientRect().top - box.top,
      height: box.height,
      scrollTop: scroller.scrollTop,
    };
  }, needle);
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`RFIX2 R8 - Source <-> Guided keeps the position, ${String(size.width)}px`, () => {
    for (const c of CASES) {
      test(c.name, async ({ browser, stack }) => {
        test.skip(c.pdf() === null, 'SKIPPED: the PDF is not present.');
        test.setTimeout(600_000);
        const note = (line: string): void => console.log(`[e2e rfix2 R8] ${line}`);
        const { page } = await openReader(
          browser,
          stack.apiUrl,
          c.pdf() as string,
          size,
          `r8-${String(size.width)}`,
          1,
          size.width < 600 ? 'fit-width' : '1.25',
        );
        await revealText(page, c.needle);
        const placed = await nudgeToTop(page, c.needle, c.top, size.width / 2);
        const sourceHeight = await page.evaluate(
          () => (document.querySelector('[data-papertree-scroller]') as HTMLElement).clientHeight,
        );

        // Source -> Guided, immediately after the reader's last wheel.
        await page.getByRole('radio', { name: 'Guided' }).click();
        await page.waitForTimeout(1500);
        const guided = await guidedOffset(page, c.guided);
        note(`${c.name}: Source top ${placed.toFixed(0)} px -> Guided ${JSON.stringify(guided)}`);
        expect(guided, 'the paragraph is in Guided').not.toBeNull();
        const g = guided as NonNullable<typeof guided>;
        expect(g.scrollTop, 'Guided is not at the top of the paper').toBeGreaterThan(200);
        // On screen: not above the fold, not below it. (The card before it may come first when a
        // figure or a caption sat at the top of the window.)
        expect(g.top, 'paragraph is not above the Guided viewport').toBeGreaterThan(-20);
        expect(g.top, 'paragraph is inside the Guided viewport').toBeLessThan(g.height * 0.9);

        // Guided -> Source: back where the reader was.
        await page.getByRole('radio', { name: 'Source' }).click();
        await page.waitForTimeout(1500);
        const back = await spanBoxAny(page, c.needle);
        note(`${c.name}: Guided -> Source: paragraph top ${back.top.toFixed(0)} px (was ${placed.toFixed(0)}), viewport ${String(sourceHeight)}`);
        expect(back.top).toBeGreaterThan(-20);
        expect(back.top).toBeLessThan(sourceHeight * 0.6);
      });
    }
  });
}
