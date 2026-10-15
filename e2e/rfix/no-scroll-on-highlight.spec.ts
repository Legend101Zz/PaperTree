/**
 * RFIX2 R2 — pressing Highlight must not scroll the reader.
 *
 * Reproduced by the orchestrator in a real Chrome (DDPM, 25 pages, Source, scale 1.25, window
 * 1414x858 at devicePixelRatio 2, explain panel closed): the first Highlight moved scrollTop
 * 3908 -> 4108, the second 4108 -> 4443, while the scroller element, the saved position and the
 * reading state were unchanged, and `document.activeElement` afterwards was the scroll region.
 *
 * What a headless Chrome shows (and the base shows it too): NOTHING in the page scrolls
 * programmatically during the press, but the focus lands on the scroll region (`focusin` on
 * `[data-papertree-scroller]`). That is the one observable difference, so it is pinned; the
 * reader also holds the scroll position for a moment after a toolbar action (`holdScroll`), and the
 * second test proves that by making something else scroll the page and watching it come back.
 *
 * `e2e/rfix/no-jump.spec.ts` passes on the base too, so neither case here is a repeat of it: the
 * first fails on the base (focus moves to the scroller), the second fails on the base (nothing puts a
 * stray scroll back).
 */
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { drag, REPO, SCROLLER } from '../s4/support';
import { openReader, revealText, spanBoxAny } from './support';

const DDPM = join(REPO, 'research', 'benchmarks', 'fresh', 'pdfs', 'ddpm-2006.11239.pdf');
const VIEWPORT = { width: 1414, height: 858 };

async function openOnPage5(
  browser: import('@playwright/test').Browser,
  apiUrl: string,
  tag: string,
): Promise<Page> {
  const { page } = await openReader(browser, apiUrl, DDPM, VIEWPORT, tag, 2, '1.25');
  await page.bringToFront();
  await revealText(page, 'Since our simplified objective');
  await page.waitForTimeout(800);
  return page;
}

/** Wrap every API that can move the page or the focus; each call is recorded with its caller. */
async function instrument(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const w = window as unknown as { __calls: string[]; __focusin: string[] };
    w.__calls = [];
    w.__focusin = [];
    const where = (): string => (new Error().stack ?? '').split('\n').slice(2, 5).join(' | ');
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      if (options?.preventScroll !== true) w.__calls.push(`focus() without preventScroll on ${this.tagName} :: ${where()}`);
      return focus.call(this, options);
    };
    for (const name of ['scrollIntoView', 'scrollTo', 'scrollBy', 'scroll'] as const) {
      const original = (Element.prototype as unknown as Record<string, (...a: unknown[]) => unknown>)[name] as (...a: unknown[]) => unknown;
      (Element.prototype as unknown as Record<string, unknown>)[name] = function (this: Element, ...args: unknown[]) {
        w.__calls.push(`${name} on ${this.tagName} :: ${where()}`);
        return original.apply(this, args);
      };
    }
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop') as PropertyDescriptor;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return (descriptor.get as () => number).call(this);
      },
      set(value: number) {
        w.__calls.push(`scrollTop = ${String(value)} on ${(this as Element).tagName} :: ${where()}`);
        (descriptor.set as (v: number) => void).call(this, value);
      },
    });
    document.addEventListener(
      'focusin',
      (event) => {
        const target = event.target as Element;
        w.__focusin.push(target.matches(selector as string) ? 'SCROLLER' : target.tagName);
      },
      true,
    );
  }, SCROLLER);
}

/** Select the paragraph that starts "Since our simplified objective" with the mouse, return the bar. */
async function selectParagraph(page: Page) {
  const a = await spanBoxAny(page, 'Since our simplified objective');
  await drag(
    page,
    { x: a.left + 0.5, y: (a.top + a.bottom) / 2 },
    { x: a.right - 2, y: (a.top + a.bottom) / 2 + 90 },
  );
  const button = page.getByRole('button', { name: 'Highlight', exact: true });
  await expect(button).toBeVisible();
  return button;
}

/** Press like a hand: approach, hover, press, hold, release. */
async function press(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<void> {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 80, y + 60, { steps: 10 });
  await page.waitForTimeout(250);
  await page.mouse.move(x, y, { steps: 12 });
  await page.waitForTimeout(400);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
}

const scrollTopOf = (page: Page): Promise<number> =>
  page.evaluate((s) => (document.querySelector(s) as HTMLElement).scrollTop, SCROLLER);

test.describe('RFIX2 R2 — Highlight does not scroll the reader', () => {
  test('no scroll or focus call, the focus does not go to the scroller, two highlights in a row', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(600_000);
    const page = await openOnPage5(browser, stack.apiUrl, 'r2a');
    await instrument(page);
    for (const round of [1, 2]) {
      if (round === 2) {
        // The second highlight, a few lines further down, as in the walk.
        await page.mouse.move(700, 500);
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(800);
        await page.evaluate(() => {
          (window as unknown as { __calls: string[] }).__calls.length = 0;
          (window as unknown as { __focusin: string[] }).__focusin.length = 0;
        });
      }
      const before = await scrollTopOf(page);
      const button = await selectParagraph(page);
      const box = await button.boundingBox();
      if (box === null) throw new Error('no Highlight button box');
      const beforePress = await scrollTopOf(page);
      await press(page, box);
      await page.waitForTimeout(1500);
      const after = await scrollTopOf(page);
      const calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
      const focusin = await page.evaluate(() => (window as unknown as { __focusin: string[] }).__focusin);
      const active = await page.evaluate((s) => document.activeElement?.matches(s) ?? false, SCROLLER);
      console.log(
        `[e2e rfix2 R2] round ${String(round)}: scrollTop ${String(before)} -> ${String(beforePress)} (before press) -> ${String(after)}; ` +
          `programmatic calls: ${JSON.stringify(calls)}; focusin: ${JSON.stringify(focusin)}; scroller is active: ${String(active)}`,
      );
      expect(after, 'the press must not move the page').toBe(beforePress);
      expect(calls, 'nothing may scroll or focus-without-preventScroll during the press').toEqual([]);
      expect(focusin, 'the focus must not go to the scroll region').not.toContain('SCROLLER');
      expect(active).toBe(false);
    }
  });

  test('a scroll nobody asked for, right after the press, is put back; the reader can still scroll', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(600_000);
    const page = await openOnPage5(browser, stack.apiUrl, 'r2b');
    // Whatever scrolls the page in a real Chrome (+200 px the first time), simulated here: 80 ms
    // after the press, something moves the scroller. The reader must not see it.
    await page.evaluate((selector) => {
      document.addEventListener(
        'click',
        () => {
          setTimeout(() => {
            const scroller = document.querySelector(selector as string) as HTMLElement;
            scroller.scrollTop += 200;
          }, 80);
        },
        false,
      );
    }, SCROLLER);
    const button = await selectParagraph(page);
    const box = await button.boundingBox();
    if (box === null) throw new Error('no Highlight button box');
    const beforePress = await scrollTopOf(page);
    await press(page, box);
    await page.waitForTimeout(1200);
    const after = await scrollTopOf(page);
    console.log(`[e2e rfix2 R2] stray +200 px: ${String(beforePress)} -> ${String(after)}`);
    expect(after).toBe(beforePress);

    // The hold ends at the reader's first wheel: scrolling still works.
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(600);
    expect(Math.abs((await scrollTopOf(page)) - beforePress)).toBeGreaterThan(100);
  });
});
