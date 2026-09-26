/**
 * e2e/s4 — shared helpers for the reader walk: the API as a user reaches it, the database as the
 * walk inspects it (read-only, except the two S4 fixtures the brief names), and the browser actions
 * a reader makes — scroll to a passage, drag across it with the MOUSE, press a button with the MOUSE.
 *
 * Every measurement a spec asserts on is taken from the live page: `getSelection()`'s line rects,
 * the painted `<polygon>`s' boxes, `elementFromPoint`. The DB is read through the workspace's own
 * Python (`.venv`), with `sqlite3`, so a row a spec counts is a row the API really wrote.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { Page } from '@playwright/test';

export const REPO = join(__dirname, '..', '..');
const PYTHON = process.env['PAPERTREE_E2E_PYTHON'] ?? join(REPO, '.venv', 'bin', 'python');

/** Where the walk's screenshots go: the evidence folder when set, the test output otherwise. */
export function shotPath(name: string, fallbackDir: string): string {
  const dir = process.env['PAPERTREE_E2E_SHOTS'] ?? fallbackDir;
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

// ── the API, as the reader's user ─────────────────────────────────────────────────────────────

export async function register(apiUrl: string, email: string): Promise<string> {
  const response = await fetch(`${apiUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'e2e-s4-password' }),
  });
  if (response.status !== 201)
    throw new Error(`register ${String(response.status)}: ${await response.text()}`);
  return ((await response.json()) as { token: string }).token;
}

export async function userId(apiUrl: string, token: string): Promise<string> {
  const response = await fetch(`${apiUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as { user_id: string }).user_id;
}

/** `POST /papers` with the PDF's bytes, exactly as the library's upload sends them. */
export async function upload(apiUrl: string, token: string, pdf: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(pdf)], { type: 'application/pdf' }), basename(pdf));
  const response = await fetch(`${apiUrl}/papers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (response.status !== 202)
    throw new Error(`upload ${String(response.status)}: ${await response.text()}`);
  return ((await response.json()) as { paper_id: string }).paper_id;
}

/** Wait for the real worker to parse and promote: `/ir` answers 200. */
export async function waitParsed(
  apiUrl: string,
  token: string,
  paperId: string,
  timeoutMs = 240_000,
): Promise<number> {
  const started = Date.now();
  for (;;) {
    const response = await fetch(`${apiUrl}/papers/${paperId}/ir`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 200) {
      await response.arrayBuffer();
      return Date.now() - started;
    }
    if (Date.now() - started > timeoutMs)
      throw new Error(`${paperId} not parsed after ${String(timeoutMs)} ms`);
    await new Promise((done) => setTimeout(done, 1000));
  }
}

export interface WireHighlight {
  readonly highlight_id: string;
  readonly color: string;
  readonly anchors: readonly {
    readonly anchor_id: string;
    readonly anchor: {
      readonly doc: { readonly textStreamId: string };
      readonly targetKind: string;
      readonly selectors: readonly {
        readonly type: string;
        readonly quads?: readonly (readonly number[])[];
      }[];
    };
    readonly resolution: { readonly generation: number } | null;
  }[];
}

export async function listHighlights(
  apiUrl: string,
  token: string,
  paperId: string,
): Promise<WireHighlight[]> {
  const response = await fetch(`${apiUrl}/papers/${paperId}/highlights`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await response.json()) as WireHighlight[];
}

// ── the database, through the workspace's Python ──────────────────────────────────────────────

export function python(script: string, args: readonly string[]): string {
  const result = spawnSync(PYTHON, ['-c', script, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' },
  });
  if (result.status !== 0)
    throw new Error(`python failed (${String(result.status)}): ${result.stderr}`);
  return result.stdout.trim();
}

/** Row counts and the stored anchors' kinds, straight from sqlite. */
export function dbRows(
  dataRoot: string,
  paperId: string,
): {
  highlights: number;
  anchors: number;
  resolutions: { generation: number; count: number }[];
  /** `anchor_resolutions.tier` per generation, e.g. `{ generation: 1, tiers: [1, 1, 4] }`. */
  tiers: { generation: number; tiers: number[] }[];
  streams: string[];
  kinds: string[];
} {
  const out = python(
    `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1] + "/papertree.sqlite")
