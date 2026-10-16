/**
 * Fitting a label to a plate box (#217): 15 px when it fits, else 13 px, else two lines broken at a
 * space, the rest cut with "…"; an edge label is cut to the room before the next lane. The labels
 * are the live smoke's (Attention §3.2.1, M3.1 Flash).
 */
import { describe, expect, it } from 'vitest';

import { cut, fitLabel } from './fit';

describe('fitLabel', () => {
  it('keeps a short label at 15 px on one line', () => {
    expect(fitLabel('Softmax', 130, 2)).toEqual({ size: 15, lines: ['Softmax'] });
  });
  it('drops to 13 px before it wraps', () => {
    expect(fitLabel('Divide by sqrt(dk)', 130, 2)).toEqual({
      size: 13,
      lines: ['Divide by sqrt(dk)'],
    });
  });
  it('breaks a long label at a space onto two lines', () => {
    expect(fitLabel('Weighted sum of values', 130, 2)).toEqual({
      size: 13,
      lines: ['Weighted sum of', 'values'],
    });
  });
  it('cuts to one line where the box keeps a line for its caption', () => {
    const fitted = fitLabel('Weighted sum of values', 130, 1);
    expect(fitted.lines).toHaveLength(1);
    expect(fitted.lines[0]).toMatch(/…$/);
  });
});

describe('cut', () => {
  it('leaves what fits and cuts what does not', () => {
    expect(cut('scores', 79, 13)).toBe('scores');
    expect(cut('weighted by the softmax', 60, 13)).toBe('weighte…');
  });
});
