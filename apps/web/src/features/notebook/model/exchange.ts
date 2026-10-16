/**
 * The exchange block's numbers (S5c, #208): which passage number each of the answer's markers
 * carries, which number each quote card carries, and where a passage is ("p. 2 ¶2"). Numbers run
 * 1..k in the order the answer first cites each passage (S4a's `locator.passage_key`), which is the
 * order Dive in seeded the quote cards in, so marker 2 in the AI slip and quote card 2 are the same
 * passage. Pure: the component passes the stored message it read.
 */
import type { Citation, Message, RunSummary } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

/** One numbered passage of the answer. */
export interface Passage {
  readonly n: number;
  /** 1-based page, from the citation's locator (or its `page_index`). */
  readonly page: number;
  /** 1-based paragraph on that page, when the locator knows it. */
  readonly para: number | null;
  /** How many of the answer's markers point here. */
  readonly cited: number;
  /** The anchor ids of the citations that point here (a quote card matches on these). */
  readonly anchorIds: readonly string[];
  readonly blockId: string | null;
  readonly supported: boolean | null;
}

/** The answer's paragraphs and the passage numbers each one cites, in reading order. */
export interface AnswerLayout {
  readonly passages: readonly Passage[];
  /** Handle (`b6`) → passage number. */
  readonly numberOf: ReadonlyMap<string, number>;
  /** The answer split into paragraphs exactly as `exchanges.answer_paragraphs` splits it. */
  readonly paragraphs: readonly string[];
}

const HANDLE_RUN = /\[(b\d+(?:\s*,\s*b\d+)*)\]/g;
const BLANK_LINE = /\n[ \t]*\n/;
const HEADING_ONLY = /^#{1,6}\s+\S[^\n]*$/;

/**
 * The handles of a text in reading order, repeats kept (`[b1, b8]` gives two).
 *
 * @param text - An answer or one paragraph of it.
 * @returns Every handle occurrence.
 */
export function handlesIn(text: string): string[] {
  return Array.from(text.matchAll(HANDLE_RUN)).flatMap((m) =>
    (m[1] ?? '').split(',').map((h) => h.trim()),
  );
}

/**
 * The block an Anchor names (its BlockSelector), the passage key's basis.
 *
 * @param anchor - An Anchor.
 * @returns The block id, or null when the Anchor has no BlockSelector.
 */
export function blockIdOf(anchor: Anchor): string | null {
  const selector = anchor.selectors.find((s) => s.type === 'BlockSelector');
  return selector?.type === 'BlockSelector' ? selector.blockId : null;
}

function keyOf(citation: Citation, generation: number): string {
  return (
    citation.locator?.passage_key ??
    `g${String(generation)}:${blockIdOf(citation.anchor) ?? citation.marker}`
  );
}

/**
 * Numbers the answer's passages and splits it into paragraphs.
 *
 * @param message - The stored assistant message (its citations carry S4a's locators).
 * @returns The passages (numbered by first use, then any citation the text never mentions), the
 *   handle → number map, and the paragraphs.
 */
export function layoutAnswer(
  message: Pick<Message, 'content' | 'citations' | 'generation'>,
): AnswerLayout {
  const byMarker = new Map(message.citations.map((c) => [c.marker, c] as const));
  const used = handlesIn(message.content).flatMap((h) => byMarker.get(h) ?? []);
  const loose = [...message.citations].sort((a, b) => a.ordinal - b.ordinal);
  const passages = new Map<string, Passage>();
  const numberOf = new Map<string, number>();
  for (const [i, citation] of [...used, ...loose].entries()) {
    const key = keyOf(citation, message.generation);
    const known = passages.get(key);
    const counts = i < used.length ? 1 : 0;
    const passage: Passage = known ?? {
      n: passages.size + 1,
      page: (citation.locator?.page_index ?? citation.page_index) + 1,
      para: citation.locator?.para_index ?? null,
      cited: 0,
      anchorIds: [],
      blockId: blockIdOf(citation.anchor),
      supported: citation.supported,
    };
    const ids = passage.anchorIds.includes(citation.anchor.id)
      ? passage.anchorIds
      : [...passage.anchorIds, citation.anchor.id];
    passages.set(key, { ...passage, cited: passage.cited + counts, anchorIds: ids });
    numberOf.set(citation.marker, passage.n);
  }
  const paragraphs = message.content
    .split(BLANK_LINE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !HEADING_ONLY.test(p));
  return { passages: [...passages.values()], numberOf, paragraphs };
}

