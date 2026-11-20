'use client';

/**
 * reader/useImageActions — what the selection menu does with a picked picture (v0.3 #348, items 3, 4
 * and 8): the same menu and the same docked behaviour as for words, with these meanings.
 *
 *   Explain / Ask…  open the panel on an `image` thread; the reader's words with the picture (a
 *                   paragraph or the caption, selected with Shift) ride as `with_text_anchor`.
 *   Send to board   an excerpt whose anchor is the image anchor and whose body is the caption: an
 *                   image root, whose asks all send the crop.
 *   Note            a highlight over the REGION ONLY (the API accepts an image anchor with no text
 *                   quote) with its card open on the note field; the selected words, if any, join it
 *                   as more anchors of the same highlight.
 *   a colour        the same highlight, kept.
 *
 * Enter on the focused selection explains, as it does for words.
 */
import { useCallback, useEffect, useMemo } from 'react';

import { useReaderActions } from '@/components/reader/actions';
import { holdScroll } from '@/components/reader/scrollHold';
import { defaultAnchorId } from '@/components/reader/useSelectionCapture';
import { buildImageAnchor, floatCardBody, type ImageAsk } from '@/lib/imageAnchor';

import { pickLabel, type ImagePick } from '../model/imagePick';

import type { Anchor, IndexedDocument } from '@papertree/anchoring';
import type { SelectionActions, SendToBoardHow } from '@/components/reader/SelectionItems';
import type { NoteAt } from '@/components/reader/useSelectionActions';
import type { SelectionCapture } from '@/components/reader/useSelectionCapture';
import type { ExplainInput } from '@/components/reader/actions';
import type { HighlightColor } from '@/lib/api/types';

/** What `useImageActions` needs. */
export interface UseImageActionsArgs {
  readonly pick: ImagePick | null;
  readonly doc: IndexedDocument | null;
  /** The live text selection, captured: the words asked with the picture. */
  readonly captureText: () => SelectionCapture | null;
  /** Drops the picture and the words with it. */
  readonly clear: () => void;
  /** The scroller, for `holdScroll` and to find the frame's box. */
  readonly root: HTMLElement | null;
  /** Keeps a highlight over these anchors, in the colour pressed. */
  readonly onCreateAnchors: (anchors: readonly Anchor[], color?: HighlightColor) => void;
  /** Keeps it and opens its card on the note field; the Note item is drawn only when given. */
  readonly onNoteAnchors?: (anchors: readonly Anchor[], at: NoteAt | null) => void;
  readonly onOpenBoard?: (cardId: string | null) => void;
  readonly onNotice?: (message: string) => void;
  readonly highlightDisabledReason?: string | undefined;
}

/**
 * The anchor a pick becomes: a fresh id, the time, and the float's block when it is a whole float.
 *
 * @param doc The parse.
 * @param pick The picked picture.
 * @returns The image anchor.
 */
export function anchorForPick(doc: IndexedDocument, pick: ImagePick): Anchor {
  return buildImageAnchor({
    doc,
    page: pick.page,
    box: pick.box,
    kind: pick.kind,
    ...(pick.float === null ? {} : { block: pick.float.block }),
    id: defaultAnchorId(),
    at: new Date().toISOString(),
    client: 'papertree-web/reader',
  });
}

/** Things that take Enter for themselves. */
const TAKES_ENTER =
  'button, a[href], input, textarea, select, [role="button"], [role="toolbar"], [contenteditable]';

/**
 * The menu's actions for a picked picture.
 *
 * @param args The pick, the parse and what the reader shell provides.
 * @returns The actions for `useSelectionToolbar`, or null while nothing is picked.
 */
