/**
 * v0.2 S6d (#214): the board's chrome on the real stack.
 *
 * A v0.1 `/paper/<id>/canvas` link redirects to `/paper/<id>/board`. An empty board (a freshly
 * seeded paper, as DDPM is on the demo account) shows frame 06b's words and its "Back to the
 * paper" goes to the reader. On a board with two notes: the header counts them, Add frame makes a
 * frame in clear space nearest the middle of the view with its name ready to type, a note dragged
 * into it joins it (saved as its `group_id`), and the frame dragged by its paper tag carries the
 * note with it (both saved, by the same distance). Then the #214 review's cases: arrow keys move
 * the frame and save the note it carries; a resize from the top-left corner leaves the note where
 * it is and saves only the frame, once; and with a card lying over the frame's tag, the frame's
 * outline still selects and moves it.
 */
import { expect, test } from '../harness/test';
import { api, getBoard, recordApi, seedPaper, shotPath, tokenInit } from '../s7/support';

import type { Page } from '@playwright/test';

test.use({ actionTimeout: 20_000 });

/** True when two boxes do not overlap. */
const apart = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

/** The id of the board node on top at a screen point, or null. */
const nodeAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) =>
      document.elementFromPoint(px!, py!)?.closest('.react-flow__node')?.getAttribute('data-id') ??
      null,
    [x, y],
  );

/**
 * A drag that lands where it is aimed: xyflow measures the grab from the first move past its 1 px
 * threshold, so a 2 px first step keeps the rest of the way.
 */
async function dragExact(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 2);
  await page.mouse.move(to.x, to.y + 2, { steps: 12 });
  await page.mouse.up();
}

async function dragBy(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('/canvas redirects to /board; the empty board says how cards arrive, and goes back', async ({
  browser,
  stack,
}, info) => {
  test.setTimeout(300_000);
  const { token, paperId } = await seedPaper(stack.apiUrl, 'board-empty');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  // A v0.1 bookmark: /canvas still opens the board, at /board, with its query string.
  await page.goto(`/paper/${paperId}/canvas?from=bookmark`);
  await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/board\\?from=bookmark$`));
  await expect(page).toHaveTitle('Board · PaperTree');
  const card = page.getByRole('region', { name: 'Nothing on this board yet.' });
  await expect(card).toContainText(
    'Select a passage and choose Send to board, or Dive in from an explanation.',
  );
  await expect(page.getByText('Passages arrive as cards')).toBeVisible();
  await expect(page.getByText('Threads link them')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Minimap' })).toContainText('Map · empty');
  await expect(page.getByRole('banner')).toContainText('0 cards');
  await page.screenshot({ path: shotPath('s6d-06b-empty-1440.png', info.outputPath('shots')) });
  await card.getByRole('link', { name: 'Back to the paper' }).click();
  await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/read$`));
  await context.close();
});