pid = sys.argv[2]
h = conn.execute("SELECT COUNT(*) FROM highlights WHERE paper_id = ?", (pid,)).fetchone()[0]
a = conn.execute("SELECT COUNT(*) FROM anchors WHERE paper_id = ?", (pid,)).fetchone()[0]
r = conn.execute("SELECT generation, COUNT(*) FROM anchor_resolutions WHERE paper_id = ? GROUP BY generation ORDER BY generation", (pid,)).fetchall()
rows = conn.execute("SELECT json_extract(anchor_json, '$.doc.textStreamId'), target_kind FROM anchors WHERE paper_id = ? ORDER BY created_at", (pid,)).fetchall()
t = {}
for g, tier in conn.execute("SELECT generation, tier FROM anchor_resolutions WHERE paper_id = ? ORDER BY generation, tier", (pid,)):
    t.setdefault(g, []).append(tier)
print(json.dumps({"highlights": h, "anchors": a, "resolutions": [{"generation": g, "count": c} for g, c in r], "tiers": [{"generation": g, "tiers": v} for g, v in sorted(t.items())], "streams": [x[0] for x in rows], "kinds": [x[1] for x in rows]}))
`,
    [dataRoot, paperId],
  );
  return JSON.parse(out) as ReturnType<typeof dbRows>;
}

/**
 * The brief's orphan: a highlight whose one anchor was made on ANOTHER PDF (foreign `pdfSha256`)
 * and carries no quote, written straight into sqlite — the API would refuse it (§2.4
 * `anchor_mismatch`, `anchor_incomplete`), which is exactly why it can only come from a test DB.
 */
export function insertOrphan(
  dataRoot: string,
  owner: string,
  paperId: string,
  highlightId: string,
  anchorId: string,
): void {
  python(
    `
import json, sqlite3, sys
root, owner, pid, hid, aid = sys.argv[1:6]
conn = sqlite3.connect(root + "/papertree.sqlite")
now = "2026-09-26T00:00:00.000Z"
anchor = {
  "anchorVersion": 1, "offsetUnit": "unicode", "id": aid,
  "doc": {"paperId": pid, "pdfSha256": "sha256:" + "f" * 64, "parserVersion": "0.9.0",
          "textStreamId": "api/" + pid + "/g1/0.9.0"},
  "targetKind": "text", "provenanceClass": "source",
  "selectors": [
    {"type": "BlockSelector", "blockId": "blk_notinthisparse000", "blockTextHash": "sha256:" + "0" * 64},
    {"type": "PageSelector", "index": 1},
    {"type": "ShapeSelector", "pageIndex": 1, "quads": [[72, 300, 300, 312]], "polygons": [[[72, 300], [300, 300], [300, 312], [72, 312]]],
     "pageWidth": 612, "pageHeight": 792, "rotation": 0, "userUnit": 1, "cropBox": [0, 0, 612, 792]},
  ],
  "created": {"mode": "source", "at": now, "client": "e2e/s4-orphan"},
}
conn.execute("INSERT INTO highlights (highlight_id, owner_id, paper_id, color, note, created_generation, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
             (hid, owner, pid, "pink", None, 1, now, now))
conn.execute("INSERT INTO anchors (anchor_id, owner_id, highlight_id, paper_id, ordinal, anchor_json, target_kind, provenance_class, quote_exact, page_index, created_generation, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
             (aid, owner, hid, pid, 0, json.dumps(anchor), "text", "source", None, 1, 1, now))
conn.commit()
`,
    [dataRoot, owner, paperId, highlightId, anchorId],
  );
}

/**
 * A DISCRIMINATING second generation (s4-review.md F12): the worker's own parse of the same bytes
 * with EVERY block and span box scaled by 0.97 about the page origin — a different parser's boxes,
 * in effect — written the way the worker's persist and promote steps write one (`put_paper` →
 * `promote_generation`). Re-running the same parser on the same bytes proves nothing about the
 * paint rule: ladder paint would repaint identically too. Here ladder-derived geometry moves by up
 * to ~18 pt, so only paint from the STORED quads stays put. The printed `moved_pt` is that control:
 * how far the blocks the highlights link to moved. S1's `POST /reparse` lands in parallel with S4.
 */
export function simulateReparse(
  dataRoot: string,
  user: string,
  paperId: string,
): { generation: number; blocks: number; scaled: number; moved_pt: number } {
  const out = python(
    `
import json, sqlite3, sys, tempfile
from pathlib import Path
from papertree_db import PaperTreeDb, generation
from papertree_document_worker.pipeline import parse_document
root, user, pid = sys.argv[1:4]
K = 0.97
def sc(v):
    return round(v * K, 2)
