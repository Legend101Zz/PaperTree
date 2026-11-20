import { useCallback, useEffect, useRef, useState } from 'react';
import {
  extentOf,
  resolveAnchor,
  sourcePaint,
  type Anchor,
  type IndexedDocument,
} from '@papertree/anchoring';

import {
  applyScroll,
  type DocumentHandle,
  type PendingScroll,
} from '@/components/reader/documentHandle';
import {
  FLASH_MS,
  FLASH_SCROLL_MS,
  nextFlashPhase,
  prefersReducedMotion,
  useClearOnNextAction,
} from '@/components/reader/flash';

import type { BBox } from '@papertree/document-ir';
import type { FocusOptions } from '@/components/reader/actions';
import type { FlashPaint } from '@/components/reader/HighlightOverlay';
import type { ReadingMode } from '../model/savedState';

/**
 * Scrolling the document pane and the citation flash, which share one thing: a scroll asked for
 * before a pane exists (a mode switch mounts and unmounts it) is held and applied when it does.
 * `focusAnchor` (contracts.md §5/§6) is the public end of both: resolve, scroll the passage into
 * view if it is not, and run the flash (`reader/flash`: in 180 → hold 900 → out 600, a faint
 * outline stays).
 *
 * In Source and Split the passage is the anchor's Source paint — its stored quads for a user
 * highlight, the ladder's matched range for a citation. In Guided it is the paragraph that renders
 * it. An anchor painted nowhere still gets its page, and the tray says why.
 * @param doc The indexed parse, or null while the paper is still being read.
 * @param mode The mode on screen.
 * @returns The scroll request, `focusAnchor` and the two flashes.
 */
export function useFocusAnchor(doc: IndexedDocument | null, mode: ReadingMode) {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const documentRef = useRef<DocumentHandle | null>(null);
  const pendingScroll = useRef<PendingScroll | null>(null);
  const [flash, setFlash] = useState<FlashPaint | null>(null);
  const [guidedFlash, setGuidedFlash] = useState<string | null>(null);

  /** Returns how long the scroll takes (a deferred one is assumed to take the flash's 240 ms). */
  const requestScroll = useCallback((request: PendingScroll): number => {
    const handle = documentRef.current;
    if (handle === null) {
      pendingScroll.current = request;
      return request.kind === 'rect' ? FLASH_SCROLL_MS : 0;
    }
    return applyScroll(handle, request);
  }, []);

  // Flush a scroll requested before a document pane existed (`mode` mounts and unmounts it).
  useEffect(() => {
    const request = pendingScroll.current;
    const handle = documentRef.current;
    if (request === null || handle === null) return;
    pendingScroll.current = null;
    applyScroll(handle, request);
  }, [mode]);

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    },
    [],
  );

  // The flash's phases: scroll → flash → linger, each keyed to this flash, so a newer flash is
  // never moved on by an older one's timer. The faint outline (and its margin tab) stays until the
  // reader's next action.
  useEffect(() => {
    if (flash === null) return undefined;
    const next = nextFlashPhase(flash.phase, flash.scrollMs, prefersReducedMotion());
    if (next === null) return undefined;
    const timer = setTimeout(
      () => setFlash((f) => (f?.key === flash.key ? { ...f, phase: next.phase } : f)),
      next.afterMs,
    );
    return () => clearTimeout(timer);
  }, [flash]);
  const clearFlash = useCallback(() => setFlash(null), []);
  useClearOnNextAction(flash !== null, clearFlash);

  const focusAnchor = useCallback(
    (anchor: Anchor, opts?: FocusOptions) => {
      if (doc === null) return;
      const resolution = resolveAnchor(anchor, doc);
      const shouldFlash = opts?.flash !== false;
      if (modeRef.current === 'guided') {
        const blockId = resolution.blockIds[0];
        if (blockId !== undefined && shouldFlash) setGuidedFlash(`${blockId}`);
        if (flashTimer.current !== null) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setGuidedFlash(null), FLASH_MS + 100);
        return;
      }
      const paint = sourcePaint(anchor, doc, resolution);
      if (paint === null) {
        if (resolution.pageIndex !== null)
          requestScroll({ kind: 'page', pageIndex: resolution.pageIndex });
        return;
      }
      const extent: BBox | null = extentOf(paint.polygons);
      const scrollMs =
        extent === null
          ? 0
          : requestScroll({
              kind: 'rect',
              pageIndex: paint.pageIndex,
              bbox: extent,
              ...(opts?.bottomInset === undefined ? {} : { bottomInset: opts.bottomInset }),
            });
      if (!shouldFlash) return;
      setFlash({
        key: `${anchor.id}:${String(Date.now())}`,
        pageIndex: paint.pageIndex,
        polygons: paint.polygons,
        phase: scrollMs > 0 ? 'scroll' : 'flash',
        scrollMs,
      });
    },
    [doc, requestScroll],
  );

  return { documentRef, requestScroll, focusAnchor, flash, guidedFlash };
}
