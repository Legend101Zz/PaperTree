'use client';

/**
 * board/hooks/useDropIn — a selection dragged from the paper across the divider (V3-25, #344).
 *
 * While a passage is in the air over the board, a cross and a dashed footprint follow the pointer
 * (the footprint is as tall as the card will be, an estimate from the words); where the reader lets
 * go the host is told the point of the board, in board units, and the card lands there. The board
 * knows nothing of the paper: the host says what is being dragged. Without a host that has a drag
 * (the board on its own page) every handler is inert.
 */
import { useReactFlow } from '@xyflow/react';
import { useCallback, useState, type DragEvent, type RefObject } from 'react';

import { heightCap } from '../model/layout';
import { FOOTPRINT_WIDTH, IMAGE_FOOTPRINT_HEIGHT, footprintHeight } from '../model/panes';

import type { BoardHost } from '../components/BoardHost';
import type { PtEdge, PtNode } from '../model/flow';

/** Where the cross is, the footprint's corner and size; all in the pane's own px. */
export interface DropMark {
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The footprint sits up and to the left of the cross: the card's corner is under the pointer. */
const CORNER = { x: 22, y: 14 } as const;

/** What `useDropIn` gives the stage. */
export interface DropIn {
  readonly mark: DropMark | null;
  readonly handlers: {
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
    readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
    readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

/**
 * The drop target of a board beside the paper.
 *
 * @param host The board's surroundings.
 * @param stage The pane the board is drawn in.
 * @returns The cross and footprint to draw, and the stage's drag handlers.
 */
export function useDropIn(host: BoardHost, stage: RefObject<HTMLElement | null>): DropIn {
  const flow = useReactFlow<PtNode, PtEdge>();
  const [mark, setMark] = useState<DropMark | null>(null);
  const dragIn = host.dragIn;

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>): void => {
      const dragged = dragIn?.current();
      const box = stage.current?.getBoundingClientRect();
      if (dragged == null || box === undefined) return;
      event.preventDefault();
      try {
        event.dataTransfer.dropEffect = 'copy';
      } catch {
        /* a drag with no data transfer: the mark still follows */
      }
      const x = Math.round(event.clientX - box.left);
      const y = Math.round(event.clientY - box.top);
      const height =
        dragged.image === true
          ? IMAGE_FOOTPRINT_HEIGHT
          : footprintHeight(dragged.text.length, heightCap(box.height));
      setMark((was) =>
        was !== null && Math.abs(was.x - x) + Math.abs(was.y - y) <= 3
          ? was
          : { x, y, left: x - CORNER.x, top: y - CORNER.y, width: FOOTPRINT_WIDTH, height },
      );
    },
    [dragIn, stage],
  );

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>): void => {
    const to = event.relatedTarget;
    if (to instanceof Node && event.currentTarget.contains(to)) return;
    setMark(null);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>): void => {
      if (dragIn?.current() == null) return;
      event.preventDefault();
      setMark(null);
      const at = flow.screenToFlowPosition({
        x: event.clientX - CORNER.x,
        y: event.clientY - CORNER.y,
      });
      dragIn.drop({ x: Math.round(at.x), y: Math.round(at.y) });
    },
    [dragIn, flow],
  );

  return { mark, handlers: { onDragOver, onDragLeave, onDrop } };
}
