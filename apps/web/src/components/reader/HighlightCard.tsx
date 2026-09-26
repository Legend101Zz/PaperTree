'use client';

/**
 * reader/HighlightCard — one highlight, opened: its colour, its note, and Delete.
 *
 * Opened by a click on highlighted text (at the click), by Enter on a focused highlight, or by a
 * Navigator row's Edit (then centred low on the screen — a bottom sheet on a phone). Every control is
 * a real button or a textarea, reachable by Tab; Escape and a click outside close it. A colour
 * change is saved at once; the note on "Done" or when the card closes, so a half-typed note is not
 * sent on every keystroke.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { HighlightColor } from '@/lib/api/types';

import { displayQuote } from './quote';
import { HIGHLIGHT_COLORS, type ReaderHighlight } from './useHighlights';

const COLOR_NAME: Record<HighlightColor, string> = {
  amber: 'Amber',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  purple: 'Purple',
};

export interface HighlightCardProps {
  readonly highlight: ReaderHighlight;
  /**
   * Where it opened from, client px: the click, and the highlight's own top and bottom edges so the
   * card opens BESIDE the passage instead of over it. Null centres it low on the screen.
   */
  readonly at: { readonly clientX: number; readonly clientY: number; readonly top?: number; readonly bottom?: number } | null;
  readonly onColor: (color: HighlightColor) => void;
  readonly onNote: (note: string | null) => void;
  readonly onDelete: () => void;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}

function quoteOf(highlight: ReaderHighlight): string {
  return displayQuote(highlight.anchors.map((a) => a.anchor));
}

const STATUS: Record<ReaderHighlight['status'], string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Not saved',
  session: 'Kept for this session only: sample papers have no server.',
};

export function HighlightCard(props: HighlightCardProps): JSX.Element {
  const { highlight, onClose, onNote } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [note, setNote] = useState(highlight.note ?? '');
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  const originalNote = useRef(highlight.note ?? '');

  const commitNote = useCallback(() => {
    const next = noteRef.current.trim();
    if (next === originalNote.current.trim()) return;
    originalNote.current = next;
    onNote(next === '' ? null : next);
  }, [onNote]);

  const close = useCallback(() => {
    commitNote();
    onClose();
  }, [commitNote, onClose]);

  // Place it next to the click, inside the window; centred low when there is no click.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || typeof window === 'undefined') return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const margin = 16;
    if (props.at === null || window.innerWidth < 640) {
      setBox({
        left: Math.max(margin, (window.innerWidth - width) / 2),
        top: Math.max(margin, window.innerHeight - height - margin),
      });
      return;
    }
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, props.at.clientX - width / 2));
    const below = (props.at.bottom ?? props.at.clientY) + 12;
    const above = (props.at.top ?? props.at.clientY) - height - 12;
    const top = below + height + margin <= window.innerHeight ? below : Math.max(margin, above);
    setBox({ left, top });
  }, [props.at]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    const onDown = (event: PointerEvent): void => {
      if (ref.current !== null && event.target instanceof Node && !ref.current.contains(event.target)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [close]);

  const quote = quoteOf(highlight);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Highlight"
      className="pt-hlcard"
      style={box === null ? { visibility: 'hidden', left: 0, top: 0 } : { left: box.left, top: box.top }}
      data-highlight-card={highlight.highlightId}
    >
      <p className="pt-hlcard__quote">{quote === '' ? 'Highlight' : `“${quote}”`}</p>
      <div className="pt-swatches" role="group" aria-label="Colour">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="pt-swatch"
            aria-label={COLOR_NAME[color]}
            aria-pressed={highlight.color === color}
            onClick={() => props.onColor(color)}
          >
            <span
              className="pt-swatch__chip"
              style={
                {
                  '--chip-fill': `var(--pt-hl-${color})`,
                  '--chip-ink': `var(--pt-hl-${color}-ink)`,
                } as React.CSSProperties
              }
            />
          </button>
        ))}
      </div>
      <label className="mb-1 block text-[0.8125rem] font-medium" htmlFor="pt-hlcard-note">
        Note
      </label>
      <textarea
        id="pt-hlcard-note"
        className="pt-field"
        value={note}
        placeholder="Why this passage matters"
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="pt-hlcard__actions">
        <button type="button" className="pt-btn pt-btn--danger" onClick={props.onDelete}>
          Delete
        </button>
        <div className="flex items-center gap-2">
          {highlight.status === 'unsaved' ? (
            <button type="button" className="pt-btn pt-btn--outline" onClick={props.onRetry}>
              Retry saving
            </button>
          ) : null}
          <button type="button" className="pt-btn pt-btn--primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
      <p className="pt-hlcard__meta" role="status">
        {highlight.status === 'unsaved' && highlight.error !== undefined ? highlight.error : STATUS[highlight.status]}
      </p>
    </div>
  );
}
