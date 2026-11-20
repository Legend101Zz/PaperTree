/**
 * The delete toast's sentence (v0.3 #337): the paper's title, and the work that goes with it so
 * the person knows what Undo holds. Zeros are left out; a long title is cut with an ellipsis.
 */
import { describe, expect, it } from 'vitest';

import { deletedMessage } from './catalogue';

describe('deletedMessage', () => {
  it('names the highlights and threads that go with the paper', () => {
    expect(deletedMessage({ title: 'Attention', highlightCount: 3, threadCount: 2 })).toBe(
      'Deleted “Attention”, with your 3 highlights and 2 threads',
    );
    expect(deletedMessage({ title: 'Attention', highlightCount: 1, threadCount: 1 })).toBe(
      'Deleted “Attention”, with your 1 highlight and 1 thread',
    );
  });

  it('leaves a zero out, and says only the title for a paper with no work in it', () => {
    expect(deletedMessage({ title: 'Attention', highlightCount: 0, threadCount: 2 })).toBe(
      'Deleted “Attention”, with your 2 threads',
    );
    expect(
      deletedMessage({ title: ' Attention ', highlightCount: 0, threadCount: undefined }),
    ).toBe('Deleted “Attention”');
  });

  it('cuts a very long title short', () => {
    const message = deletedMessage({ title: 'x'.repeat(300), highlightCount: 0, threadCount: 0 });
    expect(message).toBe(`Deleted “${'x'.repeat(59)}…”`);
  });
});