with tempfile.TemporaryDirectory() as assets:
    result = parse_document(root + "/uploads/" + pid + ".pdf", paper_id=pid, asset_root=Path(assets))
    doc = result.paper.model_dump(mode="json", by_alias=True, exclude_unset=True)
doc["generation"] = 2
before = {b["block_id"]: list(b["bbox"]) for b in doc["blocks"]}
for b in doc["blocks"]:
    b["bbox"] = [sc(v) for v in b["bbox"]]
    if b.get("polygon"):
        b["polygon"] = [[sc(x), sc(y)] for x, y in b["polygon"]]
    for s in b.get("spans") or []:
        if s.get("bbox"):
            s["bbox"] = [sc(v) for v in s["bbox"]]
linked = set()
reader = sqlite3.connect(root + "/papertree.sqlite")
for row in reader.execute("SELECT anchor_json FROM anchors WHERE paper_id = ?", (pid,)):
    for sel in json.loads(row[0]).get("selectors", []):
        if sel.get("type") == "BlockSelector":
            linked.add(sel["blockId"])
reader.close()
db = PaperTreeDb(Path(root) / "papertree.sqlite")
owner = db.owner_for(user)
moved = max(
    [max(abs(a - sc(a)) for a in before[i]) for i in linked if i in before] or [0.0]
)
db.put_paper(owner, doc)
db.promote_generation(owner, pid, generation(2))
db.close()
print(json.dumps({"generation": 2, "blocks": len(doc["blocks"]), "scaled": K, "moved_pt": round(moved, 2)}))
`,
    [dataRoot, user, paperId],
  );
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as {
    generation: number;
    blocks: number;
    scaled: number;
    moved_pt: number;
  };
}

// ── the browser, as a reader uses it ──────────────────────────────────────────────────────────

/** The scroller the reader reads in (Source's page list). */
export const SCROLLER = '[data-papertree-scroller]';

/** Scroll until a text-layer span containing `needle` is rendered and on screen; its client box. */
export async function reveal(page: Page, needle: string, exact = false): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    const found = await page.evaluate(
      ([text, whole, selector, first]) => {
        const span = Array.from(
          document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
        ).find((s) =>
          whole ? (s.textContent ?? '').trim() === text : (s.textContent ?? '').includes(text),
        );
        if (span !== undefined) {
          span.scrollIntoView({ block: 'center', inline: 'nearest' });
          return true;
        }
        const scroller = document.querySelector(selector);
        // Not rendered here: search the paper from its first page, downwards.
        if (scroller !== null)
          scroller.scrollTop = first ? 0 : scroller.scrollTop + scroller.clientHeight * 0.8;
        return false;
      },
      [needle, exact, SCROLLER, step === 0] as const,
    );
    await page.waitForTimeout(found ? 700 : 350);
    if (found) return;
  }
  throw new Error(`no text-layer span contains ${JSON.stringify(needle)}`);
}

/** Client points just inside the first character of `start` and the last character of `end`. */
export async function pointsFor(
  page: Page,
  start: string,
  end: string,
  exact = false,
): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  const points = await page.evaluate(
    ([a, b, whole]) => {
      const spans = Array.from(
        document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
      );
      const matches = (s: Element, text: string) =>
        whole ? (s.textContent ?? '').trim() === text : (s.textContent ?? '').includes(text);
      const at = (span: Element, text: string, fromEnd: boolean) => {
        const content = span.textContent ?? '';
        const index = whole ? content.indexOf(text.trim()) : content.indexOf(text);
        const node = span.firstChild as Text;
        const range = document.createRange();
        const offset = fromEnd ? index + text.trim().length - 1 : index;
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        return { x: fromEnd ? rect.right - 0.5 : rect.left + 0.5, y: rect.top + rect.height / 2 };
      };
      const first = spans.findIndex((s) => matches(s, a));
      if (first < 0) return null;
      const last = spans.findIndex((s, i) => i >= first && matches(s, b));
      if (last < 0) return null;
      return {
        from: at(spans[first] as Element, a, false),
        to: at(spans[last] as Element, b, true),
      };
    },
    [start, end, exact] as const,
  );
  if (points === null)
    throw new Error(`could not find ${JSON.stringify(start)} … ${JSON.stringify(end)}`);
  return points;
}

/** A real mouse drag from one point to another. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

export type Box = [number, number, number, number];

/** The live selection: its text and its own line rects (the browser's, for comparison only). */
export async function selectionRects(page: Page): Promise<{ text: string; rects: Box[] }> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) return { text: '', rects: [] };
    const rects = Array.from(selection.getRangeAt(0).getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => [r.left, r.top, r.right, r.bottom] as [number, number, number, number]);
    return { text: selection.toString(), rects };
  });
}

/** The painted boxes of one highlight (or of every highlight), in client pixels. */
export async function paintedBoxes(page: Page, highlightId?: string): Promise<Box[]> {
  return page.evaluate((id) => {
    const selector =
      id === undefined
        ? 'svg .pt-hl polygon.pt-hl-fill'
        : `svg .pt-hl[data-highlight-id="${id}"] polygon.pt-hl-fill`;
    return Array.from(document.querySelectorAll(selector)).map((p) => {
      const r = p.getBoundingClientRect();
      return [r.left, r.top, r.right, r.bottom] as [number, number, number, number];
    });
  }, highlightId);
}

/** The painted geometry in IR space (the SVG's own coordinates): zoom- and scroll-independent. */
export async function paintedPoints(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(() => {
    const out: Record<string, string[]> = {};
    document.querySelectorAll('svg .pt-hl').forEach((g) => {
      const id = g.getAttribute('data-anchor-id') ?? '';
      out[id] = Array.from(g.querySelectorAll('polygon.pt-hl-fill')).map(
        (p) => p.getAttribute('points') ?? '',
      );
    });
    return out;
  });
}

export function union(boxes: readonly Box[]): Box {
  return boxes.reduce<Box>(
    (u, b) => [
      Math.min(u[0], b[0]),
      Math.min(u[1], b[1]),
      Math.max(u[2], b[2]),
      Math.max(u[3], b[3]),
    ],
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ],
  );
}

/** Each painted quad's underline of one highlight, client px: `[x0, x1, y]` (y = the quad's bottom). */
export async function paintedLines(
  page: Page,
  highlightId: string,
): Promise<[number, number, number][]> {
  return page.evaluate((id) => {
    return Array.from(
      document.querySelectorAll(`svg .pt-hl[data-highlight-id="${id}"] line.pt-hl-line`),
    ).map((line) => {
      const r = line.getBoundingClientRect();
      return [r.left, r.right, (r.top + r.bottom) / 2] as [number, number, number];
    });
  }, highlightId);
}

/**
 * LINE BY LINE, not the union (s4-review.md F5): the selection's own rects grouped into lines, each
 * compared with the painted quads on that line. The union box hides a last line that overshoots
 * its selection, because the lines above it reach the column edge.
 */
export function perLineEdges(
  selection: readonly Box[],
  painted: readonly [number, number, number][],
): { worst: number; lines: { dLeft: number; dRight: number }[]; unmatched: number } {
  const lines: { top: number; bottom: number; left: number; right: number }[] = [];
  for (const [left, top, right, bottom] of selection) {
    const cy = (top + bottom) / 2;
    const line = lines.find((l) => Math.abs((l.top + l.bottom) / 2 - cy) < 4);
    if (line === undefined) lines.push({ top, bottom, left, right });
    else {
      line.top = Math.min(line.top, top);
      line.bottom = Math.max(line.bottom, bottom);
      line.left = Math.min(line.left, left);
      line.right = Math.max(line.right, right);
    }
  }
  let worst = 0;
  let unmatched = 0;
  const out: { dLeft: number; dRight: number }[] = [];
  for (const line of lines) {
    const on = painted.filter(([, , y]) => y > line.top && y < line.bottom + 6);
    if (on.length === 0) {
      unmatched += 1;
      continue;
    }
    const dLeft = Math.abs(Math.min(...on.map((u) => u[0])) - line.left);
    const dRight = Math.abs(Math.max(...on.map((u) => u[1])) - line.right);
    out.push({ dLeft: +dLeft.toFixed(2), dRight: +dRight.toFixed(2) });
    worst = Math.max(worst, dLeft, dRight);
  }
  return { worst, lines: out, unmatched };
}

/** The client rects of the text from the start of `start` to the end of `end` (no selection made). */
export async function rangeRects(page: Page, start: string, end: string): Promise<Box[]> {
  return page.evaluate(
    ([a, b]) => {
      const spans = Array.from(
        document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
      );
      const first = spans.findIndex((s) => (s.textContent ?? '').includes(a));
      const last = spans.findIndex((s, i) => i >= first && (s.textContent ?? '').includes(b));
      if (first < 0 || last < 0) return [];
      const from = spans[first] as Element;
      const to = spans[last] as Element;
      const range = document.createRange();
      range.setStart(from.firstChild as Text, (from.textContent ?? '').indexOf(a));
      range.setEnd(to.firstChild as Text, (to.textContent ?? '').indexOf(b) + b.length);
      return Array.from(range.getClientRects())
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => [r.left, r.top, r.right, r.bottom] as [number, number, number, number]);
    },
    [start, end] as const,
  );
}

/** The largest edge distance between two boxes, px. */
export function edgeDelta(a: Box, b: Box): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
    Math.abs(a[3] - b[3]),
  );
}

/** Is the element at a button's centre the button itself (the baseline's defect: a text span)? */
export async function hitTest(
  page: Page,
  name: string,
): Promise<{ x: number; y: number; hit: string }> {
  const button = page.getByRole('button', { name, exact: true });
  const box = await button.boundingBox();
  if (box === null) throw new Error(`no ${name} button`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const hit = await page.evaluate(
    ([px, py, label]) => {
      const element = document.elementFromPoint(px, py);
      const button = element?.closest('button');
      if (button === null || button === undefined)
        return `${element?.tagName ?? 'nothing'}.${element?.className ?? ''}`;
      return button.getAttribute('aria-label') === label
        ? 'button'
        : `other button ${button.getAttribute('aria-label') ?? ''}`;
    },
    [x, y, name] as const,
  );
  return { x, y, hit };
}

/** The topmost rendered text-layer item under the scroller's top edge, and its distance from it. */
export async function topLine(
  page: Page,
): Promise<{ page: number; item: number; text: string; dy: number; height: number }> {
  return page.evaluate((selector) => {
    const scroller = document.querySelector(selector) as HTMLElement;
    const top = scroller.getBoundingClientRect().top;
    let best: { page: number; item: number; text: string; dy: number; height: number } | null =
      null;
    document.querySelectorAll('.papertree-page').forEach((pageEl) => {
      const pageIndex = Number(pageEl.getAttribute('data-page-index'));
      pageEl.querySelectorAll('.papertree-text-layer span[data-item-index]').forEach((span) => {
        if ((span.textContent ?? '').trim().length < 12) return;
        const r = span.getBoundingClientRect();
        // Body text: not a figure's tiny labels, not the rotated arXiv margin stamp.
        if (r.height < 8 || r.height > 40 || r.width < r.height) return;
        if (r.top < top - 1) return;
        if (best === null || r.top - top < best.dy) {
          best = {
            page: pageIndex,
            item: Number(span.getAttribute('data-item-index')),
            text: span.textContent ?? '',
            dy: r.top - top,
            height: r.height,
          };
        }
      });
    });
    if (best === null) throw new Error('no text at the top of the scroller');
    return best;
  }, SCROLLER);
}

/** Where a given (page, item) now sits relative to the scroller's top edge. */
export async function lineOffset(
  page: Page,
  at: { page: number; item: number },
): Promise<{ dy: number; height: number } | null> {
  return page.evaluate(
    ([selector, pageIndex, item]) => {
      const scroller = document.querySelector(selector) as HTMLElement;
      const span = document.querySelector(
        `.papertree-page[data-page-index="${String(pageIndex)}"] .papertree-text-layer span[data-item-index="${String(item)}"]`,
      );
      if (span === null) return null;
      const r = span.getBoundingClientRect();
      return { dy: r.top - scroller.getBoundingClientRect().top, height: r.height };
    },
    [SCROLLER, at.page, at.item] as const,
  );
}

export async function getDocumentCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__PAPERTREE_DEBUG__?.getDocumentCalls ?? 0);
}

export async function spanCount(page: Page): Promise<number> {
  return page.locator('.papertree-text-layer span').count();
}

/** The YOLO PDF the brief's Journey B names, or null (it is not in the committed corpus). */
export function yoloPdf(): string | null {
  const candidates = [
    process.env['PAPERTREE_E2E_YOLO_PDF'],
    join(REPO, 'research', 'benchmarks', 'fresh', 'pdfs', 'yolo-1506.02640.pdf'),
  ];
  for (const candidate of candidates)
    if (candidate !== undefined && existsSync(candidate)) return candidate;
  return null;
}

declare global {
  interface Window {
    __PAPERTREE_DEBUG__?: { getDocumentCalls: number };
  }
}
