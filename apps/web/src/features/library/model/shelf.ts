/**
 * library/model/shelf — the shelf as pure functions (#195, ADR-004 §2.3, DESIGN.md §1 and §9).
 *
 * Groups papers into rows by an arrangement, sizes and labels every spine, and counts search
 * matches from data. No React and no fetch: the shelf components draw what this returns, so the
 * layout can be tested without a DOM. Nothing here invents a fact: no topic means "Unshelved", no
 * reading state means no ribbon, no year means no year on the spine.
 */
import type { ProcessingState } from '@/components/library/types';
import type { ReadingProgress } from '@/lib/api/types';

/** How the shelf is arranged (the "Arrange by" select). */
export type Arrangement = 'topic' | 'year' | 'title' | 'recent';

/** The arrangements in menu order, with their visible names. */
export const ARRANGEMENTS: readonly { readonly value: Arrangement; readonly label: string }[] = [
  { value: 'topic', label: 'Topic' },
  { value: 'year', label: 'Year' },
  { value: 'title', label: 'Title' },
  { value: 'recent', label: 'Recently opened' },
];

/** What a spine shows: a ribbon, a kraft wrap ("being read"), a torn red label, or plain cloth. */
export type SpineState = 'reading' | 'queued' | 'parsing' | 'failed' | 'ready';

/** The six topic cloths of DESIGN.md §2 (`--pt-cloth-*`). */
export type ClothId = 'transformers' | 'vision' | 'generative' | 'optimization' | 'language' | 'rl';

/** A topic the person accepted (S2b, #193). Absent until then: every paper is Unshelved. */
export interface ShelfTopic {
  readonly id: string;
  readonly name: string;
  readonly cloth: ClothId | null;
  /** Where it came from (the Table's "arXiv cs.CL · accepted"); absent from older servers. */
  readonly source?: 'arxiv_category' | 'manual' | 'model';
  /** `cs.CL` for an arXiv-category topic, the model id for a model's, else null. */
  readonly sourceDetail?: string | null;
}

/** The facts the shelf reads. The library's view model plus S2a's fields satisfies it. */
export interface ShelfPaper {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  /** 0 when the server has not counted the pages yet. */
  readonly pageCount: number;
  readonly processing: ProcessingState;
  /** ISO-8601; shelving order within a topic. */
  readonly addedAt: string;
  readonly year?: number | null;
  readonly reading?: ReadingProgress | null;
  readonly arxivCategory?: string | null;
  readonly topic?: ShelfTopic | null;
}

/** One row of the shelf: the papers under one label holder. */
export interface ShelfGroup<P extends ShelfPaper = ShelfPaper> {
  readonly key: string;
  readonly label: string;
  readonly papers: readonly P[];
}

/**
 * Spine width in px is `26 + 0.85 × pages`, fitted uncapped to the 24 spines of frame 01 (8 pp →
 * 33, 15 → 39, 25 → 47, 34 → 55, 75 → 90) and exact to the pixel on all of them; DESIGN.md §9's
 * 48 px cap then overrides the frame's four wide spines (FlashAttention, GPT-3, CLIP, SuperGLUE).
 */
export const SPINE_MAX_WIDTH = 48;
/** Used while the page count is unknown (see `spineWidth`). */
export const SPINE_DEFAULT_WIDTH = 40;
/** Frame 01's spine heights run 262–318 px, 01f's shorter rows 150–179; decoration, not data. */
const SPINE_HEIGHT_MIN = 262;
const SPINE_HEIGHT_SPAN = 57;
const COMPACT_HEIGHT_MIN = 150;
const COMPACT_HEIGHT_SPAN = 30;

/**
 * Which picture a spine shows. Processing wins over reading: a paper being read by the parser is
 * wrapped in kraft even if the person has it open in Source mode.
 *
 * @param paper - The paper.
 * @returns The spine's state.
 */
export function spineState(paper: ShelfPaper): SpineState {
  if (paper.processing === 'failed') return 'failed';
  if (paper.processing === 'pending') return 'queued';
  if (paper.processing === 'parsing') return 'parsing';
  return paper.reading?.state === 'reading' ? 'reading' : 'ready';
}

/**
 * The spine's width: from the page count once it is known, the default until then. A width that
 * depends only on the count changes at most once, when the count first arrives, and a Retry or
 * re-parse of a counted paper keeps its width (#175's layout shift).
 *
 * @param pageCount - Pages in the PDF, 0 when unknown.
 * @returns Width in CSS px, at most `SPINE_MAX_WIDTH`.
 */
