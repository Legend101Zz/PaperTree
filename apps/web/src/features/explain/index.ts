/**
 * The explain feature: ask → answer → trace (#202). Its public surface: the panel, the one
 * exchange layout, the exchange view model, the panel's message shape and merge, and the hook
 * that wires the stored threads to the panel.
 */
export { ExplainPanel, type ExplainPanelProps } from './components/ExplainPanel';
export { Exchange, type ExchangeProps } from './components/Exchange';
export { ThreadMenu, type ThreadMenuProps } from './components/ThreadMenu';
export {
  buildExchanges,
  formatAskTime,
  type AnswerModel,
  type Exchange as ExchangeModel,
  type PassageMarker,
  type TraceEntry,
} from './model/exchange';
export { mergeStored, type MessageStatus, type ThreadMessage } from './model/messages';
export { sortThreads, threadPosition } from './model/threads';
export { type ThreadDetail } from './api/threads';
export { useThreads, type ThreadsState } from './hooks/useThreads';
