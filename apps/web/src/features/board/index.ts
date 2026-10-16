/**
 * The board feature (v0.2, #211–#215): the linen board of index cards, AI-slip cards, brass pins and
 * typed threads. `app/paper/[id]/board` renders `BoardView` (`/canvas` redirects there, #214); the
 * reader's "Send to board" and "Open source" helpers keep their v0.1 home, `components/canvas`.
 */
export { BoardView, citationHref } from './components/BoardView';
export { nodeTypes } from './components/cards';
export { useBoardController, staleSubject } from './hooks/useBoardController';
export { useCardSources } from './hooks/useCardSources';
export * from './model/flow';
export { newEdgeId, newNodeId } from './model/ids';
export * from './model/placement';
