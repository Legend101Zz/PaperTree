/**
 * W2UI #141, the canvas should-fixes on the real stack (api + worker + faux agent + web):
 *
 *   - the API refuses oversized cards, labels, coordinates and zoom (422 naming the field);
 *   - the same passage sent twice makes ONE card and says "Already on your canvas";
 *   - on a phone the first view is the WHOLE board, "Fit all" is visible, in-card controls keep a
 *     40 px hit area and the group name is 40 px tall;
 *   - a stale-version refusal names the card and clears itself.
 *
 * Screenshots go to PAPERTREE_E2E_SHOTS and are looked at by the author.
 */
import { expect, test } from '../harness/test';
import {
  api,
  drag,
  getBoard,
  pointsFor,
  reveal,
  seedPaper,
  selectionRects,
  shotPath,
  tokenInit,
} from './support';

test.use({ actionTimeout: 20_000 });

test('the API refuses oversized canvas rows with a 422 that names the field', async ({ stack }) => {
  const { token, paperId } = await seedPaper(stack.apiUrl, 'limits');
  const post = (body: Record<string, unknown>) =>
    api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: `cn_${crypto.randomUUID()}`,
      kind: 'note',
      x: 0,
      y: 0,
      w: 240,
      h: 120,
      ...body,
    });
  const detail = (r: { status: number; json: unknown }) => {
    expect(r.status).toBe(422);
    return (r.json as { code: string; detail: string }).detail;
  };
  expect(detail(await post({ body: 'x'.repeat(2_000_000) }))).toMatch(/^body: /);
  expect(detail(await post({ title: 't'.repeat(201) }))).toMatch(/^title: /);
  expect(detail(await post({ x: 1_000_001 }))).toMatch(/^x: /);
  const huge = await fetch(`${stack.apiUrl}/papers/${paperId}/board/nodes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{"node_id":"cn_hugecoord1","kind":"note","x":1e308,"y":0,"w":240,"h":120}',
  });
  expect(huge.status).toBe(422);
  const ok = await post({ body: 'x'.repeat(20_000), title: 't'.repeat(200) });
  expect(ok.status, JSON.stringify(ok.json)).toBe(201);
  const created = ok.json as { board: { board_id: string }; node: { node_id: string } };
  const other = await post({ x: 400 });
  const otherId = (other.json as { node: { node_id: string } }).node.node_id;
  const edge = await api(stack.apiUrl, token, 'POST', `/boards/${created.board.board_id}/edges`, {
    edge_id: `ce_${crypto.randomUUID()}`,
    from_node_id: created.node.node_id,
    to_node_id: otherId,
    kind: 'relates',
    label: 'l'.repeat(100_000),
  });
  expect(edge.status).toBe(422);
  expect((edge.json as { detail: string }).detail).toMatch(/^label: /);
  const viewport = await api(stack.apiUrl, token, 'PATCH', `/boards/${created.board.board_id}`, {
    viewport: { x: 1e300, y: 0, zoom: 1 },
  });
  expect(viewport.status).toBe(422);
  expect((viewport.json as { detail: string }).detail).toMatch(/^viewport\.x: /);
});

test('the same passage twice is one card and a toast says so', async ({
  browser,
  stack,
}, testInfo) => {
  test.setTimeout(600_000);
  const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
  const { token, paperId } = await seedPaper(stack.apiUrl, 'dupe');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/read`);
  await expect
    .poll(() => page.locator('.papertree-text-layer span[data-item-index]').count(), {
      timeout: 180_000,
    })
    .toBeGreaterThan(20);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await reveal(page, 'Deeper neural networks');
  const send = async () => {
    const points = await pointsFor(page, 'Deeper neural networks', 'substantially deeper');
    await drag(page, points.from, points.to);
    expect((await selectionRects(page)).text).toContain('Deeper neural networks');
    await page.getByRole('button', { name: 'Send to canvas' }).click();
  };
  await send();
  const toast = page.getByTestId('canvas-toast');
  await expect(toast).toContainText('Passage added to your canvas');
  await expect
    .poll(async () => (await getBoard(stack.apiUrl, token, paperId)).nodes.length)
    .toBe(1);
  // The first toast stays up for 8 s; wait it out so the second message is the one asserted.
  await expect(toast).toBeHidden({ timeout: 15_000 });
  await send();
  await expect(toast).toContainText('Already on your canvas');
  await expect(toast.getByRole('link', { name: 'Open canvas' })).toBeVisible();
  await page.screenshot({ path: shot('w2-07-already-on-canvas-1440.png') });
  await page.waitForTimeout(800);
  expect((await getBoard(stack.apiUrl, token, paperId)).nodes).toHaveLength(1);
  await context.close();
});

