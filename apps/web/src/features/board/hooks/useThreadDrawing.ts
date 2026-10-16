'use client';

/**
 * board/hooks/useThreadDrawing — drawing a thread from a brass pin to an open pin (DESIGN.md §5).
 *
 * While a thread is drawn it is a dashed navy line and every pin it could land on lights
 * (`linking`). A drop the server would refuse (`canConnect`, the copy of its pin table) is refused
 * here first and the server's sentence is shown; a good drop opens the kind picker with both
 * pins remembered, so the thread is saved with `from_port` / `to_port`. The same handlers serve
 * xyflow's click-to-connect (press a brass pin, then an open pin), which the pins' Enter and
 * Space reach.
 */
import { useCallback, useMemo, useState, type CSSProperties } from 'react';

import { canConnect, isOutPort, pinRefusal } from '../model/pins';

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
}

/** The dashed navy thread that follows the pointer (DESIGN.md §3.10, "dragging"). */
const DRAWING_LINE: CSSProperties = {
  stroke: 'var(--pt-focus)',
  strokeWidth: 2,
  strokeDasharray: '7 5',
};

/**
 * The thread-drawing state and the xyflow handlers that drive it.
 *
 * @param nodes The board's cards, to know each end's kind.
 * @returns What is being drawn, what was refused, the pending thread, and the props for `ReactFlow`.
 */
export function useThreadDrawing(nodes: readonly PtNode[]) {
  const [linking, setLinking] = useState<LinkStart | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingThread | null>(null);

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

  const onConnectStart = useCallback(
    (_: unknown, start: OnConnectStartParams) => {
      const kind = kindOf(start.nodeId);
      setRefusal(null);
      if (start.nodeId === null || start.handleId === null || kind === undefined) return;
      setLinking({ nodeId: start.nodeId, kind, port: start.handleId });
    },
    [kindOf],
  );

  const onConnectEnd = useCallback((_: unknown, state: FinalConnectionState) => {
    setLinking(null);
    // Dropped ON a pin that cannot take it (a pin of the same card, or another brass pin).
    if (state.toHandle !== null && state.isValid === false) setRefusal(pinRefusal());
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;
    const fromPort = c.sourceHandle !== null && isOutPort(c.sourceHandle) ? c.sourceHandle : null;
    const toPort =
      c.targetHandle === 'evidence_in' || c.targetHandle === 'question_in' ? c.targetHandle : null;
    setPending({ from: c.source, to: c.target, fromPort, toPort });
  }, []);

  const flowProps = useMemo(
    () => ({
      isValidConnection,
      onConnect,
      onConnectStart,
      onConnectEnd,
      onClickConnectStart: onConnectStart,
      onClickConnectEnd: onConnectEnd,
      connectionLineStyle: DRAWING_LINE,
    }),
    [isValidConnection, onConnect, onConnectStart, onConnectEnd],
  );

  return {
    linking,
    refusal,
    dismissRefusal: () => setRefusal(null),
    pending,
    setPending,
    flowProps,
  };
}