export function spineWidth(pageCount: number): number {
  if (!(pageCount > 0)) return SPINE_DEFAULT_WIDTH;
  return Math.min(SPINE_MAX_WIDTH, Math.round(26 + 0.85 * pageCount));
}

// FNV-1a: a small, stable string hash for the decorations below (heights, the fallback cloth).
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A stable height for a spine, so the shelf has the uneven skyline of real books and keeps it
 * across reloads. A hash of the id; never encodes anything about the paper.
 *
 * @param id - The paper id.
 * @param compact - The shorter spines of a library at scale (frame 01f).
 * @returns Height in CSS px, 262–318 (150–179 compact).
 */
export function spineHeight(id: string, compact = false): number {
  const hash = fnv1a(id);
  return compact
    ? COMPACT_HEIGHT_MIN + (hash % COMPACT_HEIGHT_SPAN)
    : SPINE_HEIGHT_MIN + (hash % SPINE_HEIGHT_SPAN);
}

/**
 * The title as the spine prints it: the text before the first colon ("BERT: Pre-training…" →
 * "BERT"). Never an invented acronym: a title without a colon is printed whole.
 *
 * @param title - The full title.
 * @returns The short title.
 */
export function spineTitle(title: string): string {
  const head = title.split(':')[0]?.trim() ?? '';
  return head.length > 0 ? head : title.trim();
}

/**
 * "Ashish Vaswani∗" → "Vaswani": the last word, without footnote marks.
 *
 * @param name - An author as printed.
 * @returns The surname.
 */
export function surname(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{M}'’.-]+$/u, '')
    .trim()
    .split(/\s+/);
  return words[words.length - 1] ?? name;
}

/**
 * The author line: "Vaswani", "Kingma and Ba", "Vaswani et al.".
 *
 * @param authors - Authors as printed, in order.
 * @returns The line, or null when there are no authors.
 */
export function authorLine(authors: readonly string[]): string | null {
  const names = authors.map((a) => a.trim()).filter((a) => a.length > 0);
  const first = names[0];
  if (first === undefined) return null;
  if (names.length === 1) return surname(first);
  if (names.length === 2) return `${surname(first)} and ${surname(names[1] ?? '')}`;
  return `${surname(first)} et al.`;
}

/**
 * Where the person is: "p. 4 of 15" from S2a's zero-based `last_page`.
 *
 * @param paper - The paper.
 * @returns The 1-based page and the count, or null when not reading or the count is unknown.
 */
export function readingPage(paper: ShelfPaper): { page: number; of: number } | null {
  const reading = paper.reading;
  if (reading === null || reading === undefined || reading.state !== 'reading') return null;
  const of = reading.page_count ?? paper.pageCount;
  return of > 0 ? { page: Math.min(reading.last_page + 1, of), of } : null;
}

/**
 * Whether a paper is "reading now": the person has a place in it, has not finished it, and it
 * shows a ribbon (a paper we are still reading wears kraft instead). The Reading now strip and the
 * stats line both count this one set.
 *
 * @param paper - The paper.
 * @returns True when it belongs in Reading now.
 */
export function isReadingNow(paper: ShelfPaper): boolean {
  return spineState(paper) === 'reading' && readingPage(paper) !== null;
}

// What each state adds to the spine's accessible name.
function stateWords(paper: ShelfPaper): string {
  switch (spineState(paper)) {
    case 'failed':
      return 'could not read';
    case 'queued':
      return 'waiting to be read';
    case 'parsing':
      return 'being read';
    case 'reading': {
      const at = readingPage(paper);
      return at === null ? 'reading now' : `reading now, p. ${at.page} of ${at.of}`;
    }
    default:
      if (paper.processing === 'partial') return 'partly read';
      return paper.reading?.state === 'finished' ? 'read' : 'not started';
  }
}

/**
 * The spine button's accessible name: "Attention Is All You Need, Vaswani et al., 2017, reading
 * now, p. 4 of 15". The full title, because the short one is only what fits.
 *
 * @param paper - The paper.
 * @returns The name.
 */
export function spineName(paper: ShelfPaper): string {
  const parts = [paper.title.trim(), authorLine(paper.authors), paper.year ?? null];
  return [...parts.filter((p) => p !== null), stateWords(paper)].join(', ');
}

