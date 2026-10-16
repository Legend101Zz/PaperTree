/**
 * W3UI round 2 (#141) on the real stack (api + worker + agent + web), YOLO:
 *
 *   R3  the quote is de-hyphenated (on the call slip since #202: one line, ellipsis by CSS)
 *   R4  a marker keeps the punctuation that follows it on its line (chips until #202)
 *   R10 light markdown is rendered (no asterisks), markers still work inside lists and bold
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
  // #203: the toolbar's Explain runs the answer now (v0.1's Ask); its Ask waits for a question.
  await toolbar.getByRole('button', { name: 'Explain this passage' }).click();
}

async function noSideScroll(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
}

test.describe('W3UI round 2 (YOLO)', () => {
  test.skip(YOLO === null, 'SKIPPED: the YOLO PDF is not present.');

  test('R3 R4 R10: the explain panel quote, markers and markdown', async ({
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
        // #202: the selection is quoted on the first call slip, in the paper's voice: one line with
        // an ellipsis by CSS (two on a phone), the whole passage in the DOM, de-hyphenated (R3).
        const words = quote.locator('[data-voice="paper"]');
        const shown = (await words.innerText()).replace(/\s+/g, ' ');
        expect(shown).not.toMatch(/\p{L}- \p{Ll}/u);
        expect(shown).toContain('repurposes classifiers to perform detection');
        expect(shown).toContain('end-to-end');
        const clip = await words.evaluate((el) => {
          const css = getComputedStyle(el);
          return { overflow: css.textOverflow, wrap: css.whiteSpace, clamp: css.webkitLineClamp };
        });
        if (screen.width >= 768)
          expect(clip).toMatchObject({ overflow: 'ellipsis', wrap: 'nowrap' });
        else expect(clip.clamp).toBe('2');
        // Must-fix (kept from v0.1): the scroll area starts below the panel's tools, so scrolled
        // text never sits behind them.
        const bar = await panel.locator('.pt-explain__tools').evaluate((el) => {
          const scroll = el
            .closest('.pt-explain, .pt-explain-sheet')
            ?.querySelector('.pt-explain__scroll');
          return {
            barBottom: el.getBoundingClientRect().bottom,
            scrollTop: scroll?.getBoundingClientRect().top ?? -1,
          };
        });
        expect(bar.scrollTop).toBeGreaterThanOrEqual(bar.barBottom - 0.5);

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
        // #202: numbered passage markers, not chips: [b1] [b2] [b1] are markers 1, 2, 1.
        expect(await answer.locator('li [data-citation-id]').count()).toBe(1);
        expect(await answer.locator('[data-citation-id]').count()).toBe(3);
        expect(await answer.locator('.pt-chip').count()).toBe(0);
        // R4: the full stop travels with the marker: the run is one line, nothing left after it.
        const runs = await answer.locator('.pt-cite-run').evaluateAll((nodes) =>
          nodes.map((n) => ({
            text: n.textContent,
            lines: n.getClientRects().length,
            tail: n.parentElement?.lastChild === n,
          })),
        );
        expect(runs.length).toBe(3);
        for (const run of runs) expect(run.lines).toBe(1);
        expect(runs[2]).toMatchObject({ text: '1.', tail: true });
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
        // #212: a board card cites with the passage's numbered marker, not a "p. 4" label.
        await expect(
          canvas.locator('.react-flow__node-explanation .pt-marker').first(),
        ).toBeVisible({ timeout: 30_000 });
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
