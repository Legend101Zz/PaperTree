/**
 * board/model/askPayload — what an ask on the board says and sends (v03-BOARD-SPEC rules 3, 5, 8).
 *
 * The feedforward line above the ask box ("Uses: this path · the paper · Familiar · may draw a
 * diagram") shows what the AI is about to assume; each dotted item opens a picker, and "this
 * path" lists exactly what will be read. This module holds the defaults, the quick asks, the
 * request body and that list, all pure. The last level chosen on a board is remembered per board
 * in `localStorage`; the storage is passed in, so tests need no browser.
 */
import { isImageAnchor, pictureNameOf } from '@/lib/imageAnchor';

import { firstLine, firstSentence } from './answerText';
import { spanWords } from './spans';
import {
  branchFor,
  pathTo,
  rightChildren,
  childrenOf,
  type BoardTree,
  type TreeNodeInput,
} from './tree';

import type { AskBody, QuickAskName } from '@/lib/api/boards';
import type { AskLevel, AskUses, BoardBranch, ParentSpan } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

/** The level every ask starts at. */
export const DEFAULT_LEVEL: AskLevel = 'familiar';
/** The server's limit on a typed question (rule: 1..2000). */
export const MAX_QUESTION_LENGTH = 2000;

/** The three quick asks of the span mini menu (Simpler, Example, Diagram). */
export type QuickAsk = QuickAskName;

/** What a quick ask sets. `level` and `diagram` are left out when the quick ask keeps the reader's. */
export const QUICK_ASKS: Readonly<
  Record<
    QuickAsk,
    {
      readonly label: string;
      readonly question: string;
      readonly level?: AskLevel;
      readonly diagram?: AskUses['diagram'];
    }
  >
> = {
  simpler: { label: 'Simpler', question: 'Explain this more simply.', level: 'new' },
  example: { label: 'Example', question: 'Give me a concrete example of this.' },
  diagram: { label: 'Diagram', question: 'Draw this as a small diagram.', diagram: 'always' },
};

/** The words of the level and diagram pickers, as the feedforward line shows them. */
export const LEVEL_LABELS: Readonly<Record<AskLevel, string>> = {
  new: 'New to this',
  familiar: 'Familiar',
  expert: 'Expert',
};
export const DIAGRAM_LABELS: Readonly<Record<AskUses['diagram'], string>> = {
  may: 'may draw a diagram',
  never: 'no diagram',
  always: 'always a diagram',
};

/** The shape of `localStorage` this module needs; null when storage is unavailable. */
export type LevelStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

/**
 * The key a board's last-used level is kept under.
 *
 * @param boardId The board.
 * @returns The storage key.
 */
export function levelStorageKey(boardId: string): string {
  return `papertree.board.${boardId}.level`;
}

const isLevel = (value: unknown): value is AskLevel =>
  value === 'new' || value === 'familiar' || value === 'expert';

/**
 * The level this board last used, or the default. Storage can be missing or throw (a private
 * window, blocked site data), and the page must still work, so every failure reads as "no choice".
 *
 * @param storage `localStorage`, or null.
 * @param boardId The board.
 * @returns The remembered level, else `familiar`.
 */
