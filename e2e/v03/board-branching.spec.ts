/**
 * v0.3 (#343, #342, #349): the branching board, journey steps 8 to 10 of #347, on the real stack
 * with the faux agent (deterministic board answers in the tutor shape).
 *
 * A board with one passage opens on it (`?card=`, step 7's arrival): the card and its ask box are
 * centred as a pair. Then:
 *
 *   8   the Uses line, a picker, Ask: the answer streams into a card to the RIGHT of the passage,
 *       joined by a line;
 *   9   select words in the answer: Enter asks about them, the words stay underlined with a count
 *       knot, the new card is to the right again; click it for path focus (breadcrumb, dimmed
 *       cards, a Follow up stub); a follow-up goes BELOW; drag by the top strip, Tidy puts it back;
 *       Fold makes a pill that unfolds; "p. n" opens the paper;
 *   10  Outline is the same tree as a study doc; Export Markdown copies it.
 *
 * Escape backs out one level at a time throughout. Nothing here asserts the faux agent's words,
 * only the structure the board builds from them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { api, getBoard, seedPaper, tokenInit } from '../s7/support';

import type { Page } from '@playwright/test';

test.use({ actionTimeout: 30_000 });

const answerCards = (page: Page) => page.locator('.react-flow__node-explanation');

/** The passage root, from the committed real anchor re-pointed at the seeded paper. */
async function sendPassage(apiUrl: string, token: string, paperId: string): Promise<string> {
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
  capture.anchor.doc.paperId = paperId;
  const id = `cn_${crypto.randomUUID()}`;
  const made = await api(apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
    node_id: id,
    kind: 'excerpt',
    x: 0,
    y: 0,
    w: 304,
    h: 200,
    body: 'Deeper neural networks are more difficult to train.',
    source_anchor: capture.anchor,
  });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  return id;
}

/** One press of Escape, then the board has had a frame to close what it closes. */
async function escape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
}

