/**
 * A diagram answer as the panel holds it (#217): the plate built from the run's `plate` / `part` /
 * `link` events (or read back stored), its phase, each part's honest verdict (DESIGN.md §4: cited,
 * not verified, or inferred, never silently uncited), the passage numbers its markers show and the
 * readout "6 parts · 6 cited · drawn by AI from p. 4". Pure; the plate components draw it.
 */
import { selectorOf } from '@/features/explain/model/anchor';
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

/** A part's honest label: its quote is word for word in a passage, or it is not, or it has none. */
export type PartVerdict = 'cited' | 'not-verified' | 'inferred';

/**
 * A part's verdict.
 *
 * @param part The part.
 * @returns `inferred` with no quote; `cited` when the quote was found word for word (an Anchor and
 *   `supported`); else `not-verified`.
 */
export function verdictOf(part: Pick<DiagramPart, 'cite'>): PartVerdict {
  if (part.cite === null) return 'inferred';
  return part.cite.supported && part.cite.anchor !== null ? 'cited' : 'not-verified';
}

/** The words for an inferred part (DESIGN.md §4.7). */
export const INFERRED_WORDS = 'Inferred, no passage';

/**
 * Which passage a cite stands on: the Anchor's block, so two parts on one paragraph share a number.
 *
 * @param cite The part's cite.
 * @returns The passage key, or null when the quote has no Anchor (found nowhere).
 */
export function passageKey(cite: DiagramCite | null): string | null {
  if (cite === null || cite.anchor === null) return null;
  return (
    selectorOf(cite.anchor, 'BlockSelector')?.blockId ?? cite.locator?.passage_key ?? cite.anchor.id
  );
}

/**
 * Passage numbers for a thread's plates: 1..k in the order the plates first stand on a passage, so
 * marker 1 is the same passage on every plate of the thread (DESIGN.md §3.2).
 *
 * @param plates Each plate's parts, oldest plate first.
 * @returns Passage key → its number.
 */
export function numberPlatePassages(
  plates: readonly (readonly DiagramPart[])[],
): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  for (const part of plates.flat()) {
    const key = passageKey(part.cite);
    if (key !== null && !numbers.has(key)) numbers.set(key, numbers.size + 1);
  }
  return numbers;
}

/**
 * The page tab of a part's passage.
 *
 * @param cite The part's cite.
 * @returns 1-based page and ¶ (null: the page alone), or null without an Anchor or a page.
 */
export function tabOf(cite: DiagramCite | null): { page: number; para: number | null } | null {
  if (cite === null || cite.anchor === null) return null;
  const pageIndex = cite.locator?.page_index ?? cite.page_index;
  return pageIndex === null
    ? null
    : { page: pageIndex + 1, para: cite.locator?.para_index ?? null };
}

/** How many parts, and how many in each verdict. */
export interface PlateCounts {
  readonly parts: number;
  readonly cited: number;
  readonly notVerified: number;
  readonly inferred: number;
}

/**
 * Count a plate's parts by verdict.
 *
 * @param parts The parts.
 * @returns The counts.
 */
export function countParts(parts: readonly DiagramPart[]): PlateCounts {
  const verdicts = parts.map(verdictOf);
  const n = (v: PartVerdict): number => verdicts.filter((x) => x === v).length;
  return {
    parts: parts.length,
    cited: n('cited'),
    notVerified: n('not-verified'),
    inferred: n('inferred'),
  };
}

/**
 * The pages the cited parts stand on: `p. 4` or `pp. 3–4`.
 *
 * @param parts The parts.
 * @returns The span, or null when no part is cited.
 */
export function pagesLine(parts: readonly DiagramPart[]): string | null {
  const pages = parts
    .filter((p) => verdictOf(p) === 'cited')
    .flatMap((p) => {
      const tab = tabOf(p.cite);
      return tab === null ? [] : [tab.page];
    });
  if (pages.length === 0) return null;
  const [lo, hi] = [Math.min(...pages), Math.max(...pages)];
  return lo === hi ? `p. ${String(lo)}` : `pp. ${String(lo)}–${String(hi)}`;
}

/**
 * The readout under a plate: "3 parts so far · 3 cited" while it draws, "6 parts · 6 cited · drawn
 * by AI from pp. 3–4" once settled ("drawn by AI" alone when no part is cited). A not-verified part
 * is counted in words; an inferred one is the difference between the two counts, as the design
 * words it ("7 parts · 6 cited").
 *
 * @param parts The parts.
 * @param live True while the run is still drawing.
 * @returns The line, or null for a plate with no part.
 */
export function plateReadout(parts: readonly DiagramPart[], live: boolean): string | null {
  if (parts.length === 0) return null;
  const c = countParts(parts);
  const words = [
    `${String(c.parts)} ${c.parts === 1 ? 'part' : 'parts'}${live ? ' so far' : ''}`,
    `${String(c.cited)} cited`,
  ];
  if (c.notVerified > 0) words.push(`${String(c.notVerified)} not verified`);
  const pages = pagesLine(parts);
  if (!live) words.push(pages === null ? 'drawn by AI' : `drawn by AI from ${pages}`);
  return words.join(' · ');
}
