/**
 * test/branch-harness — what the branching cards need around them in a test: the board's tree, a
 * layout, the open-things state and every gesture as a spy. `branchActions(rows)` builds the value
 * `BranchProvider` takes; `ui` and `over` change what a test cares about.
 */
import { vi } from 'vitest';

import type { BoardHost } from '@/features/board/components/BoardHost';
import type { BranchActions } from '@/features/board/components/BranchContext';
import type { BoardUiControl } from '@/features/board/hooks/useBoardUi';
import type { BranchBoard } from '@/features/board/hooks/useBranchBoard';
import { defaultUses } from '@/features/board/model/askPayload';
import { layoutBoard } from '@/features/board/model/layout';
import { buildTree } from '@/features/board/model/tree';
import { CALM, type BoardUi } from '@/features/board/model/ui';
import type { CanvasNode } from '@/lib/api/types';

/** A `BoardUiControl` whose gestures are spies, over the state `ui` describes. */
export function uiControl(ui: Partial<BoardUi> = {}): BoardUiControl {
  return {
    ui: { ...CALM, ...ui },
    freshUses: defaultUses(),
    focus: vi.fn(),
    openAsk: vi.fn(),
    growStub: vi.fn(),
    setText: vi.fn(),
    setUses: vi.fn(),
    closeDraft: vi.fn(),
    pick: vi.fn(),
    openMenu: vi.fn(),
    setOutline: vi.fn(),
    setSheet: vi.fn(),
    escape: vi.fn(() => false),
  };
}

/**
 * The value for `BranchProvider`.
 *
 * @param rows Every card of the board (the tree is built from them).
 * @param over What the test replaces.
 * @param ui What is open.
 * @returns The branching board's actions.
 */
export function branchActions(
  rows: readonly CanvasNode[] = [],
  over: Partial<BranchActions> = {},
  ui: Partial<BoardUi> = {},
): BranchActions {
  const tree = buildTree(rows);
  return {
    tree,
    layout: layoutBoard(tree, { viewportHeight: 800, measure: () => undefined }),
    control: uiControl(ui),
    draft: null,
    streams: new Map(),
    reports: { height: vi.fn(), spanY: vi.fn() },
    send: vi.fn(() => Promise.resolve(true)),
    quick: vi.fn(() => Promise.resolve(true)),
    keepNote: vi.fn(() => Promise.resolve()),
    retry: vi.fn(() => Promise.resolve(true)),
    stop: vi.fn(),
    fold: vi.fn(),
    openSource: vi.fn(),
    visiblePages: new Set<number>(),
    beside: false,
    stage: { current: null },
    ...over,
  };
}

/**
 * A `BranchBoard` for the tools bar: the tree of `rows`, `ui` open things, spies for Tidy and Fold.
 *
 * @param rows Every card of the board.
 * @param ui What is open.
 * @returns The branching board as `useBoardTools` reads it.
 */
export function branchBoard(
  rows: readonly CanvasNode[] = [],
  ui: Partial<BoardUi> = {},
): BranchBoard {
  const actions = branchActions(rows, {}, ui);
  return {
    control: actions.control,
    view: {
      tree: actions.tree,
      layout: actions.layout,
      draft: null,
      nodes: [],
      reports: actions.reports,
      heights: new Map(),
      onNodesChange: vi.fn(),
      onDragStop: vi.fn(),
    },
    ask: {
      streams: new Map(),
      sending: false,
      send: actions.send,
      quick: actions.quick,
      keepNote: actions.keepNote,
      retry: actions.retry,
      stop: actions.stop,
      fold: vi.fn(),
      tidy: vi.fn(() => Promise.resolve()),
    },
    actions,
    onPath: null,
    arrivalCard: null,
  };
}

/**
 * The board's host for a test: on its own page by default, or beside the paper.
 *
 * @param over What the test replaces.
 * @returns The host.
 */
export function hostOf(over: Partial<BoardHost> = {}): BoardHost {
  return {
    beside: false,
    visiblePages: new Set<number>(),
    arrival: null,
    dragIn: null,
    showInPaper: vi.fn(),
    onBranched: vi.fn(),
    onEscapeUnused: vi.fn(),
    toggleSplit: vi.fn(),
    ...over,
  };
}