test('branch a conversation: ask, branch from words, focus a path, tidy, fold, outline, export', async ({
  browser,
  stack,
}) => {
  test.setTimeout(600_000);
  const { token, paperId } = await seedPaper(stack.apiUrl, 'v03-branching');
  const passageId = await sendPassage(stack.apiUrl, token, paperId);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  await tokenInit(page, token);

  // ── 7. arrival: the passage and its open ask box, as a pair, in the pane ──
  await page.goto(`/paper/${paperId}/board?card=${passageId}`);
  const passage = page.locator(`.react-flow__node[data-id="${passageId}"]`);
  await expect(passage).toBeVisible();
  const uses = page.getByTestId('uses-line');
  await expect(uses).toHaveText(/^Uses: this passage · the paper · Familiar · may draw a diagram$/);
  const stage = (await page.getByTestId('canvas-stage').boundingBox())!;
  const pair = [(await passage.boundingBox())!, (await page.locator('.pt-ask').boundingBox())!];
  const left = Math.min(...pair.map((b) => b.x));
  const right = Math.max(...pair.map((b) => b.x + b.width));
  expect(left).toBeGreaterThanOrEqual(stage.x - 1);
  expect(right).toBeLessThanOrEqual(stage.x + stage.width + 1);
  // The card's height is its text up to 60% of the pane, never more.
  expect((await passage.boundingBox())!.height).toBeLessThanOrEqual(stage.height * 0.6 + 2);

  // ── 8. a picker, then Ask: the answer is a card to the RIGHT, on a line ──
  await uses.getByRole('button', { name: 'this passage' }).click();
  await expect(page.getByRole('dialog', { name: 'What the AI will read' })).toContainText(
    'The passage',
  );
  await escape(page); // closes the picker, not the ask box
  await expect(uses).toBeVisible();
  await uses.getByRole('button', { name: 'Familiar' }).click();
  await page.getByRole('radio', { name: 'New to this' }).click();
  await expect(uses).toContainText('New to this');
  await page.getByLabel('Your question').fill('Why does adding x help training?');
  await page.getByLabel('Your question').press('Enter');
  const first = answerCards(page).first();
  await expect(first).toBeVisible({ timeout: 120_000 });
  await expect(first).toContainText('Why does adding x help training?');
  await expect(first.locator('.pt-tc__foot')).not.toContainText('writing…', { timeout: 120_000 });
  const firstBox = (await first.boundingBox())!;
  const passageBox = (await passage.boundingBox())!;
  expect(firstBox.x).toBeGreaterThan(passageBox.x + passageBox.width);
  await expect(page.locator('.pt-tree-edge[data-branch="right"]')).toHaveCount(1);

  // The server holds the tree: a root, one answer to its right, the level it was asked at.
  await expect
    .poll(async () => (await getBoard(stack.apiUrl, token, paperId)).nodes.length)
    .toBe(2);
  const stored = (await getBoard(stack.apiUrl, token, paperId)).nodes.find(
    (n) => n.parent_id === passageId,
  )!;
  expect(stored.branch).toBe('right');

  // ── 9. select words in the answer: Enter asks about them; the words stay underlined ──
  const word = first.locator('.pt-tc__answer p').first();
  await word.dblclick(); // a double click selects the word under it, and the menu opens
  const menu = page.getByRole('menu', { name: 'On the selected words' });
  await expect(menu).toBeVisible();
  const mb = (await menu.boundingBox())!;
  expect(mb.x).toBeGreaterThanOrEqual(stage.x);
  expect(mb.x + mb.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(mb.y + mb.height).toBeLessThanOrEqual(stage.y + stage.height);
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Ask about this…/,
    /Simpler/,
    /Example/,
    /Diagram/,
    /Keep as note/,
  ]);
  await page.keyboard.press('Enter'); // Ask about this…
  const feed = page.getByLabel('Your question');
  await expect(feed).toBeFocused();
  await feed.fill('what is that?');
  await feed.press('Enter');
  await expect(answerCards(page)).toHaveCount(2, { timeout: 120_000 });
  await expect(first.locator('.pt-tc__knot')).toHaveText('1');
  const second = answerCards(page).nth(1);
  expect((await second.boundingBox())!.x).toBeGreaterThan(firstBox.x + firstBox.width);

  // Keep as note: key 4, no AI call.
  await word.dblclick();
  await expect(menu).toBeVisible();
  await page.keyboard.press('4');
  // A kept note hangs from the words it was kept on, so it is a `branchnote` card (model/flow
  // `flowType`); the plain `note` type is the loose note of the v0.2 board.
  await expect(page.locator('.react-flow__node-branchnote')).toHaveCount(1);
  await expect(page.locator('.react-flow__node-branchnote')).toContainText(/\S/);
  await expect(answerCards(page)).toHaveCount(2);

  // Click the new card: path focus, a breadcrumb, the other branches dim, a Follow up stub.
  await second.click({ position: { x: 24, y: 8 } });
  const crumbs = page.getByRole('navigation', { name: 'Path' });
  await expect(crumbs).toContainText('Passage');
  await expect(page.locator('.pt-tn--dim').first()).toBeAttached();
  const stub = page.getByTestId('followup-stub');
  await expect(stub).toBeVisible();
  const secondBox = (await second.boundingBox())!;
  // A follow-up goes BELOW the card it continues.
  await stub.getByRole('textbox', { name: 'Follow up' }).click();
  await page.getByLabel('Your question').fill('so can it do nothing?');
  await page.getByLabel('Your question').press('Enter');
  await expect(answerCards(page)).toHaveCount(3, { timeout: 120_000 });
  const third = answerCards(page).nth(2);
  const thirdBox = (await third.boundingBox())!;
  expect(thirdBox.y).toBeGreaterThan(secondBox.y + secondBox.height - 2);
  // One real down line (second -> third). The new answer is focused, so it offers its own Follow up
  // stub, and that one draws a DASHED pending line (`data-pending="true"`): not an edge yet.
  await expect(page.locator('.pt-tree-edge[data-branch="down"][data-pending="false"]')).toHaveCount(
    1,
  );
  await expect(page.locator('.pt-tree-edge[data-pending="true"]')).toHaveCount(1);
  await expect(page.locator('.pt-tree-edge[data-pending="true"]')).toHaveCSS(
    'stroke-dasharray',
    /\d/,
  );

  // Escape backs out one level: the path focus first.
  await escape(page);
  await expect(crumbs).toBeHidden();
  // The stub went with the focus: no pending line is left on the board.
  await expect(page.locator('.pt-tree-edge[data-pending="true"]')).toHaveCount(0);

  // Drag a card by its top strip: one PATCH of its offset, and its whole branch moves with it.
  const strip = second.locator('.pt-tc__strip');
  const before = { second: (await second.boundingBox())!, third: (await third.boundingBox())! };
  const sb = (await strip.boundingBox())!;
  await page.mouse.move(sb.x + 40, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + 40, sb.y + sb.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = { second: (await second.boundingBox())!, third: (await third.boundingBox())! };
  expect(after.second.y - before.second.y).toBeGreaterThan(40);
  expect(after.third.y - before.third.y).toBeGreaterThan(40);
  await expect
    .poll(async () => {
      // The dragged card is the answer that grew from the first answer's words (not the first
      // answer itself, and not the note kept on the same words).
      const n = (await getBoard(stack.apiUrl, token, paperId)).nodes.find(
        (x) => x.parent_id === stored.node_id && x.kind === 'explanation',
      );
      return (n?.offset_y ?? 0) > 40;
    })
    .toBe(true);

  // Tidy puts every branch back.
  await page.getByRole('button', { name: 'Tidy' }).click();
  await page.waitForTimeout(900);
  const tidy = (await second.boundingBox())!;
  expect(Math.abs(tidy.y - before.second.y)).toBeLessThan(3);

  // Fold: the answer and what hangs from it become a pill that says what it holds; click unfolds.
  await second.click({ position: { x: 24, y: 8 } });
  // The card's own Fold (the board bar has one too, for the focused answer).
  await second.getByRole('button', { name: 'Fold', exact: true }).click();
  const pill = page.locator('.pt-pill').first();
  await expect(pill).toContainText(/\d+ answers?/);
  await pill.getByRole('button').click();
  await expect(answerCards(page)).toHaveCount(3);
  await escape(page);

  // "p. n" on the FULL-WIDTH board (#349): the paper opens BESIDE it, on the words the answer draws
  // on, and the clicked card stays on screen in the board pane (`?card=` centres it).
  const src = answerCards(page).locator('.pt-tc__src').first();
  if ((await src.count()) > 0) {
    await src.click();
    await expect(page).toHaveURL(
      new RegExp(`/paper/${paperId}/read\\?beside=1&card=cn_[\\w-]+&focus=`),
    );
    await expect(page.getByRole('complementary', { name: 'Board' })).toBeVisible();
    await page.goBack();
    await expect(answerCards(page)).toHaveCount(3);
  }

  // ── 10. Outline: the tree as a study doc; Export Markdown copies it ──
  await page.getByRole('button', { name: 'Outline' }).click();
  const outline = page.getByTestId('outline');
  await expect(outline).toBeVisible();
  await expect(outline.getByRole('heading', { level: 2 })).toHaveCount(3);
  await outline.getByRole('button', { name: 'Export Markdown' }).click();
  const sheet = page.getByRole('dialog', { name: 'Export Markdown' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('checkbox', { name: 'My notes' }).uncheck();
  await sheet.getByRole('button', { name: 'Copy' }).click();
  await expect(sheet.getByRole('status')).toHaveText('Copied.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^# /);
  expect(copied).toContain('what is that?');
  expect(copied).not.toMatch(/Check yourself/);

  // Escape: the sheet, then the Outline, in that order.
  await escape(page);
  await expect(sheet).toBeHidden();
  await expect(outline).toBeVisible();
  await escape(page);
  await expect(outline).toBeHidden();

  await context.close();
});
