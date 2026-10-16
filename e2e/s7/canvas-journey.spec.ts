/**
 * Journey D (slice-plan S7 acceptance), on the e2e harness: a real worker parses a real paper, the
 * reader sends a passage with the mouse, a faux-agent explanation is sent to the canvas, and every
 * gesture is checked against the REQUESTS it makes and the ROWS the API then holds.
 *
 * WHAT IS NOT DRIVEN THROUGH A BUTTON: the explanation's "Send to canvas" lives in the explain
 * panel, which is track S6's and is not in this branch. The explanation node is therefore created
 * through the real `POST /papers/{id}/board/nodes` with the id of a REAL assistant message that the
 * faux agent wrote through the real `POST /papers/{id}/threads`. `sendToCanvas`'s explanation path
 * itself is pinned by `apps/web/test/s7-send-to-canvas.spec.tsx`.
 */
import { expect, test } from '../harness/test';
import {
  api,
  clickEdge,
  drag,
  getBoard,
  pointsFor,
  recordApi,
  reveal,
  seedPaper,
  selectionRects,
  shotPath,
  tokenInit,
  type WireBoard,
} from './support';

const PATCHES = /^PATCH \/boards\/[^/]+\/nodes\//;

async function nodeBox(page: import('@playwright/test').Page, id: string) {
  const box = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  if (box === null) throw new Error(`node ${id} has no box`);
  return box;
}

