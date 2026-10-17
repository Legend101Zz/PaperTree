/**
 * e2e/v02 — helpers for the whole prototype flow (S8, #218): the checks run after every step (the
 * motion settled, the scheme really applied, no banned label, axe), the board's plate and passage
 * made through the API's own routes, and the animation recorder the reduced-motion walk reads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '../harness/test';
import { python, REPO } from '../s4/support';
import { api } from '../s7/support';

import type { BrowserContext, Page } from '@playwright/test';

export const ATTENTION = join(
  REPO,
  'research',
  'benchmarks',
  'corpus',
  'attention-is-all-you-need.pdf',
);
const AXE = join(REPO, 'apps', 'web', 'node_modules', 'axe-core', 'axe.min.js');

/** The two schemes, by the token every surface is drawn on (`--pt-page`, DESIGN.md §2). */
const PAGE_TOKEN = { light: '#faf8f3', dark: '#2c251f' } as const;

/** "verified", "fact-checked" or "accurate" as a label; "not verified" is the honest one. */
export const BANNED = /\bverified\b(?<!not verified)|fact-checked|\baccurate\b/i;

/**
 * Wait until no finite animation is running (an axe pass mid-fade measures the fade, not the
 * page: the explain panel's 180 ms slide-in read as a contrast failure), then two frames.
 *
 * @param page - The page.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = () =>
      document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming();
        return a.playState === 'running' && t !== undefined && Number.isFinite(t.endTime ?? 0);
      });
    const deadline = performance.now() + 4000;
    while (finite().length > 0 && performance.now() < deadline) {
      await Promise.race([
        Promise.all(finite().map((a) => a.finished.catch(() => undefined))),
        new Promise((done) => setTimeout(done, 250)),
      ]);
    }
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

/** axe-core's serious and critical violations (axe from apps/web's devDependencies). */
export async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: readFileSync(AXE, 'utf8') });
  return page.evaluate(async () => {
    const run = (
      window as unknown as { axe: { run: (c: Document, o: object) => Promise<AxeResults> } }
    ).axe.run;
    const results = await run(document, { resultTypes: ['violations'] });
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

interface AxeResults {
  readonly violations: readonly {
    readonly id: string;
    readonly impact: string | null;
    readonly nodes: readonly { readonly target: readonly string[] }[];
  }[];
}

/**
 * The checks after every step: the motion settled, the scheme's own tokens applied (#269: a dark
 * axe pass that ran in daylight proves nothing), no banned label on screen, axe 0 serious or
 * critical.
 *
 * @param page - The page.
 * @param scheme - The journey's scheme.
 * @param where - The step, for the failure message.
 */
export async function checkStep(
  page: Page,
  scheme: 'light' | 'dark',
  where: string,
): Promise<void> {
  await settle(page);
  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--pt-page').trim().toLowerCase(),
  );
  expect(token, `${where}: the ${scheme} scheme`).toBe(PAGE_TOKEN[scheme]);
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  expect(text, `${where}: no "verified", "fact-checked" or "accurate"`).not.toMatch(BANNED);
  expect(await axeSerious(page), `${where}: axe serious/critical`).toEqual([]);
}

/**
 * A whole-block source Anchor over the first block whose text holds `needle`, minted by the
 * server's own `papertree_anchoring.capture_anchor` against the promoted parse (never by hand).
 *
 * @param dataRoot - The stack's data root.
 * @param user - The owner's user id.
 * @param paperId - The paper.
 * @param needle - Words of the block.
 * @returns The Anchor, as the wire carries it.
 */
export function mintAnchor(
  dataRoot: string,
  user: string,
  paperId: string,
  needle: string,
): { doc: { paperId: string } } {
  const out = python(
    `
import json, sys, uuid
from datetime import UTC, datetime
from pathlib import Path
from papertree_anchoring import capture_anchor
from papertree_api.evidence import DocumentCache
from papertree_db import PaperTreeDb

root, user, pid, needle = sys.argv[1:5]
db = PaperTreeDb(Path(root) / "papertree.sqlite")
try:
    owner = db.owner_for(user)
    doc = DocumentCache().get(db, owner, user, pid, db.promoted_generation(owner, pid))
finally:
    db.close()
if doc is None:
    raise SystemExit("no parse to mint an Anchor against")
block = next(b for b in doc.blocks if needle in b.text)
at = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
print(json.dumps(dict(capture_anchor(doc, block.block.block_id, anchor_id=str(uuid.uuid4()),
                                     at=at, client="papertree-web/reader"))))
`,
    [dataRoot, user, paperId, needle],
  );
  return JSON.parse(out) as { doc: { paperId: string } };
}

/**
 * A plate drawn by the faux agent (`[faux:diagram]`, the frames' six parts) on a passage, through
 * `POST /papers/{id}/threads`, read back as the stored plate.
 *
 * @param apiUrl - The API.
 * @param token - The owner's session.
 * @param paperId - The paper.
 * @param anchor - The passage the diagram is asked about.
 * @returns The plate's assistant message id and title.
 */
export async function drawPlate(
  apiUrl: string,
  token: string,
  paperId: string,
  anchor: unknown,
): Promise<{ messageId: string; title: string }> {
  const stream = await fetch(`${apiUrl}/papers/${paperId}/threads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      kind: 'diagram',
      anchor,
      question: '[faux:diagram] Explain with a diagram.',
    }),
  });
  expect(stream.status).toBe(200);
  await stream.text();
  const threads = (await api(apiUrl, token, 'GET', `/papers/${paperId}/threads`)).json as {
    thread_id: string;
    kind: string;
  }[];
  const thread = threads.find((t) => t.kind === 'diagram');
  expect(thread, 'the diagram thread').toBeDefined();
  const detail = (
    await api(apiUrl, token, 'GET', `/papers/${paperId}/threads/${thread!.thread_id}`)
  ).json as {
    messages: { message_id: string; role: string; diagram: { title: string } | null }[];
  };
  const plate = detail.messages.find((m) => m.role === 'assistant' && m.diagram !== null);
  expect(plate, 'the stored plate').toBeDefined();
  return { messageId: plate!.message_id, title: plate!.diagram!.title };
}

/**
 * One card on the paper's board, through `POST /papers/{id}/board/nodes`.
 *
 * @param apiUrl - The API.
 * @param token - The owner's session.
 * @param paperId - The paper.
 * @param card - The card's kind, place and sources.
 * @returns The card's id.
 */
export async function placeCard(
  apiUrl: string,
  token: string,
  paperId: string,
  card: Record<string, unknown>,
): Promise<string> {
  const made = await api(apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
    node_id: `cn_${crypto.randomUUID()}`,
    ...card,
  });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  return (made.json as { node: { node_id: string } }).node.node_id;
}

/** One animation the recorder saw: its kind, name, target and when it ends (delay + active), ms. */
export interface SeenAnimation {
  readonly type: string;
  readonly name: string;
  readonly target: string;
  readonly end: number;
}

/**
 * Record every animation the page starts (CSS animations and transitions, Web Animations), once
 * each, on every frame, from the first paint of every page the context opens.
 *
 * @param context - The browser context.
 */
export async function recordAnimations(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const seen = new WeakSet<Animation>();
    const log: unknown[] = [];
    (window as unknown as { ptS8Animations: unknown[] }).ptS8Animations = log;
    const tick = (): void => {
      for (const a of document.getAnimations()) {
        if (seen.has(a)) continue;
        seen.add(a);
        const timing = a.effect?.getComputedTiming();
        const effect = a.effect as KeyframeEffect | null;
        const el = effect?.target ?? null;
        const cls = el === null ? '' : String(el.getAttribute('class') ?? '').split(' ')[0];
        log.push({
          type: a.constructor.name,
          name:
            (a as unknown as { animationName?: string }).animationName ??
            (a as unknown as { transitionProperty?: string }).transitionProperty ??
            '',
          target: el === null ? '' : `${el.tagName.toLowerCase()}.${cls ?? ''}`,
          end: Number(timing?.endTime ?? 0),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * The animations recorded since the last call, after the longest reduced moment has had time to
 * end (so none is caught mid-way and missed).
 *
 * @param page - The page.
 * @returns What ran.
 */
export async function takeAnimations(page: Page): Promise<SeenAnimation[]> {
  await page.waitForTimeout(400);
  return page.evaluate(() =>
    (window as unknown as { ptS8Animations: SeenAnimation[] }).ptS8Animations.splice(0),
  );
}
