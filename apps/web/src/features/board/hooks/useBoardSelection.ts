'use client';

/**
 * board/hooks/useBoardSelection — what is selected on the board, cards in the order they were
 * picked (a thread from the toolbar runs from the first to the second), and threads. Fed by
 * xyflow's `onSelectionChange`; a change that selects the same things keeps the same object, so
 * the toolbar does not re-render on every pointer move.
 */
import { useCallback, useRef, useState } from 'react';

/** The selected cards (in pick order) and threads, by id. */
export interface BoardSelection {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}

const NONE: BoardSelection = { nodes: [], edges: [] };

/**
 * The board's selection.
 *
 * @returns The selection and the handler for xyflow's `onSelectionChange`.
 */
export function useBoardSelection(): {
  readonly selection: BoardSelection;
  readonly onSelectionChange: (change: {
    nodes: readonly { id: string }[];
    edges: readonly { id: string }[];
  }) => void;
} {
  const [selection, setSelection] = useState<BoardSelection>(NONE);
  const order = useRef<string[]>([]);
  const onSelectionChange = useCallback(
    ({ nodes, edges }: { nodes: readonly { id: string }[]; edges: readonly { id: string }[] }) => {
      const ids = nodes.map((n) => n.id);
      // Remember the order cards were picked in: a link goes from the first to the second.
      order.current = [
        ...order.current.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !order.current.includes(id)),
      ];
      const next: BoardSelection = { nodes: [...order.current], edges: edges.map((e) => e.id) };
      setSelection((prev) =>
        prev.nodes.join() === next.nodes.join() && prev.edges.join() === next.edges.join()
          ? prev
          : next,
      );
    },
    [],
  );
  return { selection, onSelectionChange };
}
