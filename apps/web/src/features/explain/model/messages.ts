/**
 * A thread's messages as the panel holds them, and the merge of the live stream with the stored
 * thread (#202). While an answer streams, the live state is the truth; once it settles, the stored
 * detail (coverage, usage, times, the verdicts) replaces it under the SAME key, so nothing remounts,
 * flickers or appears twice; the markers keep the live citations they were drawn from (#252). Pure; the controller (`useExplainActions`) owns the state, `useThreads` the reads.
 */
import type { Failure } from '@/components/explain/errors';
import type { Citation, Message, MessageCoverage, RunSummary } from '@/lib/api/types';

/** A message's lifecycle, as the wire spells it. */
export type MessageStatus = 'streaming' | 'complete' | 'partial' | 'error' | 'aborted';

/** One message of the thread as the panel shows it (the controller's `ViewMessage`). */
export interface ThreadMessage {
  /** Local, stable across the message's whole life (the server id only arrives with `run`). */
  readonly key: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  /** The server's `message_id`, once known. `sendToCanvas`, `retry_of` and the merge need it. */
  readonly messageId: string | null;
  readonly runId: string | null;
  readonly status: MessageStatus;
  /** The reader pressed Stop: the partial text is kept and marked as stopped. */
  readonly stopped: boolean;
  /** The status label while it works ("Reading p. 4 · §2.1"). */
  readonly label: string | null;
  readonly failure: Failure | null;
  readonly citations: readonly Citation[];
  readonly usage: RunSummary | null;
  /** For an assistant message: the question it answers (a retry sends it again). */
  readonly question: string;
  /** ISO time: the server's `created_at` once stored, the moment it was asked until then. */
  readonly createdAt: string | null;
  /** The server's coverage of a stored answer; null while live. */
  readonly coverage: MessageCoverage | null;
  /** The parse generation of the run (the `run` event's, or the stored message's); null until known. */
  readonly generation: number | null;
  /**
   * A Retry of this answer was refused before it was sent (the daily cap, #204): the answer it
   * would have replaced stays as it was, with this beneath it, until the reader's next ask or retry.
   * Live only; a stored read never clears it.
   */
  readonly refusal?: Failure | null;
  /**
   * Stopped in this session and its stored copy (with the citations the server minted for what
   * arrived) has not landed yet: drawn as while streaming, so nothing is classed uncited and then
   * moved (#204).
   */
  readonly awaitingStored?: boolean;
}

const STORED = 's:';

/**
 * Whether a message came from a stored read rather than this session's live stream (a stored
 * message is keyed by its server id; a live one keeps its live key even after the merge).
 *
 * @param message A panel message.
 * @returns True for a message first seen in a stored read.
 */
export function isStored(message: Pick<ThreadMessage, 'key'>): boolean {
  return message.key.startsWith(STORED);
}

function failureOfStored(message: Message): Failure | null {
  if (message.error !== null) {
    return { code: message.error.code, retryable: message.error.retryable };
  }
  return message.status === 'aborted' ? { code: 'aborted', retryable: true } : null;
}

/**
 * A stored message as the panel holds it.
 *
 * @param message The stored message.
 * @param question For an answer, the ask before it ("" for a user turn).
 * @returns The panel's message, keyed by its server id.
 */
export function fromStored(message: Message, question: string): ThreadMessage {
  return {
    key: `${STORED}${message.message_id}`,
    role: message.role,
    text: message.content,
    messageId: message.message_id,
    runId: message.run?.run_id ?? null,
    status: message.status,
    stopped: false,
    label: null,
    failure: failureOfStored(message),
    citations: message.citations,
    usage: message.run,
    question,
    createdAt: message.created_at,
    coverage: message.coverage ?? null,
    generation: message.generation,
  };
}

/**
 * The stored messages worth showing, oldest first, each answer paired with its ask. A retry
 * appends a new answer to the same user turn (`retry_of`), so an answer followed directly by
 * another answer was replaced and is dropped.
 *
 * @param stored The thread detail's messages.
 * @returns The messages with each answer's question.
 */
function shownStored(stored: readonly Message[]): ThreadMessage[] {
  const ordered = [...stored].sort((a, b) => a.ordinal - b.ordinal);
  const out: ThreadMessage[] = [];
  let ask = '';
  ordered.forEach((message, i) => {
    if (message.role === 'user') {
      ask = message.content;
      out.push(fromStored(message, ''));
      return;
    }
    if (ordered[i + 1]?.role === 'assistant') return;
    out.push(fromStored(message, ask));
  });
  return out;
}

