import { useCallback, useEffect, useMemo, useRef } from 'react';

import { papersApi } from '@/lib/api/papers';
import { createReadingStateSync } from '@/lib/readingStateSync';

import {
  writeSavedReaderState,
  type ReadingMode,
  type SavedReaderState,
} from '../model/savedState';
import { initialBlockFor, topBlockAt } from '../model/topBlock';

import type { IndexedDocument } from '@papertree/anchoring';
import type { PendingScroll } from '@/components/reader/documentHandle';
import type { ReadingPosition } from '@/components/reader/VirtualPageList';
import type { ZoomMode } from '@/components/reader/ZoomControl';
import type { PaperRef } from '@/lib/paperSource';

/** What the position hook reads from the workspace. */
export interface UseReadingPositionArgs {
  readonly paper: PaperRef;
  readonly doc: IndexedDocument | null;
  readonly storageKey: string;
  /** The place read from storage when the workspace opened. */
  readonly saved: SavedReaderState | null;
  /** The mode on screen (Source until the parse is in). */
  readonly mode: ReadingMode;
  /** The mode the reader asked for: a change of it is a change worth saving. */
  readonly requestedMode: ReadingMode;
  readonly zoomMode: ZoomMode;
  readonly requestScroll: (request: PendingScroll) => number;
  /** The page of Guided's top paragraph, for the header's counter. */
  readonly onTopPage: (pageIndex: number) => void;
  /** Split: Source's top block, for Guided to follow. */
  readonly onFollowBlock: (blockId: string) => void;
}

/**
 * The reading position, kept two ways: `localStorage` (the exact place, #132) and the server's page
 * for the library's "reading now" (#192). Its own hook so the workspace only says where the reader
 * is; the timers, the flush on hide and the "only a page actually shown" rule live here.
 * @param args See the interface.
 * @returns The position callbacks and where Source and Guided open.
 */
export function useReadingPosition(args: UseReadingPositionArgs) {
  const { paper, doc, storageKey, saved, mode, requestedMode, zoomMode } = args;
  const { requestScroll, onTopPage, onFollowBlock } = args;

  const positionRef = useRef<SavedReaderState | null>(saved);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True once the reader has reported a position (scroll or guided top), i.e. shown a real page.
  const shownRef = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const zoomModeRef = useRef(zoomMode);
  zoomModeRef.current = zoomMode;

  // The server's copy of the place (#192), for the library's "reading now". Real papers only; a
  // fixture has no account to write to.
  const readingSync = useMemo(
    () =>
      paper.kind === 'api'
        ? createReadingStateSync({
            send: (page, readingMode) =>
              papersApi.putReadingState(paper.paperId, page, readingMode),
          })
        : null,
    [paper],
  );
  useEffect(() => {
    if (readingSync === null) return undefined;
    const flush = (): void => readingSync.flush({ keepalive: true });
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') readingSync.flush({ keepalive: true });
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      readingSync.flush(); // not dispose: React strict mode remounts with the same instance
    };
  }, [readingSync]);

  const persist = useCallback(() => {
    // Only a page the reader has shown: not on mount, not on a mode or zoom change before the
    // first reported position (that would overwrite the server's place with page 0).
    readingSync?.update(
      shownRef.current ? (positionRef.current?.page ?? null) : null,
      modeRef.current,
    );
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const at = positionRef.current;
      writeSavedReaderState(storageKey, {
        v: 1,
        mode: modeRef.current,
        zoomMode: zoomModeRef.current,
        page: at?.page ?? 0,
        yPt: at?.yPt ?? 0,
        ...(at?.blockId === undefined ? {} : { blockId: at.blockId }),
      });
    }, 250);
  }, [storageKey, readingSync]);

  useEffect(() => {
    persist();
  }, [requestedMode, zoomMode, persist]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    },
    [],
  );

  const onSourcePosition = useCallback(
    (position: ReadingPosition) => {
      const blockId = doc === null ? undefined : topBlockAt(doc, position);
      shownRef.current = true;
      // The page Guided would open at: its top block's (#203's counter, while Guided is shown).
      onTopPage(
        (blockId === undefined ? undefined : doc?.byId.get(blockId)?.pageIndex) ?? position.page,
      );
      positionRef.current = {
        v: 1,
        mode: modeRef.current,
        zoomMode: zoomModeRef.current,
        page: position.page,
        yPt: position.yPt,
        ...(blockId === undefined ? {} : { blockId }),
      };
      if (modeRef.current === 'split' && blockId !== undefined) onFollowBlock(blockId);
      persist();
    },
    [doc, persist, onTopPage, onFollowBlock],
  );

  const onGuidedTop = useCallback(
    (blockId: string) => {
      const block = doc?.byId.get(blockId);
      if (block === undefined) return;
      shownRef.current = true;
      onTopPage(block.pageIndex);
      positionRef.current = {
        v: 1,
        mode: modeRef.current,
        zoomMode: zoomModeRef.current,
        page: block.pageIndex,
        yPt: Math.max(0, block.bbox[1] - 12),
        blockId,
      };
      if (modeRef.current === 'split')
        requestScroll({ kind: 'rect', pageIndex: block.pageIndex, bbox: block.bbox });
      persist();
    },
    [doc, persist, requestScroll, onTopPage],
  );

  const at = positionRef.current;
  return {
    onSourcePosition,
    onGuidedTop,
    /** Where Source opens, and the block Guided opens at (read each render, applied once). */
    initialPosition: at === null ? null : { page: at.page, yPt: at.yPt },
    initialBlockId: initialBlockFor(doc, at),
  };
}
