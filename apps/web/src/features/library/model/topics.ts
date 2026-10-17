/**
 * library/model/topics — the Topics view as pure functions (#198, frame 03, DESIGN.md §1): which
 * papers stand on which topic card, the card's stats and its one source line, the cloth a new topic
 * gets, a paper's pending offer in words, and the cards' arrow-key step. Every word is computed from
 * the data: no reading state, no "reading now"; no arXiv source, no "Suggested from arXiv".
 */
import { isReadingNow, spineState, type ClothId, type ShelfPaper } from './shelf';

import type { PaperTopic, Topic } from '@/lib/api/topics';

/** The six cloths in the design's order, named by their colour for the picker. */
export const CLOTHS: readonly { readonly id: ClothId; readonly name: string }[] = [
  { id: 'transformers', name: 'Oxblood' },
  { id: 'vision', name: 'Green' },
  { id: 'generative', name: 'Plum' },
  { id: 'optimization', name: 'Navy' },
  { id: 'language', name: 'Mustard' },
  { id: 'rl', name: 'Slate' },
];

/** One topic card: the topic and the papers the person accepted onto it, in shelving order. */
export interface TopicShelf<P extends ShelfPaper = ShelfPaper> {
  readonly topic: Topic;
  readonly papers: readonly P[];
}

/** One part of a stats line: "7 papers" is `{ value: 7, noun: 'papers' }`, "not started" has none. */
export interface StatPart {
  readonly value: number | null;
  readonly noun: string;
}

const byShelving = (a: ShelfPaper, b: ShelfPaper): number =>
  a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id);

/**
 * The cards, in the topics' own order (`GET /topics` is shelf order), each with its papers.
 *
 * @param topics - The person's topics.
 * @param papers - Every paper; only an ACCEPTED topic (`paper.topic`) puts one on a card.
 * @returns One shelf per topic, an empty topic included.
 */
export function topicShelves<P extends ShelfPaper>(
  topics: readonly Topic[],
  papers: readonly P[],
): TopicShelf<P>[] {
  return topics.map((topic) => ({
    topic,
    papers: papers.filter((p) => p.topic?.id === topic.topic_id).sort(byShelving),
  }));
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/**
 * "7 papers · 203 pages · 2 reading now" (frame 03). The third part is the most pressing state the
 * papers are in: reading now, then could not read, then being read, then read, else "not started".
 *
 * @param papers - The topic's papers.
 * @returns The parts, or "No papers yet" for an empty topic.
 */
export function topicStats(papers: readonly ShelfPaper[]): StatPart[] {
  if (papers.length === 0) return [{ value: null, noun: 'No papers yet' }];
  const pages = papers.reduce((sum, p) => sum + (p.pageCount > 0 ? p.pageCount : 0), 0);
  const count = (test: (p: ShelfPaper) => boolean): number => papers.filter(test).length;
  const reading = count(isReadingNow);
  const failed = count((p) => spineState(p) === 'failed');
  const parsing = count((p) => ['queued', 'parsing'].includes(spineState(p)));
  const read = count((p) => p.reading?.state === 'finished');
  const state: StatPart =
    reading > 0
      ? { value: reading, noun: 'reading now' }
      : failed > 0
        ? { value: failed, noun: 'could not read' }
        : parsing > 0
          ? { value: parsing, noun: 'being read' }
          : read > 0
            ? { value: read, noun: 'read' }
            : { value: null, noun: 'not started' };
  return [
    { value: papers.length, noun: plural(papers.length, 'paper', 'papers') },
    ...(pages > 0 ? [{ value: pages, noun: plural(pages, 'page', 'pages') }] : []),
    state,
  ];
}

/**
 * Where the topic's papers came from, said once (DESIGN.md §1): "Suggested from arXiv cs.CL, cs.LG
 * · you accepted"; papers the person put there themselves are counted ("· 1 chosen by you"), and a
 * topic of only those says "Chosen by you".
 *
 * @param papers - The topic's papers (each carries the source of its accepted topic).
 * @returns The line.
 */
export function topicSourceLine(papers: readonly ShelfPaper[]): string {
  if (papers.length === 0) return 'Made by you';
  const sources = papers.map((p) => p.topic?.source);
  const categories = [
    ...new Set(
      papers.flatMap((p) =>
        p.topic?.source === 'arxiv_category' && p.topic.sourceDetail ? [p.topic.sourceDetail] : [],
      ),
    ),
  ].sort();
  const from = [
    ...(sources.includes('arxiv_category')
      ? [categories.length > 0 ? `arXiv ${categories.join(', ')}` : 'arXiv']
      : []),
    ...(sources.includes('model') ? ['the AI'] : []),
  ];
  const chosen = sources.filter((s) => s !== 'arxiv_category' && s !== 'model').length;
  if (from.length === 0) return 'Chosen by you';
  const suggested = `Suggested ${from[0] === 'the AI' ? 'by' : 'from'} ${from.join(' and by ')} · you accepted`;
  return chosen > 0 ? `${suggested} · ${String(chosen)} chosen by you` : suggested;
}

/**
 * The cloth a new topic starts with: the first the person does not use yet, else the least used.
 *
 * @param topics - The person's topics.
 * @returns A cloth id.
 */
export function nextCloth(topics: readonly Pick<Topic, 'cloth'>[]): ClothId {
  const uses = (id: ClothId): number => topics.filter((t) => t.cloth === id).length;
  return CLOTHS.reduce((best, c) => (uses(c.id) < uses(best.id) ? c : best)).id;
}

/**
 * A paper's pending offer in words, for the Unshelved card.
 *
 * @param offer - `GET /papers/{id}/topic`, or undefined while it loads.
 * @returns "Suggested: Vision & detection · from arXiv cs.CV", "You said no to the suggestion",
 *   or null when there is no offer.
 */
export function offerLine(offer: PaperTopic | undefined): string | null {
  if (offer === undefined) return null;
  if (offer.status === 'rejected') return 'You said no to the suggestion';
  if (offer.status !== 'suggested') return null;
  const name =
    offer.topic?.name ?? (offer.suggested_name ? `a new topic, “${offer.suggested_name}”` : null);
  if (name === null) return null;
  const from =
    offer.source === 'arxiv_category'
      ? ` · from arXiv ${offer.source_detail ?? ''}`.trimEnd()
      : offer.source === 'model'
        ? ' · by the AI'
        : '';
  return `Suggested: ${name}${from}`;
}

/**
 * The topic cards' arrow-key step in a grid of `columns`: ←/→ along, ↑/↓ a row (no wrap: a key
 * that would leave the grid stays put), Home and End.
 *
 * @param current - The focused card's index.
 * @param key - `KeyboardEvent.key`.
 * @param count - How many cards.
 * @param columns - Cards per row (1 on a phone).
 * @returns The index to focus, or null when the key is not a grid key.
 */
export function gridStep(
  current: number,
  key: string,
  count: number,
  columns: number,
): number | null {
  if (count === 0) return null;
  const cols = Math.max(1, columns);
  const to = (next: number): number => (next >= 0 && next < count ? next : current);
  switch (key) {
    case 'ArrowRight':
      return to(current + 1);
    case 'ArrowLeft':
      return to(current - 1);
    case 'ArrowDown':
      return to(current + cols);
    case 'ArrowUp':
      return to(current - cols);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
