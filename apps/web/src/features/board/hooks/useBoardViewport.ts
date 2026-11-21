'use client';

/**
 * board/hooks/useBoardViewport — remembers pan and zoom, once per gesture END.
 */
import { useCallback } from 'react';

import { boardsApi } from '@/lib/api/boards';

import type { Viewport } from '@xyflow/react';
import type { BoardStore } from './useBoardStore';

/**
 * Saves the viewport at the end of a pan or zoom.
 *
 * @param store The board's working copy.
 * @returns `saveViewport`, which skips a view the server already has.
 */
export function useBoardViewport(store: BoardStore): (viewport: Viewport) => void {
  const { boardRef, lastViewport } = store;
  return useCallback(
    (viewport: Viewport) => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined) return;
      const last = lastViewport.current;
      if (
        last !== null &&
        last.x === viewport.x &&
        last.y === viewport.y &&
        last.zoom === viewport.zoom
      )
        return;
      lastViewport.current = viewport;
      boardsApi.patchBoard(boardId, { viewport }).catch(() => {
        // A viewport is a convenience: failing to remember it is not worth interrupting the reader.
      });
    },
    [boardRef, lastViewport],
  );
}
