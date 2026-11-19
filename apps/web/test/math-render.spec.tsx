/**
 * #338: maths is typeset with KaTeX in every place model text appears: an explain/Ask answer
 * paragraph, the summary's bullets, the board's explanation card, the notebook's prose, diagram
 * notes and the key. Raw `$…$` never shows; a broken string falls back to its TeX source; a
 * half-arrived tail is held back while streaming.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnswerText } from '@/features/explain/components/AnswerText';
import { clipAnswer } from '@/features/explain/model/phone';
import { foldedPreview } from '@/features/explain/model/states';
import { CanvasActionsProvider } from '@/features/board/components/BoardContext';
import { ExplanationCard } from '@/features/board/components/cards/ExplanationCard';
import { toFlowNode, type PtNode } from '@/features/board/model/flow';
import { cardRow } from '@/features/board/model/test-data';
import { AnswerProse } from '@/features/notebook/components/AnswerProse';
import { Maths, typeset } from '@/lib/math';
import { MathText } from '@/lib/MathText';

import raw from './fixtures/attention-summary.json';
import { focusAnchor, Harness, stubDesktop } from './s6-harness';
import { installFetch, jsonResponse, PAPER } from './s6-support';

afterEach(cleanup);

const FIXTURE =
  'The framework lets the layers fit the residual $F(x) := H(x) - x$, recasting the original ' +
  'mapping as $F(x) + x$. The block then outputs\n\n$$y = F(x) + x$$\n\nwith no extra parameters.';

/** The text a reader would copy: everything but KaTeX's MathML annotation (the TeX source). */
function shownText(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('annotation').forEach((a) => a.remove());
  return clone.textContent;
}

function expectTypeset(root: Element): void {
  expect(root.querySelector('.katex')).not.toBeNull();
  expect(root.querySelector('.katex-display')).not.toBeNull();
  expect(root.querySelectorAll('.katex-mathml math').length).toBeGreaterThanOrEqual(3);
  expect(shownText(root)).not.toContain('$');
}

const answerText = (text: string, streaming = false): ReactElement => (
  <AnswerText
    paragraph={{ index: 0, text, sources: [] }}
    streaming={streaming}
    general={false}
    onShow={() => undefined}
  />
);

describe('the shared helper', () => {
  it('typesets inline and display with MathML that keeps the TeX', () => {
    const { container } = render(
      <p>
        <Maths tex="y = F(x) + x" display={false} />
        <Maths tex="y = F(x) + x" display />
      </p>,
    );
    expect(container.querySelector('.pt-math > .katex')).not.toBeNull();
    expect(container.querySelector('.pt-math--display .katex-display')).not.toBeNull();
    expect(container.querySelector('annotation')?.textContent).toBe('y = F(x) + x');
  });

  it('falls back to the TeX source without delimiters, with the complaint as a title', () => {
    const { container } = render(<Maths tex={'\\frac{'} display={false} />);
    const bad = container.querySelector('[data-math-invalid]');
    expect(bad?.textContent).toBe('\\frac{');
    expect(bad?.getAttribute('title')).toMatch(/\S/);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).not.toContain('$');
  });

  it('never throws, and refuses what could reach out', () => {
    for (const tex of [
      '\\href{javascript:alert(1)}{x}',
      '\\includegraphics{https://x.test/a.png}',
    ]) {
      const out = typeset(tex, false);
      expect(out.ok ? out.html : '').not.toMatch(/<a |<img|href=|src=/);
    }
    expect(typeset('\\def\\a{\\a\\a}\\a', false).ok).toBe(false);
    expect(() => render(<Maths tex={'\\'} display />)).not.toThrow();
  });
});

