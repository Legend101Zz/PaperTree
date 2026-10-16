/**
 * board/model/pins — the brass port pins (DESIGN.md §3.10, §5): which pins each card kind offers,
 * where each sits on the card, and whether a thread may join two of them.
 *
 * `PIN_TABLE` is a copy of the server's (`papertree_db.canvas.PIN_TABLE`, migration 0008), which
 * refuses any other thread with 422 "that pin does not take that thread"; `pins.spec.ts` reads the
 * Python source and fails if the two ever differ. The client checks first so a wrong drop is
 * refused on the spot, with the server's own sentence.
 */
import type { CanvasNode, FromPort, ToPort } from '@/lib/api/types';

/** Any pin. */
export type Port = FromPort | ToPort;

/** The pins one card kind offers: brass out-pins and open in-pins. */
export interface Pins {
  readonly out: readonly FromPort[];
  readonly into: readonly ToPort[];
}

/** Which card kind offers which pins (frame 06; a frame offers none). */
export const PIN_TABLE: Readonly<Record<CanvasNode['kind'], Pins>> = {
  excerpt: { out: ['claim_out'], into: ['evidence_in'] },
  note: { out: ['claim_out'], into: ['evidence_in'] },
  explanation: { out: ['claim_out', 'answer_out'], into: ['evidence_in', 'question_in'] },
  question: { out: [], into: ['evidence_in', 'question_in'] },
  notebook: { out: ['claim_out'], into: ['evidence_in'] },
  diagram: { out: ['claim_out'], into: ['evidence_in'] },
  group: { out: [], into: [] },
};

/** The server's refusal, word for word (`canvas.PIN_REFUSED`). */
export const PIN_REFUSED = 'that pin does not take that thread';

/** A pin's accessible name and legend words. */
export const PIN_NAMES: Readonly<Record<Port, string>> = {
  evidence_in: 'evidence in',
  question_in: 'question in',
  claim_out: 'claim out',
  answer_out: 'answer out',
};

/** The card edge each pin sits on: in-pins left and top, out-pins right and bottom (frame 06). */
export const PIN_SIDE: Readonly<Record<Port, 'left' | 'top' | 'right' | 'bottom'>> = {
  evidence_in: 'left',
  question_in: 'top',
  claim_out: 'right',
  answer_out: 'bottom',
};

/**
 * Whether a port name is an out-pin.
 *
 * @param port The pin.
 * @returns True for `claim_out` and `answer_out`.
 */
export function isOutPort(port: string): port is FromPort {
  return port === 'claim_out' || port === 'answer_out';
}

/** One end of a thread being made. */
export interface PinEnd {
  readonly kind: CanvasNode['kind'];
  readonly port: string | null | undefined;
}

/**
 * Whether a thread may run from one card's pin to another's: an out-pin the first card offers to
 * an in-pin the second offers. The same check the server makes, so a drop it would refuse is
 * refused here first.
 *
 * @param from The card and pin the thread leaves.
 * @param to The card and pin it arrives at.
 * @returns True when the server would take the thread.
 */
export function canConnect(from: PinEnd, to: PinEnd): boolean {
  const out = PIN_TABLE[from.kind].out as readonly string[];
  const into = PIN_TABLE[to.kind].into as readonly string[];
  return (
    typeof from.port === 'string' &&
    typeof to.port === 'string' &&
    out.includes(from.port) &&
    into.includes(to.port)
  );
}

/**
 * The refusal as a sentence for the notice line.
 *
 * @returns "That pin does not take that thread."
 */
export function pinRefusal(): string {
  return `${PIN_REFUSED.charAt(0).toUpperCase()}${PIN_REFUSED.slice(1)}.`;
}
