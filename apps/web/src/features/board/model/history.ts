/**
 * board/model/history — the board's undo and redo (#215): a stack of commands that are plain data.
 * Every gesture that writes records ONE command (a drag of several cards, a frame carrying its
 * cards, a resize that takes cards in); undo replays its inverse and redo replays it, through the
 * same API calls the gesture made (`replay`). Our own: React Flow Pro's example is paid (ADR-004 §4).
 */
import { cardName } from './flow';

import type { CreateEdgeBody, CreateNodeBody } from '@/lib/api/boards';
import type { CanvasEdge, CanvasNode, EdgeKind } from '@/lib/api/types';

/** How many steps the board remembers; past it, the oldest step is forgotten. */
export const HISTORY_CAP = 100;

/** The fields of a card a step sets: the ones `PATCH /boards/{bid}/nodes/{nid}` takes. */
export interface CardFields {
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly title?: string | null;
  readonly body?: string;
  readonly group_id?: string | null;
}

/** One card's fields before and after a step. */
export interface CardChange {
  readonly id: string;
  readonly before: CardFields;
  readonly after: CardFields;
}

/** The fields of a thread a step sets. */
export interface ThreadFields {
  readonly kind?: EdgeKind;
  readonly label?: string | null;
}

/** A card that was in a deleted frame, so a restored frame takes it back. */
export interface Member {
  readonly id: string;
  readonly groupId: string;
}

/** Rows that appear (`add`) or go (`remove`): whole snapshots, so they come back with their ids. */
export interface RowsCommand {
  readonly type: 'add' | 'remove';
  readonly label: string;
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  readonly members: readonly Member[];
}

/**
 * One step: what it changed, and its name (`label`, as in "Undo move of 3 cards"). `key` marks the
 * step an Undo toast names, so the toast can take back that step and no other (#215 review S1).
 */
export type BoardCommand = (
  | { readonly type: 'patch'; readonly label: string; readonly cards: readonly CardChange[] }
  | {
      readonly type: 'thread';
      readonly label: string;
      readonly id: string;
      readonly before: ThreadFields;
      readonly after: ThreadFields;
    }
  | RowsCommand
  | { readonly type: 'batch'; readonly label: string; readonly steps: readonly BoardCommand[] }
) & { readonly key?: string };

/** The steps that can be undone (oldest first) and the ones that can be redone (next last). */
export interface History {
  readonly past: readonly BoardCommand[];
  readonly future: readonly BoardCommand[];
}

/** A board with nothing to undo or redo. */
export const EMPTY_HISTORY: History = { past: [], future: [] };

const capped = (steps: readonly BoardCommand[], cap: number): readonly BoardCommand[] =>
  steps.length > cap ? steps.slice(steps.length - cap) : steps;

/**
 * A new step: it can be undone, and nothing can be redone any more.
 *
 * @param history The history so far.
 * @param command The step just made.
 * @param cap How many steps to keep.
 * @returns The new history.
 */
export function record(history: History, command: BoardCommand, cap = HISTORY_CAP): History {
  return { past: capped([...history.past, command], cap), future: [] };
}

/**
 * Takes the step to undo (or redo) off its stack; `settle` puts it on the other one once it has
 * been replayed, and a step whose replay failed is simply not put back.
 *
 * @param history The history.
 * @param side `undo` takes the newest past step, `redo` the next future one.
 * @returns The step and the history without it, or null when there is none.
 */
export function take(
  history: History,
  side: 'undo' | 'redo',
): { command: BoardCommand; rest: History } | null {
  const from = side === 'undo' ? history.past : history.future;
  const command = from[from.length - 1];
  if (command === undefined) return null;
  const left = from.slice(0, -1);
  return {
    command,
    rest: side === 'undo' ? { ...history, past: left } : { ...history, future: left },
  };
}

/**
 * A replayed step lands on the other stack.
 *
 * @param history The history after `take`.
 * @param command The step.
 * @param side What was done: `undo` makes it redoable, `redo` undoable again.
 * @param cap How many steps to keep.
 * @returns The new history.
 */
export function settle(
  history: History,
  command: BoardCommand,
  side: 'undo' | 'redo',
  cap = HISTORY_CAP,
): History {
  return side === 'undo'
    ? { ...history, future: capped([...history.future, command], cap) }
    : { ...history, past: capped([...history.past, command], cap) };
}