describe('an explain or Ask answer paragraph', () => {
  it('typesets inline and display maths and shows no raw dollar', () => {
    const { container } = render(answerText(FIXTURE));
    expectTypeset(container);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(container.textContent).toContain('recasting the original mapping as');
  });

  it('typesets maths with a citation handle beside it', () => {
    const { container } = render(answerText('It fits $F(x)$ [b3], then $x$.'));
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.textContent).not.toContain('[b3]');
  });

  it('shows currency as text', () => {
    const { container } = render(answerText('It costs $5 and $10, never maths.'));
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toBe('It costs $5 and $10, never maths.');
  });

  it('falls back for a broken string, with no raw dollar', () => {
    const { container } = render(answerText('Then $\\frac{$ breaks.'));
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.querySelector('[data-math-invalid]')?.textContent).toBe('\\frac{');
    expect(container.textContent).toBe('Then \\frac{ breaks.');
  });

  it('keeps an unmatched dollar as a dollar', () => {
    const { container } = render(answerText('Pay $ now.'));
    expect(container.textContent).toBe('Pay $ now.');
  });

  it('holds a half-arrived tail back while streaming, then typesets it when it closes', () => {
    const { container, rerender } = render(answerText('The residual $F(x) :=', true));
    expect(container.textContent).toBe('The residual');
    rerender(answerText('The residual $F(x) := H(x) - x$ and $$y = F(', true));
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(shownText(container)).not.toContain('$');
    expect(shownText(container)).not.toContain('y =');
    rerender(answerText('The residual $F(x) := H(x) - x$ and $$y = F(x) + x$$', true));
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('falls back to plain text without the dollar when the stream ends mid-maths', () => {
    const { container } = render(answerText('The residual $\\frac{a', false));
    expect(container.textContent).toBe('The residual \\frac{a');
  });

  it('keeps the TeX in the copied text through KaTeX’s MathML', () => {
    const { container } = render(answerText('Take $F(x) := H(x) - x$ here.'));
    expect(container.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(
      'F(x) := H(x) - x',
    );
  });
});

describe('the notebook prose', () => {
  it('typesets inline and display maths', () => {
    const { container } = render(
      <p>
        <AnswerProse text={FIXTURE} />
      </p>,
    );
    expectTypeset(container);
  });
});

describe('the board explanation card', () => {
  it('typesets the card body', () => {
    const node = toFlowNode(cardRow('explanation', { body: FIXTURE }), 'ppr_1');
    const props = { ...node, selected: false, dragging: false } as unknown as NodeProps<PtNode>;
    const { container } = render(
      <ReactFlowProvider>
        <CanvasActionsProvider
          value={{
            editingId: null,
            setEditingId: vi.fn(),
            commitBody: vi.fn(),
            commitTitle: vi.fn(),
            commitSize: vi.fn(),
            openCitation: vi.fn(),
          }}
        >
          <ExplanationCard {...props} />
        </CanvasActionsProvider>
      </ReactFlowProvider>,
    );
    expectTypeset(container);
  });
});

describe('the summary bullets', () => {
  beforeEach(() => {
    stubDesktop();
    focusAnchor.mockReset();
    window.localStorage.setItem('papertree.session', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('typesets maths in a bullet', async () => {
    const summary = structuredClone(raw.summary);
    summary.bullets[0]!.text =
      'The block fits $F(x) := H(x) - x$ and outputs $F(x) + x$, so $$y = F(x) + x$$ holds [b1].';
    installFetch({
      [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, []),
      [`GET /papers/${PAPER}/summary`]: () => jsonResponse(200, { state: raw.state, summary }),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Summarize paper' }));
    await waitFor(() => expect(document.querySelectorAll('[data-summary-bullet]')).toHaveLength(8));
    const bullet = document.querySelector('[data-summary-bullet]') as HTMLElement;
    expect(bullet.querySelector('.katex')).not.toBeNull();
    expect(bullet.querySelector('.katex-display')).not.toBeNull();
    expect(shownText(bullet)).not.toContain('$');
  });
});

describe('diagram notes and key labels', () => {
  it('typesets maths in a plain string and keeps a price as text', () => {
    const { container } = render(
      <p>
        <MathText text="dropped $F(x)$ and the $5 fee" />
      </p>,
    );
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(shownText(container)).toBe('dropped F(x)F(x) and the $5 fee');
  });
});

describe('plain-text surfaces never show a dollar', () => {
  it('the folded preview reads maths as words', () => {
    expect(foldedPreview([{ text: FIXTURE }])).toBe(
      'The framework lets the layers fit the residual F(x) := H(x) - x, recasting the original ' +
        'mapping as F(x) + x. The block then outputs y = F(x) + x with no extra parameters.',
    );
  });

  it('the preview of a display-only paragraph is its maths as words', () => {
    expect(foldedPreview([{ text: '$$y = F(x) + x$$' }])).toBe('y = F(x) + x');
  });
});

describe('the phone fold', () => {
  const para = (index: number, text: string) => ({ index, text, sources: [] });

  it('keeps the first paragraph whole when it is complete', () => {
    const model = { paragraphs: [para(0, 'one $x$'), para(1, 'two')] };
    expect(clipAnswer(model, false)).toMatchObject({ paragraphs: [{ index: 0 }], clipped: true });
  });

  it('does not cut inside a display equation a blank line split', () => {
    const model = { paragraphs: [para(0, 'so $$y ='), para(1, 'F(x) + x$$'), para(2, 'after')] };
    const clip = clipAnswer(model, false);
    expect(clip.paragraphs.map((p) => p.index)).toEqual([0, 1]);
    expect(clip.clipped).toBe(true);
  });

  it('is not clipped when the equation is the end of the answer', () => {
    const model = { paragraphs: [para(0, 'so $$y ='), para(1, 'F(x) + x$$')] };
    expect(clipAnswer(model, false).clipped).toBe(false);
  });
});
