/**
 * board/model/frames — which frame holds a card (frame 06: "frames are dashed outlines with a paper
 * tag", drawn from v0.1's groups). Pure: the controller asks it after the gestures that move or size
 * things (a card dropped, a frame resized) and writes the card's `group_id` from the answer.
 *
 * THE RULE: a card belongs to the smallest frame that holds its centre, and it stays in the frame it
 * is in for as long as that frame still holds its centre, so the cards a frame carries never hop
 * into a smaller frame it passes over. Frames never hold frames.
 */
import type { PtNode } from './flow';
import type { Rect } from './placement';

/** A frame's box on the board. */
export interface FrameBox extends Rect {
  readonly id: string;
}

/** A card's box on the board and the frame it is in now. */
export interface CardBox extends Rect {
  readonly id: string;
  readonly groupId: string | null;
}

/** A card that changes frame (`null`: it leaves its frame). */
export interface Regroup {
  readonly id: string;
  readonly groupId: string | null;
}

const holdsCentre = (frame: Rect, card: Rect): boolean => {
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  return cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h;
};

const boxOf = (n: PtNode): Rect => ({
  x: n.position.x,
  y: n.position.y,
  w: n.width ?? n.data.node.w,
  h: n.height ?? n.data.node.h,
});

/**
 * The frames on the board, as boxes.
 *
 * @param nodes The board's nodes.
 * @returns Every frame's box.
 */
export function frameBoxes(nodes: readonly PtNode[]): FrameBox[] {
  return nodes.filter((n) => n.data.node.kind === 'group').map((n) => ({ id: n.id, ...boxOf(n) }));
}

/**
 * The cards on the board (frames left out), as boxes with their frame.
 *
 * @param nodes The board's nodes.
 * @returns Every card's box.
 */
export function cardBoxes(nodes: readonly PtNode[]): CardBox[] {
  return nodes
    .filter((n) => n.data.node.kind !== 'group')
    .map((n) => ({ id: n.id, groupId: n.data.node.group_id, ...boxOf(n) }));
}

/**
 * The frame a card is in after it moved: its own frame while that still holds its centre, else the
 * smallest frame that does.
 *
 * @param card The card.
 * @param frames The board's frames.
 * @returns The frame's id, or null when no frame holds it.
 * @example
 * frameFor({ id: 'c', groupId: null, x: 10, y: 10, w: 100, h: 60 }, [{ id: 'f', x: 0, y: 0, w: 400, h: 300 }]); // 'f'
 */
export function frameFor(card: CardBox, frames: readonly FrameBox[]): string | null {
  const own = frames.find((f) => f.id === card.groupId);
  if (own !== undefined && holdsCentre(own, card)) return own.id;
  let best: FrameBox | null = null;
  for (const f of frames) {
    if (holdsCentre(f, card) && (best === null || f.w * f.h < best.w * best.h)) best = f;
  }
  return best?.id ?? null;
}

/**
 * The cards whose frame changes, after they moved.
 *
 * @param cards The cards that moved.
 * @param frames The board's frames.
 * @returns One entry per card that joins, leaves or swaps a frame.
 */
export function regroup(cards: readonly CardBox[], frames: readonly FrameBox[]): Regroup[] {
  return cards.flatMap((card) => {
    const next = frameFor(card, frames);
    return next === card.groupId ? [] : [{ id: card.id, groupId: next }];
  });
}

/**
 * The cards whose frame changes after one frame was resized: the cards it now holds join it, its
 * members it no longer holds leave it. Cards elsewhere on the board are not touched.
 *
 * @param frameId The resized frame.
 * @param cards Every card on the board.
 * @param frames The board's frames, the resized one at its new size.
 * @returns The changes.
 */
export function regroupAround(
  frameId: string,
  cards: readonly CardBox[],
  frames: readonly FrameBox[],
): Regroup[] {
  const was = new Map(cards.map((c) => [c.id, c.groupId]));
  return regroup(cards, frames).filter((c) => c.groupId === frameId || was.get(c.id) === frameId);
}
