/**
 * The canvas's screens and states at 1440x900 and 390x844, light and dark, with the 390 px bar
 * asserted (no horizontal scroll, touch targets >= 40 px, nothing overlapping the toolbar) and the
 * touch gestures driven through the DevTools protocol (a swipe pans, a two-finger pinch zooms, a
 * tap does everything a hover would have).
 *
 * Screenshots go to PAPERTREE_E2E_SHOTS (the evidence folder) and are LOOKED AT by the author.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import {
  api,
  boardTool,
  clickEdge,
  getBoard,
  recordApi,
  seedPaper,
  shotPath,
  tokenInit,
} from './support';

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
] as const;
const THEMES = ['light', 'dark'] as const;

async function newContext(
  browser: import('@playwright/test').Browser,
  vp: (typeof VIEWPORTS)[number],
  theme: (typeof THEMES)[number],
) {
  return browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    colorScheme: theme,
    ...(vp.mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
  });
}

async function touch(page: Page, context: BrowserContext, kind: 'swipe' | 'pinch') {
  const cdp = await context.newCDPSession(page);
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number; id: number }[],
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })),
    });
  if (kind === 'swipe') {
    await send('touchStart', [{ x: 200, y: 700, id: 1 }]);
    for (let i = 1; i <= 8; i += 1)
      await send('touchMove', [{ x: 200 - i * 12, y: 700 - i * 10, id: 1 }]);
    await send('touchEnd', []);
  } else {
    await send('touchStart', [
      { x: 150, y: 600, id: 1 },
      { x: 240, y: 600, id: 2 },
    ]);
    for (let i = 1; i <= 10; i += 1) {
      await send('touchMove', [
        { x: 150 - i * 8, y: 600, id: 1 },
        { x: 240 + i * 8, y: 600, id: 2 },
      ]);
    }
    await send('touchEnd', []);
  }
  await page.waitForTimeout(800);
}

/** A board tool that turned itself off (the zoom at its floor): `aria-disabled` or `disabled`. */
const isOff = async (tool: Locator) =>
  (await tool.getAttribute('aria-disabled')) === 'true' || (await tool.isDisabled());

const scale = (page: Page) =>
  page.evaluate(() => {
    const m = /scale\(([\d.]+)\)/.exec(
      document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '',
    );
    return m === null ? 0 : Number(m[1]);
  });

test.use({ actionTimeout: 20_000 });

