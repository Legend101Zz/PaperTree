/**
 * v0.3 #345 - a dark (and sepia) PAGE for the paper itself, from the reader's Aa menu.
 *
 * YOLO page 1 (it has Figure 1) is opened in Daylight with the page on Auto, so it is a light page.
 * Aa -> Page: Dark makes the paper light-on-dark in a daylight room (the room is untouched), the
 * PDF canvas is recoloured by CSS with no re-render, and the figure keeps its own colours on a mat.
 * The choice survives a reload (it is in localStorage, applied before first paint). Guided takes the
 * same page, with its figure crop on a mat, and axe finds no serious contrast violation there.
 * Finally Auto follows the room: Lamp-lit brings the dark page back, and Light overrides it.
 *
 * The PDF is the committed corpus's; the spec SKIPS, loudly, without it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { REPO, readingControls } from '../s4/support';
import { openReader, yolo } from '../rfix/support';

const AXE = join(REPO, 'apps', 'web', 'node_modules', 'axe-core', 'axe.min.js');
const PAGE_ONE = '.papertree-page[data-page-index="0"]';

const root = (page: Page, name: string): Promise<string | null> =>
  page.evaluate((n) => document.documentElement.getAttribute(n), name);

async function pickPage(page: Page, label: 'Auto' | 'Light' | 'Sepia' | 'Dark'): Promise<void> {
  const aa = page.getByRole('button', { name: 'Reading settings' });
  if ((await aa.getAttribute('aria-expanded')) !== 'true') await aa.click();
  await page.getByRole('radiogroup', { name: 'Page' }).getByRole('radio', { name: label }).click();
}

async function pickRoom(page: Page, label: 'Daylight' | 'Lamp-lit'): Promise<void> {
  const aa = page.getByRole('button', { name: 'Reading settings' });
  if ((await aa.getAttribute('aria-expanded')) !== 'true') await aa.click();
  await page
    .getByRole('radiogroup', { name: 'Colour scheme' })
    .getByRole('radio', { name: label })
    .click();
}

/** axe-core's serious and critical violations on the page. */
async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: readFileSync(AXE, 'utf8') });
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            c: Document,
            o: object,
          ) => Promise<{
            violations: {
              id: string;
              impact: string | null;
              nodes: { target: string[] }[];
            }[];
          }>;
        };
      }
    ).axe;
    const results = await axe.run(document, { resultTypes: ['violations'] });
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

test.describe('v0.3 #345 - the dark page', () => {
  test('Aa -> Page: Dark recolours the PDF live and keeps the figure on its mat', async ({
    browser,
    stack,
  }, testInfo) => {
    const pdf = yolo();
    test.skip(pdf === null, 'SKIPPED: the YOLO PDF is not present.');
    test.setTimeout(600_000);
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      pdf as string,
      { width: 1440, height: 900 },
      'dark-page',
    );

    // Daylight with the page on Auto: a light page, and no mat.
    expect(await root(page, 'data-pt-theme')).toBe('light');
    expect(await root(page, 'data-pt-page')).toBe('light');
    await expect(page.locator(`${PAGE_ONE} [data-papertree-mat]`)).toHaveCount(0);

    // The canvas is rendered once; count its paints to show the switch does not re-render it.
    const drawn = await page.locator(`${PAGE_ONE} canvas.papertree-page__canvas`).evaluate((c) => {
      const canvas = c as HTMLCanvasElement;
      return `${String(canvas.width)}x${String(canvas.height)}`;
    });

    await pickPage(page, 'Dark');
    expect(await root(page, 'data-pt-page')).toBe('dark');
    expect(await root(page, 'data-pt-theme')).toBe('light'); // the room is untouched
    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: 'Reading settings' })).toBeHidden();

    // The page is recoloured by a filter on the same canvas: same backing store, no re-render.
    const filter = await page
      .locator(`${PAGE_ONE} canvas.papertree-page__canvas`)
      .evaluate((c) => ({
        filter: getComputedStyle(c).filter,
        size: `${String((c as HTMLCanvasElement).width)}x${String((c as HTMLCanvasElement).height)}`,
      }));
    expect(filter.filter).toContain('invert');
    expect(filter.size).toBe(drawn);

    // Page 1 has Figure 1: its region is a mat in the dark page's mat colour, holding the figure's
    // original pixels (a light ground), not the inverted ones.
    const mat = page.locator(`${PAGE_ONE} [data-papertree-mat]`).first();
    await expect(mat).toBeVisible({ timeout: 60_000 });
    const look = await mat.evaluate((el) => {
      const canvas = el.querySelector('canvas') as HTMLCanvasElement;
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      if (data !== undefined) {
        for (let i = 0; i < data.length; i += 4) {
          if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 600) bright += 1;
        }
      }
      return {
        background: getComputedStyle(el).backgroundColor,
        padding: getComputedStyle(el).paddingTop,
        bright: data === undefined ? 0 : bright / (data.length / 4),
      };
    });
    expect(look.background).toBe('rgb(15, 13, 11)');
    expect(look.padding).toBe('10px');
    expect(look.bright, 'the figure keeps its light ground').toBeGreaterThan(0.2);
    await page.screenshot({ path: testInfo.outputPath('dark-source.png') });

    // The choice is in localStorage and applied before first paint after a reload.
    await page.reload();
    await expect.poll(() => root(page, 'data-pt-page')).toBe('dark');
    expect(await page.evaluate(() => window.localStorage.getItem('papertree.page'))).toBe('dark');
  });

  test('Guided takes the page, its figure sits on a mat, and axe is clean', async ({
    browser,
    stack,
  }, testInfo) => {
    const pdf = yolo();
    test.skip(pdf === null, 'SKIPPED: the YOLO PDF is not present.');
    test.setTimeout(600_000);
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      pdf as string,
      { width: 1440, height: 900 },
      'dark-page-guided',
    );
    await pickPage(page, 'Dark');
    await page.keyboard.press('Escape');
    await readingControls(page, (controls) =>
      controls.getByRole('radio', { name: 'Guided' }).click(),
    );
    const sheet = page.locator('.pt-guided__sheet');
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(29, 26, 23)',
    );
    const crop = page.locator('.pt-guided__sheet .pt-figure__crop').first();
    await crop.scrollIntoViewIfNeeded();
    expect(await crop.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('10px');
    expect(await crop.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(15, 13, 11)',
    );
    await page.screenshot({ path: testInfo.outputPath('dark-guided.png') });
    expect(await axeSerious(page)).toEqual([]);

    await pickPage(page, 'Sepia');
    await page.keyboard.press('Escape');
    expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(244, 233, 210)',
    );
    expect(await axeSerious(page)).toEqual([]);
  });

  test('Auto follows the room, and an explicit page overrides it', async ({ browser, stack }) => {
    const pdf = yolo();
    test.skip(pdf === null, 'SKIPPED: the YOLO PDF is not present.');
    test.setTimeout(600_000);
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      pdf as string,
      { width: 1440, height: 900 },
      'dark-page-room',
    );
    await pickRoom(page, 'Lamp-lit');
    await expect.poll(() => root(page, 'data-pt-page')).toBe('dark');
    await pickPage(page, 'Light');
    await expect.poll(() => root(page, 'data-pt-page')).toBe('light');
    expect(await root(page, 'data-pt-theme')).toBe('dark');
    await pickPage(page, 'Auto');
    await expect.poll(() => root(page, 'data-pt-page')).toBe('dark');
    await pickRoom(page, 'Daylight');
    await expect.poll(() => root(page, 'data-pt-page')).toBe('light');
  });
});
