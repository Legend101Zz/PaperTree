/**
 * A diagram answer as the panel holds it (#217, #340): the plate built from the run's `plate` /
 * `part` / `link` events (or read back stored), its phase, each part's quiet page source (the page
 * of the passage it came from, when it has one: no verdicts, no markers) and the readout
 * "6 parts · drawn by AI from p. 4". Pure; the plate components draw it.
 */
import { wasStopped } from '@/features/explain/model/states';

import type { ThreadMessage } from '@/features/explain/model/messages';
import type { DiagramCite, DiagramPart, MessageDiagram, SseEvent } from '@/lib/api/types';

/** The plate plus what the run said while drawing (a skipped line, a dropped arrow): live only. */
export interface PlateView extends MessageDiagram {
  readonly notes: readonly string[];
}

/** A plate before its first line. */
export const EMPTY_PLATE: PlateView = {
  title: null,
  status: 'streaming',
  parts: [],
  links: [],
  notes: [],
};

/** The three events that draw a plate. */
export type PlateEvent = Extract<SseEvent, { event: 'plate' | 'part' | 'link' }>;

/**
 * One event applied to a plate. A part whose letter is already placed is ignored: a slot is
 * never redrawn under the reader.
 *
 * @param plate The plate so far.
 * @param event A `plate`, `part` or `link` event.
 * @returns The new plate.
 */
export function applyPlateEvent(plate: PlateView, event: PlateEvent): PlateView {
  switch (event.event) {
    case 'plate':
      return { ...plate, title: event.data.title };
    case 'part':
      return plate.parts.some((p) => p.letter === event.data.letter)
        ? plate
        : { ...plate, parts: [...plate.parts, event.data] };
    case 'link':
      return { ...plate, links: [...plate.links, event.data] };
  }
}

/**
 * A note the run sent while drawing (a skipped line, a dropped arrow), kept under the plate.
 *
 * @param plate The plate so far.
 * @param note The status label, as the API worded it.
 * @returns The plate with the note added.
 */
export function withNote(plate: PlateView, note: string): PlateView {
  return { ...plate, notes: [...plate.notes, note] };
}

/** Where a plate is in its life, as the reader sees it. */
export type PlatePhase = 'thinking' | 'drawing' | 'complete' | 'stopped' | 'cut' | 'failed';

/**
 * The plate's phase from its message.
 *
 * @param answer The message's status, whether the reader pressed Stop, and its failure.
 * @param plate The plate.
 * @returns `thinking` before the first part, `drawing` while parts arrive; once settled, `stopped`
 *   for the reader's Stop (in this session, or a stored `aborted`) with or without parts, then
 *   `failed` for a plate with no part (never an empty plate), `complete`, or `cut` (it ended early;
 *   the parts that came are kept). Stop is read first: a Stop before the first part is the
 *   reader's, never a failure (#217 review B2).
 */
export function platePhase(
  answer: Pick<ThreadMessage, 'status' | 'stopped' | 'failure'>,
  plate: Pick<MessageDiagram, 'parts'>,
): PlatePhase {
  if (answer.status === 'streaming') return plate.parts.length === 0 ? 'thinking' : 'drawing';
  if (wasStopped(answer)) return 'stopped';
  if (plate.parts.length === 0) return 'failed';
  return answer.status === 'complete' ? 'complete' : 'cut';
}

/**
 * The note after Stop: it never says "kept" when nothing arrived.
 *
 * @param parts How many parts the plate has.
 * @returns The sentence.
 */
export function stoppedPlateNote(parts: number): string {
  return parts > 0
    ? 'Stopped. The parts that arrived are kept.'
    : 'Stopped before any part arrived.';
}

/**
 * The page a part's passage is on.
 *
 * @param cite The part's cite.
 * @returns The 1-based page, or null without an Anchor or a page.
 */
export function pageOf(cite: DiagramCite | null): number | null {
  if (cite === null || cite.anchor === null) return null;
  const pageIndex = cite.locator?.page_index ?? cite.page_index;
  return pageIndex === null ? null : pageIndex + 1;
}

/**
 * The pages the parts stand on: `p. 4` or `pp. 3–4`.
 *
 * @param parts The parts.
 * @returns The span, or null when no part has a page.
 */
export function pagesLine(parts: readonly DiagramPart[]): string | null {
  const pages = parts.flatMap((p) => pageOf(p.cite) ?? []);
  if (pages.length === 0) return null;
  const [lo, hi] = [Math.min(...pages), Math.max(...pages)];
  return lo === hi ? `p. ${String(lo)}` : `pp. ${String(lo)}–${String(hi)}`;
}

/**
 * The readout under a plate: "3 parts so far" while it draws, "6 parts · drawn by AI from pp. 3–4"
 * once settled ("drawn by AI" alone when no part has a page). No verdict and no count of any.
 *
 * @param parts The parts.
 * @param live True while the run is still drawing.
 * @param pages False to leave out "drawn by AI …" (a board card's short line).
 * @returns The line, or null for a plate with no part.
 */
export function plateReadout(
  parts: readonly DiagramPart[],
  live: boolean,
  pages = true,
): string | null {
  if (parts.length === 0) return null;
  const words = [
    `${String(parts.length)} ${parts.length === 1 ? 'part' : 'parts'}${live ? ' so far' : ''}`,
  ];
  if (!live && pages) {
    const span = pagesLine(parts);
    words.push(span === null ? 'drawn by AI' : `drawn by AI from ${span}`);
  }
  return words.join(' · ');
}
