/**
 * S9-4 on the real stack: a STOPPED (partial) answer carries no citations and may end in an unterminated
 * marker run. Neither the panel after a real Stop nor a stored partial text may show raw `[b42, ...`.
 */
import { expect, test } from '../harness/test';
import { api } from '../s7/support';
import {
  drag,
  pointsFor,
  register,
  reveal,
  shotPath,
  upload,
  waitParsed,
  yoloPdf,
} from '../s4/support';

const YOLO = yoloPdf();
const PARTIAL =
  'The paper splits the image into a grid [b1]. Each cell predicts boxes from scattered fragments [b42, b43, b44, b46, b47, b48';

test.describe('S9-4: a stopped answer never shows raw citation markers', () => {
  test.skip(YOLO === null, 'SKIPPED: the YOLO PDF is not present (run fetch_fresh.sh).');

  test('partial content with an unterminated marker run', async ({ browser, stack }, testInfo) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const token = await register(
      stack.apiUrl,
      `e2e-s9-partial-${String(Date.now())}@papertree.test`,
    );
    const paperId = await upload(stack.apiUrl, token, YOLO as string);
    await waitParsed(stack.apiUrl, token, paperId);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem('papertree.session', t);
      } catch {
        /* a context without storage is not this walk */
      }
    }, token);
    const page = await context.newPage();
    const open = async () => {
      await page.goto(`/paper/${paperId}/read`);
      await expect
        .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
          timeout: 180_000,
        })
        .toBeGreaterThan(50);
      expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    };
    await open();
    await reveal(page, 'We reframe object');
    const points = await pointsFor(page, 'We reframe object', 'class probabilities.');
    await drag(page, points.from, points.to);
    await page
      .getByRole('toolbar', { name: 'Selection actions' })
      // #203: Explain runs the answer now (v0.1's Ask); the toolbar's Ask waits for a question.
      .getByRole('button', { name: 'Explain this passage' })
      .click();
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel.locator('[data-message-status]').first()).toHaveAttribute(
      'data-message-status',
      'complete',
      { timeout: 120_000 },
    );

    // ── a real Stop: a slow follow-up, stopped part-way, keeps its words and no raw handles ──
    await panel
      .getByLabel('Ask a question about this paper')
      .fill('[faux:slow] Say more about the grid.');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    const slow = panel.locator('[data-message-status="streaming"]').first();
    await expect(slow).toContainText('This answer streams slowly', { timeout: 60_000 });
    await panel.getByRole('button', { name: 'Stop' }).click();
    const stopped = panel.locator('[data-message-status]').last();
    await expect(stopped).toContainText('Stopped. The part that arrived is kept.', {
      timeout: 30_000,
    });
    expect((await stopped.innerText()).replace(/\s+/g, ' ')).not.toMatch(/\[|\bb\d+\b/);
    await page.screenshot({ path: shot('s9-stopped-answer-1440.png') });

    // ── a STORED partial: the same text a cancelled run leaves, on a canvas card ──
    // "Send to canvas" makes an explanation card from the first (complete) answer; its stored body
    // is then replaced by the partial text, and the card is read back from the API.
    await panel.getByRole('button', { name: 'Send to canvas' }).first().click();
    type Board = {
      board: { board_id: string };
      nodes: { node_id: string; kind: string; version: number }[];
    };
    const readBoard = async (): Promise<Board> =>
      (await api(stack.apiUrl, token, 'GET', `/papers/${paperId}/board`)).json as Board;
    await expect
      .poll(async () => (await readBoard()).nodes.some((n) => n.kind === 'explanation'), {
        timeout: 30_000,
      })
      .toBe(true);
    const nodes = await readBoard();
    const card = nodes.nodes.find((n) => n.kind === 'explanation');
    expect(card).toBeDefined();
    const patched = await api(
      stack.apiUrl,
      token,
      'PATCH',
      `/boards/${nodes.board.board_id}/nodes/${card!.node_id}`,
      { version: card!.version, body: PARTIAL },
    );
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    await page.goto(`/paper/${paperId}/canvas`);
    const node = page.locator(`.react-flow__node[data-id="${card!.node_id}"]`);
    await expect(node).toBeVisible();
    const shown = (await node.innerText()).replace(/\s+/g, ' ');
    expect(shown).toContain('Each cell predicts boxes from scattered fragments');
    expect(shown).not.toMatch(/\[|\bb\d{1,2}\b/);
    await page.screenshot({ path: shot('s9-partial-card-1440.png') });

    // S9 canvas nit: a click on the BODY text of an explanation card selects it (Delete turns on).
    await node.getByText('Each cell predicts boxes').click();
    await expect(node).toHaveClass(/selected/);
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  });
});
