/**
 * library/model/table — the Table view as pure functions (#197, frame 01d): a paper's State cell
 * from `processing` and `reading`, the state chips and their counts, the Filter menu (topic, year
 * and pages ranges), the words around them, and which columns are shown. Sorting is in
 * `tableSort.ts`. Nothing is invented: an unknown year or page count is in no range.
 */
import { isReadingNow, needsALook, readingPage, spineTitle, type ShelfPaper } from './shelf';

/** What a table row reads: the shelf's facts plus the highlight count. `LibraryBook` satisfies it. */
export type TablePaper = ShelfPaper & { readonly highlightCount: number };

/** The State cell's five words, one per kind (frame 01d), plus Queued. */
export type TableStateKind =
  'reading-now' | 'read' | 'not-started' | 'queued' | 'parsing' | 'failed';

/** The State cell: its kind, its word, and the small line under it. */
export interface TableState {
  readonly kind: TableStateKind;
  readonly label: string;
  readonly detail: string | null;
}

const SOURCE_NOW = 'Readable in Source mode now';

/**
 * Where the reader opens a paper, in every state (Source mode works for a failed paper too).
 *
 * @param paperId - The paper.
 * @returns `/paper/<id>/read`.
 */
export function readerHref(paperId: string): string {
  return `/paper/${paperId}/read`;
}

/**
 * The State cell. Processing wins over reading, as on the spine: a paper we are still reading
 * says so even if the person has it open in Source mode. "Reading now" is the stats line's set
 * (`isReadingNow`, which needs the page count); a place in a paper whose page count is unknown
 * reads "Opened", under Not started, so the chip and the stats line never disagree.
 *
 * @param paper - The paper.
 * @returns "Reading now · p. 4 of 15", "Read", "Not started", "Queued", "Reading" or "Could not read".
 */
export function tableState(paper: ShelfPaper): TableState {
  if (paper.processing === 'failed')
    return { kind: 'failed', label: 'Could not read', detail: null };
  if (paper.processing === 'pending')
    return { kind: 'queued', label: 'Queued', detail: SOURCE_NOW };
  if (paper.processing === 'parsing')
    return { kind: 'parsing', label: 'Reading', detail: SOURCE_NOW };
  const at = readingPage(paper);
  if (isReadingNow(paper) && at !== null) {
    const detail = `p. ${String(at.page)} of ${String(at.of)}`;
    return { kind: 'reading-now', label: 'Reading now', detail };
  }
  if (paper.reading?.state === 'finished') return { kind: 'read', label: 'Read', detail: null };
  // "Partly read" here would read as the person's progress; it is ours.
  const partly = paper.processing === 'partial' ? 'Some parts unreadable' : null;
  const opened = paper.reading?.state === 'reading';
  return { kind: 'not-started', label: opened ? 'Opened' : 'Not started', detail: partly };
}

/** The chips over the table. A paper that needs a look is in none of the three reading chips. */
export type StateChip = 'all' | 'reading-now' | 'read' | 'not-started' | 'look';

/** The chips in order, with their words ("need a look" is printed after its count). */
export const STATE_CHIPS: readonly { readonly id: StateChip; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reading-now', label: 'Reading now' },
  { id: 'read', label: 'Read' },
  { id: 'not-started', label: 'Not started' },
  { id: 'look', label: 'need a look' },
];

/**
 * Whether a paper is under a chip.
 *
 * @param paper - The paper.
 * @param chip - The chip.
 * @returns True when the chip shows it.
 */
export function inChip(paper: ShelfPaper, chip: StateChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'look') return needsALook(paper);
  return tableState(paper).kind === chip;
}

/**
 * Each chip's count, over the papers the search and the Filter leave, so a chip's number is the
 * rows it shows (frame 01d's "All 24 · Reading now 3 · Read 10 · Not started 9 · 2 need a look"
 * adds up: the four states and "need a look" partition any set of papers).
 *
 * @param papers - The papers counted.
 * @returns The counts by chip.
 */
