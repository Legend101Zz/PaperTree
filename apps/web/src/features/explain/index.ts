/**
 * The explain feature: ask → answer → trace (#202). Its public surface: the exchange view model,
 * the panel's message shape and merge, and the hook that wires the stored threads to the panel.
 */
export {
  buildExchanges,
  formatAskTime,
  type AnswerModel,
  type Exchange,
  type PassageMarker,
  type TraceEntry,
} from './model/exchange';
export { mergeStored, type MessageStatus, type ThreadMessage } from './model/messages';
export { sortThreads, threadPosition } from './model/threads';
export { type ThreadDetail } from './api/threads';
export { useThreads, type ThreadsState } from './hooks/useThreads';
