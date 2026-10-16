'use client';

/**
 * board/components/LinkAsLayer — puts the "Link as" picker on the board for one thread: names its
 * two ends, offers the kinds its pins take (`kindChoices`, the server's table), settles it at the
 * thread's midpoint inside the stage (`placePicker`), and gives focus back to where the thread
 * started (the source pin or card, or the button that asked) once the kind is chosen.
 */
import { useReactFlow } from '@xyflow/react';
import { useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';

import { endName, kindChoices, placePicker } from '../model/linkAs';
import { LinkAsPicker } from './LinkAsPicker';
import { pinCentre } from './ThreadPreview';

import type { PtEdge, PtNode } from '../model/flow';
import type { Point } from '../model/threads';
import type { EdgeKind, FromPort, ToPort } from '@/lib/api/types';

/** A thread waiting for its kind: a new one, or a saved one whose kind is changing. */
export interface LinkRequest {
  readonly mode: 'new' | 'change';
  readonly from: string;
  readonly to: string;
  readonly fromPort: FromPort | null;
  readonly toPort: ToPort | null;
  /** The saved thread's kind, focused first when changing it. */
  readonly current?: EdgeKind;
  /** Where focus goes after; the source pin (else its card) when absent. */
  readonly returnTo?: HTMLElement | null;
}

/** Props for `LinkAsLayer`. */
export interface LinkAsLayerProps {
  readonly request: LinkRequest;
  readonly nodes: readonly PtNode[];
  /** The board's stage, which the picker is placed in. */
  readonly stage: RefObject<HTMLElement>;
  readonly onChoose: (kind: EdgeKind, label: string | null) => void;
  readonly onCancel: () => void;
}

/** The picker for one thread, at its midpoint. */
export function LinkAsLayer({
  request,
  nodes,
  stage,
  onChoose,
  onCancel,
}: LinkAsLayerProps): ReactNode {
  const flow = useReactFlow<PtNode, PtEdge>();
  const [at, setAt] = useState<Point | null>(null);
  const from = nodes.find((n) => n.id === request.from);
  const to = nodes.find((n) => n.id === request.to);
  const choices = useMemo(
    () =>
      from === undefined || to === undefined
        ? []
        : kindChoices(
            { kind: from.data.node.kind, port: request.fromPort },
            { kind: to.data.node.kind, port: request.toPort },
          ),
    [from, to, request.fromPort, request.toPort],
  );

  useLayoutEffect(() => {
    const el = stage.current;
    const box = el?.querySelector<HTMLElement>('.pt-linkas');
    const a = flow.getInternalNode(request.from);
    const b = flow.getInternalNode(request.to);
    if (el == null || box == null || a === undefined || b === undefined) return;
    const p = pinCentre(a, request.fromPort);
    const q = pinCentre(b, request.toPort);
    const mid = flow.flowToScreenPosition({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const r = el.getBoundingClientRect();
    setAt(
      placePicker(
        { x: mid.x - r.left, y: mid.y - r.top },
        { w: box.offsetWidth, h: box.offsetHeight },
        { w: r.width, h: r.height },
      ),
    );
  }, [flow, stage, request.from, request.to, request.fromPort, request.toPort]);

  if (from === undefined || to === undefined) return null;
  const giveFocusBack = (): void => {
    const card = stage.current?.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${request.from}"]`,
    );
    const pin = card?.querySelector<HTMLElement>(`[data-handleid="${request.fromPort ?? ''}"]`);
    (request.returnTo ?? pin ?? card)?.focus();
  };
  return (
    <LinkAsPicker
      from={endName(from)}
      to={endName(to)}
      choices={choices}
      mode={request.mode}
      initial={request.current}
      at={at}
      onChoose={(kind, label) => {
        giveFocusBack();
        onChoose(kind, label);
      }}
      onCancel={() => {
        giveFocusBack();
        onCancel();
      }}
    />
  );
}
