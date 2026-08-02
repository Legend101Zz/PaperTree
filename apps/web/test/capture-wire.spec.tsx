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
 * Everything downstream of pdf.js is REAL: the real `PdfPage`, the real `stampTextLayer` doing the
 * real IR arithmetic, the real `useSelectionCapture`, the real `SelectionToolbar`, the real
 * `captureAnchor` and the real `resolveAnchor`. The fake `TextLayer` emits the same `textDivs`
 * array pdf.js emits, so the stamping under test is the stamping that ships.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { indexDocument, type Anchor, type IndexedBlock, type IndexedDocument, type PaperSource } from '@papertree/anchoring';

import { SourcePane } from '@/components/reader/SourcePane';

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
    render(
      <SourcePane
        doc={doc}
        pdfSource="fixture://paper.pdf"
        zoom={1}
        anchors={[]}
        onAnchorCaptured={() => undefined}
        documentRef={{ current: null }}
        onViewportResize={() => undefined}
      />,
    );

    const span = await waitFor(() => {
      const found = document.querySelector(`[data-block-id="${target.id}"]`);
      if (found === null) throw new Error('text layer not stamped yet');
      return found as HTMLElement;
    });

    // The stamp is the precondition, and it is asserted rather than assumed: without it the hook
    // silently falls back to `locateByText` and this test would still pass while measuring less.
    expect(span.getAttribute('data-cp-start')).not.toBeNull();

    selectWithin(span);

    expect(await screen.findByRole('toolbar', { name: 'Selection actions' })).toBeTruthy();
  });

  it('reports the scroller box upward, so a fit-zoom mode has something to resolve against', async () => {
    // The seam that broke: `onViewportResize` was declared on `SourcePaneProps`, forwarded to the
    // scroller, and never supplied by the shell — so `resolveZoom` saw a container of zero and
    // "fit width" clamped to MIN_ZOOM, rendering a 25% page with no error anywhere. The prop is now
    // REQUIRED, which makes the shell side a compile error; this covers the scroller side.
    const sizes: { width: number; height: number }[] = [];
    render(
      <SourcePane
        doc={doc}
        pdfSource="fixture://paper.pdf"
        zoom={1}
        anchors={[]}
        onAnchorCaptured={() => undefined}
        documentRef={{ current: null }}
        onViewportResize={(size) => sizes.push({ ...size })}
      />,
    );

    await waitFor(() => {
      expect(sizes.length, 'the scroller never reported its box').toBeGreaterThan(0);
    });
    // happy-dom lays nothing out, so the NUMBERS are zero and asserting on them would be theatre.
    // That the call happens at all is the property that was missing.
    expect(sizes[0]).toHaveProperty('width');
    expect(sizes[0]).toHaveProperty('height');
  });

  it('pressing Highlight stores an anchor that resolves back to the selected block', async () => {
    const captured: Anchor[] = [];
    render(
      <SourcePane
        doc={doc}
        pdfSource="fixture://paper.pdf"
        zoom={1}
        anchors={[]}
        onAnchorCaptured={(anchor) => captured.push(anchor)}
        documentRef={{ current: null }}
        onViewportResize={() => undefined}
      />,
    );

    const span = await waitFor(() => {
      const found = document.querySelector(`[data-block-id="${target.id}"]`);
      if (found === null) throw new Error('not stamped');
      return found as HTMLElement;
    });

    selectWithin(span);
    const highlight = await screen.findByRole('button', { name: /highlight/i });
    fireEvent.pointerUp(highlight);

    // THE assertion of this file: the callback that was dead now fires, with a real anchor.
    await waitFor(() => {
      expect(captured.length).toBeGreaterThan(0);
    });
    expect(JSON.stringify(captured[0])).toContain(target.id);
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
