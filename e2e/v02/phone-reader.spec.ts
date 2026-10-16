/**
 * v0.2 frame 08b (#205) on the FAUX agent, at 390 × 844: open "Attention Is All You Need" → select
 * a sentence of the abstract → Explain → the bottom sheet (its header with the thread menu, the call
 * slip's quote on two lines, 44 px markers and trace rows, the pinned footer that never covers the
 * answer) → tap marker 2 → the sheet lowers to peek and passage 2 flashes above it → a follow-up
 * answered in three paragraphs (`[faux:paragraphs]`) opens on its first, and "Read the whole
 * answer" shows the rest. Then the zoom a reader picks at 390 survives a reload (#175, the v0.1
 * defect the audit could not confirm).
 *
 * Every size is measured in the page (boxes, `elementFromPoint`), not read from CSS. The PDF is the
 * committed corpus's; the spec SKIPS, loudly, without it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { drag, pointsFor, register, REPO, reveal, upload, waitParsed } from '../s4/support';

import type { Browser, Page } from '@playwright/test';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const PHONE = { width: 390, height: 844 };

async function openReader(browser: Browser, token: string, paperId: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 1,
    hasTouch: true,
  });
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem('papertree.session', t);
    } catch {
      /* a context without storage is not this walk */
    }
  }, token);
  const page = await context.newPage();
  await page.goto(`/paper/${paperId}/read`);
  await expect
    .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
      timeout: 180_000,
    })
    .toBeGreaterThan(20);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  return page;
}

/** Is a tap `d` px from the centre of this box, in each of the four directions, on the element? */
async function hitsAround(page: Page, selector: string, d: number): Promise<boolean[]> {
  return page.evaluate(
    ([sel, dist]) => {
      const el = document.querySelector(sel);
      if (el === null) return [];
      const r = el.getBoundingClientRect();
      const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
      const steps: readonly (readonly [number, number])[] = [
        [-dist, 0],
        [dist, 0],
        [0, -dist],
        [0, dist],
      ];
      return steps.map(([dx, dy]) => el.contains(document.elementFromPoint(cx + dx, cy + dy)));
    },
    [selector, d] as const,
  );
}

