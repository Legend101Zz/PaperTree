/**
 * reader/capture-wire.spec — a selection in the reader becomes a stored anchor.
 *
 * THIS IS THE TEST THAT WAS MISSING, and its absence is the whole of issue #58.
 *
 * Before this file, `packages/anchoring` had 57 passing tests including a 100.00% re-anchor rate
 * across 21 fixture × perturbation combinations, and `apps/web` had 86 more. Every one of them
 * built its anchors by calling `captureAnchor` directly, in TypeScript. `useSelectionCapture` and
 * `SelectionToolbar` were written, commented, and imported by NOTHING; `ReaderWorkspace` declared
 * `onAnchorCaptured`, passed `addAnchor` into it, and no descendant ever read the prop. So the
 * reader could resolve a highlight through a reparse and could not make one, and the entire suite
 * was green.
 *
 * The defect was an ABSENT CALL SITE. No unit test can catch that — a unit test of the hook proves
 * the hook works, which was never in doubt. Only a test that starts where the user starts, at a DOM
 * selection, and ends where the product ends, at a stored anchor, closes the gap. So that is what
 * this does:
 *
 *     stamped text layer  →  DOM Range  →  selectionchange/pointerup  →  toolbar  →  anchor
 *
 * WHAT IS FAKED AND WHY. pdf.js, and nothing else. happy-dom has no canvas to raster into and no
 * `requestAnimationFrame` for pdf.js's render loop to settle on, so a real `getDocument` here would
 * hang forever — which, for the record, is also why the reader appears to render nothing in a
 * BACKGROUND browser tab: `visibilityState: "hidden"` starves rAF and `RenderTask.promise` never
 * resolves. That is an environment property, not a bug, and it cost an hour to establish once.
 *
 * Everything downstream of pdf.js is REAL: the real `PdfDocumentProvider` (hoisted above the pane
 * since S4, as `ReaderWorkspace` mounts it), the real `PdfPage`, the real `stampTextLayer`, the real
 * `useSelectionCapture`, the real `SelectionToolbar`, the real `captureAnchor` /
 * `capturePageTextAnchor`. The fake `TextLayer` emits the same `textDivs` array pdf.js emits.
 *
 * S4 ADDITIONS: Highlight hands the WORKSPACE a capture (it persists it), activated by a CLICK — the
 * mouse path that the baseline's text layer swallowed; Ask reaches `openExplain`; and a selection in
 * an item the IR did not stamp is captured from item geometry (`pdfjs@…/page-text`) instead of the
 * removed `locateByText` guess.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  indexDocument,
  type Anchor,
  type IndexedBlock,
  type IndexedDocument,
  type PaperSource,
  type ShapeSelector,
} from '@papertree/anchoring';

import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';
import { PdfDocumentProvider } from '@/components/reader/PdfDocumentProvider';
import { SourcePane } from '@/components/reader/SourcePane';
import type { SelectionCapture } from '@/components/reader/useSelectionCapture';

/* ─────────────────────────── the pdf.js fake, and only pdf.js ─────────────────────────── */

interface FakeItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  /** Which IR block the fake emitted it for — the TEST's bookkeeping; the code never reads it. */
  sourceBlock?: string;
}

/** Filled per-test from the fixture, so the fake page emits items that really are on that page. */
let ITEMS_BY_PAGE = new Map<number, FakeItem[]>();
let PAGE_SIZES = new Map<number, { width: number; height: number }>();

class FakeTextLayer {
  readonly textDivs: HTMLElement[] = [];
  #source: { items: FakeItem[] };
  #container: HTMLElement;

  constructor({ textContentSource, container }: { textContentSource: { items: FakeItem[] }; container: HTMLElement }) {
    this.#source = textContentSource;
    this.#container = container;
  }

  render(): Promise<void> {
    // One span per item, appended in order — the same contract as pdf.js's `#appendText`.
    for (const item of this.#source.items) {
      const span = document.createElement('span');
      span.textContent = item.str;
      this.#container.append(span);
      this.textDivs.push(span);
    }
    return Promise.resolve();
  }

  cancel(): void {
    /* nothing in flight */
  }
}