export function chipCounts(papers: readonly ShelfPaper[]): Readonly<Record<StateChip, number>> {
  const counts: Record<StateChip, number> = {
    all: 0,
    'reading-now': 0,
    read: 0,
    'not-started': 0,
    look: 0,
  };
  for (const paper of papers) {
    for (const chip of STATE_CHIPS) if (inChip(paper, chip.id)) counts[chip.id] += 1;
  }
  return counts;
}

/** An inclusive range; null ends are open. */
export interface Range {
  readonly from: number | null;
  readonly to: number | null;
}

/** The Filter menu: a topic id (or `UNSHELVED`), a year range and a pages range. */
export interface TableFilter {
  readonly topic: string | null;
  readonly year: Range;
  readonly pages: Range;
}

/** The topic filter's value for papers without a topic. */
export const UNSHELVED = 'unshelved';

/**
 * The filter without a topic that has left the library (its last paper removed or moved), which
 * would otherwise hide every row with no name to show for it on the Filter button.
 *
 * @param filter - The filter.
 * @param topicIds - The topics the library has now.
 * @param unshelved - Whether some paper has no topic.
 * @returns The same filter when its topic is still there, else the filter with no topic.
 */
export function withoutGoneTopic(
  filter: TableFilter,
  topicIds: ReadonlySet<string>,
  unshelved: boolean,
): TableFilter {
  const { topic } = filter;
  if (topic === null || (topic === UNSHELVED ? unshelved : topicIds.has(topic))) return filter;
  return { ...filter, topic: null };
}

/** No filter at all. */
export const NO_FILTER: TableFilter = {
  topic: null,
  year: { from: null, to: null },
  pages: { from: null, to: null },
};

const isOpen = (range: Range): boolean => range.from === null && range.to === null;

/**
 * Whether the Filter menu narrows anything.
 *
 * @param filter - The filter.
 * @returns True when a topic or a range is set.
 */
export function filterIsOn(filter: TableFilter): boolean {
  return filter.topic !== null || !isOpen(filter.year) || !isOpen(filter.pages);
}

// An unknown value is in no range: a paper with no year is not "from 2015".
function inRange(value: number | null, range: Range): boolean {
  if (isOpen(range)) return true;
  if (value === null) return false;
  return (range.from === null || value >= range.from) && (range.to === null || value <= range.to);
}

/**
 * Whether a paper passes the Filter menu.
 *
 * @param paper - The paper.
 * @param filter - The filter.
 * @returns True when it passes.
 */
export function passesFilter(paper: ShelfPaper, filter: TableFilter): boolean {
  const topic = paper.topic ?? null;
  const topical =
    filter.topic === null ||
    (filter.topic === UNSHELVED ? topic === null : topic?.id === filter.topic);
  const pages = paper.pageCount > 0 ? paper.pageCount : null;
  return topical && inRange(paper.year ?? null, filter.year) && inRange(pages, filter.pages);
}

function rangeWords(range: Range, unit: string): string | null {
  const { from, to } = range;
  if (from !== null && to !== null) return `${String(from)}–${String(to)}${unit}`;
  if (from !== null) return `from ${String(from)}${unit}`;
  return to === null ? null : `to ${String(to)}${unit}`;
}

/**
 * The Filter button's words: what is on ("Vision & detection · 2015–2018 · 10–20 pages").
 *
 * @param filter - The filter.
 * @param topicName - The name of the filtered topic.
 * @returns The words, or null when nothing is filtered.
 */