test('a phone opens on the whole board; controls are tappable; the group name is 40 px', async ({
  browser,
  stack,
}, testInfo) => {
  test.setTimeout(600_000);
  const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
  const { token, paperId } = await seedPaper(stack.apiUrl, 'phone');
  const mk = (kind: string, x: number, y: number, extra: Record<string, unknown>) =>
    api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: `cn_${crypto.randomUUID()}`,
      kind,
      x,
      y,
      w: 300,
      h: 180,
      ...extra,
    });
  const made = [
    await mk('note', 0, 0, { body: 'First note, far left.' }),
    await mk('note', 560, 40, { body: 'A second note, far to the right.' }),
    await mk('note', 280, 500, { body: 'A third note, below.' }),
    await mk('group', 0, 480, { title: 'Open questions', w: 420, h: 260 }),
  ];
  for (const r of made) expect(r.status).toBe(201);

  for (const theme of ['light', 'dark'] as const) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: theme,
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await tokenInit(page, token);
    await page.goto(`/paper/${paperId}/canvas`);
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    // First open = the whole board: every card lies inside the stage.
    const inside = async () => {
      const stage = await page.getByTestId('canvas-stage').boundingBox();
      const boxes = await page
        .locator('.react-flow__node')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(-1);
        expect(b.right).toBeLessThanOrEqual(391);
        expect(b.top).toBeGreaterThanOrEqual((stage?.y ?? 0) - 1);
        expect(b.bottom).toBeLessThanOrEqual((stage?.y ?? 0) + (stage?.height ?? 0) + 1);
      }
    };
    await inside();
    await page.screenshot({ path: shot(`w2-09-phone-first-open-390-${theme}.png`) });

    // "Fit all" is visible, is a 40 px target, and brings the whole board back after a pan/zoom.
    const fit = page.getByRole('button', { name: 'Fit all' });
    await expect(fit).toBeVisible();
    const fb = await fit.boundingBox();
    expect(fb!.height).toBeGreaterThanOrEqual(40);
    await page.locator('.react-flow__controls-zoomin').tap();
    await page.locator('.react-flow__controls-zoomin').tap();
    await page.waitForTimeout(500);
    await fit.tap();
    await page.waitForTimeout(800);
    await inside();

    // In-card controls: the hit area (button + its ::after) reaches 19 px from the centre of
    // the pill in every direction that stays inside the card, at the zoom the board opened on.
    const zoom = await page.evaluate(() => {
      const m = /scale\(([\d.]+)\)/.exec(
        document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '',
      );
      return m === null ? 0 : Number(m[1]);
    });
    const probes = await page.evaluate(() => {
      const out: { node: string; ok: boolean; missed: string[] }[] = [];
      for (const button of Array.from(
        document.querySelectorAll<HTMLElement>('.react-flow__node .pt-cv-node__head .pt-btn'),
      )) {
        const node = button.closest('.react-flow__node') as HTMLElement;
        const nb = node.getBoundingClientRect();
        const r = button.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const missed: string[] = [];
        for (const [dx, dy] of [
          [0, -19],
          [0, 19],
          [-19, 0],
          [19, 0],
        ] as const) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < nb.left + 1 || x > nb.right - 1 || y < nb.top + 1 || y > nb.bottom - 1) continue;
          if (x < 0 || x > innerWidth) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit?.closest('.pt-btn') !== button) missed.push(`${String(dx)},${String(dy)}`);
        }
        out.push({ node: node.getAttribute('data-id') ?? '', ok: missed.length === 0, missed });
      }
      return out;
    });
    expect(probes.length).toBeGreaterThan(0);
    for (const p of probes)
      expect(p.missed, `hit area of ${p.node} at zoom ${String(zoom)}`).toEqual([]);

    // The group name input is >= 40 px tall on screen (the board fits at a zoom >= 0.3).
    expect(zoom).toBeGreaterThanOrEqual(0.3);
    const input = await page.getByLabel('Group name').boundingBox();
    expect(input!.height).toBeGreaterThanOrEqual(39.5);
    console.log(
      `[w2ui] phone ${theme}: zoom ${zoom.toFixed(3)}, group input ${input!.height.toFixed(1)} px`,
    );
    await page.screenshot({ path: shot(`w2-09b-phone-fit-all-390-${theme}.png`) });
    await context.close();
  }
});

test('a stale-version refusal names the card and clears itself', async ({
  browser,
  stack,
}, testInfo) => {
  test.setTimeout(300_000);
  const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
  const { token, paperId } = await seedPaper(stack.apiUrl, 'stale');
  const id = `cn_${crypto.randomUUID()}`;
  const created = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
    node_id: id,
    kind: 'note',
    x: 100,
    y: 100,
    w: 280,
    h: 160,
    body: 'Original words',
  });
  expect(created.status).toBe(201);
  const boardId = (created.json as { board: { board_id: string } }).board.board_id;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/canvas`);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.waitForTimeout(1200);
  // Somewhere else changes the card: the page's copy of its version is now stale.
  const elsewhere = await api(stack.apiUrl, token, 'PATCH', `/boards/${boardId}/nodes/${id}`, {
    version: 1,
    body: 'Changed on another device',
  });
  expect(elsewhere.status).toBe(200);

  await page.getByRole('button', { name: 'Edit' }).click();
  const area = page.getByRole('textbox', { name: 'Note text' });
  await area.fill('My edit');
  await area.press('Enter');
  const notice = page.locator('.pt-cv__notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('“My edit” was changed somewhere else');
  expect(await notice.innerText()).not.toMatch(/cn_|brd_|\{/);
  await page.screenshot({ path: shot('w2-10-stale-notice-1440.png') });
  // It clears itself (8 s), without the reader pressing Dismiss.
  await expect(notice).toBeHidden({ timeout: 15_000 });
  await context.close();
});
