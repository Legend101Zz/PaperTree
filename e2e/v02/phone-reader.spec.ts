/**
 * v0.2 frame 08b (#205) on the FAUX agent, at 390 × 844: open "Attention Is All You Need" → select
 * a sentence of the abstract → Explain → the bottom sheet (its header with the thread menu, the call
 * slip's quote on two lines, 44 px markers and trace rows, the pinned footer that never covers the
 * answer) → tap marker 2 → the sheet lowers to peek and passage 2 flashes above it → a follow-up
 * answered in three paragraphs (`[faux:paragraphs]`) opens on its first, and "Read the whole
 * answer" shows the rest. Then the zoom a reader picks at 390 survives a reload (#175, the v0.1
 * defect the audit could not confirm), Contents from the menu keeps focus, Guided's tables take focus
 * only when they scroll, and at 390 × 700 a passage behind the peek sheet scrolls up before it
 * flashes; a landscape phone keeps an answer area and the follow-up box on screen (review, #205).
 *
 * Every size is measured in the page (boxes, `elementFromPoint`), not read from CSS. The PDF is the
 * committed corpus's; the spec SKIPS, loudly, without it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import {
  drag,
  pointsFor,
  readingControls,
  register,
  REPO,
  reveal,
  upload,
  waitParsed,
} from '../s4/support';

import type { Browser, Page } from '@playwright/test';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const PHONE = { width: 390, height: 844 };
/** The peek sheet's height (`SHEET_PEEK_PX` in @papertree/ui). */
const SHEET_PEEK = 120;

