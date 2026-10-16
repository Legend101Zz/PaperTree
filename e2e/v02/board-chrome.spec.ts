/**
 * v0.2 S6d (#214): the board's chrome on the real stack.
 *
 * An empty board (a freshly seeded paper, as DDPM is on the demo account) shows frame 06b's words
 * and its "Back to the paper" goes to the reader. On a board with two notes: the header counts
 * them, Add frame makes a frame in the middle of the view with its name ready to type, a note
 * dragged into it joins it (saved as its `group_id`), and the frame dragged by its paper tag
 * carries the note with it (both saved, by the same distance).
 */
import { expect, test } from '../harness/test';
import { api, getBoard, seedPaper, shotPath, tokenInit } from '../s7/support';

import type { Page } from '@playwright/test';

test.use({ actionTimeout: 20_000 });

async function dragBy(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('the empty board says how cards arrive, and goes back to the paper', async ({
  browser,
  stack,
}, info) => {
  test.setTimeout(300_000);
  const { token, paperId } = await seedPaper(stack.apiUrl, 'board-empty');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/canvas`);
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
  await page.goto(`/paper/${paperId}/canvas`);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.getByRole('banner')).toContainText('2 cards');
  await page.waitForTimeout(1000);

  // Add frame: an empty frame in the middle of the view, its name selected for typing.
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
  await context.close();
});