/**
 * The live message or its stored copy, whichever is the truth now. Live while either side is
 * still streaming (a detail fetched mid-stream is stale); stored once both have settled, under the
 * live key, keeping the live-only facts (Stop was pressed; the question it answers; the citations
 * the markers on screen were drawn from; a refused Retry). Its landing ends `awaitingStored`.
 *
 * @param live The message on screen.
 * @param stored The same message from the server.
 * @returns The message to keep.
 */
/**
 * The citations a settled answer keeps. The markers on screen were drawn from the live ones: keep
 * those objects, so no marker, number or tab changes under the reader (#252), but take each one's
 * verdict (`supported`) from the stored record, matched by `citation_id`, so a "not verified" is
 * never lost (it may appear after `done`: that is the honest direction). The stored locators (a
 * finer "¶") show the next time the thread is opened. An answer with no live citations (stopped
 * before they came) takes the stored ones.
 *
 * @param live The citations the markers were drawn from.
 * @param stored The stored copy's citations.
 * @returns The citations to keep.
 */
function shownCitations(
  live: readonly Citation[],
  stored: readonly Citation[],
): readonly Citation[] {
  if (live.length === 0) return stored;
  const byId = new Map(stored.map((c) => [c.citation_id, c] as const));
  const same = byId.size === live.length && live.every((c) => byId.has(c.citation_id));
  if (!same && process.env.NODE_ENV === 'development') {
    // Unreachable on today's write path (the API persists, then sends, the same rows); say so if
    // it ever happens, since the readout (stored coverage) and the markers (live) would disagree.
    console.warn('explain: the live and stored citations of an answer differ', {
      live: live.map((c) => c.citation_id),
      stored: stored.map((c) => c.citation_id),
    });
  }
  return live.map((c) => {
    const verdict = byId.get(c.citation_id)?.supported;
    return verdict === undefined || verdict === c.supported ? c : { ...c, supported: verdict };
  });
}

function settle(live: ThreadMessage, stored: ThreadMessage): ThreadMessage {
  if (live.status === 'streaming' || stored.status === 'streaming') return live;
  return {
    ...stored,
    key: live.key,
    citations: shownCitations(live.citations, stored.citations),
    stopped: live.stopped,
    refusal: live.refusal ?? null,
    awaitingStored: false,
    question: live.role === 'assistant' && live.question !== '' ? live.question : stored.question,
  };
}

/**
 * Merge the live messages with a stored thread detail: stored order, live keys, no duplicates.
 * Live messages the snapshot does not know yet (asked after it was read) follow, in live order.
 *
 * @param live The panel's messages.
 * @param stored The thread detail's messages.
 * @returns The merged list.
 * @example
 * // a first answer just finished: the stored ask appears before it, the answer keeps its key
 * mergeStored([liveAnswer], [storedAsk, storedAnswer]); // [ask, {...storedAnswer, key: liveAnswer.key}]
 */
export function mergeStored(
  live: readonly ThreadMessage[],
  stored: readonly Message[],
): ThreadMessage[] {
  const liveById = new Map(
    live.flatMap((m) => (m.messageId === null ? [] : [[m.messageId, m] as const])),
  );
  const storedIds = new Set(stored.map((m) => m.message_id));
  const shown = shownStored(stored);
  // A read can land after the server wrote a new turn's rows but before the client handled its
  // `run` event: the live ask and answer have no ids yet, so the stored copies of that same turn
  // (an unmatched trailing ask and still-streaming answer) are left out until they can be matched.
  if (live.some((m) => m.messageId === null && m.status === 'streaming')) {
    for (let last = shown.at(-1); last !== undefined; last = shown.at(-1)) {
      const unmatched = last.messageId === null || !liveById.has(last.messageId);
      if (!unmatched || (last.role === 'assistant' && last.status !== 'streaming')) break;
      shown.pop();
    }
  }
  const merged = shown.map((s) => {
    const match = s.messageId === null ? undefined : liveById.get(s.messageId);
    return match === undefined ? s : settle(match, s);
  });
  const placed = new Set(merged.map((m) => m.key));
  const newer = live.filter(
    (m) => !placed.has(m.key) && (m.messageId === null || !storedIds.has(m.messageId)),
  );
  return [...merged, ...newer];
}
