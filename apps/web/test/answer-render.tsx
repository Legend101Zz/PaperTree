/**
 * A bare answer as the panel draws it, for the specs that test text rendering (Markdown, maths,
 * stopped answers): `buildAnswer` over one message, each paragraph through `AnswerText`. Not a spec
 * (no `.spec`), so vitest does not collect it. "General knowledge" is off by default so a spec can
 * compare the prose's own `textContent`.
 */
import type { ReactNode } from 'react';

import { AnswerText } from '@/features/explain/components/AnswerText';
import { buildAnswer, type PaperSource } from '@/features/explain/model/answer';
import { threadHandles } from '@/features/explain/model/passages';
import type { Citation } from '@/lib/api/types';

export interface AnswerProps {
  readonly text: string;
  readonly citations?: readonly Citation[];
  readonly status?: 'streaming' | 'complete' | 'partial' | 'error' | 'aborted';
  readonly general?: boolean;
  readonly touch?: boolean;
  readonly onShow?: (source: PaperSource) => void;
}

/**
 * The source lines under an answer, as a reader sees them: the peek popovers (hidden until a page
 * is hovered or focused) are left out.
 *
 * @param root Where to look.
 * @returns One string per `.pt-source` line, in order.
 */
export function sourceLines(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('.pt-source'), (line) => {
    const clone = line.cloneNode(true) as Element;
    clone.querySelectorAll('[role="tooltip"]').forEach((peek) => peek.remove());
    return clone.textContent ?? '';
  });
}

/** One answer's paragraphs, each with its quiet source line. */
export function Answer({
  text,
  citations = [],
  status = 'complete',
  general = false,
  touch = false,
  onShow = () => undefined,
}: AnswerProps): ReactNode {
  const model = buildAnswer(
    { key: 'a', role: 'assistant', text, status, citations, question: '', createdAt: null },
    threadHandles([]),
  );
  return model.paragraphs.map((p) => (
    <AnswerText
      key={p.index}
      paragraph={p}
      streaming={status === 'streaming'}
      general={general}
      touch={touch}
      onShow={onShow}
    />
  ));
}
