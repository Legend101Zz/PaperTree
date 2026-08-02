/**
 * reader/citation-scroll.spec — a click on a citation moves the document. Issue #64.
 *
 * WHY THIS FILE EXISTS RATHER THAN A UNIT TEST, in #64's own words:
 *
 *     "A test that STARTS WHERE THE USER STARTS: click a Navigator entry, assert the list
 *      scrolled. Not a unit test of `VirtualPageList.scrollToBlock` — that one already passes,
 *      and its passing is why this was invisible."
 *
 * `VirtualPageList.scrollToBlock` worked the whole time. `offsetForBlock` is pure and covered by
 * `perf.spec`. What was broken was the WIRE: `DocumentSlot` never forwarded `documentRef` to
 * `SourcePane`, `SourcePane` never read its own `listRef`, and the seam's `?.` made the resulting
 * dead click silent. Every test in the repo passed.
 *
 * WHAT THIS ASSERTS, AND WHAT IT HONESTLY CANNOT
 *
 * `apps/web` runs on happy-dom (`vitest.config.ts`), which does NO LAYOUT: every element has zero
 * height, `scrollTo` does not move `scrollTop`, and `IntersectionObserver` never fires. A test
 * asserting `container.scrollTop > 0` here would be asserting a number happy-dom fabricates, which
 * is the vacuous green `AGENTS.md` §2 is about.
 *
 * So the observation point is the SCROLLER'S OWN IMPERATIVE HANDLE — the last thing on the path
 * that is this app's code rather than the browser's. A spy `VirtualPageList` records what it was
 * asked to do. The chain under test is therefore:
 *
 *     Navigator entry click
 *       -> onNavigateToBlock            (ReaderWorkspace.tsx, NavigatorSlot)
 *       -> onShowSource([blockId])
 *       -> requestScroll({kind:'block'})
 *       -> documentRef.current          <- THE WIRE. null before #64, forever.
 *       -> SourcePane's DocumentHandle
 *       -> doc.byId.get(blockId)        <- the (pageIndex, bbox) translation
 *       -> VirtualPageListHandle.scrollToBlock(pageIndex, bbox)
 *
 * Everything but the final CSS scroll, and the final CSS scroll is what happy-dom cannot model.
 * `packages/anchoring`'s zoom.spec and `perf.spec` cover the arithmetic that follows.
 *
 * WHAT CATCHES WHAT — every one of these was watched, and they do not all land here:
 *
 *   the missing DocumentSlot forward   COMPILER. `documentRef` is required on `SourcePaneProps`,
 *                                      so deleting either forward is
 *                                      `TS2741: Property 'documentRef' is missing`. That is #64
 *                                      step 4 working, and it is a stronger guard than a test —
 *                                      it cannot be skipped or left unrun.
 *   the missing SourcePane assignment  THIS FILE:
 *                                      "SourcePane did not populate documentRef — that is #64"
 *   resolving every block to page 0    THIS FILE:
 *                                      "expected [{ page: +0 }] to deeply equal [{ page: 1 }]"
 *   the `page:${n}` sentinel returning  THIS FILE, last test.
 *
 * NOT COVERED HERE, and said plainly rather than left to be assumed: the Guided-mode DEFERRAL.
 * `showSource` from Guided switches to Split and the pane does not exist until that commits, so
 * the shell stores the request and an effect keyed on `mode` flushes it. Exercising that needs the
 * whole `ReaderWorkspace` tree — pdf.js, the Inspector, the Navigator — mounted in happy-dom, which
 * is a fixture larger than the behaviour. It is covered by the type system only. If it regresses,
 * the symptom is "a citation click in Guided mode does nothing the first time", and the place to
 * look is the `useEffect` keyed on `mode` in `ReaderWorkspace.tsx`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forwardRef, useImperativeHandle } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { indexDocument, type PaperSource } from '@papertree/anchoring';

const FIXTURE = join(process.cwd(), '../../packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json');

/** Everything the scroller was asked to do, in order. */
const calls: { readonly method: 'block' | 'page'; readonly page: number; readonly bbox?: readonly number[] }[] =
  [];

// `VirtualPageList` renders pdf.js, which needs a real PDF, a worker and a layout engine. None of
// those exist here and none of them is what #64 is about — so the SCROLLER is replaced and every
// other link in the chain is the real one. The spy implements the same imperative handle, so a
// signature change on either side is a type error rather than a silently unrecorded call.
vi.mock('@/components/reader/VirtualPageList', () => ({
  VirtualPageList: forwardRef<unknown, Record<string, unknown>>(function VirtualPageListSpy(_props, ref) {
    useImperativeHandle(ref, () => ({
      scrollToPage(pageIndex: number) {
        calls.push({ method: 'page', page: pageIndex });
      },
      scrollToBlock(pageIndex: number, bbox: readonly number[]) {
        calls.push({ method: 'block', page: pageIndex, bbox });
      },
      getVisiblePages: () => ({ first: 0, last: 0 }),
      getScrollElement: () => null,
    }));
    return <div data-testid="scroller" />;
  }),
}));