export function readBoardLevel(storage: LevelStorage, boardId: string): AskLevel {
  try {
    const stored = storage?.getItem(levelStorageKey(boardId)) ?? null;
    return isLevel(stored) ? stored : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

/**
 * Remembers the level chosen on this board for its next ask.
 *
 * @param storage `localStorage`, or null.
 * @param boardId The board.
 * @param level The level just chosen.
 */
export function writeBoardLevel(storage: LevelStorage, boardId: string, level: AskLevel): void {
  try {
    storage?.setItem(levelStorageKey(boardId), level);
  } catch {
    // A remembered level is a convenience: failing to keep it must not stop an ask.
  }
}

/**
 * The Uses a fresh ask starts with: the path on, the paper's page, the board's last level, and the
 * model free to draw a diagram.
 *
 * @param level The board's remembered level.
 * @returns The defaults.
 */
export function defaultUses(level: AskLevel = DEFAULT_LEVEL): AskUses {
  return { path: true, paper: 'page', level, diagram: 'may', extra_node_ids: [] };
}

/**
 * A quick ask's Uses: Simpler sets the level to New to this, Diagram sets the diagram to always,
 * Example changes neither. The reader's other choices stay.
 *
 * @param quick Which quick ask.
 * @param uses The Uses the ask would otherwise carry.
 * @returns The Uses to send.
 */
export function quickAskUses(quick: QuickAsk, uses: AskUses): AskUses {
  const spec = QUICK_ASKS[quick];
  return { ...uses, level: spec.level ?? uses.level, diagram: spec.diagram ?? uses.diagram };
}

/** What the reader did to start an ask. */
export interface AskInput {
  /** The typed question; ignored for a quick ask, which has its own. */
  readonly question?: string;
  readonly span?: ParentSpan | null;
  readonly askDifferently?: boolean;
  readonly quick?: QuickAsk;
  readonly uses: AskUses;
}

/**
 * Whether a typed question may be sent.
 *
 * @param text What was typed.
 * @returns True for 1..2000 characters once trimmed.
 */
export function isValidQuestion(text: string): boolean {
  const length = text.trim().length;
  return length >= 1 && length <= MAX_QUESTION_LENGTH;
}

/**
 * The request body. A quick ask carries its own question (it is the card's label) and its Uses
 * adjusted; the level rides both at the top and inside `uses` so the server and the stored node
 * agree. No `check` is sent: board answers never carry a Check-yourself block, and the API decides.
 *
 * @param input What the reader did.
 * @returns The body, or null when there is nothing valid to send.
 */
export function buildAskBody(input: AskInput): AskBody | null {
  const uses = input.quick === undefined ? input.uses : quickAskUses(input.quick, input.uses);
  const question =
    input.quick === undefined ? (input.question ?? '').trim() : QUICK_ASKS[input.quick].question;
  if (!isValidQuestion(question)) return null;
  return {
    question,
    ...(input.span != null ? { span: input.span } : {}),
    ...(input.askDifferently === true ? { ask_differently: true } : {}),
    ...(input.quick !== undefined ? { quick: input.quick } : {}),
    uses,
    level: uses.level,
  };
}

/** One thing the AI will read, for the Uses picker. */
export interface ReadItem {
  readonly kind: 'passage' | 'answer' | 'words' | 'extra';
  /** The card, absent for the selected words. */
  readonly id: string | null;
  readonly title: string;
  /** How much of it is read, or what it is to this ask. */
  readonly note: string;
}

/** What the AI will read, and what it will not. */
export interface ReadList {
  readonly items: readonly ReadItem[];
  /** The sentence about the paper itself. */
  readonly paper: string;
  /** Sibling branches the ask never sees: shown so "this path" is honest. */
  readonly notRead: readonly string[];
  /** The path's wording on the feedforward line. */
  readonly pathLabel: string;
}

/** What the reader said about the paper, as a sentence for the picker. */
export const PAPER_SENTENCES: Readonly<Record<AskUses['paper'], string>> = {
  page: 'The page this passage is on, and the page before and after it.',
  whole: 'The whole paper, looked up as the question needs.',
  off: 'Nothing from the paper beyond this path.',
};

/** The paper's wording on the feedforward line. */
export const PAPER_LABELS: Readonly<Record<AskUses['paper'], string>> = {
  page: 'the paper',
  whole: 'the whole paper',
  off: 'not the paper',
};

/**
 * The feedforward line: "Uses: this path · the paper · Familiar · may draw a diagram".
 *
 * @param uses The Uses the ask carries.
 * @param pathLabel The path's wording from `whatTheAiWillRead`.
 * @returns The line, without the leading "Uses: ".
 */
export function usesLine(uses: AskUses, pathLabel: string): string {
  return [
    pathLabel,
    PAPER_LABELS[uses.paper],
    LEVEL_LABELS[uses.level],
    DIAGRAM_LABELS[uses.diagram],
  ].join(' · ');
}

/**
 * What the AI will read for an ask from `parentId`, in the order it reads it (rule 5).
 *
 * - The root passage, always.
 * - The ancestors' questions and answers. The parent and grandparent turns go in full; older
 *   ancestors go as their TL;DR line (the first sentence when the answer has none).
 * - The selected words, and any extra cards the reader picked.
 * - Never a sibling branch: those are listed under `notRead`.
 *
 * With the path off, the ask reads the passage and the card asked from, and nothing between.
 *
 * @param tree The tree.
 * @param parentId The card being asked from.
 * @param uses The Uses the ask carries.
 * @param ask What the reader did to start the ask.
 * @param ask.span The selected words, when any.
 * @param ask.askDifferently True for "Ask differently".
 * @returns The list for the picker.
 */
export function whatTheAiWillRead<N extends AskReadNode>(
  tree: BoardTree<N>,
  parentId: string,
  uses: AskUses,
  ask: { readonly span?: ParentSpan | null; readonly askDifferently?: boolean } = {},
): ReadList {
  const path = pathTo(tree, parentId);
  const branch: BoardBranch = branchFor(tree, parentId, ask);
  const read = uses.path ? path : path.filter((n, i) => i === 0 || n.node_id === parentId);
  const items: ReadItem[] = [];
  read.forEach((node) => {
    // Turns counted back from the ask: the card asked from is 1, its parent 2.
    const turnsBack = path.length - path.indexOf(node);
    if (node.kind === 'excerpt') {
      // A picture's root sends the crop itself, with its caption (#348).
      const picture = isImageAnchor(node.source_anchor);
      items.push({
        kind: 'passage',
        id: node.node_id,
        title: picture ? 'The picture' : 'The passage',
        note: picture
          ? 'the figure itself and its caption'
          : `${String(node.body.length)} characters`,
      });
      return;
    }
    const answer = node.final_text ?? node.body;
    const asked = node.question?.trim() || node.title?.trim() || firstLine(answer);
    const isParent = node.node_id === parentId;
    const note = isParent
      ? branch === 'down'
        ? 'the answer you are following up, in full'
        : 'the answer it branches from, in full'
      : turnsBack <= 2
        ? 'in full'
        : 'its TL;DR line';
    items.push({ kind: 'answer', id: node.node_id, title: asked, note });
  });
  if (ask.span != null) {
    items.push({
      kind: 'words',
      id: null,
      title: `the words “${spanWords(ask.span.quote)}”`,
      note: '',
    });
  }
  for (const id of uses.extra_node_ids) {
    const extra = tree.byId.get(id);
    if (extra === undefined || read.some((n) => n.node_id === id)) continue;
    items.push({
      kind: 'extra',
      id,
      title: labelOf(extra),
      note: 'a card you picked',
    });
  }
  const readIds = new Set(items.flatMap((i) => (i.id === null ? [] : [i.id])));
  const notRead = path
    .flatMap((node) => childrenOf(tree, node.node_id))
    .filter((c) => c.kind === 'explanation' && !readIds.has(c.node_id) && !path.includes(c))
    .map(labelOf);
  const rootPicture = pictureNameOf(path[0]?.source_anchor, path[0]?.body);
  const rootWord = rootPicture === null ? 'passage' : rootPicture.thing;
  const pathLabel = uses.path
    ? path.length <= 1
      ? `this ${rootWord}`
      : `this path (${String(path.length)} cards)`
    : 'this card only';
  return { items, paper: PAPER_SENTENCES[uses.paper], notRead, pathLabel };
}

/** What `whatTheAiWillRead` reads of a node. */
export interface AskReadNode extends TreeNodeInput {
  readonly body: string;
  /** An excerpt's anchor: a picture's has no words, the picture is what is read. */
  readonly source_anchor?: Anchor | null;
  readonly title?: string | null;
  readonly question?: string | null;
  readonly final_text?: string | null;
}

function labelOf(node: AskReadNode): string {
  const asked = node.question?.trim() || node.title?.trim() || '';
  return asked !== '' ? asked : firstSentence(node.final_text ?? node.body);
}

/**
 * Right branches that already start from these words: the knot's count the reader sees before
 * asking again, so "Ask about this" on a span that has branches says so.
 *
 * @param tree The tree.
 * @param parentId The answer.
 * @param span The selected words.
 * @returns How many branches start from exactly this span.
 */
export function branchesFromSpan<N extends TreeNodeInput>(
  tree: BoardTree<N>,
  parentId: string,
  span: Pick<ParentSpan, 'start' | 'end'>,
): number {
  return rightChildren(tree, parentId).filter(
    (c) => c.parent_span?.start === span.start && c.parent_span.end === span.end,
  ).length;
}
