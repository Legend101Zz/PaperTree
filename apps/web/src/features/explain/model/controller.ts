/**
 * The explain controller's public shape: what `useExplainActions` hands to the panel as ONE opaque
 * prop, so the panel can grow without touching the workspace's mount lines. Types only.
 */
import type { AnswerLevel, Message, Thread } from '@/lib/api/types';
import type { ExplainRequest, ExplainState, PanelView } from './state';

/** The explain panel's controller: its state and every action the panel and the reader can take. */
export interface ExplainController {
  /** The API paper, or `null` for a fixture paper, which no server can be asked about. */
  readonly paperId: string | null;
  readonly state: ExplainState;
  /** What the panel is open on; `null` when it was opened without a selection (or is closed). */
  readonly request: ExplainRequest | null;
  readonly openExplain: (input: ExplainRequest) => void;
  /**
   * Redraw a plate (#217): a new plate under a new ask in the same thread (`redraw_of`). On a plate
   * that never arrived (refused or failed before it was written) it asks for that plate again.
   */
  readonly redraw: (key: string) => void;
  /**
   * The selection toolbar's Ask (#203): open the panel on this passage with nothing sent, so the
   * reader's own question (`ask`) starts the thread about it.
   */
  readonly askAbout: (input: ExplainRequest) => void;
  /** Open the panel with no passage: the free-question and summary entry. */
  readonly openPanel: () => void;
  readonly closeExplain: () => void;
  readonly setView: (view: PanelView) => void;
  /**
   * A question typed in the panel: a follow-up when a thread exists, else a free `ask`. Resolves
   * `not-sent` when the server refused it before the stream (the composer then keeps the text).
   */
  readonly ask: (question: string, options?: AskOptions) => Promise<AskOutcome>;
  /**
   * Switch an answer to another level (v0.3, #349). The level becomes the thread's (follow-ups and
   * chips are asked at it). A level the answer already has costs no request: the panel simply shows
   * it. Otherwise the same question is asked again at that level (`relevel_of`), as a sibling of the
   * answer, not a new turn. `messageId` is the answer the user turn started.
   */
  readonly relevel: (messageId: string, level: AnswerLevel) => void;
  /** Stop the answer that is streaming; its partial text stays. */
  readonly stop: () => void;
  /** Re-run a failed, stopped or partial answer. */
  readonly retry: (key: string) => void;
  /**
   * Show the paper summary: the cached one, or a new run when there is none. `regenerate` skips
   * the cache and asks for a new run (the "Regenerate" action on a partial summary).
   */
  readonly summarize: (options?: { readonly regenerate?: boolean }) => void;
  readonly stopSummary: () => void;
  /** Show a stored thread (the thread menu, or the newest one when the panel opens empty). */
  readonly selectThread: (thread: Thread) => void;
  /** "New thread": an empty panel whose next question starts a new thread (owner may change). */
  readonly startFresh: () => void;
  /**
   * Merge a stored read of the current thread into the panel (#202): live while streaming, the
   * stored copy (locators, coverage) once settled, under the same keys. Other threads are ignored.
   */
  readonly hydrateThread: (threadId: string, messages: readonly Message[]) => void;
  /** The composer's text changed (the composer is controlled by `state.draft`). */
  readonly setDraft: (text: string) => void;
}

/** How a typed or chip ask is sent. */
export interface AskOptions {
  /** A go-deeper chip: a fixed question the reader did not type, so the panel keeps the draft and skips the thinking pause. */
  readonly quick?: boolean;
}

/** Whether an ask reached the AI: `not-sent` only for a refusal before the stream (#204). */
export type AskOutcome = 'sent' | 'not-sent';
