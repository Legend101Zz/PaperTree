/**
 * W2UI #141 item 12: two citation chips on neighbouring text lines can have overlapping 40 px hit
 * areas. A tap in the overlap goes to the chip whose pill is NEAREST the finger, not to the later
 * one in the document. jsdom has no layout, so the chip rectangles are stubbed to the geometry the
 * stylesheet produces (28 px pills, 20 px line pitch, 6 px / 4 px hit padding).
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { nearestChip } from '@/components/explain/chipHit';
import { RichText } from '@/components/explain/RichText';

import { citation } from './s6-support';

afterEach(cleanup);

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe('nearestChip', () => {
  const upper = rect(100, 100, 40, 28); // 100..128, hit area 94..134
  const lower = rect(100, 144, 40, 28); // 144..172, hit area 138..178: clear of the upper
  const tight = rect(100, 132, 40, 28); // 132..160, hit area 126..166: overlaps the upper's 126..134

  it('picks the chip whose pill is nearest in the overlap', () => {
    expect(nearestChip([upper, tight], 120, 129)).toBe(0); // 1 px under the upper pill, 3 px above the lower
    expect(nearestChip([upper, tight], 120, 124)).toBe(0); // inside the upper pill
    expect(nearestChip([upper, tight], 120, 131)).toBe(1); // 3 px under the upper pill, 1 px above the lower
    expect(nearestChip([upper, tight], 120, 150)).toBe(1); // inside the lower pill
  });

  it('is -1 outside every hit area', () => {
    expect(nearestChip([upper, lower], 300, 300)).toBe(-1);
    expect(nearestChip([upper, lower], 120, 136)).toBe(-1); // between the two hit areas
  });
});

describe('a tap in the overlap of two chips', () => {
  it('opens the nearer chip even though the browser gave the tap to the later one', () => {
    const onCite = vi.fn();
    const first = citation('b1');
    const second = citation('b2', { page_index: 7 });
    const { container } = render(
      <RichText text="Alpha [b1]. Beta [b2]." citations={[first, second]} onCite={onCite} />,
    );
    const chips = Array.from(container.querySelectorAll<HTMLElement>('.pt-chip'));
    expect(chips).toHaveLength(2);
    chips[0]!.getBoundingClientRect = () => rect(100, 100, 40, 28) as DOMRect;
    chips[1]!.getBoundingClientRect = () => rect(100, 132, 40, 28) as DOMRect;

    // The pointer is at y=129, two px below the first pill; the browser reports the later chip.
    fireEvent.click(chips[1]!, { clientX: 120, clientY: 129, detail: 1 });
    expect(onCite).toHaveBeenCalledTimes(1);
    expect(onCite.mock.calls[0]![0]).toMatchObject({ citation_id: first.citation_id });

    onCite.mockReset();
    // A tap clearly on the second pill still opens the second.
    fireEvent.click(chips[1]!, { clientX: 120, clientY: 150, detail: 1 });
    expect(onCite).toHaveBeenCalledTimes(1);
    expect(onCite.mock.calls[0]![0]).toMatchObject({ citation_id: second.citation_id });

    onCite.mockReset();
    // Keyboard activation (detail 0) is never redirected.
    fireEvent.click(chips[1]!, { clientX: 0, clientY: 0, detail: 0 });
    expect(onCite.mock.calls[0]![0]).toMatchObject({ citation_id: second.citation_id });
  });
});
