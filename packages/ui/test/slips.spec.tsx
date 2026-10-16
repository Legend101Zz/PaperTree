/**
 * ui/slips.spec — the call slip, the AI slip and the trace list (v0.2, #224).
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

import { AiParagraph, AiSlip, CallSlip, TraceList, type TraceRowData } from '../src/index.js';

afterEach(cleanup);

const ROWS: readonly TraceRowData[] = [
  {
    n: 1,
    page: 1,
    para: 1,
    where: 'Abstract',
    citedCount: 1,
    quote: 'We propose a new simple network architecture.',
    status: 'cited',
  },
  {
    n: 2,
    page: 2,
    para: 2,
    where: 'Introduction',
    citedCount: 2,
    quote: 'Recurrent models factor computation along symbol positions.',
    status: 'not-verified',
  },
];

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

describe('AiSlip', () => {
  it('shows the AI tab, model line, slots, and labels uncited text', () => {
    const { container } = render(
      <AiSlip
        model="M3.1 Flash"
        source="from the paper"
        footer={<span>estimate: 1.2k tokens</span>}
        uncited={<p>My own reading.</p>}
      >
        <AiParagraph aside={<span>margin</span>}>Cited claim.</AiParagraph>
      </AiSlip>,
    );
    const slip = container.querySelector('[data-voice="ai"]');
    expect(slip).not.toBeNull();
    expect(within(slip as HTMLElement).getByText('AI')).not.toBeNull();
    expect(screen.getByText(/M3\.1 Flash · from the paper/)).not.toBeNull();
    expect(screen.getByText('margin')).not.toBeNull();
    expect(screen.getByText('estimate: 1.2k tokens')).not.toBeNull();
    expect(
      screen.getByRole('heading', { name: /no citation · the AI's own reading/i }),
    ).not.toBeNull();
    // The reserved marker is AiText's alone (provenance.spec); the slip must not emit it.
    expect(container.textContent).not.toContain('⊙');
  });

  it('puts each paragraph and its margin cell on the same grid row', () => {
    const { container } = render(
      <AiSlip model="m" source="s">
        <AiParagraph aside={<span>marker 1</span>}>
          First paragraph, long enough to wrap.
        </AiParagraph>
        <AiParagraph>Second, with no citation.</AiParagraph>
        <AiParagraph aside={<span>marker 3</span>}>Third.</AiParagraph>
      </AiSlip>,
    );
    const grid = container.querySelector('.pt-ai-slip__grid') as HTMLElement;
    const rows = [...grid.children] as HTMLElement[];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // One row wrapper per paragraph, holding its text cell then its margin cell, so the two can
      // only ever land on the same grid row (the wrapper is `display: contents`).
      expect(row.className).toBe('pt-ai-slip__row');
      expect([...row.children].map((c) => c.className)).toEqual([
        'pt-ai-slip__text',
        'pt-ai-slip__aside',
      ]);
    }
    // A paragraph without an aside still has an (empty) cell, so the next one keeps its column.
    expect(rows[1]?.querySelector('.pt-ai-slip__aside')?.textContent).toBe('');
    expect(rows[2]?.querySelector('.pt-ai-slip__aside')?.textContent).toBe('marker 3');
  });

  it('keeps a plain children path and takes its words as props', () => {
    render(
      <AiSlip
        model="m"
        source="s"
        tabLabel="KI"
        uncitedHeading="ohne Beleg"
        headingLevel={3}
        uncited={<p>x</p>}
      >
        <p>Plain content.</p>
      </AiSlip>,
    );
    expect(screen.getByText('Plain content.')).not.toBeNull();
    expect(screen.getByText('KI')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'ohne Beleg' })).not.toBeNull();
  });

  it('omits the uncited block when there is nothing uncited', () => {
    render(
      <AiSlip model="m" source="s">
        <p>x</p>
      </AiSlip>,
    );
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('TraceList', () => {
  it('is an ordered list whose Show in paper buttons report the row number', () => {
    const onShow = vi.fn();
    const { container } = render(<TraceList rows={ROWS} onShowInPaper={onShow} />);
    expect(container.querySelector('ol')).not.toBeNull();
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    const show = screen.getByRole('button', { name: 'Show in paper, passage 2' });
    // The shared secondary Button, not the v0.1 `.pt-btn` class.
    expect(show.className).toContain('pt-button--secondary');
    expect(show.className).not.toContain('pt-btn');
    fireEvent.click(show);
    expect(onShow).toHaveBeenCalledWith(2);
    expect(screen.getByText('Introduction · cited 2×')).not.toBeNull();
    expect(screen.getByText('Abstract · cited once')).not.toBeNull();
  });

  it('lights the row for the lit number and tells the caller on marker hover', () => {
    const onLight = vi.fn();
    const { container } = render(
      <TraceList rows={ROWS} lit={2} onLight={onLight} onShowInPaper={() => undefined} />,
    );
    const lit = container.querySelectorAll('li[data-lit="true"]');
    expect(lit).toHaveLength(1);
    expect(lit[0]?.getAttribute('data-n')).toBe('2');
    expect(lit[0]?.getAttribute('aria-current')).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Passage 1, p. 1 ¶1' }));
    expect(onLight).toHaveBeenLastCalledWith(1);
  });

  it('on touch is one button per row', () => {
    const onShow = vi.fn();
    const { container } = render(<TraceList rows={ROWS} layout="touch" onShowInPaper={onShow} />);
    expect(container.querySelectorAll('li > button')).toHaveLength(2);
    fireEvent.click(container.querySelectorAll('li > button')[0] as HTMLElement);
    expect(onShow).toHaveBeenCalledWith(1);
  });

  it('on touch the row button is named by its content: number, section, count and the quote', () => {
    render(<TraceList rows={ROWS} layout="touch" onShowInPaper={() => undefined} />);
    const name = (n: number): string =>
      screen.getAllByRole('button')[n]?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(screen.getAllByRole('button')[1]?.hasAttribute('aria-label')).toBe(false);
    expect(name(1)).toContain('Introduction · cited 2×');
    expect(name(1)).toContain('Recurrent models factor');
    expect(name(1)).toContain('not verified');
    expect(name(0)).toContain('Show in paper');
  });

  it('takes its list name and button words as props', () => {
    render(
      <TraceList
        rows={ROWS}
        label="Belege"
        showLabel="Im Papier zeigen"
        onShowInPaper={() => undefined}
      />,
    );
    expect(screen.getByRole('list', { name: 'Belege' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Im Papier zeigen, passage 1' })).not.toBeNull();
  });
});

// ─── the stylesheet: the slips sit on their own stock ─────────────────────────────────────────
const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

describe('styles.css — the slips', () => {
  it('hangs the opening quotation mark inside the clipping box, not outside it', () => {
    for (const selector of ['.pt-trace-row__quote', '.pt-call-slip__quote-text']) {
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

  it('puts the answer on AI-slip stock and the ask on call-slip stock', () => {
    expect(CSS).toMatch(/\n\.pt-ai-slip\s*\{[^}]*background:\s*var\(--pt-ai-slip\)/);
    expect(CSS).toMatch(/\n\.pt-call-slip\s*\{[^}]*background-color:\s*var\(--pt-call-slip\)/);
  });
});
