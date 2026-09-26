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
