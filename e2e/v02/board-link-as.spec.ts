/**
 * v0.2 S6c (#213): "Link as" on the real stack — prototype steps 12–14 ("a thread from a brass pin
 * → Link as → supports").
 *
 * 1. A thread dragged from a note's brass claim-out pin to a passage's open evidence-in pin: the
 *    picker settles in (not a dialog), names both ends, and key 2 inks it as "contradicts" with that
 *    kind's cue; focus goes back to the pin; the Undo toast says "Linked as contradicts."; after a
 *    reload it is still there with both pins.
 * 2. A press outside a new thread's picker closes it with nothing saved.
 * 3. Keyboard only: L on a second note; the arrows walk the targets and never move the selected
 *    card they land on; Enter, then key 1: saved as "supports" from the note's claim-out pin, focus
 *    back on the note; Undo takes it back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { api, getBoard, seedPaper, shotPath, tokenInit } from '../s7/support';

import type { Page } from '@playwright/test';

async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.use({ actionTimeout: 20_000 });

test('Link as: drag then key 2, and a keyboard-only supports', async ({ browser, stack }, info) => {
  test.setTimeout(300_000);
  const shot = (name: string) => shotPath(name, info.outputPath('shots'));
  const { token, paperId } = await seedPaper(stack.apiUrl, 'link-as');
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
  const mk = async (kind: string, x: number, y: number, extra: Record<string, unknown>) => {
    const made = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: `cn_${crypto.randomUUID()}`,
      kind,
      x,
      y,
      w: 260,
      h: 180,
      ...extra,
    });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    return (made.json as { node: { node_id: string } }).node.node_id;
  };
  const noteA = await mk('note', 0, 0, { body: 'Depth is the question.' });
  const passage = await mk('excerpt', 560, 120, {
    body: 'Deeper neural networks are more difficult to train.',
    source_anchor: capture.anchor,
  });
  const noteB = await mk('note', 0, 320, { body: 'Residual blocks train.' });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/canvas`);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.waitForTimeout(1000);
  const live = page.locator('.pt-cv > p[role="status"]');

  // ── 1. drag pin to pin → the picker → 2 ──
  const claimOut = `.react-flow__node[data-id="${noteA}"] [data-handleid="claim_out"]`;
  const evidenceIn = `.react-flow__node[data-id="${passage}"] [data-handleid="evidence_in"]`;
  const from = await centre(page, claimOut);
  const to = await centre(page, evidenceIn);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const picker = page.getByRole('group', { name: /link as/i });
  await expect(picker).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); // a picker on the board, not a modal
  await expect(picker).toContainText('Note ‘Depth is the question.’ → Passage p.');
  await expect(picker.getByRole('option')).toHaveCount(7);
  await expect(page.getByTestId('thread-preview')).toHaveCount(1);
  await page.screenshot({ path: shot('l01-link-as-open-1440.png') });
  await page.keyboard.press('2');
  await expect(picker).toBeHidden();
  const thread = page.locator('.react-flow__edge g.pt-thread');
  await expect(thread).toHaveAttribute('data-cue', 'dashed with crosses');
  await expect(page.getByTestId('edge-label')).toHaveText('contradicts');
  await expect(page.locator(claimOut)).toBeFocused();
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toContainText('Linked as contradicts.');
  await expect
    .poll(async () => (await getBoard(stack.apiUrl, token, paperId)).edges)
    .toEqual([
      expect.objectContaining({
        from_node_id: noteA,
        to_node_id: passage,
        kind: 'contradicts',
        from_port: 'claim_out',
        to_port: 'evidence_in',
      }),
    ]);
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge g.pt-thread')).toHaveAttribute(
    'data-cue',
    'dashed with crosses',
  );

  // ── 2. a press outside a new thread's picker saves nothing ──
  await page.waitForTimeout(800);
  const claimB = `.react-flow__node[data-id="${noteB}"] [data-handleid="claim_out"]`;
  const b0 = await centre(page, claimB);
  const b1 = await centre(page, evidenceIn);
  await page.mouse.move(b0.x, b0.y);
  await page.mouse.down();
  await page.mouse.move((b0.x + b1.x) / 2, (b0.y + b1.y) / 2, { steps: 8 });
  await page.mouse.move(b1.x, b1.y, { steps: 8 });
  await page.mouse.up();
  await expect(picker).toBeVisible();
  const stage = await page.getByTestId('canvas-stage').boundingBox();
  await page.mouse.click(stage!.x + stage!.width - 24, stage!.y + 24); // the empty board
  await expect(picker).toBeHidden();
  await page.waitForTimeout(500);
  expect((await getBoard(stack.apiUrl, token, paperId)).edges).toHaveLength(1);

  // ── 3. keyboard only: L on note B, the arrows to the passage, Enter, 1 ──
  const noteACard = page.locator(`.react-flow__node[data-id="${noteA}"]`);
  await noteACard.click({ position: { x: 24, y: 6 } }); // selected: xyflow's arrows would move it
  await expect(noteACard).toHaveClass(/selected/);
  const cardB = page.locator(`.react-flow__node[data-id="${noteB}"]`);
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    if (await cardB.evaluate((n) => n === document.activeElement)) break;
  }
  await expect(cardB).toBeFocused();
  // A focused card says what its keys do, L included.
  const described = await cardB.getAttribute('aria-describedby');
  await expect(page.locator(`[id="${described ?? ''}"]`)).toContainText('L to start a thread');
  await page.keyboard.press('l');
  await expect(live).toContainText('Linking from Note ‘Residual blocks train.’');
  // The walk starts on the nearest card, note A, which is selected; an arrow steps the walk and
  // must not move the card (xyflow moves a focused, selected card on an arrow key).
  await expect(noteACard).toBeFocused();
  const before = await noteACard.boundingBox();
  await page.keyboard.press('ArrowRight');
  const passageCard = page.locator(`.react-flow__node[data-id="${passage}"]`);
  await expect(passageCard).toBeFocused();
  await expect(live).toHaveText('Target 2 of 2, evidence in.');
  await page.waitForTimeout(700); // past the nudge debounce: a moved card would have been saved
  expect(await noteACard.boundingBox()).toEqual(before);
  const stillA = (await getBoard(stack.apiUrl, token, paperId)).nodes.find(
    (n) => n.node_id === noteA,
  );
  expect([stillA?.x, stillA?.y]).toEqual([0, 0]);
  await page.keyboard.press('Enter');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('Note ‘Residual blocks train.’ → Passage p.');
  await page.screenshot({ path: shot('l02-link-as-keyboard-1440.png') });
  await page.keyboard.press('1');
  await expect(picker).toBeHidden();
  await expect(toast).toContainText('Linked as supports.');
  await expect(cardB).toBeFocused();
  await expect
    .poll(async () =>
      (await getBoard(stack.apiUrl, token, paperId)).edges.find((e) => e.from_node_id === noteB),
    )
    .toEqual(
      expect.objectContaining({
        to_node_id: passage,
        kind: 'supports',
        from_port: 'claim_out',
        to_port: 'evidence_in',
      }),
    );
  // Undo takes the new thread back.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(async () =>
      (await getBoard(stack.apiUrl, token, paperId)).edges.some((e) => e.from_node_id === noteB),
    )
    .toBe(false);
  await context.close();
});
