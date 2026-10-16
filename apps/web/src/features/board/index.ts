/**
 * The board feature (v0.2, #211–#215): the linen board of index cards, AI-slip cards, brass pins and
 * typed threads. `app/paper/[id]/canvas` renders `BoardView`; the reader's "Send to canvas" and
 * "Open source" helpers still live in `components/canvas` until the Board wording sweep (S6d).
 */
export { BoardView, citationHref } from './components/BoardView';
export { nodeTypes } from './components/cards';
export { useBoardController, staleSubject } from './hooks/useBoardController';
export { useCardSources, useExplanationCitations } from './hooks/useCardSources';
export * from './model/flow';
export { newEdgeId, newNodeId } from './model/ids';
export * from './model/placement';
