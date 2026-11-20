import { describe, expect, it } from 'vitest';

import { flowType } from './flow';

describe('flowType', () => {
  it('draws a note kept on words (it has a parent) as a branchnote, the node class the board shows', () => {
    expect(flowType({ kind: 'note', parent_id: 'cn_answer' })).toBe('branchnote');
  });

  it('keeps a loose note a note, and a frame a frame', () => {
    expect(flowType({ kind: 'note', parent_id: null })).toBe('note');
    expect(flowType({ kind: 'group', parent_id: null })).toBe('frame');
    expect(flowType({ kind: 'explanation', parent_id: 'cn_a' })).toBe('explanation');
  });
});
