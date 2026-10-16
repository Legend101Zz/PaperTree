/**
 * S9 canvas nits on the real stack:
 *   - a click ANYWHERE on a card (its body text, not only the header) selects it, so Delete works;
 *   - Shift-click adds a second card to the selection, so Group is enabled.
 */
import { expect, test } from '../harness/test';
import { api, boardTool, getBoard, seedPaper, tokenInit } from './support';

test.use({ actionTimeout: 20_000 });

test('a body click selects the card and Shift-click adds to the selection', async ({
  browser,
  stack,
}) => {
  test.setTimeout(300_000);
  const { token, paperId } = await seedPaper(stack.apiUrl, 's9-select');
  const ids = [`cn_${crypto.randomUUID()}`, `cn_${crypto.randomUUID()}`];
  for (const [i, id] of ids.entries()) {
    const made = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: id,
      kind: 'note',
      x: i * 400,
      y: 0,
      w: 260,
      h: 150,
      body: `note body ${String(i)}`,
    });
    expect(made.status).toBe(201);
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/canvas`);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.waitForTimeout(1500);

  const card = (i: number) => page.locator(`.react-flow__node[data-id="${ids[i]}"]`);
  // #214: Group ("Frame selected cards") and Delete are in "More board tools"; a press on a card
  // closes the menu, and each check opens it again.
  const group = () => boardTool(page, 'Frame selected cards');
  const del = () => boardTool(page, 'Delete');

  await expect(await del()).toBeDisabled();
  await card(0).getByText('note body 0').click();
  await expect(card(0)).toHaveClass(/selected/);
  await expect(await del()).toBeEnabled();
  await expect(await group()).toBeDisabled();

  await card(1)
    .getByText('note body 1')
    .click({ modifiers: ['Shift'] });
  await expect(card(0)).toHaveClass(/selected/);
  await expect(card(1)).toHaveClass(/selected/);
  await expect(await group()).toBeEnabled();

  await (await group()).click();
  await expect
    .poll(async () => (await getBoard(stack.apiUrl, token, paperId)).nodes.length)
    .toBe(3);
});

test('a click that reaches only the card body still selects the card', async ({
  browser,
  stack,
}) => {
  test.setTimeout(300_000);
  const { token, paperId } = await seedPaper(stack.apiUrl, 's9-select-body');
  const id = `cn_${crypto.randomUUID()}`;
  const made = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
    node_id: id,
    kind: 'note',
    x: 0,
    y: 0,
    w: 300,
    h: 220,
    body: 'A note with two paragraphs.\n\nThe second paragraph of the card is here.',
  });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/canvas`);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.waitForTimeout(1500);
  const card = page.locator(`.react-flow__node[data-id="${id}"]`);
  // A bare click event on the body text (no pointer-down before it).
  await card.getByText('The second paragraph').dispatchEvent('click', { bubbles: true });
  await expect(card).toHaveClass(/selected/);
  await expect(await boardTool(page, 'Delete')).toBeEnabled(); // #214: in "More board tools"
  await page.keyboard.press('Escape');
  // Real mouse: clear on the empty pane, then click the blank lower corner of the card.
  await page.mouse.click(900, 700);
  await expect(card).not.toHaveClass(/selected/);
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
  await expect(card).toHaveClass(/selected/);
  // Clicking Edit does not turn into a selection fight: the editor opens.
  await card.getByRole('button', { name: 'Edit' }).click();
  await expect(card.getByRole('textbox', { name: 'Note text' })).toBeFocused();
});
