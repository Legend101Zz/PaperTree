'use client';

/**
 * reader/SelectionItems — what the selection menu holds, in the prototype's order (P4 step 5):
 * Explain · Ask… · Send to board (Board beside / Just send) · Note · the five highlight colours.
 * No Copy (the selection is still a real selection, so the browser's own copy works) and no
 * "Explain with a diagram" (diagrams now live inside answers, #339).
 *
 * Every item is drawn only when the caller wired it, so the bar never shows an inert button. The
 * shell (`SelectionToolbar`) owns placement, measuring and roving focus; this owns the contents.
 */

import {
  Check,
  ChevronDown,
  Highlighter,
  MessageSquare,
  PanelRight,
  Pin,
  StickyNote,
  Type,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { HIGHLIGHT_COLORS } from './useHighlights';

import type { HighlightColor } from '@/lib/api/types';
import type { CSSProperties, ReactNode } from 'react';

/** The two ways to send a passage to the board (#349): open it beside the paper, or stay reading. */
export type SendToBoardHow = 'beside' | 'just-send';

/** What the menu can do; everything but `onHighlight` is optional and drawn only when given. */
export interface SelectionActions {
  /** Highlight in the colour pressed. */
  readonly onHighlight: (color: HighlightColor) => void;
  /** Explain this passage now (the default question). */
  readonly onExplain?: () => void;
  /** Open the panel on this passage with the question box ready for the reader's own words. */
  readonly onAsk?: () => void;
  readonly onSendToBoard?: (how: SendToBoardHow) => void;
  /** Make a highlight and open its note field. */
  readonly onNote?: () => void;
  /**
   * Why Highlight (and Note, which makes one) cannot be used on this selection, or undefined. SHOWN
   * in the bar, not only as a tooltip: a disabled button with no visible reason is a dead end.
   */
  readonly highlightDisabledReason?: string;
}

const NOTE_ID = 'pt-seltool-note';
const SUB_ID = 'pt-seltool-send';
const ICON = 18;

function Item(props: {
  readonly label: string;
  /** The label in a docked row, where room is short ("Board" for "Send to board"). */
  readonly short?: string;
  /** Draw the short label. */
  readonly compact?: boolean;
  readonly icon: ReactNode;
  readonly onActivate: () => void;
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly primary?: boolean;
  readonly expanded?: boolean;
  readonly controls?: string;
}): ReactNode {
  return (
    <button
      type="button"
      className={`pt-toolbtn pt-seltool__item${props.primary === true ? ' pt-seltool__item--primary' : ''}`}
      aria-label={props.label}
      title={props.label}
      {...(props.describedBy === undefined ? {} : { 'aria-describedby': props.describedBy })}
      {...(props.expanded === undefined
        ? {}
        : {
            'aria-haspopup': 'true',
            'aria-expanded': props.expanded,
            'aria-controls': props.controls,
          })}
      // Native `disabled` (v0.1's contract, `e2e/s4/selection-regressions`): the reason is in the
      // bar beside it, so nobody has to focus the button to learn it.
      disabled={props.disabled === true}
      onClick={props.onActivate}
    >
      <span className="pt-toolbtn__icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="pt-toolbtn__label">
        {props.compact === true && props.short !== undefined ? props.short : props.label}
      </span>
      {props.expanded === undefined ? null : (
        <ChevronDown
          className="pt-seltool__chevron"
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/** Send to board and its two choices. Opening it puts focus on the first choice. */
function SendToBoard(props: {
  readonly send: (how: SendToBoardHow) => void;
  readonly compact: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const sub = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open) sub.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);
  const choose = (how: SendToBoardHow): void => {
    setOpen(false);
    props.send(how);
  };
  return (
    <div className="pt-seltool__send">
      <Item
        label="Send to board"
        short="Board"
        compact={props.compact}
        icon={<Pin size={ICON} strokeWidth={1.5} />}
        onActivate={() => setOpen((o) => !o)}
        expanded={open}
        controls={SUB_ID}
      />
      {open ? (
        <div
          ref={sub}
          id={SUB_ID}
          role="group"
          aria-label="Send to board"
          className="pt-seltool__sub"
        >
          <button
            type="button"
            className="pt-toolbtn pt-seltool__item"
            onClick={() => choose('beside')}
          >
            <span className="pt-toolbtn__icon" aria-hidden="true">
              <PanelRight size={ICON} strokeWidth={1.5} />
            </span>
            <span className="pt-toolbtn__label">Board beside</span>
            <small className="pt-seltool__hint">opens it next to the paper</small>
          </button>
          <button
            type="button"
            className="pt-toolbtn pt-seltool__item"
            onClick={() => choose('just-send')}
          >
            <span className="pt-toolbtn__icon" aria-hidden="true">
              <Check size={ICON} strokeWidth={1.5} />
            </span>
            <span className="pt-toolbtn__label">Just send</span>
            <small className="pt-seltool__hint">keep reading</small>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Washes(
  props: Pick<SelectionActions, 'onHighlight' | 'highlightDisabledReason'>,
): ReactNode {
  const off = props.highlightDisabledReason !== undefined;
  return (
    <span
      className="pt-seltool__washes"
      role="group"
      aria-label="Highlight colour"
      {...(off ? { 'aria-describedby': NOTE_ID } : {})}
    >
      <Highlighter
        className="pt-seltool__washicon"
        size={ICON}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="pt-seltool__wash"
          aria-label={`Highlight in ${color}`}
          disabled={off}
          style={
            {
              '--wash-fill': `var(--pt-hl-${color})`,
              '--wash-ink': `var(--pt-hl-${color}-ink)`,
            } as CSSProperties
          }
          onClick={() => props.onHighlight(color)}
        />
      ))}
    </span>
  );
}

/**
 * The menu's contents.
 *
 * @param props - The actions; an item without its action is not drawn. `compact`: the docked row's
 *   short labels.
 * @returns The items, a separator, the colours, and the reason Highlight is off when it is.
 */
export function SelectionItems(
  props: SelectionActions & { readonly compact?: boolean },
): ReactNode {
  const reason = props.highlightDisabledReason;
  return (
    <>
      {props.onExplain === undefined ? null : (
        <Item
          label="Explain"
          icon={<MessageSquare size={ICON} strokeWidth={1.5} />}
          onActivate={props.onExplain}
          primary
        />
      )}
      {props.onAsk === undefined ? null : (
        <Item label="Ask…" icon={<Type size={ICON} strokeWidth={1.5} />} onActivate={props.onAsk} />
      )}
      {props.onSendToBoard === undefined ? null : (
        <SendToBoard send={props.onSendToBoard} compact={props.compact === true} />
      )}
      {props.onNote === undefined ? null : (
        <Item
          label="Note"
          icon={<StickyNote size={ICON} strokeWidth={1.5} />}
          onActivate={props.onNote}
          disabled={reason !== undefined}
        />
      )}
      <span className="pt-seltool__sep" aria-hidden="true" />
      <Washes {...props} />
      {reason === undefined ? null : (
        <p id={NOTE_ID} className="pt-seltool__note">
          {reason}
        </p>
      )}
    </>
  );
}
