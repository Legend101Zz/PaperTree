/**
 * W3UI round 2 (#141) on the real stack (api + worker + agent + web), YOLO:
 *
 *   R3  the quote is de-hyphenated and never cut mid-word ("Show all" for a long one)
 *   R4  a chip keeps the punctuation that follows it on its line
 *   R10 light markdown is rendered (no asterisks), chips still work inside lists and bold
 *   R5  a canvas explanation card shows page labels, never "[bN]", and renders the same markdown
 *   R7  the "Send to canvas" toast lasts 8 s, waits while hovered or focused, and "Open canvas" is
 *       reachable by keyboard
 *
 * The panel visuals (R3/R4/R10) use a CRAFTED event stream (page.route) so the answer carries the
 * markdown the live model writes; the canvas half uses the real faux agent, a real message and its
 * stored citations. Screenshots (1440x900 and 390x844, light and dark) go to PAPERTREE_E2E_SHOTS.
 */
import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { api, getBoard, tokenInit } from '../s7/support';
import {
  drag,
  pointsFor,
  register,
  reveal,
  shotPath,
  upload,
  waitParsed,
  yoloPdf,
} from '../s4/support';

const YOLO = yoloPdf();

const SCREENS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

const MARKDOWN_ANSWER = [
  '**Short version.** YOLO treats detection as a *single regression* problem, so one network predicts boxes and class probabilities straight from the full image [b1].',
  '',
  'What matters most:',
  '',
  '- **Speed**: it runs in real time at 45 frames per second [b2].',
  '- **Global view**: it sees the *whole* image, using `S x S` grid cells and the word _where_.',
  '',
  '1. Divide the image into a grid.',
  '2. Predict boxes and confidences for each cell.',
  '',
  'Because there are no region proposals the pipeline stays simple, and it can drive cars without relying on cheaper, more specialized sensors [b1].',
].join('\n');

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function craftedStream(anchor: unknown): string {
  const cite = (n: number, page: number) => ({
    citation_id: `cit_w3_${String(n)}`,
    ordinal: n,
    marker: `b${String(n)}`,
    page_index: page,
    anchor,
    supported: true,
  });
  return [
    frame('run', {
      run_id: 'run_w3',
      thread_id: 'thr_w3',
      user_message_id: 'msg_w3u',
      message_id: 'msg_w3a',
      generation: 1,
    }),
    frame('text', { delta: MARKDOWN_ANSWER }),
    frame('citations', { items: [cite(1, 0), cite(2, 0)] }),
    frame('usage', {
      run_id: 'run_w3',
      model: 'MiniMax-M3.1-Flash-Preview',
      provider: 'minimax',
      agent_sdk: 'pi-coding-agent@0.87.1',
      input_tokens: 2000,
      output_tokens: 300,
      cache_read_tokens: 0,
      reasoning_tokens: 0,
      cost_usd_est: 0.001,
      first_text_ms: 800,
      latency_ms: 2100,
      retries: 0,
      tool_calls: 0,
    }),
    frame('done', { status: 'complete', error: null, message_id: 'msg_w3a' }),
  ].join('');
}

async function openReader(page: Page, paperId: string): Promise<void> {
  await page.goto(`/paper/${paperId}/read`);
  await expect
    .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
      timeout: 180_000,
    })
    .toBeGreaterThan(50);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
}

async function selectAndAsk(page: Page, from: string, to: string): Promise<void> {
  await reveal(page, from);
  const points = await pointsFor(page, from, to);
  await drag(page, points.from, points.to);
  const toolbar = page.getByRole('toolbar', { name: 'Selection actions' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: /Ask/ }).click();
}

async function noSideScroll(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
}

