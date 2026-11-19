/**
 * selection-paint: the live selection and the saved highlights are drawn as ONE band per line
 * (#346), and the ends of a settled selection are whole words (P4 step 5).
 *
 * The overlay is real; the numbers are a body line with an italic run and inline maths between two
 * plain runs, which is what left white gaps and steps when each text item was painted on its own.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HighlightOverlay, type PaintItem } from '@/components/reader/HighlightOverlay';
import { snapEnd, snapSelectionToWords, snapStart } from '@/components/reader/wordSnap';

import type { BBox } from '@papertree/document-ir';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

/** Two body lines; the first holds an italic run and a taller maths run between plain text. */
const QUADS: BBox[] = [
  [72, 100, 150, 110],
  [153, 100, 168, 110], // italic
  [171, 98.5, 193, 111.5], // inline maths, taller
  [196, 100, 300, 110],
  [72, 112, 210, 122],
];

const paint = (quads: BBox[]): PaintItem => ({
  key: 'a1',
  highlightId: 'hl_1',
  color: 'amber',
  pageIndex: 0,
  polygons: [],
  quads,
  approximate: false,
  label: 'The formulation of F(x) + x',
});

function overlay(items: PaintItem[], selection: BBox[] | null = null) {
  return render(
    <HighlightOverlay
      pageIndex={0}
      pageWidth={612}
      pageHeight={792}
      zoom={1}
      items={items}
      selection={selection}
    />,
  );
}

describe('a saved highlight paints one band per line from its stored quads', () => {
  it('merges the spans of a line across the italic and maths gaps', () => {
    const { container } = overlay([paint(QUADS)]);
    const fills = container.querySelectorAll('polygon.pt-hl-fill');
    expect(fills).toHaveLength(2);
    // Line one spans the whole run, 72 to 300, with no break at the maths.
    expect(fills[0]?.getAttribute('points')).toMatch(/^72,98\.5 300,98\.5 300,\d+(\.\d+)? 72,/);
    expect(container.querySelectorAll('line.pt-hl-line')).toHaveLength(2);
  });

  it('does not reach the next line: a taller maths run is clamped to the line below', () => {
    const { container } = overlay([paint(QUADS)]);
    const [first, second] = Array.from(container.querySelectorAll('polygon.pt-hl-fill')).map((p) =>
      (p.getAttribute('points') ?? '').split(' ').map((pt) => pt.split(',').map(Number)),
    );
    const bottomOfFirst = first?.[2]?.[1] ?? 0;
    const topOfSecond = second?.[0]?.[1] ?? 0;
    expect(bottomOfFirst).toBeLessThanOrEqual(topOfSecond);
  });

  it('paints the stored quads and nothing else: no quad, no re-derived shape', () => {
    const polygon: BBox[] = [];
    const { container } = overlay([{ ...paint(polygon) }]);
    expect(container.querySelectorAll('polygon.pt-hl-fill')).toHaveLength(0);
  });
});

describe('the live selection paints as bands in the selection token', () => {
  it('draws two bands for two lines, and none without a selection', () => {
    const { container, rerender } = overlay([], QUADS);
    expect(container.querySelectorAll('polygon.pt-sel-fill')).toHaveLength(2);
    rerender(
      <HighlightOverlay
        pageIndex={0}
        pageWidth={612}
        pageHeight={792}
        zoom={1}
        items={[]}
        selection={null}
      />,
    );
    expect(container.querySelector('.pt-sel')).toBeNull();
  });

  it('is aria-hidden and never a pointer target', () => {
    const { container } = overlay([], QUADS);
    expect(container.querySelector('.pt-sel')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('svg')?.style.pointerEvents).toBe('none');
  });
});

describe('whole words at both ends', () => {
  it('snaps a start back to the word and an end on to the word', () => {
    const text = 'the identity mapping is optimal';
    expect(snapStart(text, 7)).toBe(4); // inside "identity"
    expect(snapEnd(text, 19)).toBe(20); // inside "mapping"
    expect(snapStart(text, 4)).toBe(4);
    expect(snapEnd(text, 12)).toBe(12);
  });

  it('trims spaces at the edges before snapping', () => {
    const text = 'the identity mapping';
    expect(snapStart(text, 3)).toBe(4);
    expect(snapEnd(text, 13)).toBe(12);
  });

  function layerWith(text: string): Text {
    const layer = document.createElement('div');
    layer.className = 'papertree-text-layer';
    const span = document.createElement('span');
    span.textContent = text;
    layer.append(span);
    document.body.append(layer);
    return span.firstChild as Text;
  }

  it('moves a DOM selection in a text layer to whole words, keeping its direction', () => {
    const node = layerWith('the identity mapping is optimal');
    const selection = window.getSelection() as Selection;
    selection.setBaseAndExtent(node, 7, node, 22); // "ntity mapping i"
    expect(snapSelectionToWords(selection)).toBe(true);
    expect(selection.toString()).toBe('identity mapping is');
    selection.setBaseAndExtent(node, 22, node, 7); // the same, dragged backwards
    expect(snapSelectionToWords(selection)).toBe(true);
    expect(selection.toString()).toBe('identity mapping is');
    // A backwards drag keeps its anchor at the END (jsdom's focusOffset getter is unreliable).
    expect(selection.anchorOffset).toBe(23);
  });

  it('leaves a selection outside the text layer alone', () => {
    const p = document.createElement('p');
    p.textContent = 'the identity mapping';
    document.body.append(p);
    const node = p.firstChild as Text;
    const selection = window.getSelection() as Selection;
    selection.setBaseAndExtent(node, 7, node, 15);
    expect(snapSelectionToWords(selection)).toBe(false);
    expect(selection.toString()).toBe('ntity ma');
  });
});
