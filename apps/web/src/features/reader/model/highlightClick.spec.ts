/** The click-versus-drag rule for opening a highlight's card by mouse (#176). */
import { describe, expect, it } from 'vitest';

import { CLICK_SLOP_PX, isHighlightClick } from './highlightClick';

const at = (x: number, y: number) => ({ x, y });

describe('isHighlightClick', () => {
  it('a click that did not move opens the card', () => {
    expect(isHighlightClick({ down: at(10, 10), up: at(10, 10), detail: 1, shiftKey: false })).toBe(
      true,
    );
  });

  it('hand jitter within the slop is still a click (it used to select "o" and swallow it)', () => {
    expect(isHighlightClick({ down: at(10, 10), up: at(14, 10), detail: 1, shiftKey: false })).toBe(
      true,
    );
    expect(
      isHighlightClick({
        down: at(10, 10),
        up: at(10 + CLICK_SLOP_PX, 10),
        detail: 1,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it('a drag past the slop selects text and does not open the card', () => {
    expect(isHighlightClick({ down: at(10, 10), up: at(16, 10), detail: 1, shiftKey: false })).toBe(
      false,
    );
    expect(
      isHighlightClick({ down: at(10, 10), up: at(130, 14), detail: 1, shiftKey: false }),
    ).toBe(false);
  });

  it('double and triple clicks select a word or a line; Shift extends the selection', () => {
    expect(isHighlightClick({ down: at(10, 10), up: at(10, 10), detail: 2, shiftKey: false })).toBe(
      false,
    );
    expect(isHighlightClick({ down: at(10, 10), up: at(10, 10), detail: 3, shiftKey: false })).toBe(
      false,
    );
    expect(isHighlightClick({ down: at(10, 10), up: at(10, 10), detail: 1, shiftKey: true })).toBe(
      false,
    );
  });

  it('a click with no recorded press counts as a click', () => {
    expect(isHighlightClick({ down: null, up: at(10, 10), detail: 1, shiftKey: false })).toBe(true);
  });
});
