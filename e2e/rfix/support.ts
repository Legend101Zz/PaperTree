/**
 * e2e/rfix — shared helpers for the reader-fix walk (YOLO p.1 drags that end in blank space, no
 * jump on highlight, an honest PDF-engine error).
 */
import type { BrowserContext, Page } from '@playwright/test';

import { expect } from '../harness/test';
import { register, upload, waitParsed } from '../s4/support';

export { register, upload, waitParsed };

export { drag, SCROLLER, shotPath } from '../s4/support';
export { reveal as revealText, yoloPdf as yolo } from '../s4/support';

export interface Opened {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly paperId: string;
  readonly token: string;
}

/** Client box of the first text-layer span on page 1 whose text contains `needle`. */
export async function spanBox(
  page: Page,
  needle: string,
): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const box = await page.evaluate((text) => {
    const span = Array.from(
      document.querySelectorAll(
        '.papertree-page[data-page-index="0"] .papertree-text-layer span[data-item-index]',
      ),
    ).find((s) => (s.textContent ?? '').includes(text));
    if (span === undefined) return null;
    const r = span.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, needle);
  if (box === null) throw new Error(`no page-1 span contains ${JSON.stringify(needle)}`);
  return box;
}

/** Sign up, upload a PDF, wait for the parse, open the reader at 1.25 zoom in Source mode. */
export async function openReader(
  browser: import('@playwright/test').Browser,
  apiUrl: string,
  pdf: string,
  viewport: { width: number; height: number },
  tag: string,
  deviceScaleFactor = 1,
  zoom = '1.25',
): Promise<Opened> {
  const token = await register(apiUrl, `e2e-rfix-${tag}-${String(Date.now())}@papertree.test`);
  const paperId = await upload(apiUrl, token, pdf);
  await waitParsed(apiUrl, token, paperId);
  const context = await browser.newContext({ viewport, deviceScaleFactor });
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
    .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
      timeout: 180_000,
    })
    .toBeGreaterThan(50);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await page.getByLabel('Zoom level').selectOption(zoom);
  await page.waitForTimeout(1000);
  return { page, context, paperId, token };
}

export async function clearSelection(page: Page): Promise<void> {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.waitForTimeout(150);
}

/** Client box of the first rendered text-layer span, on ANY page, whose text contains `needle`. */
export async function spanBoxAny(
  page: Page,
  needle: string,
): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const box = await page.evaluate((text) => {
    const span = Array.from(
      document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
    ).find((s) => (s.textContent ?? '').includes(text));
    if (span === undefined) return null;
    const r = span.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, needle);
  if (box === null) throw new Error(`no rendered span contains ${JSON.stringify(needle)}`);
  return box;
}