test.describe('v0.2 frame 08b: the phone reader and its explain sheet (faux agent)', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );

  test('select → Explain → the sheet → marker 2 → Read the whole answer', async ({
    browser,
    stack,
  }) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const token = await register(
      stack.apiUrl,
      `e2e-v02-phone-${String(Date.now())}@papertree.test`,
    );
    const paperId = await upload(stack.apiUrl, token, ATTENTION);
    await waitParsed(stack.apiUrl, token, paperId);
    const page = await openReader(browser, token, paperId);

    // The header is one row: the rest of the reader's controls wait in its menu.
    const bar = page.getByRole('banner');
    await expect(bar.getByText('p. 1', { exact: true })).toBeVisible();
    expect((await bar.boundingBox())?.height).toBeLessThanOrEqual(57);
    await expect(bar.getByRole('radiogroup', { name: 'Reading mode' })).toHaveCount(0);

    await reveal(page, 'We propose a new simple network architecture');
    const points = await pointsFor(
      page,
      'We propose a new simple network architecture',
      'entirely.',
    );
    await drag(page, points.from, points.to);
    await page
      .getByRole('toolbar', { name: 'Selection actions' })
      .getByRole('button', { name: 'Explain' })
      .first()
      .click();

    const sheet = page.getByRole('dialog', { name: 'Explain' });
    await expect(sheet).toBeVisible();
    const head = sheet.locator('.pt-sheet__header');
    await expect(head.getByRole('button', { name: /^Thread 1 of 1/ })).toBeVisible();
    await expect(head.getByRole('button', { name: 'Close explain panel' })).toBeVisible();
    await expect(sheet.locator('[data-message-status="complete"]')).toBeVisible({
      timeout: 120_000,
    });
    // One paragraph: nothing more to read, so no "Read the whole answer".
    await expect(sheet.getByRole('button', { name: 'Read the whole answer' })).toHaveCount(0);

    // The quote on two lines; 22 px markers that answer taps 21 px out (a 44 px target); 44 px rows.
    const lines = await sheet.locator('.pt-call-slip__quote-text').evaluate((el) => {
      return Math.round(
        el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
      );
    });
    expect(lines).toBeLessThanOrEqual(2);
    const marker = '.pt-explain-sheet [data-passage="2"] button';
    expect((await page.locator(marker).first().boundingBox())?.height).toBe(22);
    expect(await hitsAround(page, marker, 21)).toEqual([true, true, true, true]);
    for (const row of await sheet.locator('.pt-trace-row__touch').all()) {
      expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // The pinned footer: usage and To board under the scroll, never over it; nothing dead.
    const pinned = sheet.locator('[data-pinned-footer]');
    await expect(pinned).toContainText('(estimate)');
    await expect(pinned.getByRole('button', { name: 'To board' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Dive in|Diagram/ })).toHaveCount(0);
    const scroll = await sheet.locator('.pt-explain__scroll').boundingBox();
    const foot = await pinned.boundingBox();
    expect((scroll?.y ?? 0) + (scroll?.height ?? 0)).toBeLessThanOrEqual((foot?.y ?? 0) + 1);

    // Marker 2: the sheet lowers to peek and passage 2 flashes, above the sheet.
    await page.locator(marker).first().click();
    await expect(page.locator('.pt-explain-sheet')).toHaveAttribute('data-detent', 'peek');
    const flash = page.locator('svg [data-flash="true"] polygon.pt-flash');
    await expect(flash.first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    const [box, sheetBox] = await Promise.all([
      flash.first().boundingBox(),
      page.locator('.pt-explain-sheet').boundingBox(),
    ]);
    expect((box?.y ?? 1e9) + (box?.height ?? 0)).toBeLessThan(sheetBox?.y ?? 0);
    await expect(page.locator('[data-flash-tab="2"]')).toContainText('from marker 2 in the answer');

    // A follow-up in three paragraphs opens on its first; Read the whole answer shows the rest.
    await sheet.getByRole('slider', { name: 'Explain height' }).press('ArrowUp');
    const box2 = sheet.getByRole('textbox');
    await box2.fill('Say more [faux:paragraphs]');
    await box2.press('Enter');
    const second = sheet.locator('[data-exchange]').nth(1);
    await expect(second.locator('[data-message-status="complete"]')).toBeVisible({
      timeout: 120_000,
    });
    await expect(second.getByText('It comes back to the selection')).toHaveCount(0);
    const more = second.getByRole('button', { name: 'Read the whole answer' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(second.getByText(/It comes back to the selection/)).toBeVisible();
    await expect(second.locator('.pt-ai-slip__uncited')).toContainText("the AI's own reading");
    await expect(second.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.context().close();
  });

  test('a zoom picked at 390 survives a reload (#175)', async ({ browser, stack }) => {
    test.setTimeout(600_000);
    const token = await register(stack.apiUrl, `e2e-v02-zoom-${String(Date.now())}@papertree.test`);
    const paperId = await upload(stack.apiUrl, token, ATTENTION);
    await waitParsed(stack.apiUrl, token, paperId);
    const page = await openReader(browser, token, paperId);
    const width = () =>
      page
        .locator('.papertree-page')
        .first()
        .evaluate((el) => el.getBoundingClientRect().width);
    const menu = page.getByRole('button', { name: 'Reading options' });

    await menu.click();
    await expect(page.getByLabel('Zoom level')).toHaveValue('fit-width');
    await page.getByLabel('Zoom level').selectOption('1.5');
    await page.keyboard.press('Escape');
    await expect.poll(width).toBeGreaterThan(800);
    const before = await width();
    await page.waitForTimeout(600); // the place is saved 250 ms after the last change

    await page.reload();
    await expect
      .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
        timeout: 180_000,
      })
      .toBeGreaterThan(20);
    expect(await width()).toBeCloseTo(before, 0);
    await menu.click();
    await expect(page.getByLabel('Zoom level')).toHaveValue('1.5');
    await page.context().close();
  });
});
