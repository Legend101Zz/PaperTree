'use client';

/**
 * board/hooks/useBranchBoard — the branching board as one unit for `BoardView`: what is open
 * (`useBoardUi`), the trees placed (`useBoardTree`), asks and the tree's gestures (`useBoardAsk`),
 * the pane's own size (the 60% cap and the span menu follow the PANE, so the split view can embed
 * the same board), Escape one level at a time, and the arrival of a card from "Send to board" (#342).
 *
 * Arrival: `?card=<id>` (or the split view's own arrival, #344) pans so the card AND its open ask
 * box, as a pair, sit in the middle of the pane, then the card glows once (reduced motion: no
 * animation, a static ring for one second). A DROPPED card keeps the view and lands where it was
 * dropped. Source links go through the host: beside the paper the paper flashes and the board stays.
 */
import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { DRAFT_ID } from '../model/display';
import { heightCap } from '../model/layout';
import { viewToCentre } from '../model/panes';
import { onPathIds } from '../model/ui';
import { useBoardAsk, type BoardAsk } from './useBoardAsk';
import { useBoardTree, type TreeView } from './useBoardTree';
import { useBoardUi, type BoardUiControl } from './useBoardUi';

import type { BoardHost } from '../components/BoardHost';
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
  /** The card the board is to open on (`?card=` or the host's arrival), or null. */
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
 * @param host Where the board is shown: its arrival, its source links, its first branch, its Escape.
 * @returns The branching board.
 */
export function useBranchBoard(
  paperId: string,
  ctl: BoardController,
  stage: RefObject<HTMLElement | null>,
  host: BoardHost,
): BranchBoard {
  const { store, writes, offer } = ctl.internals;
  const flow = useReactFlow<PtNode, PtEdge>();
  const boardId = store.board?.board_id ?? null;
  const control = useBoardUi(boardId);
  const [paneHeight, setPaneHeight] = useState(0);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const urlCard = useArrivalParam();
  // The host's arrival (a send beside the paper, a drop) wins over the address.
  const hostArrival = host.arrival;
  const cardParam = hostArrival?.cardId ?? urlCard;
  const arrivalKey =
    hostArrival === null ? urlCard : `${hostArrival.cardId}#${String(hostArrival.nonce)}`;
  const centre = hostArrival?.centre ?? true;

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
  const ask = useBoardAsk(paperId, store, writes, offer, control, view.tree, host.onBranched);
  const onPath = useMemo(
    () => onPathIds(view.tree, control.ui.focusId),
    [view.tree, control.ui.focusId],
  );

  // Escape closes one level per press, wherever the focus is in the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (control.escape()) event.preventDefault();
      else host.onEscapeUnused();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [control, host]);

  // The selection belongs to the menu: closing the menu clears it.
  const menuOpen = control.ui.menu !== null;
  useEffect(() => {
    if (!menuOpen) window.getSelection()?.removeAllRanges();
  }, [menuOpen]);

  // ── arrival (#342) ───────────────────────────────────────────────────────────────────────────
  const arrived = useRef<string | null>(null);
  const { tree, layout, heights } = view;
  const { openAsk } = control;
  // A card made outside the board (a send beside the paper, a drop) is read in before it can arrive.
  const { reload } = ctl;
  useEffect(() => {
    if (hostArrival !== null) void reload();
  }, [hostArrival, reload]);
  useEffect(() => {
    if (cardParam === null || ctl.status !== 'ready' || arrived.current === arrivalKey) return;
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
    arrived.current = arrivalKey;
    setArrivedId(cardParam);
    if (hostArrival === null) {
      // Arrived by address: a reload must not pan again, so the address no longer names the card.
      const here = new URL(window.location.href);
      here.searchParams.delete('card');
      window.history.replaceState(
        window.history.state,
        '',
        `${here.pathname}${here.search}${here.hash}`,
      );
    }
    if (!centre) return; // a drop: the card is where the reader let go, and the view stays
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
  }, [
    arrivalKey,
    centre,
    cardParam,
    hostArrival,
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

  // A source link: the passage card's own anchor, or the cited passage of an answer. Beside the
  // paper the host flashes it there and the board stays put; on the full-width board it opens the
  // paper beside this board, with the clicked card kept on screen.
  const { showInPaper } = host;
  const byId = view.tree.byId;
  const openSource = useCallback(
    (nodeId: string, citationId?: string) => {
      const row = byId.get(nodeId);
      const anchor =
        citationId === undefined
          ? (row?.source_anchor ?? null)
          : (row?.citations?.find((c) => c.citation_id === citationId)?.anchor ?? null);
      showInPaper({ nodeId, anchor, ...(citationId === undefined ? {} : { citationId }) });
    },
    [byId, showInPaper],
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
      sending: ask.sending,
      quick: ask.quick,
      keepNote: ask.keepNote,
      retry: ask.retry,
      stop: ask.stop,
      fold: ask.fold,
      openSource,
      visiblePages: host.visiblePages,
      beside: host.beside,
      stage,
    }),
    [
      view.tree,
      view.layout,
      view.draft,
      view.reports,
      control,
      ask,
      openSource,
      host.visiblePages,
      host.beside,
      stage,
    ],
  );

  return { control, view, ask, actions, onPath, arrivalCard: cardParam };
}
