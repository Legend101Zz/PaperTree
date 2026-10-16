'use client';

/**
 * board/hooks/useThreadDrawing — drawing a thread from a brass pin to an open pin (DESIGN.md §5).
 *
 * While a thread is drawn it is a dashed navy line and every pin it could land on lights
 * (`linking`). A drop the server would refuse (`canConnect`, the copy of its pin table) is refused
 * here first and the server's sentence is shown; a good drop opens the kind picker with both
 * pins remembered, so the thread is saved with `from_port` / `to_port`. The same handlers serve
 * xyflow's click-to-connect (press a brass pin, then an open pin), which the pins' Enter and
 * Space reach; Escape or a click on the empty board cancels it. The toolbar's Link takes its pins
 * from the table, and refuses a pair no pin can hold rather than save a thread nothing can draw.
 * Keyboard linking (`useKeyboardLink`, #213) starts and ends through this same state, never a
 * second link mode: `startLink` is a click-to-connect begun from a card's first brass pin.
 */
import { useStoreApi } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { canConnect, isOutPort, pinRefusal, resolvePorts } from '../model/pins';

import type { LinkStart } from '../components/BoardContext';
import type { PtEdge, PtNode } from '../model/flow';
import type { FromPort, ToPort } from '@/lib/api/types';
import type { Connection, FinalConnectionState, OnConnectStartParams } from '@xyflow/react';

/** A thread dropped on a good pin, waiting for its kind. */
export interface PendingThread {
  readonly from: string;
  readonly to: string;
  readonly fromPort: FromPort | null;
  readonly toPort: ToPort | null;
  /** Where focus goes once the kind is chosen; the source pin when absent (a mouse drag). */
  readonly returnTo?: HTMLElement | null;
}

/** The dashed navy thread that follows the pointer (DESIGN.md §3.10, "dragging"). */
const DRAWING_LINE: CSSProperties = {
  stroke: 'var(--pt-focus)',
  strokeWidth: 2,
  strokeDasharray: '7 5',
};

/** What `useThreadDrawing` gives the board. */
export interface ThreadDrawing {
  /** The pin a thread is being drawn from (mouse drag or click-to-connect), or null. */
  readonly linking: LinkStart | null;
  /** The refusal sentence after a drop the server would refuse, or null. */
  readonly refusal: string | null;
  readonly dismissRefusal: () => void;
  /** Show a refusal sentence of the board's own (keyboard linking that has nowhere to go). */
  readonly refuse: (sentence: string) => void;
  /** Start a click-to-connect from a card's pin, as pressing the pin by keyboard would. */
  readonly startLink: (nodeId: string, port: FromPort) => void;
  /** Put a thread being drawn away, saving nothing. */
  readonly cancel: () => void;
  /** A good drop waiting for its kind. */
  readonly pending: PendingThread | null;
  readonly setPending: (next: PendingThread | null) => void;
  /** The toolbar's Link between two selected cards: pins from the table, or the refusal. */
  readonly link: (from: string, to: string) => void;
  /** Props for `ReactFlow`. */
  readonly flowProps: {
    readonly isValidConnection: (c: PtEdge | Connection) => boolean;
    readonly onConnect: (c: Connection) => void;
    readonly onConnectStart: (event: unknown, start: OnConnectStartParams) => void;
    readonly onConnectEnd: (event: unknown, state: FinalConnectionState) => void;
    readonly onClickConnectStart: (event: unknown, start: OnConnectStartParams) => void;
    readonly onClickConnectEnd: (event: unknown, state: FinalConnectionState) => void;
    readonly onPaneClick: () => void;
    readonly connectionLineStyle: CSSProperties;
  };
}

/**
 * The handle a click landed on: its card and pin, from xyflow's data attributes.
 *
 * @param event The click's event (xyflow passes it to `onClickConnectEnd`).
 * @returns The card and pin, or null when the click was not on a handle.
 */
function clickedPin(event: unknown): { nodeId: string; port: string } | null {
  const target = (event as { target?: unknown } | null)?.target;
  const handle = target instanceof Element ? target.closest('.react-flow__handle') : null;
  const nodeId = handle?.getAttribute('data-nodeid');
  const port = handle?.getAttribute('data-handleid');
  return nodeId == null || port == null ? null : { nodeId, port };
}

/**
 * The thread-drawing state and the xyflow handlers that drive it. Escape, or a click on the empty
 * board, cancels a click-to-connect in progress.
 *
 * @param nodes The board's cards, to know each end's kind.
 * @returns What is being drawn, what was refused, the pending thread, and the props for `ReactFlow`.
 */