async function mouseDrag(
  page: import('@playwright/test').Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test.describe('Journey D: the canvas', () => {
  test.use({ actionTimeout: 20_000 });
  test('send, drag, connect, note, group, reload, delete, open source', async ({
    browser,
    stack,
  }, testInfo) => {
    test.setTimeout(900_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const { token, paperId } = await seedPaper(stack.apiUrl, 'journey');

    // ── never auto-populated: a parsed paper with no sends has no board ──
    const before = await getBoard(stack.apiUrl, token, paperId);
    expect(before.board).toBeNull();
    expect(before.nodes).toHaveLength(0);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await tokenInit(page, token);
    const calls = recordApi(page, stack.apiUrl);

    // ── 1. send a passage from the reader, by mouse ──
    await page.goto(`/paper/${paperId}/read`);
    await expect
      .poll(() => page.locator('.papertree-text-layer span[data-item-index]').count(), {
        timeout: 180_000,
      })
      .toBeGreaterThan(20);
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    await expect(page.getByRole('link', { name: 'Canvas' })).toBeVisible();
    await reveal(page, 'Deeper neural networks');
    const points = await pointsFor(page, 'Deeper neural networks', 'substantially deeper');
    await drag(page, points.from, points.to);
    const selected = await selectionRects(page);
    expect(selected.text).toContain('Deeper neural networks');
    await page.getByRole('button', { name: 'Send to canvas' }).click();
    const toast = page.getByTestId('canvas-toast');
    await expect(toast).toContainText('Passage added to your canvas');
    await page.screenshot({ path: shot('d01-reader-toast-1440.png') });
    const afterFirst = await getBoard(stack.apiUrl, token, paperId);
    expect(afterFirst.board).not.toBeNull();
    expect(afterFirst.nodes).toHaveLength(1);
    const excerpt = afterFirst.nodes[0]!;
    expect(excerpt.kind).toBe('excerpt');
    expect(excerpt.source_anchor?.id).toBeTruthy();
    expect(excerpt.body).toContain('Deeper neural networks');

    // ── 2. a faux-agent explanation, sent to the canvas ──
    const stream = await fetch(`${stack.apiUrl}/papers/${paperId}/threads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ kind: 'explain', anchor: excerpt.source_anchor }),
    });
    expect(stream.status).toBe(200);
    await stream.text(); // the whole faux answer
    const threads = (await api(stack.apiUrl, token, 'GET', `/papers/${paperId}/threads`)).json as {
      thread_id: string;
    }[];
    expect(threads).toHaveLength(1);
    const detail = (
      await api(stack.apiUrl, token, 'GET', `/papers/${paperId}/threads/${threads[0]!.thread_id}`)
    ).json as {
      messages: { message_id: string; role: string; content: string; status: string }[];
    };
    const answer = detail.messages.find((m) => m.role === 'assistant');
    expect(answer?.content.length ?? 0).toBeGreaterThan(10);
    const explanationId = `cn_${crypto.randomUUID()}`;
    const created = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: explanationId,
      kind: 'explanation',
      x: 388,
      y: 0,
      w: 380,
      h: 260,
      title: 'Explain: the passage',
      body: answer?.content,
      source_message_id: answer?.message_id,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);

    // ── 3. open the canvas from the toast's link: exactly 2 nodes ──
    await page.getByRole('link', { name: 'Open canvas' }).click();
    await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/canvas$`));
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
    await expect(
      page.locator(`.react-flow__node[data-id="${excerpt.node_id}"] blockquote`),
    ).toContainText('Deeper neural networks');
    // The model's words wear the AI voice; the paper's words do not (#212: the AI slip card).
    await expect(
      page.locator(`.react-flow__node[data-id="${explanationId}"] [data-voice="ai"]`),
    ).toBeVisible();
    await expect(
      page.locator(`.react-flow__node[data-id="${excerpt.node_id}"] [data-voice="paper"]`),
    ).toBeVisible();
    await expect(page.locator('.react-flow__node [data-voice="ai"]')).toHaveCount(1);
    await page.screenshot({ path: shot('d02-canvas-two-nodes-1440.png') });

    // ── 4. drag a node: ONE PATCH ──
    await page.waitForTimeout(1000);
    calls.length = 0;
    const head = await nodeBox(page, excerpt.node_id);
    await mouseDrag(page, { x: head.x + 60, y: head.y + 24 }, { x: head.x + 60, y: head.y + 224 });
    await page.waitForTimeout(1200);
    const patches = calls.filter((c) => PATCHES.test(c));
    expect(patches).toEqual([
      `PATCH /boards/${afterFirst.board!.board_id}/nodes/${excerpt.node_id}`,
    ]);
    const afterDrag = await getBoard(stack.apiUrl, token, paperId);
    const moved = afterDrag.nodes.find((n) => n.node_id === excerpt.node_id)!;
    expect(moved.y).toBeGreaterThan(excerpt.y + 100);
    expect(moved.version).toBe(excerpt.version + 1);

    // ── 5. connect with "supports": the label is visible ──
    calls.length = 0;
    const src = await page
      .locator(`.react-flow__node[data-id="${excerpt.node_id}"] .react-flow__handle.source`)
      .boundingBox();
    const dst = await page
      .locator(`.react-flow__node[data-id="${explanationId}"] .react-flow__handle.target`)
      .boundingBox();
    expect(src && dst).toBeTruthy();
    await mouseDrag(
      page,
      { x: src!.x + src!.width / 2, y: src!.y + src!.height / 2 },
      { x: dst!.x + dst!.width / 2, y: dst!.y + dst!.height / 2 },
    );
    const dialog = page.getByRole('dialog', { name: 'How are these connected?' });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: shot('d03-kind-picker-1440.png') });
    await dialog.getByRole('button', { name: 'supports', exact: true }).click();
    await expect(page.getByTestId('edge-label')).toHaveText('supports');
    expect(calls.filter((c) => c.startsWith('POST /boards/') && c.endsWith('/edges'))).toHaveLength(
      1,
    );
    const withEdge = await getBoard(stack.apiUrl, token, paperId);
    expect(withEdge.edges).toHaveLength(1);
    expect(withEdge.edges[0]).toMatchObject({
      kind: 'supports',
      from_node_id: excerpt.node_id,
      to_node_id: explanationId,
    });

    // ── 5b. the link is editable: kind and label are one PATCH each, and the new words are on the edge ──
    calls.length = 0;
    await clickEdge(page);
    const edgeBar = page.getByRole('group', { name: 'Selected link' });
    await expect(edgeBar).toBeVisible();
    await edgeBar.getByLabel('Kind').selectOption('derives_from');
    await expect(page.getByTestId('edge-label')).toHaveText('derives from');
    const labelInput = edgeBar.getByLabel('Label');
    await labelInput.fill('needs the passage');
    await labelInput.press('Enter');
    await expect(page.getByTestId('edge-label')).toHaveText('needs the passage');
    await expect
      .poll(
        () => calls.filter((c) => c.startsWith('PATCH /boards/') && c.includes('/edges/')).length,
      )
      .toBe(2);
    await page.screenshot({ path: shot('d03b-edge-editor-1440.png') });
    expect((await getBoard(stack.apiUrl, token, paperId)).edges[0]).toMatchObject({
      kind: 'derives_from',
      label: 'needs the passage',
    });
    await page.mouse.click(1000, 870); // empty pane: deselect the link
    await expect(edgeBar).toBeHidden();

    // ── 6. a note: add, type, Enter = one PATCH of the body ──
    calls.length = 0;
    await page.getByRole('button', { name: 'Add note' }).click();
    const area = page.getByRole('textbox', { name: 'Note text' });
    await expect(area).toBeFocused();
    await area.fill('Residual blocks are the whole idea.');
    await area.press('Enter');
    await expect(page.locator('.react-flow__node-note')).toContainText(
      'Residual blocks are the whole idea.',
    );
    await expect.poll(() => calls.filter((c) => PATCHES.test(c)).length).toBe(1);
    const withNote = await getBoard(stack.apiUrl, token, paperId);
    const note = withNote.nodes.find((n) => n.kind === 'note')!;
    expect(note.body).toBe('Residual blocks are the whole idea.');
    expect(note.version).toBe(2);

    // ── 7. group two nodes (the passage and the explanation) with Select area ──
    await page.getByRole('button', { name: 'Select area' }).click();
    const a = await nodeBox(page, excerpt.node_id);
    const b = await nodeBox(page, explanationId);
    const minX = Math.min(a.x, b.x) - 12;
    const minY = Math.min(a.y, b.y) - 12;
    const maxX = Math.max(a.x + a.width, b.x + b.width) + 12;
    const maxY = Math.max(a.y + a.height, b.y + b.height) + 12;
    // Start on empty pane: the top-left corner is outside every node.
    await mouseDrag(page, { x: minX, y: minY }, { x: maxX, y: maxY });
    await expect(page.getByRole('button', { name: 'Group', exact: true })).toBeEnabled();
    calls.length = 0;
    await page.getByRole('button', { name: 'Group', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await getBoard(stack.apiUrl, token, paperId)).nodes.filter((n) => n.group_id !== null)
            .length,
      )
      .toBe(2);
    await page.getByRole('button', { name: 'Select area' }).click(); // back to panning
    const grouped = await getBoard(stack.apiUrl, token, paperId);
    const group = grouped.nodes.find((n) => n.kind === 'group')!;
    expect(
      grouped.nodes
        .filter((n) => n.group_id === group.node_id)
        .map((n) => n.node_id)
        .sort(),
    ).toEqual([excerpt.node_id, explanationId].sort());
    await page.screenshot({ path: shot('d04-grouped-1440.png') });

    // ── 8. pan and zoom: saved on the END only ──
    calls.length = 0;
    await mouseDrag(page, { x: 700, y: 840 }, { x: 640, y: 800 });
    await page.mouse.move(720, 600);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(1500);
    const viewportPatches = calls.filter(
      (c) => c.startsWith('PATCH /boards/') && !c.includes('/nodes/'),
    );
    expect(viewportPatches.length).toBeGreaterThanOrEqual(2);
    expect(viewportPatches.length).toBeLessThanOrEqual(3);

    // ── 9. reload: identical ──
    const snapshot = async (): Promise<{ api: WireBoard; dom: unknown }> => {
      const board = await getBoard(stack.apiUrl, token, paperId);
      const dom = await page.evaluate(() => ({
        transform: document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '',
        nodes: Array.from(document.querySelectorAll('.react-flow__node')).map((n) => {
          const r = n.getBoundingClientRect();
          return [
            n.getAttribute('data-id'),
            Math.round(r.left),
            Math.round(r.top),
            Math.round(r.width),
            Math.round(r.height),
          ];
        }),
        labels: Array.from(document.querySelectorAll('[data-testid="edge-label"]')).map(
          (l) => l.textContent,
        ),
      }));
      return { api: board, dom };
    };
    await page.mouse.click(1000, 870); // deselect everything: a selected link adds its editor row
    await expect(page.getByRole('group', { name: 'Selected link' })).toBeHidden();
    await page.waitForTimeout(500);
    const beforeReload = await snapshot();
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await expect(page.getByTestId('edge-label')).toHaveText('needs the passage');
    await page.waitForTimeout(1000);
    const afterReload = await snapshot();
    expect(afterReload.api).toEqual(beforeReload.api);
    expect(afterReload.dom).toEqual(beforeReload.dom);
    await page.screenshot({ path: shot('d05-reloaded-1440.png') });

    // ── 10. delete a node: its edge goes with it, and stays gone after a reload ──
    calls.length = 0;
    // #212: the card has no header bar any more; a click on its top edge selects it.
    await page
      .locator(`.react-flow__node[data-id="${explanationId}"]`)
      .click({ position: { x: 24, y: 6 } });
    await page.keyboard.press('Delete');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.getByTestId('edge-label')).toHaveCount(0);
    await expect
      .poll(
        () => calls.filter((c) => c.startsWith('DELETE /boards/') && c.includes('/nodes/')).length,
      )
      .toBe(1);
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.getByTestId('edge-label')).toHaveCount(0);
    const afterDelete = await getBoard(stack.apiUrl, token, paperId);
    expect(afterDelete.nodes.map((n) => n.node_id)).not.toContain(explanationId);
    expect(afterDelete.edges).toHaveLength(0);

    // ── 11. Open source lands on, and flashes, the passage ──
    await page
      .locator(`.react-flow__node[data-id="${excerpt.node_id}"]`)
      .getByRole('link', { name: 'Open source' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/read\\?focus=${excerpt.node_id}$`));
    const flash = page.locator('polygon.pt-flash').first();
    await expect(flash).toBeAttached({ timeout: 60_000 });
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    const box = await flash.boundingBox();
    expect(box).not.toBeNull();
    const view = page.viewportSize()!;
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(view.height);

    // W2UI #141: it is the SENT passage that flashes, not just something on screen. The excerpt's
    // stored ShapeSelector quads (IR points on `pageIndex`) are mapped onto that page's overlay in
    // the DOM; the flash must sit on the same page, touch a quad, and stay near the quads' union.
    const shape = (
      excerpt.source_anchor as unknown as {
        selectors: { type: string; pageIndex?: number; quads?: number[][] }[];
      }
    ).selectors.find((sel) => sel.type === 'ShapeSelector');
    expect(shape?.quads?.length ?? 0, 'the stored anchor has quads').toBeGreaterThan(0);
    const mapped = await page.evaluate(
      ({ quads }) => {
        const poly = document.querySelector('polygon.pt-flash');
        const svg = poly?.closest('svg');
        if (poly === null || poly === undefined || svg === null || svg === undefined) return null;
        const r = svg.getBoundingClientRect();
        const pageWidth = Number(svg.getAttribute('width'));
        const scale = r.width / pageWidth;
        const f = poly.getBoundingClientRect();
        return {
          pageIndex: Number(svg.getAttribute('data-page-index')),
          flash: { left: f.left, top: f.top, right: f.right, bottom: f.bottom },
          quads: quads.map((q) => ({
            left: r.left + q[0]! * scale,
            top: r.top + q[1]! * scale,
            right: r.left + q[2]! * scale,
            bottom: r.top + q[3]! * scale,
          })),
        };
      },
      { quads: shape!.quads! },
    );
    expect(mapped, 'the flash polygon sits in a page overlay').not.toBeNull();
    expect(mapped!.pageIndex).toBe(shape!.pageIndex);
    const touches = mapped!.quads.some(
      (q) =>
        mapped!.flash.left < q.right &&
        mapped!.flash.right > q.left &&
        mapped!.flash.top < q.bottom &&
        mapped!.flash.bottom > q.top,
    );
    expect(touches, "the flash overlaps the sent passage's own quads").toBe(true);
    const union = {
      left: Math.min(...mapped!.quads.map((q) => q.left)) - 24,
      top: Math.min(...mapped!.quads.map((q) => q.top)) - 24,
      right: Math.max(...mapped!.quads.map((q) => q.right)) + 24,
      bottom: Math.max(...mapped!.quads.map((q) => q.bottom)) + 24,
    };
    expect(mapped!.flash.left).toBeGreaterThanOrEqual(union.left);
    expect(mapped!.flash.top).toBeGreaterThanOrEqual(union.top);
    expect(mapped!.flash.right).toBeLessThanOrEqual(union.right);
    expect(mapped!.flash.bottom).toBeLessThanOrEqual(union.bottom);
    await page.screenshot({ path: shot('d06-open-source-flash-1440.png') });
    await context.close();
  });
});
