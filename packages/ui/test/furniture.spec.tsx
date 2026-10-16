/** Behaviour of the v0.2 SproutMark, LabelHolder and ReadingNowRow (#226). */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LabelHolder,
  ReadingNowRow,
  SproutMark,
  paperCountLabel,
  readingFraction,
} from '../src/index.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SproutMark', () => {
  it('is decorative by default and named when given a title', () => {
    const { container, rerender } = render(<SproutMark />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<SproutMark title="PaperTree" />);
    expect(screen.getByRole('img', { name: 'PaperTree' })).toBeTruthy();
  });

  it('strokes in currentColor, never fills, and adds the leaf veins from 20 px up', () => {
    const small = render(<SproutMark size={16} />).container.querySelector('svg')!;
    expect(small.getAttribute('stroke')).toBe('currentColor');
    expect(small.getAttribute('fill')).toBe('none');
    cleanup();
    const large = render(<SproutMark size={20} />).container.querySelector('svg')!;
    expect(large.querySelectorAll('path').length).toBeGreaterThan(
      small.querySelectorAll('path').length,
    );
    expect(large.getAttribute('stroke-width')).not.toBe(small.getAttribute('stroke-width'));
  });
});

describe('LabelHolder', () => {
  it('is a button with the full accessible name and calls onSelect', () => {
    const onSelect = vi.fn();
    render(<LabelHolder name="Transformers & attention" count={7} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transformers & attention, 7 papers' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('is plain text, still fully named, without onSelect', () => {
    render(<LabelHolder name="Vision" count={1} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Vision, 1 paper')).toBeTruthy();
    expect(paperCountLabel(0)).toBe('0 papers');
  });
});

describe('ReadingNowRow', () => {
  it('shows the page text and calls onContinue', () => {
    const onContinue = vi.fn();
    render(<ReadingNowRow title="Attention" page={4} pageCount={15} onContinue={onContinue} />);
    expect(screen.getByText('p. 4 of 15')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('is 44 px tall on touch and clamps the progress fraction', () => {
    render(
      <ReadingNowRow title="A" page={1} pageCount={2} onContinue={() => undefined} size="touch" />,
    );
    expect(screen.getByRole('button', { name: 'Continue' }).style.minHeight).toBe('44px');
    expect(readingFraction(4, 15)).toBeCloseTo(0.2667, 3);
    expect(readingFraction(20, 15)).toBe(1);
    expect(readingFraction(1, 0)).toBe(0);
  });
});
