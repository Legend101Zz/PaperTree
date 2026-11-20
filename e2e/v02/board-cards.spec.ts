/**
 * v0.2 S6b (#212): the board's cards, brass pins and threads on the real stack.
 *
 * A board with a passage (a committed real captureAnchor record, re-pointed at the seeded paper)
 * and a note. The passage card shows its page tab; a thread is dragged from the note's brass
 * claim-out pin to the passage's open evidence-in pin; while it is drawn the evidence-in pin is
 * lit; the "Link as" picker (S6c, #213) gives it a kind; the thread draws with its cue; and
 * after a reload it is still there, saved with both pins. A drop on a pin that cannot take the
 * thread is refused with the server's sentence and saves nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { api, clickEdge, getBoard, recordApi, seedPaper, shotPath, tokenInit } from '../s7/support';

import type { Page } from '@playwright/test';

async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

test.use({ actionTimeout: 20_000 });

test('cards, pins and a thread that persists with its ports', async ({ browser, stack }, info) => {
  test.setTimeout(300_000);
  const shot = (name: string) => shotPath(name, info.outputPath('shots'));
  const { token, paperId } = await seedPaper(stack.apiUrl, 'board-cards');
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
  const mk = (kind: string, x: number, extra: Record<string, unknown>) =>
    api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: `cn_${crypto.randomUUID()}`,
      kind,
      x,
      y: 0,
      w: 260,
      h: 180,
      ...extra,
    });
  const note = await mk('note', 0, { body: 'Depth is the whole question here.' });
  // Two loose notes take the thread: a branching card (the passage) has no brass pins since v0.3.
  const second = await mk('note', 520, {
    body: 'Deeper neural networks are more difficult to train.',
  });
  const passage = await mk('excerpt', 1040, {
    body: 'Deeper neural networks are more difficult to train.',
    source_anchor: capture.anchor,
  });
  expect(note.status, JSON.stringify(note.json)).toBe(201);
  expect(second.status, JSON.stringify(second.json)).toBe(201);
  expect(passage.status, JSON.stringify(passage.json)).toBe(201);
  const noteId = (note.json as { node: { node_id: string } }).node.node_id;
  const secondId = (second.json as { node: { node_id: string } }).node.node_id;
  const passageId = (passage.json as { node: { node_id: string } }).node.node_id;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/board`);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.waitForTimeout(1000);

  // The passage card: the paper's words, in the paper's voice, under its page tab.
  const card = page.locator(`.react-flow__node[data-id="${passageId}"]`);
  // v0.3: the page is a button on the card's top strip (it opens the paper on those words).
  await expect(card.locator('.pt-tc__src')).toHaveText(/^p\. \d+$/);
  await expect(card.locator('blockquote[data-voice="paper"]')).toContainText('Deeper neural');
  // v0.3: a branching card has no brass pins, and the key to threads is drawn only once the board
  // has one (under the stage, never over the cards).
  await expect(card.getByRole('button', { name: 'evidence in' })).toHaveCount(0);
  await expect(card.locator('.pt-pin:not(.pt-pin-fallback)')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Legend' })).toHaveCount(0);

  // A drop on a pin that cannot take the thread (the passage's own brass pin) is refused.
  const claimOut = `.react-flow__node[data-id="${noteId}"] [data-handleid="claim_out"]`;
  const evidenceIn = `.react-flow__node[data-id="${secondId}"] [data-handleid="evidence_in"]`;
  const wrong = `.react-flow__node[data-id="${secondId}"] [data-handleid="claim_out"]`;
  const calls = recordApi(page, stack.apiUrl);
  await dragTo(page, await centre(page, claimOut), await centre(page, wrong));
  await page.mouse.up();
  await expect(page.locator('.pt-cv__notice')).toContainText('That pin does not take that thread.');
  expect(calls.filter((c) => c.endsWith('/edges'))).toEqual([]);

  // A good drag: the target pin lights while the thread is drawn, then the kind is chosen.
  await dragTo(page, await centre(page, claimOut), await centre(page, evidenceIn));
  await expect(page.locator(evidenceIn)).toHaveAttribute('data-lit', 'true');
  await page.screenshot({ path: shot('b01-drawing-a-thread-1440.png') });
  await page.mouse.up();
  const picker = page.getByRole('group', { name: /link as/i }); // #213's picker
  await expect(picker).toBeVisible();
  await picker.getByRole('option', { name: 'contradicts', exact: true }).click();

  // It draws with its cue (dashes and crosses) and its paper tag, and it is saved with its pins.
  const thread = page.locator('.react-flow__edge g.pt-thread');
  await expect(thread).toHaveAttribute('data-cue', 'dashed with crosses');
  expect(await thread.locator('.pt-thread__mark').count()).toBeGreaterThan(0);
  await expect(page.getByTestId('edge-label')).toHaveText('contradicts');
  await expect
    .poll(async () => (await getBoard(stack.apiUrl, token, paperId)).edges)
    .toEqual([
      expect.objectContaining({
        from_node_id: noteId,
        to_node_id: secondId,
        kind: 'contradicts',
        from_port: 'claim_out',
        to_port: 'evidence_in',
      }),
    ]);

  // Reload: the same thread between the same pins.
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge g.pt-thread')).toHaveAttribute(
    'data-cue',
    'dashed with crosses',
  );
  const edge = page.locator('.react-flow__edge');
  await expect(edge).toHaveAttribute('data-id', /^ce_/);
  await page.screenshot({ path: shot('b02-thread-after-reload-1440.png') });

  // With a thread on the board the key is there, under the stage: it never overlaps the cards.
  const legend = page.getByRole('region', { name: 'Legend' });
  await expect(legend).toContainText('Drag from a brass pin to make a thread.');
  const key = (await legend.boundingBox())!;
  const stageBox = (await page.getByTestId('canvas-stage').boundingBox())!;
  expect(key.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height - 1);
  await clickEdge(page);
  const linkBar = page.getByRole('group', { name: 'Selected link' });
  await expect(linkBar).toBeVisible();
  await page.mouse.click(stageBox.x + stageBox.width - 24, stageBox.y + 24); // the empty board
  await expect(linkBar).toBeHidden();
  await context.close();
});
