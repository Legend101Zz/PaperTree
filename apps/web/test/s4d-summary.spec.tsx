/**
 * #204 (frame 04d) through the real panel: the cached summary of "Attention Is All You Need" (the
 * real stored one, `fixtures/attention-summary.json`) opens as an exchange: your call slip, the AI's
 * bullets with numbered markers and "not verified" tabs, the footer's facts from data, the readout
 * and the trace in the paper's words. `fetch` is the only stub.
 */
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import raw from './fixtures/attention-summary.json';
import { GOLDEN } from './fixtures/attention-thread';
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

describe('the summary shares the open thread’s passage numbers (review 2.3)', () => {
  it('golden thread open → Summarize: the Abstract is passage 1, the first new passage is 5', async () => {
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
    const labels = Array.from(
      document.querySelectorAll('[data-summary-bullet] [data-citation-id] button'),
      (m) => m.getAttribute('aria-label'),
    );
    // The thread numbered b1 (the Abstract) 1 and its passages up to 4; the summary's new ones follow.
    expect(labels.slice(0, 3)).toEqual(['Passage 1, p. 1', 'Passage 1, p. 1', 'Passage 5, p. 2']);
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
  it('your slip, the AI’s bullets, the paper’s words: three voices apart', async () => {
    const exchange = await openSummary();
    const slip = within(exchange).getByRole('group', { name: 'Your question' });
    expect(slip.querySelector('[data-voice="you"]')?.textContent).toBe(
      'Summary of the whole paper',
    );
    expect(slip.querySelector('time')?.textContent).toBe('cached · 15 Oct');
    expect(slip.querySelector('time')?.getAttribute('datetime')).toBe(raw.summary.created_at);
    const ai = exchange.querySelector('[data-voice="ai"]') as HTMLElement;
    expect(ai.querySelectorAll('[data-summary-bullet]')).toHaveLength(8);
    expect(ai.querySelector('.pt-ai-slip__source')?.textContent).toBe('M3 · from the paper');
    const paper = exchange.querySelectorAll('.pt-trace-list [data-voice="paper"]');
    expect(paper).toHaveLength(7);
    expect(ai.contains(paper[0] as Node)).toBe(false);
    expect(document.querySelector('.pt-explain__title')?.textContent).toBe('Summary cached');
  });

  it('numbered markers with "not verified" where the check failed, and the flash says which', async () => {
    const exchange = await openSummary();
    const markers = Array.from(
      exchange.querySelectorAll('[data-summary-bullet] [data-citation-id] button'),
    );
    expect(markers).toHaveLength(11);
    expect(markers.map((m) => m.getAttribute('aria-label'))).toEqual([
      'Passage 1, p. 1',
      'Passage 1, p. 1',
      'Passage 2, p. 2',
      'Passage 3, p. 3, not verified',
      'Passage 4, p. 7, not verified',
      'Passage 1, p. 1',
      'Passage 5, p. 8',
      'Passage 1, p. 1, not verified',
      'Passage 6, p. 10, not verified',
      'Passage 7, p. 10',
      'Passage 6, p. 10',
    ]);
    const unsupported = Array.from(
      exchange.querySelectorAll('[data-summary-bullet][data-supported="false"]'),
    );
    expect(unsupported).toHaveLength(3);
    for (const bullet of unsupported) {
      expect(bullet.querySelector('.pt-nv-caption')?.textContent).toBe('not verified');
    }
    fireEvent.click(markers[3] as Element);
    expect(focusAnchor.mock.calls[0]?.[1]).toEqual({
      flash: true,
      from: { n: 3, page: 3, para: null, notVerified: true },
    });
    const text = exchange.textContent ?? '';
    expect(text).not.toMatch(/\[b\d+\]|\bblk_|\bmsg_/);
    expect(text.replace(/not verified/g, '')).not.toMatch(/verified|fact-checked|accurate/i);
  });

  it('the footer’s facts, the readout and the trace come from data; no dead buttons', async () => {
    const exchange = await openSummary();
    expect(exchange.querySelector('[data-summary-footer]')?.textContent).toBe(
      'Cached 15 Oct · no new tokens used · made with M3',
    );
    expect(exchange.querySelector('[data-summary-readout]')?.textContent).toBe(
      '¶Stands on 7 passages on 6 pages · 8 bullets · 11 citations · 3 bullets not verified',
    );
    const rows = Array.from(
      exchange.querySelectorAll('.pt-trace-row__where'),
      (n) => n.textContent,
    );
    expect(rows[0]).toBe('Abstract · cited 4× · 1 not verified');
    expect(rows[3]).toBe('5.1 Training Data and Batching · cited once');
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
