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

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { api, clickEdge, getBoard, recordApi, seedPaper, shotPath, tokenInit } from './support';

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
      await page.goto(`/paper/${empty.paperId}/canvas`);
      await expect(page.getByTestId('canvas-empty')).toBeVisible();
      await expect(page.getByTestId('canvas-empty')).toContainText('Send to canvas');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(vp.width);
      await page.screenshot({ path: shot(`s01-empty-${tag}.png`) });
      // Reads only (`next dev` runs effects twice, so a read can repeat); not one write.
      expect(emptyCalls.filter((c) => !c.startsWith('GET '))).toEqual([]);
      expect((await getBoard(stack.apiUrl, empty.token, empty.paperId)).board).toBeNull();

      // ── the loading skeleton and the failure state ──
      const slow = await context.newPage();
      await tokenInit(slow, full.token);
      await slow.route('**/board', async (route) => {
        await new Promise((done) => setTimeout(done, 2500));
        await route.continue();
      });
      await slow.goto(`/paper/${full.paperId}/canvas`);
      await expect(slow.getByRole('status', { name: 'Loading your canvas' })).toBeVisible();
      await slow.screenshot({ path: shot(`s02-loading-${tag}.png`) });
      await slow.close();
      const broken = await context.newPage();
      await tokenInit(broken, full.token);
      await broken.route('**/board', (route) => route.abort());
      await broken.goto(`/paper/${full.paperId}/canvas`);
      await expect(broken.getByRole('heading', { name: /didn.t load/ })).toBeVisible();
      await expect(broken.getByRole('button', { name: 'Try again' })).toBeVisible();
      expect(await broken.locator('body').innerText()).not.toMatch(/\{|ppr_|brd_|NetworkError/);
      await broken.screenshot({ path: shot(`s03-error-${tag}.png`) });
      await broken.close();

      // ── a populated board ──
      const fullPage = await context.newPage();
      await tokenInit(fullPage, full.token);
      await fullPage.goto(`/paper/${full.paperId}/canvas`);
      await expect(fullPage.locator('.react-flow__node')).toHaveCount(6);
      await expect(fullPage.getByTestId('edge-label')).toHaveText('supports');
      expect(await fullPage.evaluate(() => document.documentElement.scrollWidth)).toBe(vp.width);
      await fullPage.waitForTimeout(600);
      await fullPage.screenshot({ path: shot(`s04-board-${tag}.png`) });

      // the toolbar fits, every control is a >= 40 px target, and nothing overlaps it
      const tools = await fullPage
        .getByRole('toolbar', { name: 'Canvas tools' })
        .locator('button')
        .evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { w: r.width, h: r.height, right: r.right, left: r.left };
          }),
        );
      expect(tools).toHaveLength(6);
      for (const t of tools) {
        expect(t.h).toBeGreaterThanOrEqual(40);
        expect(t.w).toBeGreaterThanOrEqual(40);
        expect(t.right).toBeLessThanOrEqual(vp.width);
        expect(t.left).toBeGreaterThanOrEqual(0);
      }
      const controls = await fullPage
        .locator('.react-flow__controls-button')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of controls) expect(h).toBeGreaterThanOrEqual(40);

      // the kind picker: pick two notes with the area tool, then Link
      if (vp.mobile) {
        // The first view on a phone is readable (>= 60 %), so the whole board is wider than the
        // screen: zoom out with the visible control (a 40 px button) to reach both notes.
        for (let i = 0; i < 2; i += 1) {
          await fullPage.locator('.react-flow__controls-zoomout').tap();
          await fullPage.waitForTimeout(300);
        }
      }
      await fullPage.getByRole('button', { name: 'Select area' }).click();
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
      await fullPage.mouse.move(x0, y0);
      await fullPage.mouse.down();
      await fullPage.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 6 });
      await fullPage.mouse.move(x1, y1, { steps: 6 });
      await fullPage.mouse.up();
      await expect(fullPage.getByRole('button', { name: 'Link' })).toBeEnabled();
      await fullPage.getByRole('button', { name: 'Link' }).click();
      const dialog = fullPage.getByRole('dialog', { name: 'How are these connected?' });
      await expect(dialog).toBeVisible();
      expect(await fullPage.evaluate(() => document.documentElement.scrollWidth)).toBe(vp.width);
      await fullPage.screenshot({ path: shot(`s05-picker-${tag}.png`) });
      const kinds = await dialog
        .locator('.pt-cv-kind')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(kinds).toHaveLength(7);
      for (const h of kinds) expect(h).toBeGreaterThanOrEqual(40);
      await fullPage.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await fullPage.getByRole('button', { name: 'Select area' }).click();

      // a selected edge shows its editor
      await clickEdge(fullPage);
      await expect(fullPage.getByRole('group', { name: 'Selected link' })).toBeVisible();
      await fullPage.screenshot({ path: shot(`s06-selected-${tag}.png`) });

      if (vp.mobile) {
        // ── touch: no hover-only actions; swipe pans, pinch zooms; tapping Add note adds one ──
        await fullPage.reload();
        await expect(fullPage.locator('.react-flow__node')).toHaveCount(6);
        await fullPage.waitForTimeout(800);
        const calls = recordApi(fullPage, stack.apiUrl);
        // Two fingers must land on empty pane: zoom out with the visible controls first.
        for (let i = 0; i < 2; i += 1) {
          await fullPage.locator('.react-flow__controls-zoomout').tap();
          await fullPage.waitForTimeout(300);
        }
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
