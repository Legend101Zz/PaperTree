/**
 * The split view (#344): the paper on the left and the real board on the right, "Board beside".
 * `ReaderWorkspace` mounts it; the board's own half is `features/board`'s `BoardHost`.
 */
export { BoardBeside } from './components/BoardBeside';
export { useBoardBeside, type BoardBeside as BoardBesideControl } from './hooks/useBoardBeside';
export { draggedPassage, setDraggedPassage } from './model/passageDrag';
export { useBoardBesideWiring } from './hooks/useBoardBesideWiring';
export { useDragIn } from './hooks/useDragIn';
