'use client';

/**
 * A typed note or a sticky on the notebook page (S5c, #208): the person's own words in Courier
 * Prime (`data-voice="you"`). It moves by drag or by arrow keys (8 units; Shift for 24), Enter edits
 * it in place, Delete removes it. A drag moves the element with a CSS translate and commits ONE
 * history command on release, so dragging never re-renders the page (the 16 ms frame budget).
 */
import { YouText } from '@papertree/ui';
import { X } from 'lucide-react';
import { useRef } from 'react';

import type { StickyItem, TextItem } from '../model/page';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';

/** Props for `NoteItem`. */
export interface NoteItemProps {
  readonly item: TextItem | StickyItem;
  /** Screen px per page unit, to turn a pointer drag into page units. */
  readonly scale: number;
  readonly editing: boolean;
  /** Start editing in place. */
  readonly onEdit: () => void;
  /** Finish editing with this text. */
  readonly onCommit: (text: string) => void;
  /** Move by this much, in page units. */
  readonly onMove: (dx: number, dy: number) => void;
  readonly onDelete: () => void;
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** One typed note or sticky, movable and editable. */
export function NoteItem(props: NoteItemProps): ReactNode {
  const { item, scale, editing } = props;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; moved: boolean } | null>(
    null,
  );
  const noun = item.kind === 'text' ? 'typed note' : 'sticky note';

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || editing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null) return;
    d.dx = (e.clientX - d.x) / scale;
    d.dy = (e.clientY - d.y) / scale;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
    d.moved = true;
    if (ref.current !== null) ref.current.style.translate = `${String(d.dx)}px ${String(d.dy)}px`;
  };
  const onPointerUp = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d === null || !d.moved) return;
    if (ref.current !== null) ref.current.style.translate = '';
    props.onMove(Math.round(d.dx), Math.round(d.dy));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const arrow = ARROWS[e.key];
    const step = e.shiftKey ? 24 : 8;
    if (arrow !== undefined) props.onMove(arrow[0] * step, arrow[1] * step);
    else if (e.key === 'Enter' || e.key === ' ') props.onEdit();
    else if (e.key === 'Delete' || e.key === 'Backspace') props.onDelete();
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className={`pt-nb-note pt-nb-note--${item.kind}`}
      data-item-id={item.id}
      style={{ left: item.x, top: item.y, width: item.w, minHeight: item.h, zIndex: item.z + 10 }}
    >
      {editing ? (
        <textarea
          className="pt-nb-note__editor"
          aria-label={item.kind === 'text' ? 'Typed note' : 'Sticky note'}
          data-voice="you"
          defaultValue={item.text}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the person just asked to type here
          autoFocus
          onBlur={(e) => props.onCommit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <div
          className="pt-nb-note__face"
          role="button"
          tabIndex={0}
          aria-roledescription={noun}
          aria-label={`${noun[0]?.toUpperCase() ?? ''}${noun.slice(1)}: ${item.text}`}
          aria-describedby="pt-nb-note-help"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={props.onEdit}
          onKeyDown={onKeyDown}
        >
          <YouText as="div" className="pt-nb-note__text">
            {item.text}
          </YouText>
        </div>
      )}
      {editing ? null : (
        <button
          type="button"
          className="pt-nb-note__delete"
          aria-label={`Delete ${noun}`}
          onClick={props.onDelete}
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