async function openReader(
  browser: Browser,
  token: string,
  paperId: string,
  viewport: { width: number; height: number } = PHONE,
): Promise<Page> {
  const context = await browser.newContext({
    viewport,
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

/** Select a sentence with the mouse, from `start` to `end`, and press the toolbar's Explain. */
async function explainPassage(page: Page, start: string, end: string): Promise<void> {
  await reveal(page, start);
  const points = await pointsFor(page, start, end);
  await drag(page, points.from, points.to);
  await page
    .getByRole('toolbar', { name: 'Selection actions' })
    .getByRole('button', { name: 'Explain' })
    .first()
    .click();
}

/**
 * Who answers taps on the squares of the first run of two markers in exchange `index`, sampled on
 * an 11 × 11 grid per square: the passage number of the marker under each point.
 */
async function squareOwners(page: Page, index: number): Promise<string[][]> {
  return page.evaluate((at) => {
    const exchange = document.querySelectorAll('.pt-explain-sheet [data-exchange]')[at];
    const run = Array.from(exchange?.querySelectorAll('.pt-cite-run') ?? []).find(
      (r) => r.querySelectorAll('.pt-exchange__inline-marker').length === 2,
    );
    run?.scrollIntoView({ block: 'center' });
    const wraps = Array.from(run?.querySelectorAll('.pt-exchange__inline-marker') ?? []);
    return wraps.map((wrap) => {
      const r = (wrap.querySelector('button') as HTMLElement).getBoundingClientRect();
      const owners: string[] = [];
      for (let gx = 0; gx <= 10; gx += 1)
        for (let gy = 0; gy <= 10; gy += 1) {
          const hit = document.elementFromPoint(
            r.left + 0.5 + (gx * (r.width - 1)) / 10,
            r.top + 0.5 + (gy * (r.height - 1)) / 10,
          );
          owners.push(
            hit?.closest('.pt-exchange__inline-marker')?.getAttribute('data-passage') ?? '',
          );
        }
      return owners;
    });
  }, index);
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
    for (const name of ['Library', 'Explain', 'Reading options']) {
      const target = await bar
        .getByRole(name === 'Library' ? 'link' : 'button', { name })
        .boundingBox();
      expect(target?.height ?? 0, `${name} is a 44 px target`).toBeGreaterThanOrEqual(44);
    }

    await explainPassage(page, 'We propose a new simple network architecture', 'entirely.');

    const sheet = page.getByRole('dialog', { name: 'Explain' });
    await expect(sheet).toBeVisible();
    const head = sheet.locator('.pt-sheet__header');
    await expect(head.getByRole('button', { name: /^Thread 1 of 1/ })).toBeVisible();
    await expect(head.getByRole('button', { name: 'Close explain panel' })).toBeVisible();
    await expect(sheet.locator('[data-message-status="complete"]')).toBeVisible({
      timeout: 120_000,
    });
    // The menu opens above the sheet: every item answers taps where it is drawn.
    await page.getByRole('button', { name: 'Reading options' }).click();
    const options = page.getByRole('group', { name: 'Reading options' });
    for (const target of [
      options.getByRole('button', { name: /^Contents/ }),
      options.getByRole('radio', { name: 'Guided' }),
      options.getByLabel('Zoom level'),
      options.getByRole('button', { name: 'Zoom in' }),
      options.getByRole('link', { name: 'Board' }),
    ]) {
      const b = await target.boundingBox();
      expect(b).not.toBeNull();
      const hit = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('.pt-reader-menu') !== null,
        [(b?.x ?? 0) + (b?.width ?? 0) / 2, (b?.y ?? 0) + (b?.height ?? 0) / 2] as const,
      );
      expect(hit, 'the menu, not the sheet, answers there').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(options).toHaveCount(0);

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

    // "[b1, b2]" draws markers 1 and 2 side by side: each square answers only to itself.
    const owners = await squareOwners(page, 1);
    expect(owners).toHaveLength(2);
    expect(new Set(owners[0])).toEqual(new Set(['1']));
    expect(new Set(owners[1])).toEqual(new Set(['2']));
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
  test('Contents from the menu keeps focus; Guided tables take focus only when they scroll', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(600_000);
    const token = await register(stack.apiUrl, `e2e-v02-menu-${String(Date.now())}@papertree.test`);
    const paperId = await upload(stack.apiUrl, token, ATTENTION);
    await waitParsed(stack.apiUrl, token, paperId);
    const page = await openReader(browser, token, paperId);

    // Contents from the menu: focus goes into the Contents panel, and back to the menu on Esc.
    const menu = page.getByRole('button', { name: 'Reading options' });
    await menu.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Contents/ }).focus();
    await page.keyboard.press('Enter');
    const inContents = () =>
      page.evaluate(() =>
        document.activeElement?.closest('[role="tablist"]')?.getAttribute('aria-label'),
      );
    await expect.poll(inContents).toBe('Contents sections');
    await page.keyboard.press('Escape');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
      .toBe('Reading options');

    // Guided: a table is a named, focusable region only while it scrolls sideways.
    await readingControls(page, (controls) =>
      controls.getByRole('radio', { name: 'Guided' }).click(),
    );
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.waitForTimeout(1200);
      const tables = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pt-guided__table-scroller')).map((el) => ({
          scrolls: el.scrollWidth > el.clientWidth + 1,
          focusable: el.getAttribute('tabindex') === '0',
          role: el.getAttribute('role'),
          name: el.getAttribute('aria-label') ?? '',
        })),
      );
      console.log(`[e2e v02 phone] Guided tables at ${String(width)}: ${JSON.stringify(tables)}`);
      expect(tables.length, 'the paper has tables').toBeGreaterThan(0);
      for (const t of tables) {
        expect(t.focusable, `a tab stop only where it scrolls (${t.name})`).toBe(t.scrolls);
        if (t.scrolls) {
          expect(t.role).toBe('region');
          expect(t.name).toMatch(/^Table/);
        }
      }
    }
    await page.context().close();
  });

  test('390 × 700: a passage behind the peek sheet scrolls up before it flashes; landscape fits', async ({
    browser,
    stack,
  }) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const token = await register(
      stack.apiUrl,
      `e2e-v02-inset-${String(Date.now())}@papertree.test`,
    );
    const paperId = await upload(stack.apiUrl, token, ATTENTION);
    await waitParsed(stack.apiUrl, token, paperId);
    const page = await openReader(browser, token, paperId, { width: 390, height: 700 });
    // A passage of p. 2, so the passages it cites can be scrolled anywhere in the window.
    await explainPassage(page, 'Recurrent models typically factor computation', 'sequences.');
    const sheet = page.locator('.pt-explain-sheet');
    await expect(sheet.locator('[data-message-status="complete"]')).toBeVisible({
      timeout: 120_000,
    });
    const marker = sheet.locator('[data-passage="1"] button').first();
    const scrollTop = () =>
      page.evaluate(
        () => (document.querySelector('[data-papertree-scroller]') as HTMLElement).scrollTop,
      );
    const flashBottom = async () => {
      await expect(page.locator('svg [data-flash] polygon.pt-flash').first()).toBeVisible({
        timeout: 10_000,
      });
      await page.waitForTimeout(700); // the sheet settles at peek, any scroll is over
      return page
        .locator('svg [data-flash] polygon.pt-flash')
        .evaluateAll((ps) => Math.max(...ps.map((p) => p.getBoundingClientRect().bottom)));
    };

    // Find passage 1, then park it in the window's foot, where the peek sheet covers it.
    await marker.click();
    const bottom = await flashBottom();
    const before = await scrollTop();
    await page.mouse.click(5, 200); // the next action clears the outline
    await page.evaluate(
      (dy) => {
        (document.querySelector('[data-papertree-scroller]') as HTMLElement).scrollTop -= dy;
      },
      700 - 40 - bottom,
    );
    await page.waitForTimeout(500);
    const parked = bottom + before - (await scrollTop());
    // Behind the peek sheet now (else this would prove nothing).
    expect(parked, 'the passage sits behind the peek sheet').toBeGreaterThan(700 - SHEET_PEEK);
    await sheet.getByRole('slider', { name: 'Explain height' }).press('ArrowUp');
    await page.waitForTimeout(400);
    await marker.click();
    const again = await flashBottom();
    const sheetTop = (await sheet.boundingBox())?.y ?? 0;
    expect(again, 'the flashed passage is above the peek sheet').toBeLessThanOrEqual(sheetTop);

    // A landscape phone: the answer keeps a readable area and the follow-up box stays on screen.
    await sheet.getByRole('slider', { name: 'Explain height' }).press('ArrowUp');
    await page.setViewportSize({ width: 667, height: 375 });
    await page.waitForTimeout(800);
    const scroll = await sheet.locator('.pt-explain__scroll').boundingBox();
    const composer = await sheet.locator('.pt-explain__composer').boundingBox();
    expect(scroll?.height ?? 0, 'the answer area').toBeGreaterThanOrEqual(100);
    expect((composer?.y ?? 0) + (composer?.height ?? 0)).toBeLessThanOrEqual(375);
    await page.context().close();
  });
});
