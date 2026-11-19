'use client';

/**
 * board/hooks/useBoardTree — the trees of the board, placed (v03-BOARD-SPEC section 4).
 *
 * Positions are COMPUTED, never stored: this hook builds the tree from the store's rows, asks
 * `layoutBoard` where every card goes from the heights the cards report (their own text, up to the
 * cap), and hands xyflow the derived nodes. A drag becomes an offset on the dragged card (its
 * whole branch moves with it) and is saved at drag END, one PATCH, like every other position.
 *
 * The height cap is 60% of the PANE the board sits in (the stage's own size), not of the window:
 * the split view puts the same board in half a window.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { displayNodes, draftNode, DRAFT_ID } from '../model/display';
import { layoutBoard, offsetForDrop, type BoardLayout } from '../model/layout';
import { buildTree, branchFor, downChild, type BoardTree } from '../model/tree';
import { onPathIds, type Draft } from '../model/ui';
import { itemsPhrase } from '../model/history';

import type { NodeChange } from '@xyflow/react';
import type { PtNode } from '../model/flow';
import type { AskUses, CanvasNode } from '@/lib/api/types';
import type { BoardStore } from './useBoardStore';
import type { BoardWrites } from './useBoardWrites';
import type { UndoOfferControl } from './useUndoOffer';

/** What the cards tell the layout about themselves. */
export interface CardReports {
  /** A card's content height in px (its text, before the cap). */
  readonly height: (id: string, px: number) => void;
  /** Where, in px from the top of `parentId`'s card, the last line of a span's words sits. */
  readonly spanY: (parentId: string, key: string, px: number | null) => void;
}

/** The trees, placed. */
export interface TreeView {
  readonly tree: BoardTree;
  readonly layout: BoardLayout;
  /**
   * The ask box on the board: the one being written, else the one-line "Follow up…" stub under a
   * focused answer that has no next turn, else null.
   */
  readonly draft: Draft | null;
  /** Every card as xyflow draws it. */
  readonly nodes: PtNode[];
  readonly reports: CardReports;
  /** The heights the cards have reported so far, by id (a card not in it has not been measured). */
  readonly heights: ReadonlyMap<string, number>;
  /** Position changes of tree cards become offsets; everything else is the caller's. */
  readonly onNodesChange: (
    changes: NodeChange<PtNode>[],
    rest: (changes: NodeChange<PtNode>[]) => void,
  ) => void;
  /** Drag END: saves the offsets that changed since the drag began. */
  readonly onDragStop: () => void;
}

/** What the tree reads of the rest of the board. */
export interface BoardTreeInput {
  readonly paperId: string;
  readonly store: BoardStore;
  readonly writes: BoardWrites;
  readonly offer: UndoOfferControl;
  /** The pane's height in px (0 before it is measured). */
  readonly paneHeight: number;
  readonly draft: Draft | null;
  /** What a fresh ask starts with (the board's remembered level). */
  readonly uses: AskUses;
  readonly focusId: string | null;
  readonly arrivedId: string | null;
}

/**
 * The key a span's measured line height is kept under.
 *
 * @param parentId The answer the words are in.
 * @param start The span's first offset.
 * @param end The span's last offset.
 * @returns The key.
 */
export const spanKey = (parentId: string, start: number, end: number): string =>
  `${parentId}:${String(start)}:${String(end)}`;

const NUDGE_MS = 400;

/**
 * Builds, lays out and derives the board's trees.
 *
 * @param input The store, the writes and what is open.
 * @returns The tree, its layout, the nodes xyflow draws and the drag handlers.
 */