export function filterSummary(filter: TableFilter, topicName: string | null): string | null {
  const parts = [
    filter.topic === null ? null : filter.topic === UNSHELVED ? 'Unshelved' : topicName,
    rangeWords(filter.year, ''),
    rangeWords(filter.pages, ' pages'),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * Where an accepted topic came from, said once: the ONE rule for the Table's cell ("arXiv cs.CL ·
 * accepted") and the opened book's page ("suggested from arXiv cs.CL · you accepted"). A topic the
 * AI proposed says so, with its model when the server names it (the three voices: AI origin is
 * always marked); one from the arXiv category is a deterministic match, not the AI's.
 *
 * @param topic - The paper's topic.
 * @param voice - `table` for the cell's short words, `book` for the opened book's sentence.
 * @returns The source line, or null for a paper without a topic or a server that did not say.
 */
export function topicSource(
  topic: ShelfPaper['topic'],
  voice: 'table' | 'book' = 'table',
): string | null {
  if (topic === null || topic === undefined) return null;
  const accepted = voice === 'book' ? 'you accepted' : 'accepted';
  if (topic.source === 'arxiv_category') {
    const from = topic.sourceDetail ? `arXiv ${topic.sourceDetail}` : 'arXiv';
    return voice === 'book' ? `suggested from ${from} · ${accepted}` : `${from} · ${accepted}`;
  }
  if (topic.source === 'model') {
    const by = topic.sourceDetail ? `the AI (${topic.sourceDetail})` : 'the AI';
    return `suggested by ${by} · ${accepted}`;
  }
  return topic.source === 'manual' ? 'chosen by you' : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "16 Oct" (with the year when it is not this year), in the viewer's time zone.
 *
 * @param iso - `reading.opened_at`.
 * @param now - Today, for the year.
 * @returns The date, or null when never opened.
 */
export function openedLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (iso === null || iso === undefined) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const day = `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''}`;
  return at.getFullYear() === now.getFullYear() ? day : `${day} ${String(at.getFullYear())}`;
}

const CHIP_EMPTY: Readonly<Record<StateChip, string>> = {
  all: 'No papers here.',
  'reading-now': 'Nothing here is being read now.',
  read: 'Nothing here is Read yet.',
  'not-started': 'Everything here has been started.',
  look: 'Nothing here needs a look.',
};

/**
 * What an empty table says, naming what emptied it: the search, the Filter, or only the chip.
 *
 * @param chip - The pressed chip.
 * @param counted - How many papers the search and the Filter leave (before the chip).
 * @param narrowed - Whether a search runs and whether a filter is on.
 * @returns The sentence.
 */
export function emptyWords(
  chip: StateChip,
  counted: number,
  narrowed: { readonly search: boolean; readonly filter: boolean },
): string {
  if (counted > 0 || (!narrowed.search && !narrowed.filter)) return CHIP_EMPTY[chip];
  if (narrowed.search && narrowed.filter)
    return 'No papers match the search and the filter. Clear them to see them all.';
  return narrowed.search
    ? 'No papers match the search. Clear it to see them all.'
    : 'No papers pass the filter. Clear the filter to see them all.';
}

/**
 * The sentence beside the "need a look" chip: "LoRA is still being read; SuperGLUE could not be
 * read." Names up to three papers; past that it counts them.
 *
 * @param papers - The papers the search and the Filter leave.
 * @returns The sentence, or null when nothing needs a look.
 */
export function lookSentence(papers: readonly ShelfPaper[]): string | null {
  const look = papers.filter(needsALook);
  if (look.length === 0) return null;
  const VERB = { failed: 'could not be read', pending: 'is waiting to be read' } as const;
  const verb = (p: ShelfPaper): string =>
    p.processing === 'failed' || p.processing === 'pending'
      ? VERB[p.processing]
      : 'is still being read';
  if (look.length <= 3)
    return `${look.map((p) => `${spineTitle(p.title)} ${verb(p)}`).join('; ')}.`;
  const failed = look.filter((p) => p.processing === 'failed').length;
  const busy = look.length - failed;
  const parts = [
    busy === 0 ? null : `${String(busy)} ${busy === 1 ? 'is' : 'are'} still to be read`,
    failed === 0 ? null : `${String(failed)} could not be read`,
  ];
  return `${parts.filter(Boolean).join('; ')}.`;
}
