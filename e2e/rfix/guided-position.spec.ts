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
const CASES: readonly {
  name: string;
  pdf: () => string | null;
  needle: string;
  guided: string;
  top: number;
}[] = [
  {
    name: 'DDPM page 2',
    pdf: () => DDPM,
    needle: 'This paper presents progress in diffusion',
    guided: 'This paper presents progress in diffusion',
    top: 100,
  },
  {
    name: 'DDPM page 2 (equation paragraph)',
    pdf: () => DDPM,
    needle: 'Training is performed by optimizing',
    guided: 'Training is performed by optimizing',
    top: 120,
  },
  {
    name: 'DDPM page 5',
    pdf: () => DDPM,
    needle: 'Since our simplified objective',
    guided: 'discards the weighting',
    top: 90,
  },
  {
    name: 'YOLO page 1 (left column)',
    pdf: () => YOLO,
    needle: 'Humans glance at an image',
    guided: 'Humans glance at an image',
    top: 100,
  },
  {
    name: 'YOLO page 4 (left column)',
    pdf: () => YOLO,
    needle: 'Our learning rate schedule is as follows',
    guided: 'Our learning rate schedule is as follows',
    top: 110,
  },
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
async function guidedOffset(
  page: Page,
  needle: string,
): Promise<{ top: number; height: number; scrollTop: number } | null> {
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
        note(
          `${c.name}: Guided -> Source: paragraph top ${back.top.toFixed(0)} px (was ${placed.toFixed(0)}), viewport ${String(sourceHeight)}`,
        );
        expect(back.top).toBeGreaterThan(-20);
        expect(back.top).toBeLessThan(sourceHeight * 0.6);
      });
    }
  });
}

test.describe('RFIX2 R8 - a saved position that names no block still opens Guided in the right place', () => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`DDPM, reload at page 5 with a position saved before the parse had loaded, ${String(size.width)}px`, async ({
      browser,
      stack,
    }) => {
      test.setTimeout(600_000);
      const { page, paperId } = await openReader(
        browser,
        stack.apiUrl,
        DDPM,
        size,
        `r8-noblock-${String(size.width)}`,
        1,
        size.width < 600 ? 'fit-width' : '1.25',
      );
      // What a reader who scrolled before the parse arrived leaves behind: page and offset, no block.
      await page.evaluate(
        ([key, zoom]) =>
          localStorage.setItem(
            key as string,
            JSON.stringify({ v: 1, mode: 'source', zoomMode: zoom, page: 4, yPt: 330 }),
          ),
        [
          `papertree/reader/${paperId}`,
          size.width < 600 ? { kind: 'fit-width' } : { kind: 'scale', scale: 1.25 },
        ] as const,
      );
      await page.reload();
      await expect
        .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
          timeout: 180_000,
        })
        .toBeGreaterThan(20);
      await page.getByRole('radio', { name: 'Guided' }).click();
      await page.waitForTimeout(1500);
      const where = await page.evaluate(() => {
        const sc = document.querySelector('[data-guided-scroller]') as HTMLElement;
        const top = sc.getBoundingClientRect().top;
        const first = Array.from(sc.querySelectorAll('[data-guided-para]')).find(
          (p) => p.getBoundingClientRect().bottom > top + 5,
        );
        return { scrollTop: sc.scrollTop, first: (first?.textContent ?? '').slice(0, 60) };
      });
      console.log(
        `[e2e rfix2 R8] no saved block, ${String(size.width)}px: ${JSON.stringify(where)}`,
      );
      expect(where.scrollTop, 'Guided is not at the top of the paper').toBeGreaterThan(2000);
    });
  }
});

/**
 * RFIX2 R8 (reviewer must-fix): "no block" at the page's bottom margin or in the gap between two
 * pages used to open Guided at the paper's title (FlashAttention 7 of 14 positions, Mask R-CNN 7 of
 * 14). A sweep of real wheel steps through pages 2-4 puts the top of the window in EVERY part of a
 * page, margins and gaps included, and each position must open Guided past the title.
 */
const FLASH = join(
  REPO,
  'research',
  'benchmarks',
  'fresh',
  'pdfs',
  'flashattention-2205.14135.pdf',
);

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`FlashAttention: every position in a wheel sweep through pages 2-4 opens Guided past the title, ${String(size.width)}px`, async ({
    browser,
    stack,
  }) => {
    test.setTimeout(900_000);
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      FLASH,
      size,
      `r8-sweep-${String(size.width)}`,
      1,
      size.width < 600 ? 'fit-width' : '1.25',
    );
    const scroller = '[data-papertree-scroller]';
    // Small steps at 1440 (a page is ~1000 px there) so the top of the window lands in the bottom
    // margin and the page gap as well.
    const stepPx = size.width < 600 ? 260 : 110;
    // Start on page 2 (index 1): past the title, whatever the zoom.
    const pageHeight = await page.evaluate(
      (s) => ((document.querySelector(s) as HTMLElement).scrollHeight - 400) / 20,
      scroller,
    );
    await page.mouse.move(size.width / 2, 450);
    await page.mouse.wheel(0, Math.round(pageHeight * 1.2));
    await page.waitForTimeout(800);
    const bad: string[] = [];
    let marginHits = 0;
    for (let step = 0; step < 18; step += 1) {
      const saved = await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith('papertree/reader/'));
        return key === undefined
          ? null
          : (JSON.parse(localStorage.getItem(key) as string) as {
              page: number;
              yPt: number;
              blockId?: string;
            });
      });
      if (saved !== null && saved.blockId === undefined) marginHits += 1;
      await page.getByRole('radio', { name: 'Guided' }).click();
      await page.waitForTimeout(900);
      const guidedTop = await page.evaluate(
        () => (document.querySelector('[data-guided-scroller]') as HTMLElement).scrollTop,
      );
      console.log(
        `[e2e rfix2 R8 sweep ${String(size.width)}] step ${String(step)}: saved ${JSON.stringify(saved)} -> Guided scrollTop ${guidedTop.toFixed(0)}`,
      );
      if (guidedTop < 200)
        bad.push(`step ${String(step)} ${JSON.stringify(saved)} -> ${guidedTop.toFixed(0)}`);
      await page.getByRole('radio', { name: 'Source' }).click();
      await page.waitForTimeout(900);
      await page.mouse.move(size.width / 2, 450);
      await page.mouse.wheel(0, stepPx);
      await page.waitForTimeout(500);
    }
    console.log(
      `[e2e rfix2 R8 sweep ${String(size.width)}] positions with no saved block: ${String(marginHits)}`,
    );
    expect(bad, 'Guided opened at the title for these positions').toEqual([]);
  });
}