/**
 * Fallback cloth by arXiv category while a paper has no topic (owner may change this mapping).
 * cs.CL → transformers, cs.CV → vision, cs.LG and stat.ML → generative, math.OC and cs.NE →
 * optimization, cs.IR → language, cs.AI / cs.RO / cs.MA → reinforcement. Another category takes a
 * stable cloth by hash; no category at all takes the slate (`rl`) cloth.
 */
const CLOTH_BY_CATEGORY: Readonly<Record<string, ClothId>> = {
  'cs.CL': 'transformers',
  'cs.CV': 'vision',
  'cs.LG': 'generative',
  'stat.ML': 'generative',
  'math.OC': 'optimization',
  'cs.NE': 'optimization',
  'cs.IR': 'language',
  'cs.AI': 'rl',
  'cs.RO': 'rl',
  'cs.MA': 'rl',
};
const CLOTHS: readonly ClothId[] = [
  'transformers',
  'vision',
  'generative',
  'optimization',
  'language',
  'rl',
];

/**
 * The spine's cloth: the topic's, else the arXiv-category fallback.
 *
 * @param paper - The paper.
 * @returns The cloth id (`--pt-cloth-<id>`).
 */
export function clothFor(paper: ShelfPaper): ClothId {
  const topical = paper.topic?.cloth;
  if (topical !== undefined && topical !== null) return topical;
  const category = paper.arxivCategory;
  if (category === undefined || category === null || category === '') return 'rl';
  return CLOTH_BY_CATEGORY[category] ?? CLOTHS[fnv1a(category) % CLOTHS.length] ?? 'rl';
}

/**
 * Gilt on the mustard Language cloth is 2.4:1, so that cloth takes a paper label (DESIGN.md §2).
 *
 * @param cloth - The cloth.
 * @returns True when the title goes on a paper label instead of gilt.
 */
export function clothTakesLabel(cloth: ClothId): boolean {
  return cloth === 'language';
}

const compareText = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

const byAdded = (a: ShelfPaper, b: ShelfPaper): number =>
  a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id);

const byTitle = (a: ShelfPaper, b: ShelfPaper): number =>
  compareText(spineTitle(a.title), spineTitle(b.title)) || a.id.localeCompare(b.id);

// Rows by a key; `last` keys sort after the rest, the others by `order` (given keys and labels).
function groupBy<P extends ShelfPaper>(
  papers: readonly P[],
  keyOf: (p: P) => { key: string; label: string; last?: boolean },
  order: (a: string, b: string, labelA: string, labelB: string) => number,
  within: (a: P, b: P) => number,
): ShelfGroup<P>[] {
  const rows = new Map<string, { label: string; last: boolean; papers: P[] }>();
  for (const paper of papers) {
    const { key, label, last = false } = keyOf(paper);
    const row = rows.get(key) ?? { label, last, papers: [] };
    row.papers.push(paper);
    rows.set(key, row);
  }
  return [...rows.entries()]
    .sort(
      ([a, ra], [b, rb]) => Number(ra.last) - Number(rb.last) || order(a, b, ra.label, rb.label),
    )
    .map(([key, row]) => ({ key, label: row.label, papers: [...row.papers].sort(within) }));
}

/**
 * Arrange the shelf. Topic (the default): one row per accepted topic by name, books in the order
 * they were shelved, papers without a topic under "Unshelved" at the end. Year: one row per year,
 * oldest first, "Year unknown" last. Title: one A–Z row. Recently opened: the opened papers, most
 * recent first, then "Not opened yet" in shelving order.
 *
 * @param papers - Every paper, in any order.
 * @param arrangement - How to arrange them.
 * @returns The rows, left to right.
 */
export function arrangeShelf<P extends ShelfPaper>(
  papers: readonly P[],
  arrangement: Arrangement,
): ShelfGroup<P>[] {
  switch (arrangement) {
    case 'year':
      return groupBy(
        papers,
        (p) =>
          typeof p.year === 'number'
            ? { key: String(p.year), label: String(p.year) }
            : { key: 'unknown', label: 'Year unknown', last: true },
        (a, b) => Number(a) - Number(b),
        byTitle,
      );
    case 'title':
      return papers.length === 0
        ? []
        : [{ key: 'az', label: 'A–Z', papers: [...papers].sort(byTitle) }];
    case 'recent':
      return groupBy(
        papers,
        (p) =>
          p.reading === null || p.reading === undefined
            ? { key: 'unopened', label: 'Not opened yet', last: true }
            : { key: 'opened', label: 'Recently opened' },
        compareText,
        (a, b) =>
          (b.reading?.opened_at ?? '').localeCompare(a.reading?.opened_at ?? '') || byAdded(a, b),
      );
    default:
      return groupBy(
        papers,
        (p) =>
          p.topic === null || p.topic === undefined
            ? { key: 'unshelved', label: 'Unshelved', last: true }
            : { key: `topic:${p.topic.id}`, label: p.topic.name },
        // By the topic's name (keyed by id, which says nothing to a person), as documented above.
        (a, b, labelA, labelB) => compareText(labelA, labelB) || compareText(a, b),
        byAdded,
      );
  }
}

