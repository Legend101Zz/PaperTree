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

import { AiSlip, CallSlip, TraceList, type TraceRowData } from '../src/index.js';

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
        aside={<span>margin</span>}
        footer={<span>estimate: 1.2k tokens</span>}
        uncited={<p>My own reading.</p>}
      >
        <p>Cited claim.</p>
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
    fireEvent.click(screen.getByRole('button', { name: 'Show passage 2 in paper' }));
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
    expect(lit[0]?.getAttribute('aria-current')).toBe('true');
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
});

// ─── the stylesheet: the slips sit on their own stock ─────────────────────────────────────────
const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

describe('styles.css — the slips', () => {
  it('puts the answer on AI-slip stock and the ask on call-slip stock', () => {
    expect(CSS).toMatch(/\n\.pt-ai-slip\s*\{[^}]*background:\s*var\(--pt-ai-slip\)/);
    expect(CSS).toMatch(/\n\.pt-call-slip\s*\{[^}]*background-color:\s*var\(--pt-call-slip\)/);
  });
});
