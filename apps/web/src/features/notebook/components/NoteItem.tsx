'use client';

/**
 * A typed note or a sticky on the notebook page (S5c, #208): the person's own words in Courier
 * Prime (`data-voice="you"`). It moves by drag or by arrow keys (8 units; Shift for 24), Enter
 * edits it in place (`NoteEditor`, which carries a 44 px Delete for touch screens), Delete removes
 * it. A drag moves the element with a CSS translate and commits ONE history command on release, so
 * dragging never re-renders the page (the 16 ms frame budget); a cancelled pointer snaps back and
 * records nothing.
 */
import { YouText } from '@papertree/ui';
import { X } from 'lucide-react';
import { memo, useRef } from 'react';

import { NoteEditor } from './NoteEditor';
import { usePointerDrag } from '../hooks/usePointerDrag';

import type { StickyItem, TextItem } from '../model/page';
import type { KeyboardEvent, ReactNode } from 'react';

/** Props for `NoteItem`. */
export interface NoteItemProps {
  readonly item: TextItem | StickyItem;
  /** Screen px per page unit, to turn a pointer drag into page units. */
  readonly scale: number;
  readonly editing: boolean;
  /** True when the notebook search matched this note; it is lit. */
  readonly matched?: boolean;
  /** Start editing this item in place. */
  readonly onEdit: (id: string) => void;
  /** Finish editing this item with this text. */
  readonly onCommit: (id: string, text: string) => void;
  /** Move this item by this much, in page units. */
  readonly onMove: (id: string, dx: number, dy: number) => void;
  readonly onDelete: (id: string) => void;
  /**
   * In the phone's stack (S5e, #210): the note flows in the column instead of sitting at its stored
   * place, and is edited and deleted there but never moved.
   */
  readonly flow?: boolean;
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Re-render only when what is drawn changes; the callbacks are `usePageEditing`'s stable,
 * id-taking actions, so they never need comparing.
 */
function sameNote(a: NoteItemProps, b: NoteItemProps): boolean {
  return (
    a.item === b.item &&
    a.scale === b.scale &&
    a.editing === b.editing &&
    a.matched === b.matched &&
    a.flow === b.flow
  );
}

/** One typed note or sticky, movable and editable. */
export const NoteItem = memo(function NoteItem(props: NoteItemProps): ReactNode {
  const { item, scale, editing } = props;
  const ref = useRef<HTMLDivElement>(null);
  const noun = item.kind === 'text' ? 'typed note' : 'sticky note';
  const place = (dx: number, dy: number): void => {
    if (ref.current !== null) {
      ref.current.style.translate = dx === 0 && dy === 0 ? '' : `${String(dx)}px ${String(dy)}px`;
    }
  };
  const drag = usePointerDrag(
    scale,
    place,
    (dx, dy) => {
      place(0, 0);
      props.onMove(item.id, dx, dy);
    },
    () => place(0, 0),
  );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const arrow = props.flow === true ? undefined : ARROWS[e.key];
    const step = e.shiftKey ? 24 : 8;
    if (arrow !== undefined) props.onMove(item.id, arrow[0] * step, arrow[1] * step);
    else if (e.key === 'Enter' || e.key === ' ') props.onEdit(item.id);
    else if (e.key === 'Delete' || e.key === 'Backspace') props.onDelete(item.id);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className={`pt-nb-note pt-nb-note--${item.kind}${props.flow === true ? ' pt-nb-note--flow' : ''}`}
      data-item-id={item.id}
      data-match={props.matched === true ? 'true' : undefined}
      style={
        props.flow === true
          ? undefined
          : { left: item.x, top: item.y, width: item.w, minHeight: item.h, zIndex: item.z + 10 }
      }
    >
      {editing ? (
        <NoteEditor
          kind={item.kind}
          initial={item.text}
          onCommit={(text) => props.onCommit(item.id, text)}
          onDelete={() => props.onDelete(item.id)}
        />
      ) : (
        <div
          className="pt-nb-note__face"
          role="button"
          tabIndex={0}
          aria-roledescription={noun}
          // The search's light is visual; the name says it too, so a screen reader hears which
          // note matched.
          aria-label={`${noun[0]?.toUpperCase() ?? ''}${noun.slice(1)}: ${item.text}${props.matched === true ? ' (matches your search)' : ''}`}
          aria-describedby={props.flow === true ? undefined : 'pt-nb-note-help'}
          // In the stack one tap edits: nothing there is dragged, so a tap means nothing else.
          {...(props.flow === true ? { onClick: () => props.onEdit(item.id) } : drag)}
          onDoubleClick={() => props.onEdit(item.id)}
          onKeyDown={onKeyDown}
        >
          <YouText as="div" className="pt-nb-note__text">
            {item.text}
          </YouText>
        </div>
      )}
      {/* No × in the stack, and none shows on a touch screen (notebook.css): a hidden button a
          stray tap can find would delete the note. There Delete is in the editor (S5e). */}
      {editing || props.flow === true ? null : (
        <button
          type="button"
          className="pt-nb-note__delete"
          aria-label={`Delete ${noun}`}
          onClick={() => props.onDelete(item.id)}
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}, sameNote);