/**
 * Fold case, width and diacritics, so "atten" finds "Attention" and "unified" finds the parser's
 * "Uniﬁed" (a ligature).
 *
 * @param text - Any text.
 * @returns The comparable form.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/**
 * Which papers a search matches: every word of the query must occur in the title, the authors or
 * the topic. Counted over the data, not the drawn spines, so a match hidden in a "+n more" overflow
 * still counts and "2 of 24" stays true.
 *
 * @param papers - Every paper.
 * @param query - What the person typed.
 * @returns The matching ids, or null when the query is blank (no search active).
 */
export function matchPapers(
  papers: readonly ShelfPaper[],
  query: string,
): ReadonlySet<string> | null {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const found = new Set<string>();
  for (const paper of papers) {
    const hay = foldForSearch([paper.title, ...paper.authors, paper.topic?.name ?? ''].join(' '));
    if (words.every((word) => hay.includes(word))) found.add(paper.id);
  }
  return found;
}

/**
 * The roving-tabindex step for the shelf toolbar: ←/→ along the shelf (no wrap: a shelf has
 * ends), Home and End.
 *
 * @param current - The index that has focus.
 * @param key - `KeyboardEvent.key`.
 * @param count - How many spines.
 * @returns The index to focus, or null when the key is not a shelf key.
 */
export function shelfStep(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowRight') return Math.min(count - 1, current + 1);
  if (key === 'ArrowLeft') return Math.max(0, current - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Papers that need a look: queued, being read or could not be read (the header's "2 need a look").
 * A partly read paper is readable, so it does not count (owner may change).
 *
 * @param paper - The paper.
 * @returns True when the paper needs a look.
 */
export function needsALook(paper: ShelfPaper): boolean {
  return (
    paper.processing === 'pending' ||
    paper.processing === 'parsing' ||
    paper.processing === 'failed'
  );
}

/** The library's stats line, computed from the papers. */
export interface LibraryStats {
  readonly papers: number;
  /** Distinct accepted topics. */
  readonly topics: number;
  readonly readingNow: number;
  /** Pages of the papers whose count is known. */
  readonly pages: number;
  readonly needALook: number;
}

/**
 * The numbers for "24 papers · 6 topics · 3 reading now · 484 pages" and "2 need a look".
 *
 * @param papers - Every paper.
 * @returns The counts.
 */
export function libraryStats(papers: readonly ShelfPaper[]): LibraryStats {
  const topics = new Set(papers.flatMap((p) => (p.topic ? [p.topic.id] : [])));
  return {
    papers: papers.length,
    topics: topics.size,
    readingNow: papers.filter(isReadingNow).length,
    pages: papers.reduce((sum, p) => sum + (p.pageCount > 0 ? p.pageCount : 0), 0),
    needALook: papers.filter(needsALook).length,
  };
}

/**
 * Where the catalogue card goes in the band above the shelf: its left edge in band coordinates,
 * kept inside the band, and its pointer's offset from that edge, so it points at the spine.
 *
 * @param spineCenter - The open spine's centre, in px from the band's left edge.
 * @param bandWidth - The band's width.
 * @param cardWidth - The card's width (at most the band's).
 * @returns The card's left edge and the pointer's offset inside the card.
 */
export function placeCard(
  spineCenter: number,
  bandWidth: number,
  cardWidth: number,
): { readonly left: number; readonly pointer: number } {
  const width = Math.min(cardWidth, bandWidth);
  // Frame 01: the pointer sits 42 px in from the card's left edge when there is room.
  const left = Math.max(0, Math.min(spineCenter - 42, bandWidth - width));
  const pointer = Math.max(12, Math.min(spineCenter - left, width - 12));
  return { left, pointer };
}
