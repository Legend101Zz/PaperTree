'use client';

/**
 * reader/SourcePane — the paper itself, and the only surface a highlight can be born on.
 *
 * Extracted from `ReaderWorkspace` when issue #58 gave it hooks of its own. It is a component with
 * three collaborators to coordinate rather than a JSX fragment, and it is the unit
 * `test/capture-wire.spec.tsx` drives — a testing-only export from the route file would have been
 * the same thing with a worse name.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { Anchor, IndexedDocument, Resolution } from '@papertree/anchoring';

import { type DocumentHandle, type DocumentRef } from './documentHandle';
import { HighlightOverlay } from '@/components/reader/HighlightOverlay';
import { PdfDocumentProvider } from '@/components/reader/PdfDocumentProvider';
import type { TextLayerInfo } from '@/components/reader/PdfPage';
import { SelectionToolbar } from '@/components/reader/SelectionToolbar';
import { stampTextLayer } from '@/components/reader/stampTextLayer';
import { useSelectionCapture } from '@/components/reader/useSelectionCapture';
import { VirtualPageList, type VirtualPageListHandle } from '@/components/reader/VirtualPageList';

export interface SourcePaneAnchor {
  readonly anchor: Anchor;
  readonly resolution: Resolution;
}

export interface SourcePaneProps {
  readonly doc: IndexedDocument;
  /**
   * A same-origin path (fixture) or the PDF bytes (API — the file endpoint needs a bearer header
   * that pdf.js cannot send). `null` while the fetch is in flight; the pane renders its shell and
   * `PdfDocumentProvider` opens nothing until it arrives.
   */
  readonly pdfSource: string | ArrayBuffer | null;
  readonly zoom: number;
  readonly anchors: readonly SourcePaneAnchor[];
  readonly onAnchorCaptured: (anchor: Anchor) => void;
  /**
   * Forwarded from the scroller so the shell can re-resolve a fit-zoom mode.
   *
   * REQUIRED, not optional, and that is the point. It was optional for one commit and the shell
   * silently never supplied it, so `resolveZoom` ran with a container of zero and "fit width"
   * clamped to `MIN_ZOOM` — a 25% page, in a reader, with no error anywhere. That is the same
   * declared-and-never-read shape as #58's `onAnchorCaptured`. Making it required moves the check
   * from a test that has to think of it to the compiler, which cannot forget.
   */
  readonly onViewportResize: (size: { readonly width: number; readonly height: number }) => void;
  /**
   * Populated by this pane while it is mounted, and nulled when it unmounts — #64.
   *
   * REQUIRED, not optional. `DocumentSlot` renders this component in Source and Split modes and
   * both call sites in the shell reach through this ref; before #64 the ref existed, was passed
   * as far as `DocumentSlot`, and was never handed down here, so every citation click was a
   * no-op. A required prop makes the next omission a compile error.
   */
  readonly documentRef: DocumentRef;
}

/**
 * The paper surface, and the only place a highlight is born.
 *
 * THREE THINGS HAVE TO MEET HERE and they met nowhere before issue #58: the IR (which knows blocks
 * and offsets), the text layer (which knows glyphs), and the anchor writer. `useSelectionCapture`
 * and `SelectionToolbar` both existed, fully written and unit-tested, and were imported by nothing —
 * `onAnchorCaptured` was declared on `ViewProps`, supplied by `ReaderWorkspace`, and read by no
 * descendant. The reader could paint highlights and resolve them across a reparse; a user could not
 * make one.
 *
 * THE TOOLBAR IS RENDERED INSIDE THE PAGE'S OVERLAY SLOT, not in the viewport. Its position comes
 * from `irExtent × zoom × userUnit`, which is a position in the page's own scaled coordinate box —
 * so it tracks the page through zoom and scroll with no listener, and there is no `innerWidth`
 * anywhere in the path. It is rendered only into the page the selection is on; the overlay slot is
 * `pointer-events: none`, and the toolbar opts back in.
 */