test.describe('W3UI round 2 (YOLO)', () => {
  test.skip(YOLO === null, 'SKIPPED: the YOLO PDF is not present.');

  test('R3 R4 R10: the explain panel quote, chips and markdown', async ({
    browser,
    stack,
  }, testInfo) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const token = await register(stack.apiUrl, `e2e-w3ui-${String(Date.now())}@papertree.test`);
    const paperId = await upload(stack.apiUrl, token, YOLO as string);
    await waitParsed(stack.apiUrl, token, paperId);

    for (const screen of SCREENS) {
      for (const theme of THEMES) {
        const label = `${screen.name}-${theme}`;
        const context = await browser.newContext({
          viewport: { width: screen.width, height: screen.height },
          colorScheme: theme,
        });
        await tokenInit(
          await context.newPage().then(async (p) => (await p.close(), p)),
          token,
        ).catch(() => undefined);
        await context.addInitScript((t) => {
          try {
            window.localStorage.setItem('papertree.session', t);
          } catch {
            /* no storage, no walk */
          }
        }, token);
        const page = await context.newPage();
        let anchorForCites: unknown = {};
        await page.route(/\/papers\/[^/]+\/threads$/, async (route) => {
          const request = route.request();
          if (request.method() !== 'POST') return route.fallback();
          const body = request.postDataJSON() as { anchor?: unknown };
          anchorForCites = body.anchor ?? {};
          return route.fulfill({
            status: 200,
            headers: {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              'access-control-allow-origin': '*',
            },
            body: craftedStream(anchorForCites),
          });
        });
        await openReader(page, paperId);
        // A long selection that crosses PDF line ends ("per-" / "form") and a real compound.
        await selectAndAsk(
          page,
          'Prior work on object',
          'Our unified architecture is extremely fast.',
        );

        // A right drawer from 768 px up, a bottom sheet (a dialog) below it.
        const panel =
          screen.width >= 768
            ? page.getByRole('complementary', { name: 'Explain' })
            : page.getByRole('dialog', { name: 'Explain' });
        await expect(panel).toBeVisible();
        const quote = panel.locator('[data-explain-quote]');
        await expect(quote).toContainText('Prior work');
        const shown = (await quote.locator('blockquote').innerText()).replace(/\s+/g, ' ');
        // R3: no line-end hyphen is left, and a long quote is cut at a word, with Show all.
        expect(shown).not.toMatch(/\p{L}- \p{Ll}/u);
        expect(shown).toContain('repurposes classifiers to perform detection');
        const fold = quote.getByRole('button', { name: 'Show all' });
        await expect(fold).toBeVisible();
        const cut = shown.replace(/\s*p\. \d+\s*$/, '');
        expect(cut.endsWith('\u2026')).toBe(true);
        const kept = cut.slice(0, -1);
        // Must-fix: the toolbar has its own ground and a hairline, and the scroll area starts
        // below it, so scrolled quote text never sits behind "Summarize paper".
        const bar = await panel.locator('.pt-explain__toolbar').evaluate((el) => {
          const css = getComputedStyle(el);
          const scroll = el.parentElement?.querySelector('.pt-explain__scroll');
          return {
            bg: css.backgroundColor,
            border: css.borderBottomWidth,
            barBottom: el.getBoundingClientRect().bottom,
            scrollTop: scroll?.getBoundingClientRect().top ?? -1,
          };
        });
        expect(bar.bg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
        expect(bar.border).toBe('1px');
        expect(bar.scrollTop).toBeGreaterThanOrEqual(bar.barBottom - 0.5);
        // Should-fix: "Show all" sits close under the cut quote.
        const gap = await quote.evaluate((el) => {
          const q = el.querySelector('blockquote')?.getBoundingClientRect();
          const f = el.querySelector('.pt-explain__fold')?.getBoundingClientRect();
          return q && f ? f.top - q.bottom : -1;
        });
        expect(gap).toBeGreaterThanOrEqual(-8);
        expect(gap).toBeLessThan(16);
        await fold.click();
        const full = (await quote.locator('blockquote').innerText()).replace(/\s+/g, ' ');
        expect(full.startsWith(kept)).toBe(true);
        expect(/\s/.test(full[kept.length] ?? ' ')).toBe(true);
        expect(full).not.toMatch(/\p{L}- \p{Ll}/u);
        expect(full).toContain('end-to-end');
        await quote.getByRole('button', { name: 'Show less' }).click();

        const answer = panel.locator('[data-message-status="complete"]').first();
        await expect(answer).toBeVisible({ timeout: 60_000 });
        // R10: rendered, not raw.
        const text = (await answer.innerText()).replace(/\s+/g, ' ');
        expect(text).not.toMatch(/\*|\[b\d|_where_|`/);
        await expect(answer.locator('strong').first()).toContainText('Short version.');
        expect(await answer.locator('em').count()).toBeGreaterThanOrEqual(2);
        expect(await answer.locator('code').count()).toBe(1);
        expect(await answer.locator('ul > li').count()).toBe(2);
        expect(await answer.locator('ol > li').count()).toBe(2);
        expect(await answer.locator('li .pt-chip').count()).toBe(1);
        expect(await answer.locator('.pt-chip').count()).toBe(3);
        // R4: the full stop travels with the chip: the run is one line, and nothing is left after it.
        const runs = await answer.locator('.pt-cite-run').evaluateAll((nodes) =>
          nodes.map((n) => ({
            text: n.textContent,
            lines: n.getClientRects().length,
            tail: n.parentElement?.lastChild === n,
          })),
        );
        expect(runs.length).toBe(3);
        for (const run of runs) expect(run.lines).toBe(1);
        expect(runs[2]).toMatchObject({ text: 'p. 1.', tail: true });
        await noSideScroll(page, screen.width);
        await page.screenshot({
          path: shotPath(`r2-panel-${label}.png`, testInfo.outputPath('shots')),
        });
        await context.close();
      }
    }
  });

  test('R5 R7 W2: canvas card citations, markdown, toast, keyboard', async ({
    browser,
    stack,
  }, testInfo) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const token = await register(stack.apiUrl, `e2e-w3ui-c-${String(Date.now())}@papertree.test`);
    const paperId = await upload(stack.apiUrl, token, YOLO as string);
    await waitParsed(stack.apiUrl, token, paperId);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await tokenInit(await context.newPage(), token);
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem('papertree.session', t);
      } catch {
        /* no storage, no walk */
      }
    }, token);
    const page = await context.newPage();
    await openReader(page, paperId);
    await selectAndAsk(page, 'Prior work on object', 'full images in one evaluation.');
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel.locator('[data-message-status="complete"]').first()).toBeVisible({
      timeout: 120_000,
    });

    // R7, mouse: the toast is still there after 6.5 s (the old one went at 6 s), waits while hovered.
    const send = panel.getByRole('button', { name: 'Send to canvas' });
    await send.click();
    const toast = page.getByTestId('canvas-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Answer added to your canvas.');
    await page.waitForTimeout(6_500);
    await expect(toast).toBeVisible();
    await page.screenshot({ path: shot('r2-toast-1440-light.png') });
    await toast.hover();
    await page.waitForTimeout(10_000);
    await expect(toast).toBeVisible();
    await page.mouse.move(100, 100);
    await expect(toast).toBeHidden({ timeout: 15_000 });

    // R7, keyboard: a second answer's toast takes the keyboard to "Open canvas"; Escape returns.
    await panel.getByLabel('Ask a question about this paper').fill('Why is that fast?');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(panel.locator('[data-message-status="complete"]')).toHaveCount(2, {
      timeout: 120_000,
    });
    const sendSecond = panel.getByRole('button', { name: 'Send to canvas' }).last();
    await sendSecond.focus();
    await page.keyboard.press('Enter');
    await expect(toast).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open canvas' })).toBeFocused();
    await page.waitForTimeout(9_000);
    await expect(toast).toBeVisible(); // focus inside holds the clock
    await page.keyboard.press('Escape');
    await expect(toast).toBeHidden();

    // The canvas: cards carry the answer, with page labels and no handles.
    const board = await getBoard(stack.apiUrl, token, paperId);
    const nodes = (
      board as unknown as {
        nodes: { node_id: string; kind: string; version: number; body: string }[];
      }
    ).nodes;
    const cards = nodes.filter((n) => n.kind === 'explanation');
    expect(cards.length).toBe(2);
    expect(
      cards.some((c) => /\[b\d+\]/.test(c.body)),
      'the stored body keeps its handles',
    ).toBe(true);
    const boardId = (board as unknown as { board: { board_id: string } }).board.board_id;
    // Give the first card the markdown the live model writes (the stored words, edited by the test).
    const first = cards[0] as { node_id: string; version: number };
    const patched = await api(
      stack.apiUrl,
      token,
      'PATCH',
      `/boards/${boardId}/nodes/${first.node_id}`,
      {
        version: first.version,
        body: MARKDOWN_ANSWER,
      },
    );
    expect(patched.status).toBe(200);

    for (const screen of SCREENS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({
          viewport: { width: screen.width, height: screen.height },
          colorScheme: theme,
        });
        await tokenInit(await ctx.newPage(), token);
        await ctx.addInitScript((t) => {
          try {
            window.localStorage.setItem('papertree.session', t);
          } catch {
            /* no storage, no walk */
          }
        }, token);
        const canvas = await ctx.newPage();
        await canvas.goto(`/paper/${paperId}/canvas`);
        await expect(canvas.locator('.react-flow__node-explanation')).toHaveCount(2);
        await expect(canvas.locator('.pt-cite-label').first()).toBeVisible({ timeout: 30_000 });
        const body = (await canvas.locator('.react-flow__node-explanation').allInnerTexts()).join(
          ' ',
        );
        expect(body).not.toMatch(/\[b\d+\]|\*\*|_where_|`/);
        expect(await canvas.locator('.react-flow__node-explanation button.pt-chip').count()).toBe(
          0,
        );
        expect(
          await canvas.locator('.react-flow__node-explanation strong').count(),
        ).toBeGreaterThan(0);
        expect(await canvas.locator('.react-flow__node-explanation ul > li').count()).toBe(2);
        await noSideScroll(canvas, screen.width);
        await canvas.screenshot({ path: shot(`r2-canvas-${screen.name}-${theme}.png`) });
        await ctx.close();
      }
    }
    await context.close();
  });
});