export function useThreadDrawing(nodes: readonly PtNode[]): ThreadDrawing {
  const store = useStoreApi();
  const [linking, setLinking] = useState<LinkStart | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingThread | null>(null);
  const started = useRef<LinkStart | null>(null);

  const kindOf = useCallback(
    (id: string | null | undefined) => nodes.find((n) => n.id === id)?.data.node.kind,
    [nodes],
  );

  const isValidConnection = useCallback(
    (c: PtEdge | Connection) => {
      const from = kindOf(c.source);
      const to = kindOf(c.target);
      return (
        c.source !== c.target &&
        from !== undefined &&
        to !== undefined &&
        canConnect({ kind: from, port: c.sourceHandle }, { kind: to, port: c.targetHandle })
      );
    },
    [kindOf],
  );

  const begin = useCallback((next: LinkStart | null) => {
    started.current = next;
    setLinking(next);
  }, []);

  const cancel = useCallback(() => {
    if (started.current === null) return;
    store.setState({ connectionClickStartHandle: null });
    begin(null);
  }, [begin, store]);

  useEffect(() => {
    if (linking === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [linking, cancel]);

  const startFrom = useCallback(
    (start: OnConnectStartParams, keyboard: boolean) => {
      const kind = kindOf(start.nodeId);
      setRefusal(null);
      if (start.nodeId === null || start.handleId === null || kind === undefined) return;
      begin({ nodeId: start.nodeId, kind, port: start.handleId, keyboard });
    },
    [begin, kindOf],
  );
  const onConnectStart = useCallback(
    (_: unknown, start: OnConnectStartParams) => startFrom(start, false),
    [startFrom],
  );
  // A pin pressed with Enter or Space (`CardPins`' synthetic click) carries no click count.
  const onClickConnectStart = useCallback(
    (event: unknown, start: OnConnectStartParams) =>
      startFrom(start, (event as { detail?: unknown } | null)?.detail === 0),
    [startFrom],
  );

  const startLink = useCallback(
    (nodeId: string, port: FromPort) => {
      const kind = kindOf(nodeId);
      if (kind === undefined) return;
      setRefusal(null);
      store.setState({ connectionClickStartHandle: { nodeId, type: 'source', id: port } });
      begin({ nodeId, kind, port, keyboard: true });
    },
    [begin, kindOf, store],
  );

  const onConnectEnd = useCallback(
    (_: unknown, state: FinalConnectionState) => {
      begin(null);
      // Dropped ON a pin that cannot take it (a pin of the same card, or another brass pin).
      if (state.toHandle !== null && state.isValid === false) setRefusal(pinRefusal());
    },
    [begin],
  );

  // xyflow hands a click end its idle connection state, so the clicked pin is read from the event.
  const onClickConnectEnd = useCallback(
    (event: unknown) => {
      const from = started.current;
      const end = clickedPin(event);
      const kind = kindOf(end?.nodeId);
      begin(null);
      if (from === null || end === null || kind === undefined) return;
      const ok =
        end.nodeId !== from.nodeId &&
        canConnect({ kind: from.kind, port: from.port }, { kind, port: end.port });
      if (!ok) setRefusal(pinRefusal());
    },
    [begin, kindOf],
  );

  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;
    const fromPort = c.sourceHandle !== null && isOutPort(c.sourceHandle) ? c.sourceHandle : null;
    const toPort =
      c.targetHandle === 'evidence_in' || c.targetHandle === 'question_in' ? c.targetHandle : null;
    setPending({ from: c.source, to: c.target, fromPort, toPort });
  }, []);

  const link = useCallback(
    (from: string, to: string) => {
      const a = kindOf(from);
      const b = kindOf(to);
      const ports = a === undefined || b === undefined ? null : resolvePorts(a, b);
      // A thread no pin can hold would be saved and never drawn: refuse it as the server would.
      if (ports === null) {
        setRefusal(pinRefusal());
        return;
      }
      setRefusal(null);
      const returnTo =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPending({ from, to, fromPort: ports.from_port, toPort: ports.to_port, returnTo });
    },
    [kindOf],
  );

  const flowProps = useMemo(
    () => ({
      isValidConnection,
      onConnect,
      onConnectStart,
      onConnectEnd,
      onClickConnectStart,
      onClickConnectEnd,
      onPaneClick: cancel,
      connectionLineStyle: DRAWING_LINE,
    }),
    [
      isValidConnection,
      onConnect,
      onConnectStart,
      onConnectEnd,
      onClickConnectStart,
      onClickConnectEnd,
      cancel,
    ],
  );

  return {
    linking,
    refusal,
    dismissRefusal: () => setRefusal(null),
    refuse: setRefusal,
    startLink,
    cancel,
    pending,
    setPending,
    link,
    flowProps,
  };
}
