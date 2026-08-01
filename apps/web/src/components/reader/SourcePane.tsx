'use client';

/**
 * reader/SourcePane — the paper itself, and the only surface a highlight can be born on.
 *
 * Extracted from `ReaderWorkspace` when issue #58 gave it hooks of its own. It is a component with
 * three collaborators to coordinate rather than a JSX fragment, and it is the unit
 * `test/capture-wire.spec.tsx` drives — a testing-only export from the route file would have been
 * the same thing with a worse name.
 */

import { useCallback, useRef, useState } from 'react';

import type { Anchor, IndexedDocument, Resolution } from '@papertree/anchoring';

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
  readonly pdfUrl: string;
  readonly zoom: number;
  readonly anchors: readonly SourcePaneAnchor[];
  readonly onAnchorCaptured: (anchor: Anchor) => void;
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

  return (
    <PdfDocumentProvider src={props.pdfUrl}>
      <VirtualPageList
        ref={(handle) => {
          listRef.current = handle;
          setRoot(handle?.getScrollElement() ?? null);
        }}
        zoom={props.zoom}
        className="h-full"
        onTextLayer={onTextLayer}
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
