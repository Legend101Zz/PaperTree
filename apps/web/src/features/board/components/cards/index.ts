/**
 * board/cards — the card kinds as xyflow node types (frame 06): index cards (passage, note,
 * question, notebook page) and AI-slip cards (explanation, diagram), plus the frame.
 */
import { memo } from 'react';

import { sameCard } from '../../model/glance';
import { withGlance } from './CardGlance';
import { ExplanationCard } from './ExplanationCard';
import { FrameNode } from './FrameNode';
import { DiagramCard, NotebookCard } from './NotebookCard';
import { NoteCard, QuestionCard } from './NoteCard';
import { PassageCard } from './PassageCard';

/**
 * Node type → the card that draws it; the keys are `flowType`'s values. Every card is memoised on
 * its row and draws as a glance when the board is zoomed out (#215); a frame stays an outline.
 */
export const nodeTypes = {
  excerpt: withGlance(PassageCard),
  explanation: withGlance(ExplanationCard),
  note: withGlance(NoteCard),
  question: withGlance(QuestionCard),
  notebook: withGlance(NotebookCard),
  diagram: withGlance(DiagramCard),
  frame: memo(FrameNode, sameCard),
};

export { CardGlance, withGlance } from './CardGlance';
export { CardShell } from './CardShell';
export { ClipBody } from './ClipBody';