/**
 * The passage a quote card shows: the one whose citation carried the card's Anchor (Dive in copies
 * it verbatim), else the one on the same block.
 *
 * @param layout - The answer's layout.
 * @param anchor - The quote card's stored Anchor.
 * @returns The passage, or null for a quote the answer does not cite.
 */
export function passageOfQuote(layout: AnswerLayout, anchor: Anchor): Passage | null {
  const block = blockIdOf(anchor);
  return (
    layout.passages.find((p) => p.anchorIds.includes(anchor.id)) ??
    layout.passages.find((p) => block !== null && p.blockId === block) ??
    null
  );
}

/**
 * Where the exchange's question was asked: the origin anchor's page, and its paragraph when one of
 * the answer's passages sits on the same block.
 *
 * @param origin - The thread's origin anchor.
 * @param layout - The answer's layout, when the thread could be read.
 * @returns The page and paragraph, or null when the anchor names no page.
 */
export function originPlace(
  origin: Anchor,
  layout: AnswerLayout | null,
): { page: number; para: number | null } | null {
  const page = origin.selectors.find((s) => s.type === 'PageSelector');
  if (page?.type !== 'PageSelector') return null;
  const block = blockIdOf(origin);
  const same = layout?.passages.find(
    (p) => block !== null && p.blockId === block && p.page === page.index + 1,
  );
  return { page: page.index + 1, para: same?.para ?? null };
}

/**
 * The passage's words from its Anchor, whitespace collapsed (a display cache, never stored).
 *
 * @param anchor - A citation or origin Anchor.
 * @returns The quoted text, or "" when the Anchor has no TextQuoteSelector.
 */
export function anchorQuote(anchor: Anchor): string {
  const quote = anchor.selectors.find((s) => s.type === 'TextQuoteSelector');
  return quote?.type === 'TextQuoteSelector' ? quote.exact.replace(/\s+/g, ' ').trim() : '';
}

/**
 * The usage line under an answer. Always ends "(estimate)": these are the provider's figures.
 *
 * @param run - The run's summary.
 * @returns "6,776 tokens · ≈ $0.0027 (estimate)", or null when the run used nothing.
 */
export function usageLine(run: RunSummary | null): string | null {
  if (run === null) return null;
  const tokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0);
  if (tokens === 0) return null;
  const cost = run.cost_usd_est === null ? '' : ` · ≈ $${run.cost_usd_est.toFixed(4)}`;
  return `${tokens.toLocaleString('en-US')} tokens${cost} (estimate)`;
}

/**
 * The model's short name for the slip's source line ("MiniMax-M3.1-Flash-Preview" → "M3.1 Flash").
 *
 * @param model - The provider's model id, or null when the run is unknown.
 * @returns A short label; "the AI" when the model is unknown.
 */
export function modelLabel(model: string | null): string {
  if (model === null || model.trim() === '') return 'the AI';
  return model
    .replace(/^MiniMax-/i, '')
    .replace(/-Preview$/i, '')
    .replace(/-/g, ' ');
}

/**
 * "15 Oct" and "21:14" for a stored timestamp, in the reader's time zone.
 *
 * @param iso - An ISO timestamp from the API.
 * @returns The day and the time.
 */
export function dayAndTime(iso: string): { day: string; time: string } {
  const at = new Date(iso);
  return {
    day: at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    time: at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}