/**
 * The step that takes `command` back.
 *
 * @param command A step.
 * @returns Its inverse (same name): a batch is inverted step by step, last first.
 */
export function invert(command: BoardCommand): BoardCommand {
  switch (command.type) {
    case 'patch':
      return {
        ...command,
        cards: command.cards.map((c) => ({ id: c.id, before: c.after, after: c.before })),
      };
    case 'thread':
      return { ...command, before: command.after, after: command.before };
    case 'add':
    case 'remove':
      return { ...command, type: command.type === 'add' ? 'remove' : 'add' };
    case 'batch':
      return { ...command, steps: [...command.steps].reverse().map(invert) };
  }
}

/**
 * Whether a step changes a card (or a thread) with this id.
 *
 * @param command A step.
 * @param id A card or thread id.
 * @returns True when replaying the step would write that row.
 */
export function touches(command: BoardCommand, id: string): boolean {
  switch (command.type) {
    case 'patch':
      return command.cards.some((c) => c.id === id);
    case 'thread':
      return command.id === id;
    case 'add':
    case 'remove':
      return (
        command.nodes.some((n) => n.node_id === id) ||
        command.edges.some((e) => e.edge_id === id) ||
        command.members.some((m) => m.id === id)
      );
    case 'batch':
      return command.steps.some((s) => touches(s, id));
  }
}

/**
 * A step after its row `id` was changed somewhere else: null when its next replay would write over
 * that row (a PATCH, or a DELETE of it); else the step, less the frame members that row was (a
 * rejoin is a PATCH). A replay that only creates the row again (a delete's undo, a new card's redo)
 * overwrites nothing, so a deleted card stays restorable (#215 review S1).
 *
 * @param command The step.
 * @param id The row changed elsewhere.
 * @param creating The kind of step whose replay creates rows: `remove` when undone, `add` redone.
 * @returns The step to keep, or null.
 */
function afterConflict(
  command: BoardCommand,
  id: string,
  creating: 'add' | 'remove',
): BoardCommand | null {
  switch (command.type) {
    case 'patch':
    case 'thread':
      return touches(command, id) ? null : command;
    case 'add':
    case 'remove': {
      const row =
        command.nodes.some((n) => n.node_id === id) || command.edges.some((e) => e.edge_id === id);
      if (row && command.type !== creating) return null;
      const members = command.members.filter((m) => m.id !== id);
      return members.length === command.members.length ? command : { ...command, members };
    }
    case 'batch': {
      const steps = command.steps.map((s) => afterConflict(s, id, creating));
      if (steps.some((s) => s === null)) return null;
      const kept = steps as BoardCommand[];
      return kept.every((s, i) => s === command.steps[i]) ? command : { ...command, steps: kept };
    }
  }
}

/**
 * Forgets the steps about a row that was changed somewhere else, so no later undo or redo writes
 * over that change without the 409 that told the reader about it (#215). A step that would only
 * create the row again (bring back a deleted card) is kept: it overwrites nothing.
 *
 * @param history The history.
 * @param id The card or thread.
 * @returns The history without those steps.
 */
export function forget(history: History, id: string): History {
  const keep = (steps: readonly BoardCommand[], creating: 'add' | 'remove') =>
    steps.flatMap((c) => {
      const kept = afterConflict(c, id, creating);
      return kept === null ? [] : [kept];
    });
  return { past: keep(history.past, 'remove'), future: keep(history.future, 'add') };
}

/**
 * Whether a thread is as a step expects to find it before its replay (threads carry no version on
 * the server, so this read is the only guard; #215 review S3).
 *
 * @param edge The thread as the server has it now.
 * @param expect The fields the step left (a redo) or found (an undo).
 * @returns True when every expected field matches.
 */
export function threadIsAsLeft(
  edge: { readonly kind: EdgeKind; readonly label: string | null },
  expect: ThreadFields,
): boolean {
  return (
    (expect.kind === undefined || expect.kind === edge.kind) &&
    (expect.label === undefined || expect.label === edge.label)
  );
}

/**
 * The POST that puts a deleted card back as it was: same id, words, anchor, message, page or
 * diagram, size and place (NodeCreate has no `z`).
 *
 * @param snap The card as it was deleted.
 * @param groupId Its frame, when that frame is on the board.
 * @returns The body of `POST /papers/{id}/board/nodes`.
 */
