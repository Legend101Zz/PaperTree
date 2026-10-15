/**
 * Keyboard: nodes are focusable with a visible ring, Enter selects, arrows nudge (ONE PATCH after
 * the debounce, however many presses), Delete removes. And "Back to paper" is the way out.
 */
import { expect, test } from '../harness/test';
import { api, getBoard, recordApi, seedPaper, tokenInit } from './support';

test.use({ actionTimeout: 20_000 });

test('canvas by keyboard', async ({ browser, stack }) => {
  test.setTimeout(300_000);
  const { token, paperId } = await seedPaper(stack.apiUrl, 'keyboard');
  const ids = [`cn_${crypto.randomUUID()}`, `cn_${crypto.randomUUID()}`];
  for (const [i, id] of ids.entries()) {
    const made = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: id,
      kind: 'note',
      x: i * 400,
      y: 0,
      w: 260,
      h: 150,
      body: `note ${String(i)}`,
    });
    expect(made.status).toBe(201);
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  const calls = recordApi(page, stack.apiUrl);
  await page.goto(`/paper/${paperId}/canvas`);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.waitForTimeout(1500);

  // Tab from the toolbar reaches a node (it has tabindex 0), and the ring is drawn on it.
  const first = page.locator(`.react-flow__node[data-id="${ids[0]}"]`);
  await expect(first).toHaveAttribute('tabindex', '0');
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab');
    if (await first.evaluate((n) => n === document.activeElement)) break;
  }
  await expect(first).toBeFocused();
  const outline = await first.evaluate(
    (n) => getComputedStyle(n).outlineStyle + ' ' + getComputedStyle(n).outlineWidth,
  );
  expect(outline).toMatch(/solid 2px/);
  await expect(first).toHaveAttribute('aria-label', /Note: note 0/);

  const before = (await getBoard(stack.apiUrl, token, paperId)).nodes.find(
    (n) => n.node_id === ids[0],
  )!;
  calls.length = 0;
  await page.keyboard.press('Enter'); // selects the focused node
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1500);
  expect(calls.filter((c) => c.startsWith('PATCH /boards/'))).toHaveLength(1);
  const after = (await getBoard(stack.apiUrl, token, paperId)).nodes.find(
    (n) => n.node_id === ids[0],
  )!;
  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBe(before.y);

  calls.length = 0;
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect.poll(() => calls.filter((c) => c.startsWith('DELETE /boards/')).length).toBe(1);
  expect((await getBoard(stack.apiUrl, token, paperId)).nodes.map((n) => n.node_id)).toEqual([
    ids[1],
  ]);

  // The way out.
  await page.getByRole('link', { name: 'Back to paper' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/read`));
  await context.close();
});