export function useImageActions(args: UseImageActionsArgs): SelectionActions | null {
  const { pick, doc, captureText, clear, root, onCreateAnchors, onNoteAnchors, onOpenBoard } = args;
  const { onNotice, highlightDisabledReason } = args;
  const actions = useReaderActions();

  const anchorOf = useCallback(
    () => (pick === null || doc === null ? null : anchorForPick(doc, pick)),
    [pick, doc],
  );

  /** What the panel opens on, with the words selected beside the picture. */
  const askInput = useCallback((): ExplainInput | null => {
    const anchor = anchorOf();
    if (anchor === null || pick === null) return null;
    const text = captureText();
    const image: ImageAsk = {
      label: pickLabel(pick),
      caption: pick.float?.caption ?? null,
      ...(text === null ? {} : { withText: { anchor: text.anchor, quote: text.selection.text } }),
    };
    return { anchor, quote: text?.selection.text ?? '', image };
  }, [anchorOf, pick, captureText]);

  const onExplain = useCallback(() => {
    const input = askInput();
    if (input === null) return;
    actions.openExplain(input);
    clear();
  }, [actions, askInput, clear]);

  const askAbout = actions.askAbout;
  const onAsk = useCallback(() => {
    const input = askInput();
    if (input === null) return;
    askAbout?.(input);
    clear();
  }, [askAbout, askInput, clear]);

  const onSendToBoard = useCallback(
    (how: SendToBoardHow) => {
      const anchor = anchorOf();
      if (anchor === null || pick === null) return;
      holdScroll(root);
      const caption =
        pick.float === null ? '' : floatCardBody(pick.float.caption, pick.float.label);
      clear();
      const beside = how === 'beside' && onOpenBoard !== undefined;
      actions
        .sendToCanvas({ kind: 'excerpt', anchor, body: caption, toast: beside ? 'none' : 'added' })
        .then((cardId) => {
          if (beside) onOpenBoard(cardId ?? null);
        })
        .catch(() => onNotice?.("Couldn't send this picture to the board. Try again."));
    },
    [actions, anchorOf, clear, onNotice, onOpenBoard, pick, root],
  );

  /** The region's anchor first, then the words selected with it. */
  const highlightAnchors = useCallback(() => {
    const anchor = anchorOf();
    if (anchor === null) return null;
    return [anchor, ...(captureText()?.anchors ?? [])];
  }, [anchorOf, captureText]);

  const onHighlight = useCallback(
    (color: HighlightColor) => {
      const made = highlightAnchors();
      if (made === null) return;
      holdScroll(root);
      onCreateAnchors(made, color);
      clear();
    },
    [clear, highlightAnchors, onCreateAnchors, root],
  );

  const onNote = useMemo(
    () =>
      onNoteAnchors === undefined
        ? undefined
        : () => {
            const frame = root?.querySelector('[data-pt-imgframe]')?.getBoundingClientRect();
            const at: NoteAt | null =
              frame === undefined
                ? null
                : {
                    clientX: (frame.left + frame.right) / 2,
                    clientY: frame.top,
                    top: frame.top,
                    bottom: frame.bottom,
                  };
            const made = highlightAnchors();
            if (made === null) return;
            onNoteAnchors(made, at);
            clear();
          },
    [clear, highlightAnchors, onNoteAnchors, root],
  );

  const has = pick !== null;
  // Enter on the focused selection explains it, as for words; the menu's own buttons keep theirs.
  useEffect(() => {
    if (!has) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.key !== 'Enter' || event.isComposing) return;
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TAKES_ENTER) != null) return;
      event.preventDefault();
      onExplain();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [has, onExplain]);

  return useMemo(
    () =>
      has
        ? {
            onHighlight,
            onExplain,
            ...(askAbout === undefined ? {} : { onAsk }),
            onSendToBoard,
            ...(onNote === undefined ? {} : { onNote }),
            ...(highlightDisabledReason === undefined ? {} : { highlightDisabledReason }),
          }
        : null,
    [has, onHighlight, onExplain, askAbout, onAsk, onSendToBoard, onNote, highlightDisabledReason],
  );
}
