/**
 * Passage numbers for ask → answer → trace (#202, ADR-004 §2.6, DESIGN.md §3.2). A passage is a
 * cited citation's `locator.passage_key`; numbers run 1..k in the order the THREAD first cites
 * each passage, so marker 2 is the same passage in the answer, its trace and every later exchange.
 * Pure: no React, no fetch. `exchange.ts` builds the on-screen exchange from these numbers.
 */
import type { Citation } from '@/lib/api/types';

/** One answer as numbering reads it: its text (with `[bN]` handles) and its citations. */
export interface CitedAnswer {
  readonly text: string;
  readonly citations: readonly Citation[];
}

/** The thread's passage numbering. */
export interface PassageNumbers {
  /** Passage key → its number (1-based). */
  readonly byKey: ReadonlyMap<string, number>;
  /**
   * Handle → passage key, learnt from every citation of the thread that carries a locator. The
   * server keeps a thread's handles stable across its runs (`ai_run_handles`), so a live citation,
   * which arrives without a locator, still finds its passage through its handle.
   */
  readonly keyOfHandle: ReadonlyMap<string, string>;
}

/** Mirrors `MARKER_PATTERN` (agent contract) and `evidence.MARKER` (API): `[b3]`, `[b1, b8]`. */
const HANDLE_RUN = /\[(b\d+(?:\s*,\s*b\d+)*)\]/g;

/**
 * The handle runs of a text, in order: `[b1, b8]` is one run of two handles.
 *
 * @param text An answer or one of its paragraphs.
 * @returns One array of handles per run, in reading order.
 * @example
 * handleRuns('A [b1]. B [b1, b8].'); // [['b1'], ['b1', 'b8']]
 */
export function handleRuns(text: string): string[][] {
  return Array.from(text.matchAll(HANDLE_RUN), (match) =>
    (match[1] ?? '').split(',').map((handle) => handle.trim()),
  );
}

/**
 * The passage a citation points at. Its locator's key when it has one; else the key its handle
 * had elsewhere in the thread; else the handle itself, so an unlocated citation is still one
 * passage of its own and never merges with another.
 *
 * @param citation The citation.
 * @param keyOfHandle Handle → key, from `numberPassages`.
 * @returns The passage key.
 */
export function passageKeyOf(citation: Citation, keyOfHandle: ReadonlyMap<string, string>): string {
  return (
    citation.locator?.passage_key ?? keyOfHandle.get(citation.marker) ?? `handle:${citation.marker}`
  );
}

/** An answer's citations split by how its text uses them. */
export interface CitationUse {
  /** One entry per handle occurrence that has a citation, in reading order (repeats included). */
  readonly occurrences: readonly Citation[];
  /** Citations the text never mentions, by ordinal: kept so no stored source is lost. */
  readonly loose: readonly Citation[];
}

/**
 * How an answer's text uses its citations. A handle with no citation is dropped, as the server's
 * coverage drops it (`unresolved_markers`): a reader cannot act on "b9".
 *
 * @param answer The answer.
 * @returns The cited occurrences in reading order and the unmentioned citations.
 */
export function citationUse(answer: CitedAnswer): CitationUse {
  const byMarker = new Map(answer.citations.map((c) => [c.marker, c] as const));
  const occurrences: Citation[] = [];
  for (const run of handleRuns(answer.text)) {
    for (const handle of run) {
      const citation = byMarker.get(handle);
      if (citation !== undefined) occurrences.push(citation);
    }
  }
  const used = new Set(occurrences.map((c) => c.marker));
  const loose = answer.citations
    .filter((c) => !used.has(c.marker))
    .sort((a, b) => a.ordinal - b.ordinal);
  return { occurrences, loose };
}

/**
 * Number every passage a thread cites, 1..k in order of first use across its answers.
 *
 * @param answers The thread's answers, oldest first.
 * @returns The numbering (`byKey`) and the handle → key map it used.
 * @example
 * // the stored Attention thread: b1, b6, b7, b8 → 1, 2, 3, 4; the follow-up's b6 stays 2
 * numberPassages([first, followUp]).byKey.get(keyOfB6); // 2
 */
export function numberPassages(answers: readonly CitedAnswer[]): PassageNumbers {
  const keyOfHandle = new Map<string, string>();
  for (const answer of answers) {
    for (const citation of answer.citations) {
      if (citation.locator !== undefined && !keyOfHandle.has(citation.marker)) {
        keyOfHandle.set(citation.marker, citation.locator.passage_key);
      }
    }
  }
  const byKey = new Map<string, number>();
  for (const answer of answers) {
    const use = citationUse(answer);
    for (const citation of [...use.occurrences, ...use.loose]) {
      const key = passageKeyOf(citation, keyOfHandle);
      if (!byKey.has(key)) byKey.set(key, byKey.size + 1);
    }
  }
  return { byKey, keyOfHandle };
}

/**
 * The passage numbers of one handle run, deduplicated in order (`[b1, b8]` → `[1, 4]`). A handle
 * with no citation in this answer, or a passage the numbering does not know, yields nothing.
 *
 * @param run The run's handles.
 * @param answer The answer the run belongs to.
 * @param numbers The thread's numbering.
 * @returns The numbers to draw as markers after the claim.
 */
export function runNumbers(
  run: readonly string[],
  answer: CitedAnswer,
  numbers: PassageNumbers,
): number[] {
  const out: number[] = [];
  for (const handle of run) {
    const citation = answer.citations.find((c) => c.marker === handle);
    if (citation === undefined) continue;
    const n = numbers.byKey.get(passageKeyOf(citation, numbers.keyOfHandle));
    if (n !== undefined && !out.includes(n)) out.push(n);
  }
  return out;
}