vi.mock('@/lib/pdf/worker', () => ({
  getPdfjs: () =>
    Promise.resolve({
      version: '5.7.284',
      TextLayer: FakeTextLayer,
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: PAGE_SIZES.size,
          getPage: (n: number) => {
            const index = n - 1;
            const size = PAGE_SIZES.get(index) ?? { width: 612, height: 792 };
            return Promise.resolve({
              pageNumber: n,
              rotate: 0,
              userUnit: 1,
              view: [0, 0, size.width, size.height],
              getViewport: ({ scale }: { scale: number }) => ({
                width: size.width * scale,
                height: size.height * scale,
                scale,
                rotation: 0,
                convertToPdfPoint: (x: number, y: number) => [x / scale, size.height - y / scale],
              }),
              render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
              getTextContent: () => Promise.resolve({ items: ITEMS_BY_PAGE.get(index) ?? [], styles: {} }),
              cleanup: () => undefined,
            });
          },
          destroy: () => Promise.resolve(),
        }),
        destroy: () => Promise.resolve(),
      }),
    }),
}));

/* ────────────────────────────── fixture → fake pdf.js items ────────────────────────────── */

/**
 * Emit one item per IR SPAN, positioned from that span's own bbox.
 *
 * Deliberately a coarser segmentation than pdf.js's — an IR span is a whole line where pdf.js emits
 * words — because the mapping must not depend on the two agreeing. If `stampTextLayer` only worked
 * when the segmentations matched, this test would pass and the product would still be broken; the
 * real-pdf.js coverage numbers live in `test/stamp.spec.ts`, which is the other half of this pair.
 */
function itemsFor(doc: IndexedDocument, pageIndex: number): FakeItem[] {
  const page = doc.pages.find((p) => p.index === pageIndex);
  const height = page?.height ?? 792;
  const out: FakeItem[] = [];

  for (const block of doc.byPage.get(pageIndex) ?? []) {
    if (block.text.length === 0) continue;
    const chars = Array.from(block.text);
    for (const span of block.spans) {
      const text = chars.slice(span.start, span.end).join('').replace(/\n/gu, ' ');
      if (text.trim() === '') continue;
      const [x0, y0, x1, y1] = span.bbox;
      out.push({
        str: text,
        // IR y is top-down; raw PDF y is bottom-up. This is the inverse of what `pdfRectToIr` does,
        // which is the point: the round trip has to land back on the same span.
        transform: [1, 0, 0, 1, x0, height - y1],
        width: x1 - x0,
        height: y1 - y0,
        sourceBlock: block.id,
      });
    }
  }
  return out;
}

/* ──────────────────────────────────────── the test ──────────────────────────────────────── */

const SLUG = 'attention-is-all-you-need';

/**
 * `process.cwd()` and not `import.meta.url`: under happy-dom `import.meta.url` is an `http://`
 * document URL, and `fileURLToPath` rejects it. vitest runs with `apps/web` as the working
 * directory, which is stable and is what the other specs rely on too.
 */
async function loadFixtureDoc(): Promise<IndexedDocument> {
  const { readFileSync } = await import('node:fs');
  const paper = JSON.parse(
    readFileSync(`${process.cwd()}/../../packages/document-ir/fixtures/${SLUG}.paperir.json`, 'utf8'),
  ) as PaperSource;
  return indexDocument(paper, 'capture-wire.spec');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});


function renderPane(
  doc: IndexedDocument,
  overrides: {
    readonly onCreateHighlight?: (capture: SelectionCapture) => void;
    readonly onViewportResize?: (size: { width: number; height: number }) => void;
    readonly actions?: Partial<ReaderActions>;
  } = {},
) {
  const actions: ReaderActions = {
    openExplain: overrides.actions?.openExplain ?? (() => undefined),
    sendToCanvas: overrides.actions?.sendToCanvas ?? (async () => undefined),
    focusAnchor: overrides.actions?.focusAnchor ?? (() => undefined),
  };
  return render(
    <PdfDocumentProvider src="fixture://paper.pdf">
      <ReaderActionsProvider value={actions}>
        <SourcePane
          doc={doc}
          zoom={1}
          highlights={[]}
          onCreateHighlight={overrides.onCreateHighlight ?? (() => undefined)}
          highlightUnavailableReason={null}
          onActivateHighlight={() => undefined}
          activeHighlightId={null}
          flash={null}
          narrow={false}
          onViewportResize={overrides.onViewportResize ?? (() => undefined)}
          onSelectionChange={() => undefined}
          documentRef={{ current: null }}
          initialPosition={null}
          onPositionChange={() => undefined}
        />
      </ReaderActionsProvider>
    </PdfDocumentProvider>,
  );
}

