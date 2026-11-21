/**
 * The explain panel's state and its reducer (the controller `useExplainActions` owns it). Pure.
 *
 * ONE CONVERSATION PER ASK: every `open` bumps the epoch, and the reducer drops events carrying any
 * other epoch, so a slow stream from the previous ask cannot write into the new one.
 */
import { EMPTY_PLATE, type PlateView } from '@/features/diagram';
import { DEFAULT_LEVEL } from '@/features/explain/model/levels';
import { mergeStored, type ThreadMessage } from '@/features/explain/model/messages';

import type { Anchor } from '@papertree/anchoring';
import type { ImageAsk } from '@/lib/imageAnchor';
import type { AnswerLevel, Message, RunSummary, Summary } from '@/lib/api/types';
import type { Failure } from '@/components/explain/errors';

/** What the panel is opened on: a selection's Anchor and its words, or a picture. */
export interface ExplainRequest {
  readonly anchor: Anchor;
  /**
   * The exact selected text, verbatim — the paper's words, rendered in the paper's register. For a
   * picture: the words selected with it, or "".
   */
  readonly quote: string;
  /** Set when the anchor is a figure or a region: the thread is an `image` thread (#348). */
  readonly image?: ImageAsk;
}

/** One line of the conversation as the panel shows it (defined beside the merge that builds it). */
export type ViewMessage = ThreadMessage;

/** Where the paper summary is: idle, working, or settled. */
export type SummaryPhase = 'idle' | 'loading' | 'streaming' | 'ready' | 'partial' | 'failed';

/** The paper summary as the panel shows it. */
export interface SummaryView {
  readonly phase: SummaryPhase;
  readonly label: string | null;
  readonly runId: string | null;
  readonly summary: Summary | null;
  readonly failure: Failure | null;
  readonly usage: RunSummary | null;
  /** Shown from the stored derivation, so no tokens were spent on it now (#204's footer). */
  readonly cached: boolean;
  /** The last request skipped the cache ("Summarise again"): its Retry asks for a new run again. */
  readonly regenerate: boolean;
}

/** Which of the panel's two views is shown. */
export type PanelView = 'thread' | 'summary';

/** Everything the explain panel holds. */
export interface ExplainState {
  /** Bumped by every `openExplain`; async continuations of an older epoch are ignored. */
  readonly epoch: number;
  readonly open: boolean;
  readonly view: PanelView;
  readonly request: ExplainRequest | null;
  readonly threadId: string | null;
  readonly messages: readonly ViewMessage[];
  readonly summary: SummaryView;
  /**
   * The person chose "New thread" (#202): the panel stays empty for a fresh question instead of
   * opening on the newest stored thread, and that question starts a new thread.
   */
  readonly fresh: boolean;
  /**
   * The composer's text, held here so it outlives the composer (the summary view and a closed
   * panel unmount it): a question refused before it was sent comes back into it (#204).
   */
  readonly draft: string;
  /** The thread is a diagram's (#217): its only next turn is a Redraw, never a typed question. */
  readonly diagram: boolean;
  /**
   * How deep the next answer goes: Familiar until the reader switches an answer's level, then the
   * level they chose (typed follow-ups and the go-deeper chips are asked at it). Starts over at
   * Familiar with every new explain, thread or fresh thread.
   */
  readonly level: AnswerLevel;
}

const IDLE_SUMMARY: SummaryView = {
  phase: 'idle',
  label: null,
  runId: null,
  summary: null,
  failure: null,
  usage: null,
  cached: false,
  regenerate: false,
};

/** The panel before anything is opened. */
export const INITIAL_STATE: ExplainState = {
  epoch: 0,
  open: false,
  view: 'thread',
  request: null,
  threadId: null,
  messages: [],
  summary: IDLE_SUMMARY,
  fresh: false,
  draft: '',
  diagram: false,
  level: DEFAULT_LEVEL,
};

