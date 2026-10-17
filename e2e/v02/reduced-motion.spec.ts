/**
 * S8 (#218): every moment of frame 11 with `prefers-reduced-motion: reduce`, on the real stack with
 * the FAUX agent at 1440: pull out, open, put back, Read, the citation flash, Dive in, Back to the
 * paper, the plate's parts arriving, and the board's thread. Each one must COMPLETE (its end state
 * is asserted), and no animation it starts may run longer than DESIGN.md §6's reduced column: one
 * 120 ms cross-fade at most, and none at all for the flash ("the ring and wash appear, clear on the
 * next action"), the plate's parts ("simply appear") and the thread ("drawn on release, no
 * settle"). Every animation is read from `document.getAnimations()` on every frame
 * (`recordAnimations`), so a CSS transition, a CSS animation and a Web Animation all count. The one
 * motion those cannot see is script-driven: the flash's scroll to an off-screen passage
 * (`tweenScroll`, a `requestAnimationFrame` loop, 240 ms in full motion). The walk starts the flash
 * with its passage off screen and reads the scroller's `scrollTop` on every frame (`recordScroll`):
 * under reduced motion it must jump, not travel.
 *
 * The board's passage card holds the Anchor the reader sent for the explained selection, placed
 * through the API (as in `prototype-flow.spec.ts`); the plate is drawn in the panel by the faux
 * agent (`[faux:diagram]`, added to that one request as `diagram.spec.ts` does) and sent to the
 * board from it. The PDF is the committed corpus's; the spec SKIPS, loudly, without it.
 */
import { existsSync } from 'node:fs';

import { expect, test } from '../harness/test';
import { drag, pointsFor, register, reveal, SCROLLER, upload, waitParsed } from '../s4/support';
import { getBoard, tokenInit } from '../s7/support';
import {
  ATTENTION,
  placeCard,
  recordAnimations,
  recordScroll,
  steadyCentre,
  takeAnimations,
  type SeenAnimation,
} from './flow-support';

import type { Page } from '@playwright/test';

/** DESIGN.md §6, reduced motion: the longest moment is one 120 ms cross-fade. */
const REDUCED_MS = 120;

/** What a moment ran: never an endless animation, never one longer than `bound` ms. */
function expectWithin(moment: string, seen: readonly SeenAnimation[], bound = REDUCED_MS): void {
  console.log(`[e2e s8 reduced] ${moment}: ${JSON.stringify(seen)}`);
  const over = seen.filter((a) => !Number.isFinite(a.end) || a.end > bound);
  expect(over, `${moment}: animations over ${String(bound)} ms`).toEqual([]);
}

/** What a moment ran on the elements that must not move at all (`targets` start with one of these). */
function expectNoneOn(moment: string, seen: readonly SeenAnimation[], targets: RegExp): void {
  const moving = seen.filter((a) => targets.test(a.target) && a.end > 0);
  expect(moving, `${moment}: nothing may animate on ${String(targets)}`).toEqual([]);
}

async function select(page: Page, from: string, to: string): Promise<void> {
  await reveal(page, from);
  const points = await pointsFor(page, from, to);
  await drag(page, points.from, points.to);
}

const textLayer = (page: Page) => page.locator('.papertree-text-layer span[data-cp-start]');

