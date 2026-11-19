/**
 * board/hooks/controllerShared — the words, constants and types every controller hook shares.
 * They live apart from the hooks so each hook file stays small and none imports another for a
 * constant. `useBoardController` re-exports the public ones, so existing imports keep working.
 */
import { ApiError, type Board, type EdgeKind, type FromPort, type ToPort } from '@/lib/api/types';

import type { Viewport } from '@xyflow/react';
import type { EdgeChange, NodeChange } from '@xyflow/react';
import type { PtEdge, PtNode } from '../model/flow';
import type { BoardHistory } from './useBoardHistory';

export const NUDGE_DEBOUNCE_MS = 400;
/** How long the Undo offer after a delete stays on screen. */
export const UNDO_VISIBLE_MS = 8000;
/** How long the "changed somewhere else" notice stays when nothing else clears it first. */
export const STALE_NOTICE_MS = 8000;

/** The end of every sentence that follows a reload. */
export const RELOADED = 'The board was reloaded from your last saved version.';
/** The toast's Undo when its step is no longer the newest one (#215 review S1). */
export const NOT_NEWEST =
  'That was not undone: the board changed after it. Undo in the toolbar takes back the newest change first.';

/** The Undo toast after a delete or a new thread: its words (its Undo is the history's). */
export interface UndoOffer {
  readonly token: number;
  readonly message: string;
}

/** The pins a thread was drawn between. */
export interface ThreadPorts {
  readonly from_port: FromPort | null;
  readonly to_port: ToPort | null;
}

/** Where the board's first read stands. */
export type Status = 'loading' | 'ready' | 'error';

/** Everything `BoardView` needs: the state and every gesture that writes. */
export interface BoardController {
  readonly status: Status;
  readonly board: Board | null;
  readonly nodes: PtNode[];
  readonly edges: PtEdge[];
  readonly notice: string | null;
  readonly editingId: string | null;
  readonly setEditingId: (id: string | null) => void;
  readonly dismissNotice: () => void;
  /** The Undo offer after a delete or a new thread (8 s), or null. */
  readonly undo: UndoOffer | null;
  /** The toast's Undo: the history's newest step, which is the one the toast names. */
  readonly runUndo: () => Promise<void>;
  /** Undo and redo of every gesture that writes (#215). */
  readonly history: BoardHistory;
  readonly dismissUndo: () => void;
  /** Several deletes that arrive in one gesture (cards AND their links) become one Undo. */
  readonly deleteSelection: (nodeIds: readonly string[], edgeIds: readonly string[]) => void;
  readonly reload: () => Promise<void>;
  readonly onNodesChange: (changes: NodeChange<PtNode>[]) => void;
  readonly onEdgesChange: (changes: EdgeChange<PtEdge>[]) => void;
  readonly onNodeDragStop: () => void;
  readonly addNote: (near?: { x: number; y: number }) => Promise<void>;
  /** An empty frame in clear space nearest `centre` (the view's middle), its name ready to type. */
  readonly addFrame: (centre: { x: number; y: number }) => Promise<void>;
  readonly commitBody: (id: string, body: string) => void;
  readonly commitTitle: (id: string, title: string) => void;
  readonly commitSize: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  readonly deleteNodes: (ids: readonly string[]) => void;
  readonly deleteEdges: (ids: readonly string[]) => void;
  /**
   * A thread between two cards, drawn between `ports`; resolves true once the server saved it, and
   * offers Undo for 8 s ("Linked as supports.", the toast every delete uses).
   */
  readonly connect: (
    from: string,
    to: string,
    kind: EdgeKind,
    label: string | null,
    ports?: ThreadPorts,
  ) => Promise<boolean>;
  readonly patchEdge: (id: string, fields: { kind?: EdgeKind; label?: string | null }) => void;
  readonly groupNodes: (ids: readonly string[]) => Promise<void>;
  readonly saveViewport: (viewport: Viewport) => void;
  readonly initialViewport: Viewport | null;
}

/**
 * "The card “first words”", "A passage" ... the start of the stale-version sentence.
 *
 * @param card The card's `cardName`, or undefined when it is gone.
 * @returns The sentence's subject.
 */
export function staleSubject(card: string | undefined): string {
  if (card === undefined) return 'A card';
  return card.startsWith('“')
    ? `The card ${card}`
    : `${card.charAt(0).toUpperCase()}${card.slice(1)}`;
}

/**
 * The sentence a failed request tells the reader: the server's own, unless it is an internal error.
 *
 * @param error What the request threw.
 * @param fallback What to say when the server gave no usable sentence.
 * @returns The sentence.
 */
export function sentence(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status !== 0 && error.detail.trim() !== '') {
    return error.code === 'internal' ? fallback : error.detail;
  }
  return fallback;
}
