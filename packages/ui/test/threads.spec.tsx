/** ThreadSwatch (#237): every relation kind differs by colour AND by a drawn, non-colour cue. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { THREAD_KINDS, THREAD_LINES, ThreadSwatch, markPositions } from '../src/threads.js';

afterEach(cleanup);

/** What a reader could tell apart without colour: shape counts, dash pattern, fill, cue name. */
function cueSignature(svg: Element): string {
  const dash = [...svg.querySelectorAll('[stroke-dasharray]')].map((e) =>
    e.getAttribute('stroke-dasharray'),
  );
  const lines = svg.querySelectorAll('line').length;
  const paths = svg.querySelectorAll('path').length;
  const filled = svg.querySelectorAll('[fill="currentColor"]').length;
  return JSON.stringify({ dash, lines, paths, filled, cue: svg.getAttribute('data-cue') });
}

describe('ThreadSwatch', () => {
  it('names itself with the kind and its cue, and shows glyph and name as text', () => {
    render(<ThreadSwatch kind="contradicts" />);
    const img = screen.getByRole('img', { name: 'contradicts: dashed with crosses' });
    expect(img.textContent).toContain('×');
    expect(img.textContent).toContain('contradicts');
  });

  it('gives each of the seven kinds its own colour token', () => {
    const colours = THREAD_KINDS.map((info) => {
      const { container } = render(<ThreadSwatch kind={info.kind} />);
      const svg = container.querySelector('svg')!;
      cleanup();
      return svg.style.color;
    });
    expect(new Set(colours).size).toBe(7);
    expect(colours[0]).toBe('var(--pt-wire-supports)');
  });

  it('gives each kind a distinct non-colour cue', () => {
    const signatures = THREAD_KINDS.map((info) => {
      const { container } = render(<ThreadSwatch kind={info.kind} />);
      const sig = cueSignature(container.querySelector('svg')!);
      cleanup();
      return sig;
    });
    expect(new Set(signatures).size).toBe(7);
  });

  it('draws the doubled line as two lines and the arrowhead as a filled shape', () => {
    const doubled = render(<ThreadSwatch kind="compares" />).container.querySelectorAll('line');
    expect(doubled.length).toBe(2);
    cleanup();
    const answers = render(<ThreadSwatch kind="answers" />).container;
    expect(answers.querySelectorAll('[fill="currentColor"]').length).toBe(1);
  });
});

describe('markPositions: one table for the strip, the legend and the board', () => {
  it('repeats crosses along a long line, keeps one on a short one, and pins the rest', () => {
    expect(markPositions(THREAD_LINES.contradicts, 116).map((f) => Math.round(f * 116))).toEqual([
      28, 56, 84,
    ]);
    expect(markPositions(THREAD_LINES.contradicts, 30)).toEqual([0.5]);
    expect(markPositions(THREAD_LINES.supports, 400)).toEqual([0.5]);
    expect(markPositions(THREAD_LINES.derives, 400)).toEqual([0.5]);
    expect(markPositions(THREAD_LINES.plain, 400)).toEqual([]);
  });

  it('draws the swatch’s marks from that table: a plus on supports, crosses on contradicts', () => {
    const plus = render(<ThreadSwatch kind="supports" />).container.querySelectorAll('path');
    expect(plus).toHaveLength(1);
    cleanup();
    const crosses = render(<ThreadSwatch kind="contradicts" />).container.querySelectorAll('path');
    expect(crosses).toHaveLength(3);
  });
});