test.describe('S8: reduced motion, every moment (faux agent)', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );
  test.use({ actionTimeout: 20_000 });

  test('each moment completes, and none runs past the reduced durations', async ({
    browser,
    stack,
  }) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const token = await register(
      stack.apiUrl,
      `e2e-s8-reduced-${String(Date.now())}@papertree.test`,
    );
    const paperId = await upload(stack.apiUrl, token, ATTENTION);
    await waitParsed(stack.apiUrl, token, paperId);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    await recordAnimations(context);
    const page = await context.newPage();
    await tokenInit(page, token);
    await page.route(`**/papers/${paperId}/threads`, async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() ?? '{}') as { kind?: string; question?: string };
      if (request.method() !== 'POST' || body.kind !== 'diagram') return route.continue();
      body.question = '[faux:diagram] Explain with a diagram.';
      return route.continue({ postData: JSON.stringify(body) });
    });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    );

    // ── the book: pull out, open, put back, and Read ──
    await page.goto('/dashboard');
    const book = page.locator(`[aria-label="Your shelf"] button[data-paper-id="${paperId}"]`);
    await expect(book).toBeVisible({ timeout: 60_000 });
    // The library's own arrival (covers, the header) is not one of frame 11's moments: drop it.
    await takeAnimations(page);
    const spread = page.locator('[role="dialog"][data-book-stage]');
    await book.focus();
    await page.keyboard.press('Enter');
    await expect(spread).toHaveAttribute('data-book-stage', 'pulled');
    expectWithin('pull out', await takeAnimations(page));
    await page.keyboard.press('Enter');
    await expect(spread).toHaveAttribute('data-book-stage', 'open');
    await expect(spread.getByRole('button', { name: /^Read / })).toBeFocused();
    expectWithin('open', await takeAnimations(page));
    await page.keyboard.press('Escape');
    await expect(spread).toHaveCount(0);
    await expect(book).toBeFocused();
    expectWithin('put back', await takeAnimations(page));
    await page.keyboard.press('Enter');
    await expect(spread).toHaveAttribute('data-book-stage', 'pulled');
    await page.keyboard.press('Enter');
    await expect(spread.getByRole('button', { name: /^Read / })).toBeFocused();
    // A second pull out and open, already held to the bound above: drop them, so "Read" is alone.
    await takeAnimations(page);
    await page.keyboard.press('Enter');
    await page.waitForURL(`**/paper/${paperId}/read**`);
    await expect.poll(() => textLayer(page).count(), { timeout: 180_000 }).toBeGreaterThan(50);
    expectWithin('Read', await takeAnimations(page));

    // ── Explain, then the citation flash: the ring and wash appear and stay until the next action ──
    await select(page, 'We propose a new simple network architecture', 'entirely.');
    const sent = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`/papers/${paperId}/threads`),
    );
    await page
      .getByRole('toolbar', { name: 'Selection actions' })
      .getByRole('button', { name: 'Explain this passage' })
      .click();
    const selection = ((await sent).postDataJSON() as { anchor: unknown }).anchor;
    const panel = page.getByRole('complementary', { name: 'Explain' });
    const exchange = panel.locator('[data-exchange]').first();
    await expect(exchange.locator('[data-message-status="complete"]')).toBeVisible({
      timeout: 120_000,
    });
    expectWithin('Explain', await takeAnimations(page));
    // The passage off screen first, so the flash must scroll to it: half the paper further down.
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement;
      el.scrollTop = el.scrollHeight / 2;
    }, SCROLLER);
    const flash = page.locator('svg [data-flash] polygon.pt-flash');
    await expect(flash).toHaveCount(0);
    const scroll = await recordScroll(page, SCROLLER);
    await exchange.locator('[data-passage="2"] button').first().click();
    await expect(flash.first()).toBeVisible({ timeout: 10_000 });
    const seen = await scroll.stop();
    const [first, last] = [seen[0] ?? 0, seen.at(-1) ?? 0];
    const between = seen.filter((v, i) => v !== first && v !== last && v !== seen[i - 1]);
    console.log(`[e2e s8 reduced] the flash's scroll: ${JSON.stringify(seen)}`);
    const height = await page.evaluate(
      (sel) => document.querySelector(sel)!.clientHeight,
      SCROLLER,
    );
    expect(first - last, 'the flash scrolled back to its passage').toBeGreaterThan(height);
    // A jump: the scroller goes from where it was to the passage in one frame, never through a
    // run of eased positions (240 ms of them in full motion).
    expect(between.length, `positions on the way: ${JSON.stringify(between)}`).toBeLessThanOrEqual(
      1,
    );
    // Past the whole normal flash (180 + 900 + 600): still the full ring, no fade to an outline.
    await page.waitForTimeout(2_000);
    await expect(page.locator('svg [data-flash="true"]').first()).toBeAttached();
    await expect(page.locator('svg [data-flash="linger"]')).toHaveCount(0);
    const flashed = await takeAnimations(page);
    expectWithin('the flash', flashed);
    expectNoneOn('the flash', flashed, /\.pt-flash/);
    await page.mouse.click(5, 450);
    await expect(page.locator('svg [data-flash]')).toHaveCount(0);
    expectWithin('the flash clears', await takeAnimations(page));

    // ── Dive in, and Back to the paper ──
    await exchange.getByRole('button', { name: /^Dive in/ }).click();
    await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/notebook/np_`));
    await expect(page.locator('.pt-nb-quote')).toHaveCount(2);
    await expect(page.locator('.pt-nb[data-dive]')).toHaveCount(0);
    expectWithin('Dive in', await takeAnimations(page));
    await page
      .locator('.pt-nb__bar')
      .getByRole('link', { name: /Back to the paper/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/read`));
    await expect(panel.locator('.pt-exchange')).toHaveCount(1);
    await expect.poll(() => textLayer(page).count(), { timeout: 180_000 }).toBeGreaterThan(50);
    expectWithin('Back to the paper', await takeAnimations(page));

    // ── the plate's parts simply appear ──
    await select(page, 'We call our particular attention', 'weights on the');
    await page
      .getByRole('toolbar', { name: 'Selection actions' })
      .getByRole('button', { name: 'Explain with a diagram' })
      .click();
    await expect(panel.locator('[data-plate-phase="complete"]')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.pt-plate-key [data-letter]')).toHaveCount(6);
    const plate = await takeAnimations(page);
    expectWithin('the plate', plate);
    expectNoneOn('the plate', plate, /\.pt-plate/);
    await panel.getByRole('button', { name: 'Send to board' }).click();
    await expect(panel.getByRole('button', { name: 'On your board' })).toBeVisible();

    // ── the board's thread: the picker is there at once, the thread is drawn on release ──
    const passage = await placeCard(stack.apiUrl, token, paperId, {
      kind: 'excerpt',
      x: 700,
      y: 0,
      w: 340,
      h: 200,
      body: 'We propose a new simple network architecture, the Transformer.',
      source_anchor: selection,
    });
    await page.goto(`/paper/${paperId}/board`);
    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 60_000 });
    const plateCard = page.locator('.react-flow__node-diagram');
    await expect(plateCard.locator('[data-plate-mini="6"]')).toBeVisible();
    // The board has fitted itself and placed the pins the drag aims at.
    const from = await steadyCentre(page, plateCard.locator('[data-handleid="claim_out"]'));
    const to = await steadyCentre(
      page,
      page.locator(`.react-flow__node[data-id="${passage}"] [data-handleid="evidence_in"]`),
    );
    // The board's own arrival (cards, the minimap) is not one of frame 11's moments: drop it.
    await takeAnimations(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    const picker = page.getByRole('group', { name: /link as/i });
    await expect(picker).toBeVisible();
    await page.keyboard.press('1');
    await expect(picker).toBeHidden();
    await expect(page.locator('.react-flow__edge g.pt-thread')).toHaveAttribute(
      'data-cue',
      'solid with plus',
    );
    await expect
      .poll(async () => (await getBoard(stack.apiUrl, token, paperId)).edges.length)
      .toBe(1);
    const link = await takeAnimations(page);
    expectWithin('the thread', link);
    expectNoneOn('the thread', link, /\.pt-(linkas|thread)/);
    await context.close();
  });
});