test('Add frame, a card dropped in it, and the frame carries the card', async ({
  browser,
  stack,
}, info) => {
  test.setTimeout(300_000);
  const shot = (name: string) => shotPath(name, info.outputPath('shots'));
  const { token, paperId } = await seedPaper(stack.apiUrl, 'board-frames');
  const ids: string[] = [];
  for (const [i, x] of [0, 700].entries()) {
    const made = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: `cn_${crypto.randomUUID()}`,
      kind: 'note',
      x,
      y: 0,
      w: 260,
      h: 150,
      body: `note ${String(i)}`,
    });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    ids.push((made.json as { node: { node_id: string } }).node.node_id);
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/board`);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.getByRole('banner')).toContainText('2 cards');
  await page.waitForTimeout(1000);

  // Add frame: an empty frame in clear space nearest the middle of the view, its name selected.
  await page.getByRole('button', { name: 'Add frame' }).click();
  const name = page.getByRole('textbox', { name: 'Frame name' });
  await expect(name).toBeFocused();
  await page.keyboard.type('Why attention only');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('banner')).toContainText('2 cards · 1 frame');
  const frameRow = async () =>
    (await getBoard(stack.apiUrl, token, paperId)).nodes.find((n) => n.kind === 'group');
  await expect.poll(async () => (await frameRow())?.title).toBe('Why attention only');
  const frame = (await frameRow())!;
  const frameEl = page.locator(`.react-flow__node[data-id="${frame.node_id}"]`);
  for (const card of (await getBoard(stack.apiUrl, token, paperId)).nodes) {
    if (card.kind !== 'group')
      expect(apart(frame, card), `the frame is on ${card.node_id}`).toBe(true);
  }
  await page.getByRole('button', { name: 'Fit all' }).click();
  await page.waitForTimeout(600);

  // Drag note 1 into the frame: it joins it.
  const note = page.locator(`.react-flow__node[data-id="${ids[1]!}"]`);
  const nb = (await note.boundingBox())!;
  const fb = (await frameEl.boundingBox())!;
  await dragBy(
    page,
    { x: nb.x + nb.width / 2, y: nb.y + 6 },
    { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 - nb.height / 2 + 6 },
  );
  const noteRow = async () =>
    (await getBoard(stack.apiUrl, token, paperId)).nodes.find((n) => n.node_id === ids[1]);
  await expect.poll(async () => (await noteRow())?.group_id).toBe(frame.node_id);
  const dropped = (await noteRow())!;
  await page.screenshot({ path: shot('s6d-frame-dropped-1440.png') });

  // Drag the frame by its paper tag: the note goes with it, the other note stays.
  const grip = (await frameEl.locator('.pt-frame__grip').boundingBox())!;
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  await dragBy(page, start, { x: start.x + 120, y: start.y + 80 });
  await expect.poll(async () => (await frameRow())!.x).not.toBe(frame.x);
  const moved = (await frameRow())!;
  await expect.poll(async () => (await noteRow())!.x - dropped.x).toBeCloseTo(moved.x - frame.x, 3);
  expect((await noteRow())!.y - dropped.y).toBeCloseTo(moved.y - frame.y, 3);
  expect((await noteRow())!.group_id).toBe(frame.node_id);
  const other = (await getBoard(stack.apiUrl, token, paperId)).nodes.find(
    (n) => n.node_id === ids[0],
  );
  expect([other?.x, other?.y, other?.group_id]).toEqual([0, 0, null]);
  await page.screenshot({ path: shot('s6d-frame-moved-1440.png') });

  // ── #214 review B2: arrow keys move the frame, and the note it carries is saved with it ──
  const calls = recordApi(page, stack.apiUrl);
  const patches = (id: string) =>
    calls.filter((c) => c === `PATCH /boards/${frame.board_id}/nodes/${id}`).length;
  const atRest = { frame: (await frameRow())!, note: (await noteRow())! };
  await frameEl.focus();
  await page.keyboard.press('Enter'); // xyflow selects the focused node
  await expect(frameEl).toHaveClass(/selected/);
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await frameRow())!.x).toBeGreaterThan(atRest.frame.x);
  const nudged = (await frameRow())!;
  await expect
    .poll(async () => (await noteRow())!.x - atRest.note.x)
    .toBeCloseTo(nudged.x - atRest.frame.x, 3);
  const carried = (await noteRow())!;
  await page.waitForTimeout(700);
  expect([patches(frame.node_id), patches(ids[1]!)]).toEqual([1, 1]);

  // ── B2: a slow resize from the top-left corner leaves the note alone; one PATCH, the frame's ──
  calls.length = 0;
  const noteBox = await note.boundingBox();
  const corner = frameEl.locator('.react-flow__resize-control.handle.top.left');
  await expect(corner).toBeVisible();
  const cb = (await corner.boundingBox())!;
  const c0 = { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 };
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.down();
  await page.mouse.move(c0.x - 30, c0.y - 20, { steps: 6 });
  await page.waitForTimeout(700); // longer than the nudge debounce: nothing is sent mid-resize
  expect(calls.filter((c) => c.startsWith('PATCH '))).toEqual([]);
  await page.mouse.move(c0.x - 60, c0.y - 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await frameRow())!.w).toBeGreaterThan(nudged.w);
  await page.waitForTimeout(700);
  const resized = (await frameRow())!;
  expect([resized.x < nudged.x, resized.y < nudged.y]).toEqual([true, true]);
  expect(await note.boundingBox()).toEqual(noteBox);
  expect(await noteRow()).toMatchObject({ x: carried.x, y: carried.y, group_id: frame.node_id });
  expect([patches(frame.node_id), patches(ids[1]!)]).toEqual([1, 0]);

  // ── #214 review S1: with the other note over the frame's tag, its outline still reaches it ──
  const stage = (await page.getByTestId('canvas-stage').boundingBox())!;
  const empty = { x: stage.x + 12, y: stage.y + 12 };
  const deselect = async () => {
    expect(
      await page.evaluate(
        ([x, y]) => document.elementFromPoint(x!, y!)?.classList.contains('react-flow__pane'),
        [empty.x, empty.y],
      ),
      'the deselecting click lands on the empty board',
    ).toBe(true);
    await page.mouse.click(empty.x, empty.y);
    await expect(frameEl).not.toHaveClass(/selected/);
  };
  await deselect();
  const tag = (await frameEl.locator('.pt-frame__tag').boundingBox())!;
  const first = page.locator(`.react-flow__node[data-id="${ids[0]!}"]`);
  const fb0 = (await first.boundingBox())!;
  // Its lower edge over the whole tag, its centre above the frame (so it does not join it).
  await dragExact(
    page,
    { x: fb0.x + fb0.width / 2, y: fb0.y + 6 },
    { x: tag.x - 10 + fb0.width / 2, y: tag.y + tag.height - 2 - fb0.height + 6 },
  );
  const firstRow = async () =>
    (await getBoard(stack.apiUrl, token, paperId)).nodes.find((n) => n.node_id === ids[0]);
  await expect.poll(async () => (await firstRow())!.x).not.toBe(0);
  expect((await firstRow())!.group_id).toBeNull();
  const gripNow = (await frameEl.locator('.pt-frame__grip').boundingBox())!;
  expect(await nodeAt(page, gripNow.x + gripNow.width / 2, gripNow.y + gripNow.height / 2)).toBe(
    ids[0],
  );
  const fNow = (await frameEl.boundingBox())!;
  const edge = { x: fNow.x + fNow.width - 3, y: fNow.y + fNow.height / 2 };
  expect(await nodeAt(page, edge.x, edge.y)).toBe(frame.node_id);
  await page.mouse.click(edge.x, edge.y);
  await expect(frameEl).toHaveClass(/selected/);
  await page.screenshot({ path: shot('s6d-frame-tag-covered-1440.png') });
  await deselect();
  const beforeEdge = { frame: (await frameRow())!, note: (await noteRow())! };
  await dragBy(page, edge, { x: edge.x + 40, y: edge.y + 120 });
  await expect.poll(async () => (await frameRow())!.y).toBeGreaterThan(beforeEdge.frame.y);
  const afterEdge = (await frameRow())!;
  await expect
    .poll(async () => (await noteRow())!.y - beforeEdge.note.y)
    .toBeCloseTo(afterEdge.y - beforeEdge.frame.y, 3);
  await context.close();
});
