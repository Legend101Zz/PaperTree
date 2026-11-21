import { describe, expect, it } from 'vitest';

import { parseDiagramFence } from './fence';

const line = (o: Record<string, unknown>): string => JSON.stringify(o);

const GOOD = [
  line({ t: 'plate', title: 'Residual block' }),
  line({ t: 'part', label: 'Input x', kind: 'input', after: [], cite: null }),
  line({
    t: 'part',
    label: 'Two layers',
    text: 'compute F(x)',
    kind: 'step',
    after: ['A'],
    cite: null,
  }),
  line({
    t: 'part',
    label: 'Add',
    kind: 'output',
    after: ['B', 'A'],
    edge: ['F(x)', 'shortcut'],
    cite: { quote: 'identity shortcut connections', page: 2 },
  }),
  line({ t: 'link', from: 'C', to: 'A', label: 'again' }),
  line({ t: 'end' }),
].join('\n');

describe('parseDiagramFence', () => {
  it('reads the same NDJSON lines the diagram run emits into letters, edges and links', () => {
    const figure = parseDiagramFence(GOOD);
    expect(figure?.title).toBe('Residual block');
    expect(figure?.parts.map((p) => [p.letter, p.label, p.kind, p.after])).toEqual([
      ['A', 'Input x', 'input', []],
      ['B', 'Two layers', 'step', ['A']],
      ['C', 'Add', 'output', ['B', 'A']],
    ]);
    expect(figure?.parts[2]?.edge).toEqual(['F(x)', 'shortcut']);
    expect(figure?.links).toEqual([{ source: 'C', target: 'A', label: 'again' }]);
    // The figure inside an answer carries no passage of its own.
    expect(figure?.parts.every((p) => p.cite === null)).toBe(true);
  });

  it('costs a bad line only that line', () => {
    const figure = parseDiagramFence(
      [
        'not json',
        '{"t":"part","label":',
        line({ t: 'part', label: 'Only', after: [], cite: null }),
        line({ t: 'part', label: 'Next', after: ['A'], cite: null }),
      ].join('\n'),
    );
    expect(figure?.parts.map((p) => p.letter)).toEqual(['A', 'B']);
  });

  it('drops an arrow from a part that does not come before, so the graph stays acyclic', () => {
    const figure = parseDiagramFence(
      [
        line({ t: 'part', label: 'A part', after: ['B'], cite: null }),
        line({ t: 'part', label: 'B part', after: ['A', 'B'], cite: null }),
        line({ t: 'link', from: 'A', to: 'A' }),
        line({ t: 'link', from: 'A', to: 'L' }),
      ].join('\n'),
    );
    expect(figure?.parts.map((p) => p.after)).toEqual([[], ['A']]);
    expect(figure?.links).toEqual([]);
  });

  it("keeps the model's own count when a part line is skipped (its letters still mean its lines)", () => {
    const figure = parseDiagramFence(
      [
        line({ t: 'part', label: 'First', after: [], cite: null }),
        line({ t: 'part', label: '', after: [], cite: null }),
        line({ t: 'part', label: 'Third', after: ['A'], cite: null }),
        line({ t: 'part', label: 'Fourth', after: ['B'], cite: null }),
      ].join('\n'),
    );
    // The model's B was skipped: the arrow from it is dropped, never moved to another part.
    expect(figure?.parts.map((p) => [p.letter, p.label, p.after])).toEqual([
      ['A', 'First', []],
      ['B', 'Third', ['A']],
      ['C', 'Fourth', []],
    ]);
  });

  it('stops at the end line and caps at twelve parts', () => {
    const parts = Array.from({ length: 14 }, (_, i) =>
      line({ t: 'part', label: `P${String(i)}`, after: [], cite: null }),
    );
    expect(parseDiagramFence(parts.join('\n'))?.parts).toHaveLength(12);
    const ended = [parts[0], parts[1], line({ t: 'end' }), parts[2]].join('\n');
    expect(parseDiagramFence(ended)?.parts).toHaveLength(2);
  });

  it('is null when no part could be read: nothing to draw', () => {
    expect(parseDiagramFence('')).toBeNull();
    expect(parseDiagramFence('{"t":"plate","title":"Only a title"}')).toBeNull();
    expect(parseDiagramFence('plain prose, not NDJSON')).toBeNull();
  });

  it('is null for a one-box figure: it explains nothing, so nothing is drawn', () => {
    const one = line({ t: 'part', label: 'input x', after: [], cite: null });
    expect(parseDiagramFence(one)).toBeNull();
    expect(
      parseDiagramFence([line({ t: 'plate', title: 'Residual block' }), one].join('\n')),
    ).toBeNull();
  });
});
