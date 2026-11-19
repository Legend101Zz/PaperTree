/**
 * ui/slips.spec — the call slip, the AI slip and the source line under its paragraphs (v0.2, #224, #340).
 *
 * Behaviour, not snapshots: what a reader or a screen reader meets in the DOM, plus the stylesheet
 * as source (happy-dom applies no CSS) for the claim that the three voices look different in both
 * colour schemes.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiParagraph, AiSlip, CallSlip, SourceLine, firstWords } from '../src/index.js';

afterEach(cleanup);

describe('CallSlip', () => {
  it('shows the stamp, quote, ask and time in the right voices', () => {
    const { container } = render(
      <CallSlip
        quote={{ text: 'Recurrent models typically factor', page: 2, para: 2 }}
        ask="Why does this preclude parallelization?"
        time="2:14 pm"
      />,
    );
    expect(container.querySelector('.pt-call-slip__stamp')?.textContent).toBe('M');
    expect(container.querySelector('[data-voice="paper"]')?.textContent).toContain('Recurrent');
    expect(container.querySelector('[data-voice="you"]')?.textContent).toBe(
      'Why does this preclude parallelization?',
    );
    expect(screen.getByText('p. 2 ¶2')).not.toBeNull();
    expect(screen.getByText('2:14 pm')).not.toBeNull();
  });

  it('is a labelled group (not a landmark), with a label and dateTime of its own', () => {
    const { container } = render(
      <CallSlip ask="Why?" time="9:00 am" label="Ihre Frage" dateTime="2026-10-16T09:00" />,
    );
    expect(screen.getByRole('group', { name: 'Ihre Frage' })).not.toBeNull();
    expect(container.querySelector('section')).toBeNull();
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-16T09:00');
  });

  it('takes another initial and omits the quote when none is given', () => {
    const { container } = render(<CallSlip initial="R" ask="Why?" time="9:00 am" />);
    expect(container.querySelector('.pt-call-slip__stamp')?.textContent).toBe('R');
    expect(container.querySelector('[data-voice="paper"]')).toBeNull();
  });
});

describe('CallSlip without a time (the board card)', () => {
  it('draws the stamp and the ask and no time', () => {
    const { container } = render(<CallSlip ask="Explain this passage." />);
    expect(screen.getByRole('group', { name: 'Your question' }).textContent).toContain(
      'Explain this passage.',
    );
    expect(container.querySelector('time')).toBeNull();
  });
});

describe('AiSlip', () => {
  it('shows the AI tab, the model alone beside it, and the slots', () => {
    const { container } = render(
      <AiSlip model="M3.1 Flash" footer={<span>estimate: 1.2k tokens</span>}>
        <AiParagraph source={<SourceLine sources={[]} />}>A claim.</AiParagraph>
      </AiSlip>,
    );
    const slip = container.querySelector('[data-voice="ai"]');
    expect(slip).not.toBeNull();
    expect(within(slip as HTMLElement).getByText('AI')).not.toBeNull();
    expect(container.querySelector('.pt-ai-slip__source')?.textContent).toBe('M3.1 Flash');
    expect(screen.getByText('estimate: 1.2k tokens')).not.toBeNull();
    // The reserved marker is AiText's alone (provenance.spec); the slip must not emit it.
    expect(container.textContent).not.toContain('⊙');
    // No verdict, no "own reading" block, no "from the paper" status.
    expect(container.textContent).not.toMatch(/own reading|verified|from the paper/i);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('without a model it draws no model line and names no model (the board card)', () => {
    const { container } = render(
      <AiSlip>
        <p>Cited claim.</p>
      </AiSlip>,
    );
    const slip = screen.getByRole('note', { name: "AI answer, not the paper's words" });
    expect(slip.getAttribute('data-voice')).toBe('ai');
    expect(container.querySelector('.pt-ai-slip__source')).toBeNull();
  });

  it('puts each paragraph and its one source line in one row of the grid', () => {
    const { container } = render(
      <AiSlip model="m">
        <AiParagraph source={<SourceLine sources={[{ page: 1, passage: 'x', onShow: vi.fn() }]} />}>
          First paragraph, long enough to wrap.
        </AiParagraph>
        <AiParagraph source={<SourceLine sources={[]} />}>
          Second, from general knowledge.
        </AiParagraph>
        <AiParagraph>Third, with no line at all.</AiParagraph>
      </AiSlip>,
    );
    const rows = [...(container.querySelector('.pt-ai-slip__grid') as HTMLElement).children];
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.className).toBe('pt-ai-slip__row');
    expect([...(rows[0] as Element).children].map((c) => c.className)).toEqual([
      'pt-ai-slip__text',
      'pt-source',
    ]);
    expect(rows[1]?.querySelector('.pt-source--general')?.textContent).toBe('General knowledge');
    expect(rows[2]?.querySelector('.pt-source')).toBeNull();
  });

  it('keeps a plain children path and takes its tab label as a prop', () => {
    render(
      <AiSlip model="m" tabLabel="KI">
        <p>Plain content.</p>
      </AiSlip>,
    );
    expect(screen.getByText('Plain content.')).not.toBeNull();
    expect(screen.getByText('KI')).not.toBeNull();
  });
});

describe('SourceLine', () => {
  const pages = (onShow = vi.fn()) => [
    { page: 1, passage: 'We propose a new simple network architecture.', onShow },
    {
      page: 4,
      passage: 'We call our particular attention “Scaled Dot-Product Attention”.',
      onShow,
    },
  ];

  it('says "From the paper:" and lists each page as a real button, in the order given', () => {
    const { container } = render(<SourceLine sources={pages()} />);
    const line = container.querySelector('.pt-source') as HTMLElement;
    expect(line.getAttribute('data-source')).toBe('paper');
    expect(line.textContent?.startsWith('From the paper: p. 1')).toBe(true);
    const buttons = within(line).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['p. 1', 'p. 4']);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Show p. 1 in the paper');
    expect(line.querySelectorAll('.pt-chip, .pt-marker, .pt-tab')).toHaveLength(0);
  });

  it('a click runs that page’s flash, once', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <SourceLine
        sources={[
          { page: 1, passage: 'a', onShow: first },
          { page: 4, passage: 'b', onShow: second },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show p. 4 in the paper' }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('hover or focus peeks the passage’s first words, and leaving, blur or Esc closes it', () => {
    render(<SourceLine sources={pages()} />);
    const page = screen.getByRole('button', { name: 'Show p. 4 in the paper' });
    const peek = page.parentElement?.querySelector('[role="tooltip"]') as HTMLElement;
    expect(peek.hidden).toBe(true);
    fireEvent.mouseEnter(page);
    expect(peek.hidden).toBe(false);
    expect(peek.textContent).toBe(
      'p. 4“We call our particular attention “Scaled Dot-Product Attention”.”',
    );
    expect(page.getAttribute('aria-describedby')).toBe(peek.id);
    fireEvent.mouseLeave(page);
    expect(peek.hidden).toBe(true);
    fireEvent.focus(page);
    expect(peek.hidden).toBe(false);
    fireEvent.blur(page);
    expect(peek.hidden).toBe(true);
    fireEvent.focus(page);
    fireEvent.keyDown(page, { key: 'Escape' });
    expect(peek.hidden).toBe(true);
  });

  it('a page with no passage words has no peek', () => {
    render(<SourceLine sources={[{ page: 2, passage: '', onShow: vi.fn() }]} />);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(screen.getByRole('button').hasAttribute('aria-describedby')).toBe(false);
  });

  it('says "General knowledge" in the same quiet line when there is no source: no button, no verdict', () => {
    const { container } = render(<SourceLine sources={[]} />);
    const line = container.querySelector('.pt-source') as HTMLElement;
    expect(line.textContent).toBe('General knowledge');
    expect(line.className).toContain('pt-source--general');
    expect(line.querySelector('button')).toBeNull();
  });

  it('says nothing while the answer is still arriving (general off)', () => {
    const { container } = render(<SourceLine sources={[]} general={false} />);
    expect(container.querySelector('.pt-source')).toBeNull();
  });

  it('on a phone each page answers taps over a larger area', () => {
    render(<SourceLine sources={pages()} touch />);
    expect(screen.getAllByRole('button')[0]?.className).toContain('pt-source__page--touch');
  });
});

describe('firstWords', () => {
  it('cuts at a word with an ellipsis, collapses whitespace and leaves short text alone', () => {
    expect(firstWords('Attention   is\nall you need', 100)).toBe('Attention is all you need');
    expect(firstWords('Attention is all you need', 13)).toBe('Attention is…');
    expect(firstWords('', 10)).toBe('');
    expect(firstWords('x'.repeat(200)).endsWith('…')).toBe(true);
  });
});

// ─── the stylesheet: the slips sit on their own stock ─────────────────────────────────────────
const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

describe('styles.css — the slips', () => {
  it('hangs the opening quotation mark inside the clipping box, not outside it', () => {
    for (const selector of ['.pt-call-slip__quote-text']) {
      const block =
        new RegExp(`\\n${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
      expect(block, selector).toMatch(/margin-inline-start:\s*-0\.42em/);
      expect(block, selector).toMatch(/padding-inline-start:\s*0\.42em/);
      expect(block, selector).toMatch(/text-indent:\s*-0\.42em/);
    }
  });

  it('keeps a raw rgb() out of the slip rules', () => {
    const slips = CSS.slice(CSS.indexOf("/* The person's ask: ruled ivory"));
    expect(slips).not.toMatch(/rgb\(/);
  });

  it('draws the source line at the prototype’s size and in muted ink (V3-32 option B)', () => {
    const block = /\n\.pt-source\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(block).toMatch(/font:\s*13\.5px \/ 19px/);
    expect(block).toMatch(/color:\s*var\(--pt-ink-muted\)/);
    expect(block).toMatch(/margin:\s*6px 0 0/);
    expect(/\n\.pt-source__page\s*\{([^}]*)\}/.exec(CSS)?.[1]).toMatch(
      /text-decoration:\s*underline dotted var\(--pt-tab\)/,
    );
    // General knowledge is the same line in italics: not a colour, not a warning.
    expect(/\n\.pt-source--general\s*\{([^}]*)\}/.exec(CSS)?.[1]).toMatch(/font-style:\s*italic/);
  });

  it('puts the answer on AI-slip stock and the ask on call-slip stock', () => {
    expect(CSS).toMatch(/\n\.pt-ai-slip\s*\{[^}]*background:\s*var\(--pt-ai-slip\)/);
    expect(CSS).toMatch(/\n\.pt-call-slip\s*\{[^}]*background-color:\s*var\(--pt-call-slip\)/);
  });
});
