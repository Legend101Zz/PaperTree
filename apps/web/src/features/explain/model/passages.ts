/**
 * Handles of an answer (#202, #340). The agent writes `[b3]` or `[b1, b8]` after a claim; the
 * server keeps a thread's handles stable across its runs, so a handle the thread has already
 * resolved still names the same passage in a later answer, and a streaming answer can resolve it
 * before its own citations arrive (they come just before `done`, #204). Pure: no React, no fetch.
 */
import type { Citation } from '@/lib/api/types';

/** One answer as the handle map reads it: its citations. */
export interface CitedAnswer {
  readonly citations: readonly Citation[];
}

/** The thread's handle → the first citation that resolved it. */
export interface ThreadHandles {
  readonly handleCitations: ReadonlyMap<string, { readonly citation: Citation }>;
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
 * Every handle a thread has resolved, over its answers (oldest first).
 *
 * @param answers The thread's answers.
 * @returns Handle → the first citation that resolved it.
 */
export function threadHandles(answers: readonly CitedAnswer[]): ThreadHandles {
  const handleCitations = new Map<string, { citation: Citation }>();
  for (const answer of answers) {
    for (const citation of answer.citations) {
      if (!handleCitations.has(citation.marker)) {
        handleCitations.set(citation.marker, { citation });
      }
    }
  }
  return { handleCitations };
}