async function stampedSpan(block: IndexedBlock): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector(`[data-block-id="${block.id}"][data-cp-start]`);
    if (found === null) throw new Error('text layer not stamped yet');
    return found as HTMLElement;
  });
}

describe('reader/capture-wire.spec — a DOM selection becomes an anchor', () => {
  let doc: IndexedDocument;
  let target: IndexedBlock;

  beforeEach(async () => {
    doc = await loadFixtureDoc();
    ITEMS_BY_PAGE = new Map(doc.pages.map((p) => [p.index, itemsFor(doc, p.index)]));
    PAGE_SIZES = new Map(doc.pages.map((p) => [p.index, { width: p.width, height: p.height }]));

    const found = doc.blocks.find(
      (b) => b.type === 'paragraph' && b.spans.length > 2 && b.textCodePoints.length > 200,
    );
    if (found === undefined) throw new Error('fixture has no multi-span paragraph');
    target = found;
  });

  it('selecting text in the paper surfaces the selection toolbar', async () => {
    renderPane(doc);
    const span = await stampedSpan(target);
    // The stamp is the precondition, asserted rather than assumed.
    expect(span.getAttribute('data-cp-start')).not.toBeNull();
    expect(span.getAttribute('data-item-index')).not.toBeNull();

    selectWithin(span);
    const toolbar = await screen.findByRole('toolbar', { name: 'Selection actions' });
    // NOT inside the page's overlay slot (pointer-events: none, overflow clipped): the baseline bug.
    expect(toolbar.closest('[data-papertree-overlay-slot]')).toBeNull();
    expect(toolbar.closest('[data-papertree-floating]')).not.toBeNull();
  });

  it('reports the scroller box upward, so a fit-zoom mode has something to resolve against', async () => {
    const sizes: { width: number; height: number }[] = [];
    renderPane(doc, { onViewportResize: (size) => sizes.push({ ...size }) });
    await waitFor(() => {
      expect(sizes.length, 'the scroller never reported its box').toBeGreaterThan(0);
    });
    expect(sizes[0]).toHaveProperty('width');
    expect(sizes[0]).toHaveProperty('height');
  });

  it('a CLICK on Highlight hands the workspace anchors on the selected block, with item-geometry quads', async () => {
    const captured: SelectionCapture[] = [];
    renderPane(doc, { onCreateHighlight: (capture) => captured.push(capture) });
    const span = await stampedSpan(target);

    selectWithin(span);
    fireEvent.click(await screen.findByRole('button', { name: 'Highlight' }));

    await waitFor(() => {
      expect(captured.length).toBeGreaterThan(0);
    });
    const anchor = captured[0]?.anchor as Anchor;
    expect(JSON.stringify(anchor)).toContain(target.id);
    expect(anchor.doc.textStreamId).toBe('capture-wire.spec');
    const types = anchor.selectors.map((s) => s.type);
    expect(types).toEqual(expect.arrayContaining(['BlockSelector', 'PageSelector', 'TextQuoteSelector', 'ShapeSelector']));
    // The quads are the SELECTED item's box, not the block polygon (the 17x over-paint).
    const shape = anchor.selectors.find((s): s is ShapeSelector => s.type === 'ShapeSelector') as ShapeSelector;
    const [bx0, , bx1] = target.bbox;
    const area = (q: readonly number[]) => ((q[2] ?? 0) - (q[0] ?? 0)) * ((q[3] ?? 0) - (q[1] ?? 0));
    const selectedArea = shape.quads.reduce((sum, q) => sum + area(q), 0);
    expect(selectedArea).toBeLessThan(area(target.bbox));
    for (const quad of shape.quads) {
      expect(quad[0]).toBeGreaterThanOrEqual(bx0 - 1);
      expect(quad[2]).toBeLessThanOrEqual(bx1 + 1);
    }
  });

  it('one selection across a paragraph break is ONE capture with an anchor per block', async () => {
    const next = doc.blocks.find(
      (b) => b.readingIndex > target.readingIndex && b.pageIndex === target.pageIndex && b.type === 'paragraph' && b.spans.length > 0,
    );
    if (next === undefined) throw new Error('fixture has no second paragraph on the page');
    const captured: SelectionCapture[] = [];
    renderPane(doc, { onCreateHighlight: (capture) => captured.push(capture) });
    const from = await stampedSpan(target);
    const to = await stampedSpan(next);
    const range = document.createRange();
    range.setStart(from.firstChild as Text, 0);
    range.setEnd(to.firstChild as Text, Math.min(10, (to.textContent ?? '').length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    fireEvent.pointerUp(to);
    fireEvent.click(await screen.findByRole('button', { name: 'Highlight' }));
    await waitFor(() => expect(captured.length).toBe(1));
    const blocks = captured[0]?.anchors.map(
      (a) => (a.selectors.find((s) => s.type === 'BlockSelector') as { blockId: string } | undefined)?.blockId,
    );
    expect(blocks?.[0]).toBe(target.id);
    expect(blocks).toContain(next.id);
    expect(new Set(captured[0]?.anchors.map((a) => a.id)).size).toBe(captured[0]?.anchors.length);
  });

  it('Ask sends the captured anchor and the quote to openExplain', async () => {
    const asked: { anchor: Anchor; quote: string }[] = [];
    renderPane(doc, { actions: { openExplain: (input) => asked.push(input) } });
    const span = await stampedSpan(target);
    selectWithin(span);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about this passage' }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]?.quote).toBe(span.textContent);
    expect(JSON.stringify(asked[0]?.anchor)).toContain(target.id);
  });

  it('an item the IR did not stamp is captured from item geometry, not guessed', async () => {
    // One extra item on the target's page that belongs to no IR block (a figure label, say).
    const page = target.pageIndex;
    const height = PAGE_SIZES.get(page)?.height ?? 792;
    ITEMS_BY_PAGE.get(page)?.push({ str: 'conv 7x7', transform: [9, 0, 0, 9, 20, height - 20], width: 30, height: 9 });
    const captured: SelectionCapture[] = [];
    renderPane(doc, { onCreateHighlight: (capture) => captured.push(capture) });
    const label = await waitFor(() => {
      const found = Array.from(document.querySelectorAll<HTMLElement>('[data-item-index]')).find(
        (el) => el.textContent === 'conv 7x7',
      );
      if (found === undefined) throw new Error('label not rendered yet');
      return found;
    });
    expect(label.getAttribute('data-block-id')).toBeNull();

    selectWithin(label);
    fireEvent.click(await screen.findByRole('button', { name: 'Highlight' }));
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const anchor = captured[0]?.anchor as Anchor;
    expect(anchor.doc.textStreamId).toBe('pdfjs@5.7.284/page-text');
    expect(anchor.selectors.map((s) => s.type)).toEqual(['PageSelector', 'TextQuoteSelector', 'ShapeSelector']);
    const shape = anchor.selectors.find((s): s is ShapeSelector => s.type === 'ShapeSelector') as ShapeSelector;
    // Inside the item's own box: x 20..50, baseline at IR y 20, 9 pt high (0.85 up, 0.2 down).
    expect(shape.quads).toHaveLength(1);
    const [x0, y0, x1, y1] = shape.quads[0] as readonly number[];
    expect([x0, y0, x1, y1].map((v) => Math.round((v ?? 0) * 1000) / 1000)).toEqual([20, 12.35, 50, 21.8]);
  });
});

/* ─────────────── review F1: one selection stores each glyph ONCE (s4-review.md §4) ─────────────── */

/** The fake items emitted for `block`, as indices into its page's item list. */
function itemIndicesOf(block: IndexedBlock): number[] {
  const items = ITEMS_BY_PAGE.get(block.pageIndex) ?? [];
  return items.flatMap((item, index) => (item.sourceBlock === block.id ? [index] : []));
}

/**
 * Make one item's text disagree with the IR, the way a ligature does on YOLO (the IR says "ﬁcing",
 * pdf.js says "ficing"): `stampTextLayer` still places it in the block by GEOMETRY
 * (`data-block-id`) but cannot give it an offset (`data-cp-start`) — an unstamped item inside a
 * stamped paragraph.
 */
function unstamp(block: IndexedBlock, which: number): FakeItem {
  const items = ITEMS_BY_PAGE.get(block.pageIndex) ?? [];
  const item = items[itemIndicesOf(block)[which] as number] as FakeItem;
  item.str = item.str.replace(/[a-z]/u, (c) => `${c}̇`);
  return item;
}

async function itemElement(str: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = Array.from(document.querySelectorAll<HTMLElement>('[data-item-index]')).find(
      (el) => el.textContent === str,
    );
    if (found === undefined) throw new Error(`item ${JSON.stringify(str.slice(0, 30))} not rendered yet`);
    return found;
  });
}

