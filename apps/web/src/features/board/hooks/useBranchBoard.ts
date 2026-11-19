'use client';

/**
 * board/hooks/useBranchBoard — the branching board as one unit for `BoardView`: what is open
 * (`useBoardUi`), the trees placed (`useBoardTree`), asks and the tree's gestures (`useBoardAsk`),
 * the pane's own size (the 60% cap and the span menu follow the PANE, so the split view can embed
 * the same board), Escape one level at a time, and the arrival of a card from "Send to board" (#342).
 *
 * Arrival: `?card=<id>` pans so the card AND its open ask box, as a pair, sit in the middle of the
 * pane, then the card glows once (reduced motion: no animation, a static ring for one second).
 */
import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { citationHref } from '../model/chrome';
import { DRAFT_ID } from '../model/display';
import { heightCap } from '../model/layout';
import { viewToCentre } from '../model/panes';
import { onPathIds } from '../model/ui';
import { useBoardAsk, type BoardAsk } from './useBoardAsk';
import { useBoardTree, type TreeView } from './useBoardTree';
import { useBoardUi, type BoardUiControl } from './useBoardUi';

import type { BranchActions } from '../components/BranchContext';
import type { PtEdge, PtNode } from '../model/flow';
import type { BoardController } from './controllerShared';

/** The branching board. */
export interface BranchBoard {
  readonly control: BoardUiControl;
  readonly view: TreeView;
  readonly ask: BoardAsk;
  /** What the cards read through `BranchProvider`. */
  readonly actions: BranchActions;
  /** The cards a path focus keeps lit; null when nothing is focused. */
  readonly onPath: ReadonlySet<string> | null;
  /** The card the URL asked the board to open on (`?card=`), or null. */
  readonly arrivalCard: string | null;
}

/** How long a card glows after it arrives; reduced motion shows a still ring for 1 s. */
const GLOW_MS = 1600;
const RING_MS = 1000;

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The card a URL asks the board to open on (`?card=<id>`), read once on the client.
 *
 * @returns The id, or null.
 */
function useArrivalParam(): string | null {
  const [card, setCard] = useState<string | null>(null);
  useEffect(() => {
    setCard(new URLSearchParams(window.location.search).get('card'));
  }, []);
  return card;
}

/**
 * Builds the branching board for one paper.
 *
 * @param paperId The paper.
 * @param ctl The board controller (its store and writes are the tree's).
 * @param stage The pane the board sits in; its size sets the card cap and places the span menu.
 * @returns The branching board.
 */
export function useBranchBoard(
  paperId: string,
  ctl: BoardController,
  stage: RefObject<HTMLElement | null>,
): BranchBoard {
  const { store, writes, offer } = ctl.internals;
  const flow = useReactFlow<PtNode, PtEdge>();
  const boardId = store.board?.board_id ?? null;
  const control = useBoardUi(boardId);
  const [paneHeight, setPaneHeight] = useState(0);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const cardParam = useArrivalParam();

  // The pane's height sets the cap on every card (60%), as a CSS variable the cards read and as the
  // number the layout uses, so what is drawn and what is laid out agree.
  useEffect(() => {
    const el = stage.current;
    if (el === null) return undefined;
    const apply = (): void => {
      const h = Math.round(el.clientHeight);
      el.style.setProperty(
        '--pt-card-cap',
        `${String(heightCap(h > 0 ? h : window.innerHeight))}px`,
      );
      setPaneHeight((was) => (was === h ? was : h));
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stage, ctl.status]);

  const view = useBoardTree({
    paperId,
    store,
    writes,
    offer,
    paneHeight,
    draft: control.ui.draft,
    uses: control.freshUses,
    focusId: control.ui.focusId,
    arrivedId,
  });
  const ask = useBoardAsk(paperId, store, writes, offer, control, view.tree);
  const onPath = useMemo(
    () => onPathIds(view.tree, control.ui.focusId),
    [view.tree, control.ui.focusId],
  );

  // Escape closes one level per press, wherever the focus is in the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (control.escape()) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [control]);

  // The selection belongs to the menu: closing the menu clears it.
  const menuOpen = control.ui.menu !== null;
  useEffect(() => {
    if (!menuOpen) window.getSelection()?.removeAllRanges();
  }, [menuOpen]);

  // ── arrival (#342) ───────────────────────────────────────────────────────────────────────────
  const arrived = useRef<string | null>(null);
  const { tree, layout, heights } = view;
  const { openAsk } = control;
  useEffect(() => {
    if (cardParam === null || ctl.status !== 'ready' || arrived.current === cardParam) return;
    const card = layout.cards.get(cardParam);
    const row = tree.byId.get(cardParam);
    if (card === undefined || row === undefined) return;
    if (!heights.has(cardParam)) return; // its words are not measured yet
    // A card with nothing under it opens its ask box, so the pair is what gets centred.
    // (The ask box itself is a child in the tree, so the question is about the stored cards.)
    const hasChildren = ctl.nodes.some((n) => n.data.node.parent_id === cardParam);
    const wantsBox = (row.kind === 'excerpt' || row.kind === 'explanation') && !hasChildren;
    const box = layout.cards.get(DRAFT_ID);
    if (wantsBox && control.ui.draft === null) {
      openAsk(cardParam);
      return;
    }
    if (wantsBox && (box === undefined || !heights.has(DRAFT_ID))) return;
    arrived.current = cardParam;
    const pane = {
      w: stage.current?.clientWidth ?? window.innerWidth,
      h: stage.current?.clientHeight ?? window.innerHeight,
    };
    const boxes = [card, ...(wantsBox && box !== undefined ? [box] : [])].map((c) => ({
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
    }));
    const target = viewToCentre(boxes, pane, flow.getZoom());
    const calm = reducedMotion();
    void flow.setViewport(target, { duration: calm ? 0 : 400 });
    setArrivedId(cardParam);
    // Arrived: a reload must not pan again, so the address no longer names the card.
    const here = new URL(window.location.href);
    here.searchParams.delete('card');
    window.history.replaceState(
      window.history.state,
      '',
      `${here.pathname}${here.search}${here.hash}`,
    );
  }, [
    cardParam,
    control.ui.draft,
    ctl.nodes,
    ctl.status,
    flow,
    heights,
    layout,
    openAsk,
    stage,
    tree,
  ]);

  // One glow, then it goes: reduced motion gets a still ring for a second instead.
  useEffect(() => {
    if (arrivedId === null) return undefined;
    const timer = setTimeout(() => setArrivedId(null), reducedMotion() ? RING_MS : GLOW_MS);
    return () => clearTimeout(timer);
  }, [arrivedId]);

  const openSource = useCallback(
    (nodeId: string, citationId?: string, threadId?: string) =>
      window.location.assign(citationHref(paperId, nodeId, citationId, threadId)),
    [paperId],
  );

  const actions = useMemo<BranchActions>(
    () => ({
      tree: view.tree,
      layout: view.layout,
      control,
      draft: view.draft,
      streams: ask.streams,
      reports: view.reports,
      send: ask.send,
      quick: ask.quick,
      keepNote: ask.keepNote,
      stop: ask.stop,
      fold: ask.fold,
      openSource,
      stage,
    }),
    [view.tree, view.layout, view.draft, view.reports, control, ask, openSource, stage],
  );

  return { control, view, ask, actions, onPath, arrivalCard: cardParam };
}
