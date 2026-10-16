'use client';

/**
 * board/cards/CardShell — what every card shares: the stock it is cut from (index card, call slip,
 * or bare for the slip cards), the resize handles, the link handles and select-on-click; and the
 * person's stamp. Each card kind fills it with its own voice; long bodies go in a `ClipBody`.
 *
 * No hover-only actions: every action is a visible button.
 */
import { Handle, NodeResizer, Position, useStoreApi } from '@xyflow/react';
import { type MouseEvent, type ReactNode } from 'react';

import { useCanvasActions } from '../BoardContext';

/** Props for `CardShell`. */
export interface CardShellProps {
  readonly id: string;
  readonly selected: boolean;
  /** The wire kind, published as `data-kind` for styles and tests. */
  readonly kind: string;
  /** `card` = ruled index card, `call` = call slip, `bare` = the card is its slips. */
  readonly stock: 'card' | 'call' | 'bare';
  readonly children: ReactNode;
}

/**
 * The card around a kind's content.
 *
 * @example
 * <CardShell id={id} selected={selected} kind="note" stock="card">…</CardShell>
 */
export function CardShell({ id, selected, kind, stock, children }: CardShellProps): ReactNode {
  const ctx = useCanvasActions();
  const store = useStoreApi();
  // S9: a click ANYWHERE on a card selects it, not only on its header. React Flow selects on
  // pointer-down; this is the safety net for a click that reaches the card without it (the
  // card body, text inside it). Editors, links and buttons keep their own behaviour, a modifier
  // click is React Flow's own multi-select, and an already-selected card is left alone.
  const selectOnClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (selected || event.shiftKey || event.metaKey || event.ctrlKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input, textarea, select, [contenteditable="true"]') !== null)
      return;
    store.getState().addSelectedNodes([id]);
  };
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={`pt-bc pt-bc--${stock}`}
      data-kind={kind}
      data-selected={selected}
      onClick={selectOnClick}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={100}
        handleClassName="pt-cv-resize"
        lineClassName="pt-cv-resize-line"
        onResizeEnd={(_, p) => ctx.commitSize(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
      />
      <Handle type="target" position={Position.Left} className="pt-cv-handle" />
      {children}
      <Handle type="source" position={Position.Right} className="pt-cv-handle" />
    </div>
  );
}

/** Props for `Stamp`. */
export interface StampProps {
  /** The account's initial. Default `M`. */
  readonly initial?: string;
}

/** The person's stamp on their own cards (question, note): the call slip's own. Decorative. */
export function Stamp({ initial = 'M' }: StampProps): ReactNode {
  return (
    <span className="pt-call-slip__stamp pt-bc__stamp" aria-hidden="true">
      {initial}
    </span>
  );
}
