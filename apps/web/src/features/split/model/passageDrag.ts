/**
 * split/model/passageDrag — a selection being dragged from the paper across the divider (V3-25).
 *
 * The paper says what is being dragged (the captured passage) when the drag starts and clears it
 * when it ends; the board, which has no idea what the paper holds, asks for it as the pointer moves
 * over it and when it lets go. One value, module scope: there is one pointer and one paper.
 */
import type { Anchor } from '@papertree/anchoring';

/** The passage in the air. */
export interface DraggedPassage {
  readonly anchor: Anchor;
  /** Its words, for the footprint's height. */
  readonly text: string;
}

let current: DraggedPassage | null = null;

/**
 * The passage being dragged now, or null.
 *
 * @returns The passage.
 */
export function draggedPassage(): DraggedPassage | null {
  return current;
}

/**
 * Starts (or, with null, ends) a drag of a passage.
 *
 * @param passage The passage, or null.
 */
export function setDraggedPassage(passage: DraggedPassage | null): void {
  current = passage;
}
