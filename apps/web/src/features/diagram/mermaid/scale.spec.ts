import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fitFigure, MIN_SCALE } from './scale';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('fitFigure: scale to the room, never below the minimum readable scale', () => {
  it('a drawing that fits is shown at its natural size, never enlarged', () => {
    expect(fitFigure(400, 520, false)).toEqual({ scale: 1, width: 400, scrolls: false });
  });

  it('a wider one shrinks to the room, down to 0.7', () => {
    expect(fitFigure(650, 520, false)).toEqual({ scale: 0.8, width: 520, scrolls: false });
    const edge = fitFigure(520 / MIN_SCALE, 520, false);
    expect(edge.scale).toBeCloseTo(0.7, 5);
    expect(edge.scrolls).toBe(false);
  });

  it('a much wider one (a 3,290 px timeline in the 520 px panel) stays at 0.7 and scrolls sideways', () => {
    const fit = fitFigure(3290, 520, false);
    expect(fit.scale).toBe(MIN_SCALE);
    expect(fit.width).toBe(Math.round(3290 * MIN_SCALE));
    expect(fit.scrolls).toBe(true);
  });

  it('never below 0.7 whatever the room', () => {
    for (const room of [120, 300, 520, 900]) {
      for (const natural of [200, 700, 1500, 4000]) {
        expect(fitFigure(natural, room, false).scale).toBeGreaterThanOrEqual(MIN_SCALE);
      }
    }
  });

  it('larger is the natural size, scrolling when it is wider than the room', () => {
    expect(fitFigure(3290, 520, true)).toEqual({ scale: 1, width: 3290, scrolls: true });
    expect(fitFigure(400, 520, true)).toEqual({ scale: 1, width: 400, scrolls: false });
  });

  it('a room not measured yet (0) draws the natural size and claims no scrolling', () => {
    expect(fitFigure(900, 0, false)).toEqual({ scale: 1, width: 900, scrolls: false });
  });

  it('no drawing, no size', () => {
    expect(fitFigure(0, 520, false).width).toBe(0);
  });
});

describe('the figure box (mermaid.css)', () => {
  const css = readFileSync(resolve(HERE, '../components/mermaid.css'), 'utf8');

  it('caps its height like a board card and scrolls inside, both ways', () => {
    expect(css).toMatch(/\.pt-mmd__scroll \{[^}]*overflow: auto;/);
    expect(css).toMatch(/\.pt-mmd__scroll \{[^}]*max-block-size: var\(--pt-card-cap, 60vh\);/);
  });

  it('draws the svg at the fitted width, not 100% of the room', () => {
    expect(css).toMatch(/\.pt-mmd__svg svg \{[^}]*inline-size: var\(--pt-mmd-w, 100%\);/);
    expect(css).toMatch(/max-inline-size: none !important/);
  });

  it('has a fade cue that shows only while there is more to scroll', () => {
    expect(css).toMatch(/\.pt-mmd__fade \{[^}]*opacity: 0;/);
    expect(css).toMatch(/\.pt-mmd\[data-scrolls='true'\] \.pt-mmd__fade \{[^}]*opacity: 1;/);
  });
});
