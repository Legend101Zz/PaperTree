/**
 * #204 (frame 04d) through the real panel: the cached summary of "Attention Is All You Need" (the
 * real stored one, `fixtures/attention-summary.json`) opens as an exchange: your call slip, the AI's
 * bullets each with one quiet source line, and the footer's facts from data (#340, #341: no
 * readout, no passage list, no verdicts). `fetch` is the only stub.
 */
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import raw from './fixtures/attention-summary.json';
import { GOLDEN } from './fixtures/attention-thread';
import { sourceLines } from './answer-render';
import { focusAnchor, Harness, stubDesktop } from './s6-harness';
import { installFetch, jsonResponse, PAPER } from './s6-support';

beforeEach(() => {
  stubDesktop();
  focusAnchor.mockReset();
  window.localStorage.setItem('papertree.session', 'test-token');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openSummary(): Promise<HTMLElement> {
  const { calls } = installFetch({
    [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, []),
    [`GET /papers/${PAPER}/summary`]: () =>
      jsonResponse(200, { state: raw.state, summary: raw.summary }),
  });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Summarize paper' }));
  await waitFor(() => expect(document.querySelectorAll('[data-summary-bullet]')).toHaveLength(8));
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  return document.querySelector('[data-summary-exchange]') as HTMLElement;
}

describe('the summary is its own: an open thread changes nothing (#340)', () => {
  it('golden thread open → Summarize: each bullet lists its own pages', async () => {
    installFetch({
      [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, [GOLDEN.thread]),
      [`GET /papers/${PAPER}/threads/${GOLDEN.thread.thread_id}`]: () => jsonResponse(200, GOLDEN),
      [`GET /papers/${PAPER}/summary`]: () =>
        jsonResponse(200, { state: raw.state, summary: raw.summary }),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    await waitFor(() => expect(screen.getAllByText(/central proposal/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Summarize paper' }));
    await waitFor(() => expect(document.querySelectorAll('[data-summary-bullet]')).toHaveLength(8));
    const exchange = document.querySelector('[data-summary-exchange]') as HTMLElement;
    expect(sourceLines(exchange).slice(0, 3)).toEqual([
      'From the paper: p. 1',
      'From the paper: p. 1',
      'From the paper: p. 2',
    ]);
  });
});

describe('Retry after a failed "Summarise again" (review 2.2)', () => {
  it('asks for a new run again, never the cached copy', async () => {
    let posts = 0;
    const { calls } = installFetch({
      [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, []),
      [`GET /papers/${PAPER}/summary`]: () =>
        jsonResponse(200, { state: raw.state, summary: raw.summary }),
      [`POST /papers/${PAPER}/summary`]: () => {
        posts += 1;
        return jsonResponse(503, { detail: 'x', code: 'agent_unavailable', retryable: true });
      },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Summarize paper' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise again' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(posts).toBe(2));
    const bodies = calls.filter((c) => c.method === 'POST').map((c) => c.body);
    expect(bodies).toEqual([{ regenerate: true }, { regenerate: true }]);
    expect(document.querySelector('[data-summary-exchange]')).toBeNull();
  });
});

describe('the summary as an exchange (04d)', () => {
  it('your slip, the AI’s bullets: the voices apart, and no passage list', async () => {
    const exchange = await openSummary();
    const slip = within(exchange).getByRole('group', { name: 'Your question' });
    expect(slip.querySelector('[data-voice="you"]')?.textContent).toBe(
      'Summary of the whole paper',
    );
    expect(slip.querySelector('time')?.textContent).toBe('cached · 15 Oct');
    expect(slip.querySelector('time')?.getAttribute('datetime')).toBe(raw.summary.created_at);
    const ai = exchange.querySelector('[data-voice="ai"]') as HTMLElement;
    expect(ai.querySelectorAll('[data-summary-bullet]')).toHaveLength(8);
    expect(ai.querySelector('.pt-ai-slip__source')?.textContent).toBe('M3');
    expect(exchange.querySelector('.pt-trace-list')).toBeNull();
    expect(document.querySelector('.pt-explain__title')?.textContent).toBe('Summary cached');
  });

  it('one quiet source line per bullet, a page click flashes it, and nothing audits the AI', async () => {
    const exchange = await openSummary();
    expect(sourceLines(exchange)).toEqual([
      'From the paper: p. 1',
      'From the paper: p. 1',
      'From the paper: p. 2',
      'From the paper: p. 3',
      'From the paper: p. 7',
      'From the paper: p. 1 · p. 8',
      'From the paper: p. 1 · p. 10',
      'From the paper: p. 10',
    ]);
    for (const gone of [
      '.pt-chip',
      '.pt-marker',
      '.pt-tab',
      '.pt-nv-caption',
      '[data-supported]',
    ]) {
      expect(exchange.querySelector(gone), gone).toBeNull();
    }
    fireEvent.click(
      within(exchange).getAllByRole('button', { name: 'Show p. 7 in the paper' })[0]!,
    );
    expect(focusAnchor).toHaveBeenCalledTimes(1);
    expect(focusAnchor.mock.calls[0]?.[1]).toEqual({ flash: true });
    const text = exchange.textContent ?? '';
    expect(text).not.toMatch(/\[b\d+\]|\bblk_|\bmsg_/);
    expect(text).not.toMatch(
      /Stands on|verified|grounded|fact-checked|accurate|own reading|could not be linked/i,
    );
  });

  it('the footer’s facts come from data; no dead buttons', async () => {
    const exchange = await openSummary();
    expect(exchange.querySelector('[data-summary-footer]')?.textContent).toBe(
      'Cached 15 Oct · no new tokens used · made with M3',
    );
    expect(exchange.querySelector('.pt-coverage, [data-summary-readout]')).toBeNull();
    expect(within(exchange).getByRole('button', { name: 'Summarise again' })).toBeTruthy();
    // The APIs take a message, not a summary (#258): no button that cannot work.
    expect(within(exchange).queryByRole('button', { name: /Dive in|Send to board/ })).toBeNull();
    const results = await axe.run(document.body, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: {
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
        region: { enabled: false },
      },
    });
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);
  });
});
