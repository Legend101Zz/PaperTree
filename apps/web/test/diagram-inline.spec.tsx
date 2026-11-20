/**
 * The figure inside an answer: layered (branches side by side), no A–G key letters or leader
 * lines, maths in labels typeset, and the picture's title and description list parts and arrows.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { InlineDiagram } from '@/features/diagram';

const line = (o: object): string => JSON.stringify(o);
const BODY = [
  line({ t: 'plate', title: 'Residual block' }),
  line({ t: 'part', label: 'Input x', kind: 'input', after: [] }),
  line({ t: 'part', label: 'Main path F(x)', kind: 'step', after: ['A'] }),
  line({ t: 'part', label: 'Shortcut path', kind: 'step', after: ['A'] }),
  line({ t: 'part', label: 'Scale by √d_k', kind: 'step', after: ['B', 'C'] }),
  line({ t: 'part', label: 'Output', kind: 'output', after: ['D'] }),
].join('\n');

afterEach(cleanup);

describe('InlineDiagram', () => {
  it('draws the branches side by side with no key letters, and typesets maths in a label', () => {
    const { container } = render(<InlineDiagram body={BODY} closed />);
    const figure = container.querySelector('[data-diagram-inline]') as HTMLElement;
    expect(figure.getAttribute('data-diagram-inline')).toBe('5');
    expect(figure.getAttribute('data-diagram-columns')).toBe('2');
    expect(container.querySelector('.pt-plate__letter')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
    const y = (letter: string): string | null =>
      container.querySelector(`[data-part="${letter}"] .pt-plate__box`)?.getAttribute('y') ?? null;
    expect(y('B')).toBe(y('C'));
    expect(y('B')).not.toBe(y('A'));
    // Maths: KaTeX, no raw underscore or dollar sign.
    expect(container.querySelector('[data-part="D"] .katex')).not.toBeNull();
    expect(container.querySelector('[data-part="D"] .katex-html')?.textContent).not.toMatch(/\$|_/);
    expect(container.querySelector('desc')?.textContent).not.toMatch(/\$|_/);
  });

  it('names the picture and lists its parts and arrows in order', () => {
    const { container } = render(<InlineDiagram body={BODY} closed />);
    const svg = container.querySelector('svg[role="img"]') as SVGElement;
    expect(svg.querySelector('title')?.textContent).toBe('Diagram: Residual block');
    const desc = svg.querySelector('desc')?.textContent ?? '';
    expect(desc).toMatch(/^Parts: Input x; Main path F\(x\); Shortcut path;/);
    expect(desc).toContain('Arrows: Input x to Main path F(x); Input x to Shortcut path;');
    expect(svg.getAttribute('aria-labelledby')).toContain(svg.querySelector('desc')?.id ?? '?');
  });

  it('holds a placeholder until the fence closes, and draws nothing for one box', () => {
    const open = render(<InlineDiagram body={BODY} closed={false} />);
    expect(open.container.querySelector('[data-diagram-pending]')).not.toBeNull();
    open.unmount();
    const one = render(
      <InlineDiagram body={line({ t: 'part', label: 'Alone', kind: 'step', after: [] })} closed />,
    );
    expect(one.container.firstChild).toBeNull();
  });
});