export function useBoardTree(input: BoardTreeInput): TreeView {
  const { paperId, store, writes, offer, paneHeight, uses, focusId, arrivedId } = input;
  const { nodes: stored, nodesRef, mergeData, board } = store;
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [spanYs, setSpanYs] = useState<ReadonlyMap<string, number>>(new Map());

  const reports = useMemo<CardReports>(
    () => ({
      height: (id, px) =>
        setHeights((prev) => (prev.get(id) === px ? prev : new Map(prev).set(id, px))),
      spanY: (parentId, key, px) =>
        setSpanYs((prev) => {
          if (px === null) {
            if (!prev.has(key)) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
          }
          return prev.get(key) === px ? prev : new Map(prev).set(key, px);
        }),
    }),
    [],
  );

  const rows = useMemo(() => stored.map((n) => n.data.node), [stored]);
  const base = useMemo(() => buildTree(rows), [rows]);
  const draft = useMemo<Draft | null>(() => {
    if (input.draft !== null) return base.byId.has(input.draft.parentId) ? input.draft : null;
    // A focused answer with no next turn offers a one-line "Follow up…" that grows when used.
    if (focusId === null || base.byId.get(focusId)?.kind !== 'explanation') return null;
    if (downChild(base, focusId) !== undefined) return null;
    return {
      parentId: focusId,
      span: null,
      askDifferently: false,
      expanded: false,
      text: '',
      uses,
    };
  }, [base, focusId, input.draft, uses]);
  const draftRow = useMemo<CanvasNode | null>(() => {
    if (draft === null || board === null) return null;
    const branch = branchFor(base, draft.parentId, {
      span: draft.span,
      askDifferently: draft.askDifferently,
    });
    return draftNode(board.board_id, draft, branch);
  }, [base, board, draft]);

  const tree = useMemo(
    () => buildTree(draftRow === null ? rows : [...rows, draftRow]),
    [draftRow, rows],
  );
  // The window stands in for a pane that has no size yet (first paint, tests).
  const viewportHeight =
    paneHeight > 0 ? paneHeight : typeof window === 'undefined' ? 800 : window.innerHeight;
  const layout = useMemo(
    () =>
      layoutBoard(tree, {
        viewportHeight,
        measure: (id) => heights.get(id),
        spanY: (parentId, span) => spanYs.get(spanKey(parentId, span.start, span.end)),
      }),
    [tree, viewportHeight, heights, spanYs],
  );
  const onPath = useMemo(() => onPathIds(tree, focusId), [tree, focusId]);
  const nodes = useMemo(
    () => displayNodes(stored, layout, { paperId, onPath, draft: draftRow, arrivedId }),
    [stored, layout, paperId, onPath, draftRow, arrivedId],
  );

  // ── dragging ────────────────────────────────────────────────────────────────────────────────
  /** The offset each dragged card had when its drag began: what an undo puts back. */
  const before = useRef(new Map<string, { offset_x: number; offset_y: number }>());
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const { patchNode } = writes;
  const { recordStep } = offer;

  const save = useCallback(() => {
    const moved = [...before.current.entries()].flatMap(([id, was]) => {
      const row = nodesRef.current.find((n) => n.id === id)?.data.node;
      if (row === undefined) return [];
      const now = { offset_x: row.offset_x ?? 0, offset_y: row.offset_y ?? 0 };
      return now.offset_x === was.offset_x && now.offset_y === was.offset_y
        ? []
        : [{ id, row, was, now }];
    });
    before.current.clear();
    if (moved.length === 0) return;
    for (const m of moved) void patchNode(m.id, m.now);
    recordStep({
      type: 'patch',
      label: `move of ${itemsPhrase(moved.map((m) => m.row))}`,
      cards: moved.map((m) => ({ id: m.id, before: m.was, after: m.now })),
    });
  }, [nodesRef, patchNode, recordStep]);

  const onDragStop = useCallback(() => {
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = null;
    save();
  }, [save]);

  const onNodesChange = useCallback(
    (changes: NodeChange<PtNode>[], rest: (changes: NodeChange<PtNode>[]) => void) => {
      const others: NodeChange<PtNode>[] = [];
      for (const change of changes) {
        const placed =
          change.type === 'position' ? layoutRef.current.cards.get(change.id) : undefined;
        if (change.type !== 'position' || placed === undefined || change.id === DRAFT_ID) {
          others.push(change);
          continue;
        }
        if (change.position === undefined) continue;
        const row = nodesRef.current.find((n) => n.id === change.id)?.data.node;
        if (row === undefined) continue;
        if (!before.current.has(change.id)) {
          before.current.set(change.id, {
            offset_x: row.offset_x ?? 0,
            offset_y: row.offset_y ?? 0,
          });
        }
        mergeData(change.id, offsetForDrop(placed, change.position));
        // A keyboard nudge is not a drag: it is saved once, shortly after the last arrow press.
        if (change.dragging !== true) {
          if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
          nudgeTimer.current = setTimeout(onDragStop, NUDGE_MS);
        }
      }
      if (others.length > 0) rest(others);
    },
    [mergeData, nodesRef, onDragStop],
  );

  return { tree, layout, draft, nodes, reports, heights, onNodesChange, onDragStop };
}