// pdf.js is loaded by `PdfDocumentProvider` at module scope in a worker; nothing here needs a
// rendered page, only the tree around it.
vi.mock('@/components/reader/PdfDocumentProvider', () => ({
  PdfDocumentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  pageUnitSize: () => ({ width: 612, height: 792 }),
  usePdfDocument: () => ({ document: null, pages: [], error: null }),
}));

const paper = JSON.parse(readFileSync(FIXTURE, 'utf8')) as PaperSource & { ir_version?: string };
const doc = indexDocument(paper, `fixture/${paper.ir_version ?? 'unknown'}`);

describe('reader/citation-scroll.spec — clicking a citation moves the page (#64)', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('the fixture is real, so this file is not measuring a stub', () => {
    // Non-vacuity. A doc with no blocks would let every assertion below pass by never navigating.
    expect(doc.blocks.length).toBeGreaterThan(50);
    expect(doc.byId.size).toBe(doc.blocks.length);
  });

  it('a Navigator entry click reaches the scroller with the right page and bbox', async () => {
    const { SourcePane } = await import('@/components/reader/SourcePane');
    const target = doc.blocks.find((block) => block.pageIndex > 0);
    expect(target, 'the fixture must have a block off page 0, or this asserts nothing').toBeDefined();

    const ref: { current: { scrollToBlock(id: string): void; scrollToPage(n: number): void } | null } = {
      current: null,
    };
    render(
      <SourcePane
        doc={doc}
        pdfSource="fixture://paper.pdf"
        zoom={1}
        anchors={[]}
        onAnchorCaptured={() => undefined}
        onViewportResize={() => undefined}
        documentRef={ref}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('scroller')).toBeTruthy());

    // THE WIRE. `null` here on `main` before #64, in every mode, forever.
    expect(ref.current, 'SourcePane did not populate documentRef — that is #64').not.toBeNull();

    ref.current?.scrollToBlock(target!.id);
    expect(calls).toEqual([{ method: 'block', page: target!.pageIndex, bbox: target!.bbox }]);
  });

  it('resolves the block id to ITS page and bbox, not to page 0', () => {
    // The translation is the half a wire-only test would miss: forwarding the ref but resolving
    // the wrong block scrolls confidently to the wrong place, which is worse than not scrolling.
    const target = doc.blocks.find((block) => block.pageIndex > 0);
    expect(target!.pageIndex).toBeGreaterThan(0);
    expect(target!.bbox).toHaveLength(4);
  });

  it('an unknown block id is a no-op, not a throw', async () => {
    const { SourcePane } = await import('@/components/reader/SourcePane');
    const ref: { current: { scrollToBlock(id: string): void; scrollToPage(n: number): void } | null } = {
      current: null,
    };
    render(
      <SourcePane
        doc={doc}
        pdfSource="fixture://paper.pdf"
        zoom={1}
        anchors={[]}
        onAnchorCaptured={() => undefined}
        onViewportResize={() => undefined}
        documentRef={ref}
      />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());

    // Block ids are content-derived, so an edit retires them (AGENTS.md §4) and a citation from an
    // older parse landing here is expected, not exceptional.
    expect(() => ref.current?.scrollToBlock('blk_notarealblockid')).not.toThrow();
    expect(calls).toEqual([]);
  });

  it('scrollToPage is its own method — the `page:${n}` sentinel is gone', async () => {
    const { SourcePane } = await import('@/components/reader/SourcePane');
    const ref: { current: { scrollToBlock(id: string): void; scrollToPage(n: number): void } | null } = {
      current: null,
    };
    render(
      <SourcePane
        doc={doc}
        pdfSource="fixture://paper.pdf"
        zoom={1}
        anchors={[]}
        onAnchorCaptured={() => undefined}
        onViewportResize={() => undefined}
        documentRef={ref}
      />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());

    ref.current?.scrollToPage(2);
    expect(calls).toEqual([{ method: 'page', page: 2 }]);

    // And the old sentinel resolves to nothing, which is what it always would have done: no block
    // id matches `page:2`. Pinned so nobody reintroduces the string contract.
    calls.length = 0;
    ref.current?.scrollToBlock('page:2');
    expect(calls).toEqual([]);
  });
});
