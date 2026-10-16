import { describe, expect, it } from 'vitest';

import { clipState } from './clip';

describe('clipState: a cut-off body is never silent (GAP-A3 §7)', () => {
  it('fades and offers "more" when the words do not fit', () => {
    expect(clipState(480, 200, false)).toEqual({ clipped: true, control: 'more' });
  });

  it('shows nothing extra when everything fits, sub-pixel rounding included', () => {
    expect(clipState(200, 200, false)).toEqual({ clipped: false, control: null });
    expect(clipState(201.5, 200, false)).toEqual({ clipped: false, control: null });
  });

  it('offers "less" and no fade once expanded', () => {
    expect(clipState(480, 480, true)).toEqual({ clipped: false, control: 'less' });
  });
});
