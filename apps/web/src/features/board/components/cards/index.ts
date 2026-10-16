/**
 * board/cards — the card kinds as xyflow node types (frame 06): index cards (passage, note,
 * question, notebook page) and AI-slip cards (explanation, diagram), plus the frame.
 */
import { ExplanationCard } from './ExplanationCard';
import { FrameNode } from './FrameNode';
import { DiagramCard, NotebookCard } from './NotebookCard';
import { NoteCard, QuestionCard } from './NoteCard';
import { PassageCard } from './PassageCard';

/** Node type → the card that draws it; the keys are `flowType`'s values. */
export const nodeTypes = {
  excerpt: PassageCard,
  explanation: ExplanationCard,
  note: NoteCard,
  question: QuestionCard,
  notebook: NotebookCard,
  diagram: DiagramCard,
  frame: FrameNode,
};

export { AnswerText } from './ExplanationCard';
export { CardShell, ClipBody } from './CardShell';
