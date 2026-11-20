/**
 * answerView: a stored or cut-off answer never reaches a card with a raw handle run (S9-4). The
 * board card draws `answerView(...).model.blocks` through `AnswerBody`, so that is what is read.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AnswerBody } from '@/features/explain/components/AnswerBody';

import { answerView } from './answerView';

afterEach(cleanup);

const PARTIAL =
  'The paper splits the image into a grid [b1]. Each cell predicts boxes from scattered fragments [b42, b43, b48';

/** What a card shows of a text: the answer's blocks drawn as the card draws them. */
function shown(text: string, state: 'live' | 'done' | 'cut'): string {
  const view = answerView('n1', text, state, []);
  const { container } = render(
    <AnswerBody
      blocks={view.model.blocks}
      streaming={state === 'live'}
      general={false}
      onShow={() => undefined}
    />,
  );
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('answerView', () => {
  it.each(['live', 'done', 'cut'] as const)(
    'draws no raw handle at the end of a %s answer that stops inside a run',
    (state) => {
      const text = shown(PARTIAL, state);
      expect(text).toContain('Each cell predicts boxes from scattered fragments');
      expect(text).not.toMatch(/\[|\bb\d{1,2}\b/);
    },
  );

  it.each(['[b1, b', '[b', '[', '[b1, '])(
    'drops the half-typed tail %s of a stored answer',
    (tail) => {
      expect(shown(`A grid of cells ${tail}`, 'done')).toBe('A grid of cells');
    },
  );

  it('keeps an ordinary finished answer whole', () => {
    expect(shown('A grid of cells [b1].', 'done')).toBe('A grid of cells.');
  });
});
