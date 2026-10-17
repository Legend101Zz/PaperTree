/**
 * v0.2 S6e (#215): undo and redo on the real stack, checked against what the SERVER has.
 *
 * A note dragged and then undone with Cmd/Ctrl+Z is back where it was, in the API's row and after a
 * reload, and Shift+Cmd/Ctrl+Z moves it again. A deleted note comes back with its id and its words
 * (the API's row, and its card after a reload). A thread drawn between two notes is gone again
 * after Cmd/Ctrl+Z. The toolbar's Undo is named by the step it would take back.
 */
import { expect, test } from '../harness/test';
import { api, getBoard, seedPaper, tokenInit } from '../s7/support';

import type { Page } from '@playwright/test';

test.use({ actionTimeout: 20_000 });

const UNDO = 'ControlOrMeta+z';
const REDO = 'ControlOrMeta+Shift+z';

/** A drag xyflow takes from its first move past its 1 px threshold. */
async function dragBy(page: Page, from: { x: number; y: number }, dx: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 2);
  await page.mouse.move(from.x + dx, from.y + 2, { steps: 12 });
  await page.mouse.up();
}

async function centre(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('undo and redo a move, a delete and a new thread, as the server sees them', async ({
  browser,
  stack,
}) => {
  test.setTimeout(300_000);
  const { token, paperId } = await seedPaper(stack.apiUrl, 'board-undo');
  const ids: string[] = [];
  for (const [i, x] of [0, 700].entries()) {
    const made = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: `cn_${crypto.randomUUID()}`,
      kind: 'note',
      x,
      y: 0,
      w: 260,
      h: 150,
      body: i === 0 ? 'Residual blocks train.' : 'Read 3.2 next.',
    });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    ids.push((made.json as { node: { node_id: string } }).node.node_id);
  }
  const [noteA, noteB] = ids as [string, string];
  const row = async (id: string) =>
    (await getBoard(stack.apiUrl, token, paperId)).nodes.find((n) => n.node_id === id);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/board`);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.waitForTimeout(1000);
  const bar = page.getByRole('toolbar', { name: 'Board tools' });
  await expect(bar.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // ── a move: undo puts it back on the server, and a reload agrees; redo moves it again ──
  const cardA = page.locator(`.react-flow__node[data-id="${noteA}"]`);
  const start = (await cardA.boundingBox())!;
  await dragBy(page, { x: start.x + start.width / 2, y: start.y + 8 }, 160);
  await expect.poll(async () => (await row(noteA))?.x).toBeGreaterThan(50);
  await expect(
    bar.getByRole('button', { name: 'Undo move of “Residual blocks train.”' }),
  ).toBeVisible();
  await page.keyboard.press(UNDO);
  await expect.poll(async () => (await row(noteA))?.x).toBe(0);
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  const after = (await cardA.boundingBox())!;
  expect(Math.round(after.x)).toBe(Math.round(start.x));
  // The history is the page's: a reload starts it afresh, so the redo is of a fresh move.
  await dragBy(page, { x: after.x + after.width / 2, y: after.y + 8 }, 160);
  await expect.poll(async () => (await row(noteA))?.x).toBeGreaterThan(50);
  const movedX = (await row(noteA))!.x;
  await page.keyboard.press(UNDO);
  await expect.poll(async () => (await row(noteA))?.x).toBe(0);
  await page.keyboard.press(REDO);
  await expect.poll(async () => (await row(noteA))?.x).toBe(movedX);

  // ── a delete: undo brings the note back with its id and words, after a reload too ──
  const cardB = page.locator(`.react-flow__node[data-id="${noteB}"]`);
  await cardB.click({ position: { x: 24, y: 6 } });
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('undo-toast')).toContainText('Deleted “Read 3.2 next.”.');
  await expect.poll(async () => await row(noteB)).toBeUndefined();
  await page.keyboard.press(UNDO);
  await expect.poll(async () => (await row(noteB))?.body).toBe('Read 3.2 next.');
  await page.reload();
  await expect(cardB).toContainText('Read 3.2 next.');

  // ── a new thread: undo takes it away on the server ──
  await page.waitForTimeout(800);
  const from = await centre(
    page,
    `.react-flow__node[data-id="${noteA}"] [data-handleid="claim_out"]`,
  );
  const to = await centre(
    page,
    `.react-flow__node[data-id="${noteB}"] [data-handleid="evidence_in"]`,
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('1');
  await expect
    .poll(async () => (await getBoard(stack.apiUrl, token, paperId)).edges)
    .toHaveLength(1);
  await expect(bar.getByRole('button', { name: 'Undo new thread “supports”' })).toBeVisible();
  await page.keyboard.press(UNDO);
  await expect.poll(async () => (await getBoard(stack.apiUrl, token, paperId)).edges).toEqual([]);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await context.close();
});