/** Everything that changes the panel's state. */
export type ExplainAction =
  | {
      type: 'open';
      epoch: number;
      request: ExplainRequest | null;
      view: PanelView;
    }
  | { type: 'close' }
  | { type: 'level'; level: AnswerLevel }
  | { type: 'view'; view: PanelView }
  | { type: 'thread'; epoch: number; threadId: string }
  | {
      type: 'select';
      epoch: number;
      threadId: string;
      request: ExplainRequest | null;
      diagram: boolean;
    }
  | { type: 'fresh'; epoch: number }
  | { type: 'hydrate'; threadId: string; messages: readonly Message[] }
  | { type: 'add'; epoch: number; message: ViewMessage }
  | { type: 'patch'; epoch: number; key: string; patch: Partial<ViewMessage> }
  | { type: 'append'; epoch: number; key: string; delta: string }
  /** A diagram answer's plate grows by one event (or one note), #217. */
  | { type: 'plate'; epoch: number; key: string; update: (plate: PlateView) => PlateView }
  | { type: 'summary'; patch: Partial<SummaryView> }
  /** `restore`: a refused question returns only to an empty box, never over words typed since. */
  | { type: 'draft'; text: string; restore?: boolean }
  /** A new ask or retry: earlier refused Retries have been answered by the reader's next action. */
  | { type: 'clearRefusals'; epoch: number };

/**
 * The panel's reducer.
 *
 * @param state The current state.
 * @param action What happened.
 * @returns The next state.
 */
export function explainReducer(state: ExplainState, action: ExplainAction): ExplainState {
  switch (action.type) {
    case 'open':
      return {
        ...state,
        epoch: action.epoch,
        open: true,
        view: action.view,
        request: action.request,
        threadId: null,
        messages: [],
        fresh: false,
        diagram: false,
        level: DEFAULT_LEVEL,
      };
    case 'fresh':
      return {
        ...state,
        epoch: action.epoch,
        open: true,
        view: 'thread',
        request: null,
        threadId: null,
        messages: [],
        fresh: true,
        diagram: false,
        level: DEFAULT_LEVEL,
      };
    case 'close':
      return { ...state, open: false };
    case 'level':
      return { ...state, level: action.level };
    case 'view':
      return { ...state, view: action.view, open: true };
    case 'thread':
      return action.epoch === state.epoch ? { ...state, threadId: action.threadId } : state;
    case 'select':
      return {
        ...state,
        epoch: action.epoch,
        open: true,
        view: 'thread',
        request: action.request,
        threadId: action.threadId,
        messages: [],
        fresh: false,
        diagram: action.diagram,
        level: DEFAULT_LEVEL,
      };
    case 'hydrate':
      // A detail read for a thread the panel has left (the menu moved on) is dropped.
      return action.threadId === state.threadId
        ? { ...state, messages: mergeStored(state.messages, action.messages) }
        : state;
    case 'add':
      return action.epoch === state.epoch
        ? { ...state, messages: [...state.messages, action.message] }
        : state;
    case 'patch':
      return action.epoch === state.epoch
        ? {
            ...state,
            messages: state.messages.map((m) =>
              m.key === action.key ? { ...m, ...action.patch } : m,
            ),
          }
        : state;
    case 'append':
      return action.epoch === state.epoch
        ? {
            ...state,
            messages: state.messages.map((m) =>
              m.key === action.key ? { ...m, text: m.text + action.delta } : m,
            ),
          }
        : state;
    case 'plate':
      return action.epoch === state.epoch
        ? {
            ...state,
            messages: state.messages.map((m) =>
              m.key === action.key ? { ...m, diagram: action.update(m.diagram ?? EMPTY_PLATE) } : m,
            ),
          }
        : state;
    case 'draft':
      return action.restore === true && state.draft.trim() !== ''
        ? state
        : { ...state, draft: action.text };
    case 'clearRefusals':
      return action.epoch === state.epoch &&
        state.messages.some((m) => m.refusal !== undefined && m.refusal !== null)
        ? { ...state, messages: state.messages.map((m) => ({ ...m, refusal: null })) }
        : state;
    case 'summary':
      return { ...state, summary: { ...state.summary, ...action.patch } };
  }
}