function selectBetween(from: HTMLElement, fromOffset: number, to: HTMLElement, toOffset: number): void {
  const range = document.createRange();
  range.setStart(from.firstChild as Text, fromOffset);
  range.setEnd(to.firstChild as Text, toOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.pointerUp(to);
}

function quadsOf(anchor: Anchor): readonly (readonly number[])[] {
  return (anchor.selectors.find((s): s is ShapeSelector => s.type === 'ShapeSelector')?.quads ?? []) as readonly (readonly number[])[];
}

function kindOf(anchor: Anchor): 'ir' | 'page-text' {
  return anchor.doc.textStreamId.startsWith('pdfjs@') ? 'page-text' : 'ir';
}

/**
 * The worst overlap between two DIFFERENT anchors' quads, as a fraction of the smaller quad. A
 * glyph stored twice is 1.0 (the reviewer's duplicate was the same box); two adjacent lines' glyph
 * bands touch by ~5 % of a line (descent 0.2 below one baseline, ascent 0.85 above the next).
 */
function worstCrossAnchorOverlap(anchors: readonly Anchor[]): number {
  const area = (q: readonly number[]) => Math.max(0, (q[2] ?? 0) - (q[0] ?? 0)) * Math.max(0, (q[3] ?? 0) - (q[1] ?? 0));
  let worst = 0;
  anchors.forEach((a, i) => {
    anchors.slice(i + 1).forEach((b) => {
      for (const p of quadsOf(a)) {
        for (const q of quadsOf(b)) {
          const inter = area([
            Math.max(p[0] ?? 0, q[0] ?? 0),
            Math.max(p[1] ?? 0, q[1] ?? 0),
            Math.min(p[2] ?? 0, q[2] ?? 0),
            Math.min(p[3] ?? 0, q[3] ?? 0),
          ]);
          const smaller = Math.min(area(p), area(q));
          if (smaller > 0) worst = Math.max(worst, inter / smaller);
        }
      }
    });
  });
  return worst;
}

describe('reader/capture-wire.spec — review F1: each selected glyph is stored once', () => {
  let doc: IndexedDocument;
  let target: IndexedBlock;

  beforeEach(async () => {
    doc = await loadFixtureDoc();
    ITEMS_BY_PAGE = new Map(doc.pages.map((p) => [p.index, itemsFor(doc, p.index)]));
    PAGE_SIZES = new Map(doc.pages.map((p) => [p.index, { width: p.width, height: p.height }]));
    const found = doc.blocks.find(
      (b) => b.type === 'paragraph' && b.spans.length > 2 && b.textCodePoints.length > 200,
    );
    if (found === undefined) throw new Error('fixture has no multi-span paragraph');
    target = found;
  });

  it('an unstamped line INSIDE a selected paragraph is part of the paragraph’s one anchor, not a second', async () => {
    const lines = itemIndicesOf(target);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const middle = unstamp(target, 1);
    const items = ITEMS_BY_PAGE.get(target.pageIndex) ?? [];
    const firstStr = (items[lines[0] as number] as FakeItem).str;
    const lastStr = (items[lines[lines.length - 1] as number] as FakeItem).str;

    const captured: SelectionCapture[] = [];
    renderPane(doc, { onCreateHighlight: (capture) => captured.push(capture) });
    const unstamped = await itemElement(middle.str);
    // The precondition, asserted: placed by geometry, no offset — the reviewer's "ﬁcing" line.
    expect(unstamped.getAttribute('data-block-id')).toBe(target.id);
    expect(unstamped.getAttribute('data-cp-start')).toBeNull();
    const first = await itemElement(firstStr);
    const last = await itemElement(lastStr);
    selectBetween(first, 0, last, (last.textContent ?? '').length);
    fireEvent.click(await screen.findByRole('button', { name: 'Highlight' }));
    await waitFor(() => expect(captured).toHaveLength(1));

    const anchors = captured[0]?.anchors ?? [];
    expect(anchors.map(kindOf)).toEqual(['ir']);
    // One quad per selected line, the unstamped one included, and none of them twice.
    expect(quadsOf(anchors[0] as Anchor)).toHaveLength(lines.length);
    expect(worstCrossAnchorOverlap(anchors)).toBeLessThan(0.25);
  });

  it('an unstamped LAST line, selected whole, joins its paragraph’s anchor (the text around it is known)', async () => {
    const lines = itemIndicesOf(target);
    const tail = unstamp(target, lines.length - 1);
    const items = ITEMS_BY_PAGE.get(target.pageIndex) ?? [];
    const firstStr = (items[lines[0] as number] as FakeItem).str;

    const captured: SelectionCapture[] = [];
    renderPane(doc, { onCreateHighlight: (capture) => captured.push(capture) });
    const first = await itemElement(firstStr);
    const last = await itemElement(tail.str);
    expect(last.getAttribute('data-cp-start')).toBeNull();
    selectBetween(first, 0, last, (last.textContent ?? '').length);
    fireEvent.click(await screen.findByRole('button', { name: 'Highlight' }));
    await waitFor(() => expect(captured).toHaveLength(1));

    const anchors = captured[0]?.anchors ?? [];
    expect(anchors.map(kindOf)).toEqual(['ir']);
    const quote = (anchors[0] as Anchor).selectors.find((s) => s.type === 'TextQuoteSelector') as
      | { exact: string }
      | undefined;
    // The range reaches the block's last glyph: the quote ends where the paragraph does.
    const squash = (value: string) => value.replace(/\s+/gu, ' ').trim();
    const text = squash(String.fromCodePoint(...target.textCodePoints));
    expect(squash(quote?.exact ?? '').endsWith(text.slice(-40))).toBe(true);
    expect(squash(quote?.exact ?? '').startsWith(text.slice(0, 40))).toBe(true);
    expect(quadsOf(anchors[0] as Anchor)).toHaveLength(lines.length);
  });

  it('an unstamped last line selected PART-way is its own page-text anchor, and its glyphs are in no other', async () => {
    const lines = itemIndicesOf(target);
    const tail = unstamp(target, lines.length - 1);
    const items = ITEMS_BY_PAGE.get(target.pageIndex) ?? [];
    const firstStr = (items[lines[0] as number] as FakeItem).str;

    const captured: SelectionCapture[] = [];
    renderPane(doc, { onCreateHighlight: (capture) => captured.push(capture) });
    const first = await itemElement(firstStr);
    const last = await itemElement(tail.str);
    const part = Math.floor((last.textContent ?? '').length / 2);
    selectBetween(first, 0, last, part);
    fireEvent.click(await screen.findByRole('button', { name: 'Highlight' }));
    await waitFor(() => expect(captured).toHaveLength(1));

    const anchors = captured[0]?.anchors ?? [];
    expect(anchors.map(kindOf)).toEqual(['ir', 'page-text']);
    expect(quadsOf(anchors[0] as Anchor)).toHaveLength(lines.length - 1);
    expect(quadsOf(anchors[1] as Anchor)).toHaveLength(1);
    expect(worstCrossAnchorOverlap(anchors)).toBeLessThan(0.25);
  });

  it('a mixed selection’s anchors come in reading order: paragraph, label, paragraph', async () => {
    const next = doc.blocks.find(
      (b) =>
        b.readingIndex > target.readingIndex &&
        b.pageIndex === target.pageIndex &&
        b.type === 'paragraph' &&
        b.spans.length > 0,
    );
    if (next === undefined) throw new Error('fixture has no second paragraph on the page');
    const items = ITEMS_BY_PAGE.get(target.pageIndex) ?? [];
    const lines = itemIndicesOf(target);
    const nextLines = itemIndicesOf(next);
    // A figure label between the two paragraphs in CONTENT order, in the page's top margin by
    // geometry, so no block's band holds it.
    const height = PAGE_SIZES.get(target.pageIndex)?.height ?? 792;
    const label: FakeItem = { str: 'Figure 9: a label', transform: [9, 0, 0, 9, 20, height - 20], width: 60, height: 9 };
    items.splice((lines[lines.length - 1] as number) + 1, 0, label);
    const firstStr = (items[lines[0] as number] as FakeItem).str;
    const nextStr = (items[(nextLines[0] as number) + 1] as FakeItem).str;

    const captured: SelectionCapture[] = [];
    renderPane(doc, { onCreateHighlight: (capture) => captured.push(capture) });
    const from = await itemElement(firstStr);
    const to = await itemElement(nextStr);
    selectBetween(from, 0, to, Math.min(10, (to.textContent ?? '').length));
    fireEvent.click(await screen.findByRole('button', { name: 'Highlight' }));
    await waitFor(() => expect(captured).toHaveLength(1));

    const anchors = captured[0]?.anchors ?? [];
    const blockOf = (a: Anchor) =>
      (a.selectors.find((s) => s.type === 'BlockSelector') as { blockId: string } | undefined)?.blockId ?? 'page-text';
    const order = anchors.map(blockOf);
    const labelAt = order.indexOf('page-text');
    expect(order[0]).toBe(target.id);
    expect(labelAt).toBeGreaterThan(0);
    expect(order.indexOf(next.id)).toBeGreaterThan(labelAt);
    expect(worstCrossAnchorOverlap(anchors)).toBeLessThan(0.25);
  });
});

describe('reader/capture-wire.spec — review F2: a selection longer than one highlight may hold', () => {
  it('says so in the bar (not a tooltip), disables Highlight, and sends nothing', async () => {
    const doc = await loadFixtureDoc();
    ITEMS_BY_PAGE = new Map(doc.pages.map((p) => [p.index, itemsFor(doc, p.index)]));
    PAGE_SIZES = new Map(doc.pages.map((p) => [p.index, { width: p.width, height: p.height }]));
    // The fullest page, with a stray label (no block holds it) after every line: every line's
    // block and every label is its own target, which is well past 64 on one page.
    const [pageIndex, items] = Array.from(ITEMS_BY_PAGE.entries()).sort((a, b) => b[1].length - a[1].length)[0] as [
      number,
      FakeItem[],
    ];
    const height = PAGE_SIZES.get(pageIndex)?.height ?? 792;
    const lines = items.length;
    for (let i = lines - 1; i >= 0; i -= 1) {
      items.splice(i + 1, 0, { str: `label ${String(i)}`, transform: [6, 0, 0, 6, 4, height - 6], width: 20, height: 6 });
    }
    const captured: SelectionCapture[] = [];
    renderPane(doc, { onCreateHighlight: (capture) => captured.push(capture) });
    const first = await itemElement((items[0] as FakeItem).str);
    const last = await itemElement((items[items.length - 1] as FakeItem).str);
    selectBetween(first, 0, last, (last.textContent ?? '').length);

    const button = await screen.findByRole('button', { name: 'Highlight' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    const toolbar = screen.getByRole('toolbar', { name: 'Selection actions' });
    expect(toolbar.textContent).toMatch(/covers \d+ passages; one highlight holds up to 64/);
    const noteId = button.getAttribute('aria-describedby');
    expect(noteId).not.toBeNull();
    expect(document.getElementById(noteId ?? '')?.textContent).toMatch(/up to 64/);
    fireEvent.click(button);
    expect(captured).toEqual([]);
    // Ask and Copy still work on it.
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

/**
 * Select this element's text, then fire what a real pointer fires.
 *
 * BOTH events, in this order, because the hook listens to both and for different devices:
 * `selectionchange` is the only signal an iOS handle-drag emits, and `pointerup` short-circuits the
 * 180 ms debounce for everything with a pointer. Firing only one would test half the hook.
 */
function selectWithin(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.pointerUp(element);
}