test('the canvas screens, both sizes, both themes', async ({ browser, stack }, testInfo) => {
  test.setTimeout(900_000);
  const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
  const empty = await seedPaper(stack.apiUrl, 'screens-empty');
  const full = await seedPaper(stack.apiUrl, 'screens-full');

  // A populated board: three notes, a group and an edge, through the API's own routes.
  const mk = (kind: string, i: number, extra: Record<string, unknown>) =>
    api(stack.apiUrl, full.token, 'POST', `/papers/${full.paperId}/board/nodes`, {
      node_id: `cn_${crypto.randomUUID()}`,
      kind,
      x: (i % 3) * 400,
      y: Math.floor(i / 3) * 300,
      w: 340,
      h: 200,
      ...extra,
    });
  // A passage (a committed real captureAnchor record, re-pointed at this paper) and a faux explanation.
  const capture = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'packages',
        'db',
        'python',
        'tests',
        'data',
        'capture_anchor_resnet.json',
      ),
      'utf8',
    ),
  ) as { anchor: { doc: { paperId: string } } };
  capture.anchor.doc.paperId = full.paperId;
  const passage = await mk('excerpt', 0, {
    body: 'Deeper neural networks are more difficult to train. We present a residual learning framework.',
    source_anchor: capture.anchor,
  });
  expect(passage.status, JSON.stringify(passage.json)).toBe(201);
  const stream = await fetch(`${stack.apiUrl}/papers/${full.paperId}/threads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${full.token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ kind: 'explain', anchor: capture.anchor }),
  });
  expect(stream.status).toBe(200);
  await stream.text();
  const [thread] = (await api(stack.apiUrl, full.token, 'GET', `/papers/${full.paperId}/threads`))
    .json as { thread_id: string; title: string }[];
  const messages = (
    (
      await api(
        stack.apiUrl,
        full.token,
        'GET',
        `/papers/${full.paperId}/threads/${thread!.thread_id}`,
      )
    ).json as {
      messages: { message_id: string; role: string; content: string }[];
    }
  ).messages;
  const answer = messages.find((m) => m.role === 'assistant')!;
  const explanation = await mk('explanation', 1, {
    title: thread!.title,
    body: answer.content,
    source_message_id: answer.message_id,
  });
  expect(explanation.status, JSON.stringify(explanation.json)).toBe(201);
  const a = await mk('note', 2, { body: 'Why does depth hurt plain networks?' });
  const b = await mk('note', 3, {
    body: 'Because gradients vanish, or so the paper argues in the introduction.',
  });
  const c = await mk('note', 4, { body: 'Compare with the highway networks result.' });
  const g = await mk('group', 5, { title: 'Open questions', w: 420, h: 300 });
  for (const r of [a, b, c, g]) expect(r.status).toBe(201);
  const ids = [a, b, c].map((r) => (r.json as { node: { node_id: string } }).node.node_id);
  const explanationId = (explanation.json as { node: { node_id: string } }).node.node_id;
  const board = (a.json as { board: { board_id: string } }).board.board_id;
  const edge = await api(stack.apiUrl, full.token, 'POST', `/boards/${board}/edges`, {
    edge_id: `ce_${crypto.randomUUID()}`,
    from_node_id: ids[0],
    to_node_id: ids[1],
    kind: 'supports',
  });
  expect(edge.status).toBe(201);
  expect((await getBoard(stack.apiUrl, full.token, full.paperId)).nodes).toHaveLength(6);

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const tag = `${vp.name}-${theme}`;
      // The saved viewport belongs to the board, not the device: start every pass from "never moved".
      await api(stack.apiUrl, full.token, 'PATCH', `/boards/${board}`, { viewport: null });
      const context = await newContext(browser, vp, theme);
      const page = await context.newPage();

      // ── the empty state: explains how to send things; nothing was made for the reader ──
      await tokenInit(page, empty.token);
      const emptyCalls = recordApi(page, stack.apiUrl);
      await page.goto(`/paper/${empty.paperId}/board`);
      await expect(page.getByTestId('canvas-empty')).toBeVisible();
      await expect(page.getByTestId('canvas-empty')).toContainText('Send to board');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(vp.width);
      await page.screenshot({ path: shot(`s01-empty-${tag}.png`) });
      // Reads only (`next dev` runs effects twice, so a read can repeat); not one write.
      expect(emptyCalls.filter((c) => !c.startsWith('GET '))).toEqual([]);
      expect((await getBoard(stack.apiUrl, empty.token, empty.paperId)).board).toBeNull();

      // ── the loading skeleton and the failure state ──
      // Only the API's board read (`GET {api}/papers/<id>/board`): since #214 the page is
      // /paper/<id>/board too, and a bare '**/board' would also hold or abort its navigation.
      const apiOrigin = new URL(stack.apiUrl).origin;
      const boardRead = (url: URL) => url.origin === apiOrigin && url.pathname.endsWith('/board');
      const slow = await context.newPage();
      await tokenInit(slow, full.token);
      let held = 0;
      await slow.route(boardRead, async (route) => {
        held += 1;
        await new Promise((done) => setTimeout(done, 2500));
        await route.continue();
      });
      await slow.goto(`/paper/${full.paperId}/board`);
      await expect(slow.getByRole('status', { name: 'Loading your board' })).toBeVisible();
      expect(held, 'the board read was the request held').toBeGreaterThan(0);
      await slow.screenshot({ path: shot(`s02-loading-${tag}.png`) });
      await slow.close();
      const broken = await context.newPage();
      await tokenInit(broken, full.token);
      let aborted = 0;
      await broken.route(boardRead, (route) => {
        aborted += 1;
        return route.abort();
      });
      await broken.goto(`/paper/${full.paperId}/board`);
      await expect(broken.getByRole('heading', { name: /didn.t load/ })).toBeVisible();
      expect(aborted, 'the board read was the request aborted').toBeGreaterThan(0);
      await expect(broken.getByRole('button', { name: 'Try again' })).toBeVisible();
      expect(await broken.locator('body').innerText()).not.toMatch(/\{|ppr_|brd_|NetworkError/);
      await broken.screenshot({ path: shot(`s03-error-${tag}.png`) });
      await broken.close();

      // ── a populated board ──
      const fullPage = await context.newPage();
      await tokenInit(fullPage, full.token);
      await fullPage.goto(`/paper/${full.paperId}/board`);
      await expect(fullPage.locator('.react-flow__node')).toHaveCount(6);
      await expect(fullPage.getByTestId('edge-label')).toHaveText('supports');
      expect(await fullPage.evaluate(() => document.documentElement.scrollWidth)).toBe(vp.width);
      await fullPage.waitForTimeout(600);
      await fullPage.screenshot({ path: shot(`s04-board-${tag}.png`) });

      // the toolbar fits on one row, every control is a >= 40 px target, and nothing overlaps it
      const bar = fullPage.getByRole('toolbar', { name: 'Board tools' });
      const boxes = (root: typeof bar) =>
        root.locator('button').evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { w: r.width, h: r.height, right: r.right, left: r.left, top: r.top };
          }),
        );
      const tools = await boxes(bar);
      // #214: Select, Add note, Add frame, Thread, Fit all, Zoom out, Zoom in, More board tools; on
      // a phone Select and the zoom are in More, so the bar is one row beside "Board".
      expect(tools).toHaveLength(vp.mobile ? 5 : 8);
      for (const t of tools) {
        expect(t.h).toBeGreaterThanOrEqual(40);
        expect(t.w).toBeGreaterThanOrEqual(40);
        expect(t.right).toBeLessThanOrEqual(vp.width);
        expect(t.left).toBeGreaterThanOrEqual(0);
        expect(t.top).toBe(tools[0]!.top);
      }
      // v0.1's controls (the zoom, Group, Ungroup, Delete) are still >= 40 px targets, in More.
      await bar.getByRole('button', { name: 'More board tools' }).click();
      const menu = await boxes(fullPage.getByRole('group', { name: 'More board tools' }));
      expect(menu).toHaveLength(vp.mobile ? 6 : 3);
      for (const m of menu) expect(m.h).toBeGreaterThanOrEqual(40);
      await fullPage.keyboard.press('Escape');

      // the kind picker: pick two notes with the area tool, then Link
      if (vp.mobile) {
        // Zoom out with the visible control (a 40 px button) so both notes are in reach, all the
        // way to the 20 % floor: two taps reach it on one font stack and not on another, and the
        // floor is where cards sit closest together (#212: Linux CI stopped there, macOS did not).
        // The control turns itself off at the floor (#214: in More on a phone).
        for (let i = 0; i < 8; i += 1) {
          const zoomOut = await boardTool(fullPage, 'Zoom out');
          if (await isOff(zoomOut)) break;
          await zoomOut.tap();
          await fullPage.waitForTimeout(300);
        }
        await fullPage.keyboard.press('Escape');
        expect(await scale(fullPage)).toBeCloseTo(0.2, 2);
      }
      await (await boardTool(fullPage, 'Select')).click();
      const pair = await Promise.all(
        [explanationId, ids[2]!].map((id) =>
          fullPage.locator(`.react-flow__node[data-id="${id}"]`).boundingBox(),
        ),
      );
      const [p1, p2] = pair;
      expect(p1 !== null && p2 !== null).toBe(true);
      const x0 = Math.min(p1!.x, p2!.x) - 10;
      const y0 = Math.min(p1!.y, p2!.y) - 10;
      const x1 = Math.max(p1!.x + p1!.width, p2!.x + p2!.width) + 10;
      const y1 = Math.max(p1!.y + p1!.height, p2!.y + p2!.height) + 10;
      // The drag must start on the empty board, or it is a pan or a thread and selects nothing.
      expect(
        await fullPage.evaluate(
          ([x, y]) => document.elementFromPoint(x!, y!)?.classList.contains('react-flow__pane'),
          [x0, y0],
        ),
        'the Select-area drag starts on the empty board',
      ).toBe(true);
      await fullPage.mouse.move(x0, y0);
      await fullPage.mouse.down();
      await fullPage.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 6 });
      await fullPage.mouse.move(x1, y1, { steps: 6 });
      await fullPage.mouse.up();
      // #214: Thread (L) with two cards selected links the first to the second (v0.1's Link).
      await expect(fullPage.getByRole('button', { name: 'Thread', exact: true })).toBeEnabled();
      await fullPage.getByRole('button', { name: 'Thread', exact: true }).click();
      // #213: the "Link as" picker (no longer a modal dialog).
      const dialog = fullPage.getByRole('group', { name: /link as/i });
      await expect(dialog).toBeVisible();
      expect(await fullPage.evaluate(() => document.documentElement.scrollWidth)).toBe(vp.width);
      await fullPage.screenshot({ path: shot(`s05-picker-${tag}.png`) });
      const kinds = await dialog
        .getByRole('option')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(kinds).toHaveLength(7);
      for (const h of kinds) expect(h).toBeGreaterThanOrEqual(40);
      // #213 changes v0.1's "Escape cancels" on purpose: Escape keeps a PLAIN LINK. The new
      // thread's Undo takes it back, so the board on screen and the next pass are one thread again.
      await fullPage.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const plainLink = async () =>
        (await getBoard(stack.apiUrl, full.token, full.paperId)).edges.find(
          (e) => e.from_node_id === explanationId && e.to_node_id === ids[2],
        );
      await expect.poll(async () => (await plainLink())?.kind).toBe('relates');
      const undoLink = fullPage.getByTestId('undo-toast');
      await expect(undoLink).toContainText('Linked as a plain link.');
      await undoLink.getByRole('button', { name: 'Undo' }).click();
      await expect.poll(plainLink).toBeUndefined();
      await expect(fullPage.getByTestId('edge-label')).toHaveCount(1);
      await (await boardTool(fullPage, 'Select')).click();

      // a selected edge shows its editor. First clear the two cards picked above on the empty
      // board: xyflow's selection rectangle over them, with a phone's grown in-card targets at the
      // 20 % floor, covers every point of the thread's line otherwise (#214).
      const stageBox = (await fullPage.getByTestId('canvas-stage').boundingBox())!;
      const blank = { x: stageBox.x + 12, y: stageBox.y + 12 };
      expect(
        await fullPage.evaluate(
          ([x, y]) => document.elementFromPoint(x!, y!)?.classList.contains('react-flow__pane'),
          [blank.x, blank.y],
        ),
        'the deselecting click lands on the empty board',
      ).toBe(true);
      await fullPage.mouse.click(blank.x, blank.y);
      await expect(fullPage.locator('.react-flow__node.selected')).toHaveCount(0);
      await clickEdge(fullPage);
      await expect(fullPage.getByRole('group', { name: 'Selected link' })).toBeVisible();
      await fullPage.screenshot({ path: shot(`s06-selected-${tag}.png`) });

      if (vp.mobile) {
        // ── touch: no hover-only actions; swipe pans, pinch zooms; tapping Add note adds one ──
        await fullPage.reload();
        await expect(fullPage.locator('.react-flow__node')).toHaveCount(6);
        await fullPage.waitForTimeout(800);
        const calls = recordApi(fullPage, stack.apiUrl);
        // Two fingers must land on empty pane: zoom out with the visible controls first, up to
        // twice. The control turns itself off at the 20 % floor, and the board can reopen there:
        // the tap on the empty board above ended a (still) pan, which saves the view it ended on.
        for (let i = 0; i < 2; i += 1) {
          const zoomOut = await boardTool(fullPage, 'Zoom out');
          if (await isOff(zoomOut)) break;
          await zoomOut.tap();
          await fullPage.waitForTimeout(300);
        }
        const menu = fullPage.getByRole('group', { name: 'More board tools' });
        if (await menu.isVisible()) await fullPage.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        const s0 = await scale(fullPage);
        await touch(fullPage, context, 'pinch');
        const s1 = await scale(fullPage);
        expect(s1).toBeGreaterThan(s0);
        const before = await fullPage.evaluate(() =>
          document.querySelector('.react-flow__viewport')?.getAttribute('style'),
        );
        await touch(fullPage, context, 'swipe');
        const after = await fullPage.evaluate(() =>
          document.querySelector('.react-flow__viewport')?.getAttribute('style'),
        );
        expect(after).not.toBe(before);
        await fullPage.waitForTimeout(1200);
        expect(
          calls.filter((x) => x.startsWith('PATCH /boards/') && !x.includes('/nodes/')).length,
        ).toBeGreaterThanOrEqual(1);
        await fullPage.getByRole('button', { name: 'Add note' }).tap();
        await expect(fullPage.getByRole('textbox', { name: 'Note text' })).toBeFocused();
        await fullPage.keyboard.type('typed on a phone');
        await fullPage.keyboard.press('Enter');
        await expect(
          fullPage.locator('.react-flow__node-note', { hasText: 'typed on a phone' }),
        ).toHaveCount(1);
        // every node action is a visible button
        const openAll = await fullPage.locator('.react-flow__node-note .pt-btn').count();
        expect(openAll).toBeGreaterThan(0);
        await fullPage.screenshot({ path: shot(`s07-touch-${tag}.png`) });
        // Leave the board as it was found: the next theme's pass starts from the same six cards.
        const left = await getBoard(stack.apiUrl, full.token, full.paperId);
        const typed = left.nodes.find((n) => n.body === 'typed on a phone');
        expect(typed).toBeDefined();
        expect(
          (
            await api(
              stack.apiUrl,
              full.token,
              'DELETE',
              `/boards/${left.board!.board_id}/nodes/${typed!.node_id}`,
            )
          ).status,
        ).toBe(204);
      }
      await context.close();
    }
  }
});
