/**
 * v0.2 S6e (#215): a 500-card board on the real stack.
 *
 * 500 passage cards of the ResNet corpus paper (each one a real body paragraph of the parse, with
 * the reader's whole-block source anchor minted by `papertree_anchoring.capture_anchor` over it) in
 * GAP-A3 §4.1's 25 × 20 grid at a 300 × 200 pitch, and 167 `supports` threads. Asserted: the first
 * view draws the cards as glances (kind and words, below the low-zoom switch); a settled 500-card
 * board makes 0 requests in 15 s; dragging one card keeps a frame budget with a LOOSE bound (p95
 * under 250 ms: this box is shared and loaded, #259/#270, so the numbers are logged, not raced).
 */
import { execSync } from 'node:child_process';

import { expect, test } from '../harness/test';
import { api, python, seedPaper, tokenInit, userId } from '../s7/support';

import type { Page } from '@playwright/test';

test.use({ actionTimeout: 20_000 });

/** Mints one whole-block source anchor per card, cycling through the parse's body paragraphs. */
function passages(dataRoot: string, user: string, paperId: string, count: number) {
  const out = python(
    `
import json, sys, uuid
from datetime import UTC, datetime
from pathlib import Path
from papertree_anchoring import capture_anchor
from papertree_api.evidence import DocumentCache
from papertree_db import PaperTreeDb

root, user, pid, count = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
db = PaperTreeDb(Path(root) / "papertree.sqlite")
try:
    owner = db.owner_for(user)
    doc = DocumentCache().get(db, owner, user, pid, db.promoted_generation(owner, pid))
finally:
    db.close()
if doc is None:
    raise SystemExit("no parse to mint Anchors against")
body = [b for b in doc.blocks
        if b.block.flow == "body" and b.block.type == "paragraph" and len(b.text) >= 80]
at = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
cards = []
for i in range(count):
    blk = body[i % len(body)]
    anchor = capture_anchor(doc, blk.block.block_id, anchor_id=str(uuid.uuid4()), at=at,
                            client="papertree-web/reader")
    cards.append({"text": blk.text, "anchor": dict(anchor)})
print(json.dumps(cards))
`,
    [dataRoot, user, paperId, String(count)],
  );
  return JSON.parse(out) as { text: string; anchor: unknown }[];
}

/** rAF frame intervals while `gesture` runs: frame count, p50, p95 and the longest, in ms. */
async function frames(page: Page, gesture: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __f: number[]; __go: boolean };
    w.__f = [];
    w.__go = true;
    let last = performance.now();
    const tick = (t: number): void => {
      w.__f.push(t - last);
      last = t;
      if (w.__go) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await gesture();
  const all = await page.evaluate(() => {
    const w = window as unknown as { __f: number[]; __go: boolean };
    w.__go = false;
    return w.__f.slice(1);
  });
  const sorted = [...all].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { frames: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 };
}

test('a settled 500-card board makes 0 requests, and one card drags inside a frame budget', async ({
  browser,
  stack,
}) => {
  test.setTimeout(600_000);
  const { token, paperId } = await seedPaper(stack.apiUrl, 'board-scale');
  const cards = passages(stack.dataRoot, await userId(stack.apiUrl, token), paperId, 500);
  const ids: string[] = [];
  let boardId = '';
  for (const [i, card] of cards.entries()) {
    const made = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: `cn_${crypto.randomUUID()}`,
      kind: 'excerpt',
      x: (i % 25) * 300,
      y: Math.floor(i / 25) * 200,
      w: 260,
      h: 150,
      body: card.text,
      source_anchor: card.anchor,
    });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    const json = made.json as { board: { board_id: string }; node: { node_id: string } };
    ids.push(json.node.node_id);
    boardId = json.board.board_id;
  }
  for (let k = 0; k < 167; k += 1) {
    const made = await api(stack.apiUrl, token, 'POST', `/boards/${boardId}/edges`, {
      edge_id: `ce_${crypto.randomUUID()}`,
      from_node_id: ids[3 * k],
      to_node_id: ids[3 * k + 1],
      kind: 'supports',
      label: null,
      from_port: 'claim_out',
      to_port: 'evidence_in',
    });
    expect(made.status).toBe(201);
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/board`);
  await expect(page.getByRole('banner')).toContainText('500 cards · 167 threads');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  // The first view is the whole board at the zoom floor: every card a glance (kind and words).
  const glances = page.locator('.react-flow__node [data-glance="true"]');
  await expect(glances.first()).toBeVisible();
  expect(await glances.count()).toBe(await page.locator('.react-flow__node').count());

  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/__nextjs')) return;
    requests.push(`${request.method()} ${request.url()}`);
  });
  await page.waitForTimeout(15_000);
  expect(requests).toEqual([]);

  // One card dragged by its top edge, 40 moves.
  const box = (await page.locator(`.react-flow__node[data-id="${ids[262]!}"]`).boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + 3 };
  const drag = await frames(page, async () => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 40; i += 1) await page.mouse.move(start.x + i * 4, start.y + i * 2);
    await page.mouse.up();
    await page.waitForTimeout(300);
  });
  const load = execSync('uptime').toString().trim();
  console.log(`board-scale: drag of one card at 500 cards ${JSON.stringify(drag)}; ${load}`);
  test.info().annotations.push({ type: 'drag frames (ms)', description: JSON.stringify(drag) });
  expect(drag.frames).toBeGreaterThan(5);
  expect(drag.p95).toBeLessThan(250);
  await context.close();
});
