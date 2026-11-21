'use client';

/**
 * board/hooks/useBoardUi — what is open on the board and the gestures that open and close it: path
 * focus, the ask box and its Uses pickers, the span menu, the Outline and the export sheet. The
 * state is `model/ui`; Escape is `escapeStep`, so one press closes one level everywhere.
 *
 * The level a reader picks is remembered per board (`localStorage`, behind try/catch) and starts
 * their next ask; the other Uses reset with each ask box.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { defaultUses, readBoardLevel, writeBoardLevel } from '../model/askPayload';
import {
  CALM,
  escapeStep,
  type BoardUi,
  type Draft,
  type MenuState,
  type PickerName,
} from '../model/ui';

import type { AskLevel, AskUses, ParentSpan } from '@/lib/api/types';

/** What the board has open, and every way to change it. */
export interface BoardUiControl {
  readonly ui: BoardUi;
  /** What a fresh ask starts with. */
  readonly freshUses: AskUses;
  readonly focus: (id: string | null) => void;
  /** Opens the ask box on a card (an Ask edge, "Ask differently"), or from words in it. */
  readonly openAsk: (
    parentId: string,
    options?: { span?: ParentSpan | null; askDifferently?: boolean },
  ) => void;
  /** The "Follow up…" stub grows into the full box. */
  readonly growStub: (stub: Draft) => void;
  readonly setText: (text: string) => void;
  readonly setUses: (patch: Partial<AskUses>) => void;
  readonly closeDraft: () => void;
  readonly pick: (name: PickerName | null) => void;
  readonly openMenu: (menu: MenuState | null) => void;
  readonly setOutline: (on: boolean) => void;
  readonly setSheet: (on: boolean) => void;
  /** One press of Escape: true when something was closed. */
  readonly escape: () => boolean;
}

const storage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/**
 * The board's open things for one board.
 *
 * @param boardId The board (the remembered level is kept per board); null before it loads.
 * @returns The state and its gestures.
 */
export function useBoardUi(boardId: string | null): BoardUiControl {
  const [ui, setUi] = useState<BoardUi>(CALM);
  const [level, setLevel] = useState<AskLevel | null>(null);
  const remembered = useMemo(
    () => level ?? (boardId === null ? 'familiar' : readBoardLevel(storage(), boardId)),
    [boardId, level],
  );
  const freshUses = useMemo(() => defaultUses(remembered), [remembered]);

  const focus = useCallback(
    (id: string | null) =>
      setUi((u) =>
        u.focusId === id ? u : { ...u, focusId: id, draft: null, picker: null, menu: null },
      ),
    [],
  );
  const openAsk = useCallback<BoardUiControl['openAsk']>(
    (parentId, options = {}) =>
      setUi((u) => ({
        ...u,
        focusId: parentId,
        menu: null,
        picker: null,
        draft: {
          parentId,
          span: options.span ?? null,
          askDifferently: options.askDifferently === true,
          expanded: true,
          text: '',
          uses: freshUses,
        },
      })),
    [freshUses],
  );
  const growStub = useCallback(
    (stub: Draft) => setUi((u) => ({ ...u, draft: { ...stub, expanded: true } })),
    [],
  );
  const setText = useCallback(
    (text: string) => setUi((u) => (u.draft === null ? u : { ...u, draft: { ...u.draft, text } })),
    [],
  );
  const setUses = useCallback(
    (patch: Partial<AskUses>) => {
      if (patch.level !== undefined) {
        setLevel(patch.level);
        if (boardId !== null) writeBoardLevel(storage(), boardId, patch.level);
      }
      setUi((u) =>
        u.draft === null ? u : { ...u, draft: { ...u.draft, uses: { ...u.draft.uses, ...patch } } },
      );
    },
    [boardId],
  );
  const closeDraft = useCallback(() => setUi((u) => ({ ...u, draft: null, picker: null })), []);
  const pick = useCallback(
    (name: PickerName | null) => setUi((u) => ({ ...u, picker: u.picker === name ? null : name })),
    [],
  );
  const openMenu = useCallback((menu: MenuState | null) => setUi((u) => ({ ...u, menu })), []);
  const setOutline = useCallback(
    (on: boolean) => setUi((u) => ({ ...u, outline: on, sheet: false })),
    [],
  );
  const setSheet = useCallback((on: boolean) => setUi((u) => ({ ...u, sheet: on })), []);

  // Escape must say at once whether it closed something: it reads the state as last drawn.
  const latest = useRef(ui);
  latest.current = ui;
  const escape = useCallback((): boolean => {
    const step = escapeStep(latest.current);
    if (step.used) setUi(step.ui);
    return step.used;
  }, []);

  return {
    ui,
    freshUses,
    focus,
    openAsk,
    growStub,
    setText,
    setUses,
    closeDraft,
    pick,
    openMenu,
    setOutline,
    setSheet,
    escape,
  };
}