export function restoreBody(snap: CanvasNode, groupId: string | null): CreateNodeBody {
  return {
    node_id: snap.node_id,
    kind: snap.kind,
    x: snap.x,
    y: snap.y,
    w: snap.w,
    h: snap.h,
    title: snap.title,
    body: snap.body,
    ...(snap.source_anchor === null ? {} : { source_anchor: snap.source_anchor }),
    ...(snap.source_message_id === null ? {} : { source_message_id: snap.source_message_id }),
    // A notebook or diagram card is refused without the thing it shows (S6a).
    ...(snap.source_page_id === null ? {} : { source_page_id: snap.source_page_id }),
    ...(snap.source_diagram_id === null ? {} : { source_diagram_id: snap.source_diagram_id }),
    group_id: groupId,
  };
}

/**
 * The POST that puts a deleted thread back on the pins it was drawn between (a keyboard link of
 * v0.1 has none).
 *
 * @param edge The thread as it was deleted.
 * @returns The body of `POST /boards/{bid}/edges`.
 */
export function restoreThreadBody(edge: CanvasEdge): CreateEdgeBody {
  return {
    edge_id: edge.edge_id,
    from_node_id: edge.from_node_id,
    to_node_id: edge.to_node_id,
    kind: edge.kind,
    label: edge.label,
    ...(edge.from_port === null ? {} : { from_port: edge.from_port }),
    ...(edge.to_port === null ? {} : { to_port: edge.to_port }),
  };
}

/** What the replay needs from the board; each resolves false after saying what went wrong. */
export interface ReplayIo {
  readonly patchCards: (changes: readonly { id: string; fields: CardFields }[]) => Promise<boolean>;
  /** `expect` is what the thread must be now, read from the server before the PATCH. */
  readonly patchThread: (
    id: string,
    fields: ThreadFields,
    expect: ThreadFields,
  ) => Promise<boolean>;
  readonly restore: (rows: RowsCommand) => Promise<boolean>;
  readonly remove: (rows: RowsCommand) => Promise<boolean>;
}

/**
 * Replays a step through the board's writes, in order, stopping at the first that fails.
 *
 * @param command The step (pass `invert(step)` to undo it).
 * @param io The board's writes.
 * @returns True when every write was saved.
 */
export async function replay(command: BoardCommand, io: ReplayIo): Promise<boolean> {
  switch (command.type) {
    case 'patch':
      return io.patchCards(command.cards.map((c) => ({ id: c.id, fields: c.after })));
    case 'thread':
      return io.patchThread(command.id, command.after, command.before);
    case 'add':
      return io.restore(command);
    case 'remove':
      return io.remove(command);
    case 'batch':
      for (const step of command.steps) if (!(await replay(step, io))) return false;
      return true;
  }
}

/** The modifier and key a keyboard event carries (a `KeyboardEvent` is one). */
export interface KeyPress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Which history key a press is: Cmd/Ctrl+Z undoes; Shift+Cmd/Ctrl+Z and Ctrl+Y redo.
 *
 * @param press The key press.
 * @returns `undo`, `redo`, or null for any other key.
 */
export function historyKey(press: KeyPress): 'undo' | 'redo' | null {
  if (press.altKey || !(press.metaKey || press.ctrlKey)) return null;
  const key = press.key.toLowerCase();
  if (key === 'z') return press.shiftKey ? 'redo' : 'undo';
  return key === 'y' && press.ctrlKey && !press.metaKey && !press.shiftKey ? 'redo' : null;
}

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? `a ${one}` : `${String(n)} ${many}`;

/**
 * What a step is about, for its name: one card by its words, else the counts.
 *
 * @param nodes The cards and frames the step changes.
 * @param threads How many threads it changes on their own.
 * @returns E.g. `“Next: read 3.2”`, `3 cards`, `2 cards and a frame`, `a thread`.
 */
export function itemsPhrase(nodes: readonly CanvasNode[], threads = 0): string {
  const only = nodes[0];
  if (nodes.length === 1 && threads === 0 && only !== undefined) return cardName(only);
  const frames = nodes.filter((n) => n.kind === 'group').length;
  const parts = [
    nodes.length - frames > 0 ? plural(nodes.length - frames, 'card', 'cards') : null,
    frames > 0 ? plural(frames, 'frame', 'frames') : null,
    threads > 0 ? plural(threads, 'thread', 'threads') : null,
  ].filter((p): p is string => p !== null);
  return parts.join(' and ');
}