export function SourcePane(props: SourcePaneProps) {
  const { doc, onAnchorCaptured } = props;
  const listRef = useRef<VirtualPageListHandle | null>(null);
  // State, not a ref: the hook must re-bind when the scroller mounts, and a ref write does not
  // re-render. Null until then, which is exactly when the hook is meant to be inert.
  const [root, setRoot] = useState<HTMLElement | null>(null);

  const { selection, capture, clear } = useSelectionCapture({
    doc,
    root,
    client: 'papertree-web/reader',
    mode: 'source',
    provenanceClass: 'source',
  });

  /**
   * Stamp the text layer as each page renders.
   *
   * Re-stamps on every rebuild, which is every zoom step — the divs are new objects each time, so
   * anything cached against the old ones would be stale. `stampTextLayer` is idempotent for that
   * reason.
   */
  const onTextLayer = useCallback(
    (info: TextLayerInfo) => {
      const blocks = doc.byPage.get(info.pageIndex) ?? [];
      if (blocks.length === 0) return;
      stampTextLayer({
        divs: info.divs,
        items: info.items,
        page: {
          view: info.page.view,
          rotate: info.page.rotate,
          userUnit: doc.pages[info.pageIndex]?.user_unit ?? 1,
        },
        blocks,
      });
    },
    [doc],
  );

  /**
   * Commit the selection.
   *
   * EVERY anchor, not just the first. A selection that crosses a paragraph boundary is genuinely
   * more than one target, and `capture()` returns one anchor per block precisely so that the second
   * one is not dropped in silence — the failure mode this epic exists to remove.
   */
  const onHighlight = useCallback(() => {
    const captured = capture('text');
    if (captured === null) return;
    for (const anchor of captured.anchors) onAnchorCaptured(anchor);
    clear();
  }, [capture, clear, onAnchorCaptured]);

  const onCopy = useCallback(() => {
    const text = selection?.text ?? '';
    if (text === '') return;
    // Best-effort: a denied clipboard permission must not take the toolbar down with it.
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    clear();
  }, [selection, clear]);

  /**
   * The block-id -> (pageIndex, bbox) translation, done HERE because `doc.byId` is in this scope
   * and not the shell's — #64 step 2. `VirtualPageList`'s imperative handle already implements
   * both scrolls (`VirtualPageList.tsx:365, 367`); nothing new is being built one layer down.
   */
  const documentHandle = useMemo<DocumentHandle>(
    () => ({
      scrollToBlock(blockId) {
        const block = doc.byId.get(blockId);
        // A stale id resolves to nothing. Not a throw: block ids are content-derived, so any edit
        // to a block retires its id (AGENTS.md §4), and a citation minted against an older parse
        // arriving here is expected. Recovering from that is the anchoring ladder's job.
        if (block === undefined) return;
        listRef.current?.scrollToBlock(block.pageIndex, block.bbox, { behavior: 'smooth' });
      },
      scrollToPage(pageIndex) {
        listRef.current?.scrollToPage(pageIndex, { behavior: 'smooth' });
      },
    }),
    [doc],
  );

  return (
    <PdfDocumentProvider src={props.pdfSource}>
      <VirtualPageList
        ref={(handle) => {
          listRef.current = handle;
          // #64: the shell's seam terminates HERE. `listRef` was written and never read for two
          // epics; this is the line that makes it reachable. A ref callback runs during commit,
          // BEFORE effects, which is what lets the shell flush a deferred scroll in an effect
          // keyed on `mode` and find the handle already installed.
          props.documentRef.current = handle === null ? null : documentHandle;
          setRoot(handle?.getScrollElement() ?? null);
        }}
        zoom={props.zoom}
        className="h-full"
        onTextLayer={onTextLayer}
        onViewportResize={props.onViewportResize}
        renderOverlay={(pageIndex, meta) => (
          <>
            <HighlightOverlay
              pageIndex={pageIndex}
              pageWidth={meta.width}
              pageHeight={meta.height}
              userUnit={meta.userUnit}
              zoom={props.zoom}
              items={props.anchors.map((record) => ({
                anchorId: record.anchor.id,
                resolution: record.resolution,
              }))}
            />
            {selection !== null && selection.pageIndex === pageIndex && selection.irExtent !== null ? (
              <SelectionToolbar
                irExtent={selection.irExtent}
                zoom={props.zoom}
                userUnit={meta.userUnit}
                onHighlight={onHighlight}
                onCopy={onCopy}
                // Epic 5 owns the canvas and it is stood down (#43). Clearing the selection is the
                // honest response to a button whose destination does not exist yet.
                onSendToCanvas={clear}
              />
            ) : null}
          </>
        )}
      />
    </PdfDocumentProvider>
  );
}
