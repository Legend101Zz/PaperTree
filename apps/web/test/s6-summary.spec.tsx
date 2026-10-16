/**
 * s6-summary — "Summarize paper": the cached summary renders with NO new run; otherwise a run with
 * a progress label, then 5-8 bullets with working chips; a partial summary says so in words.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { focusAnchor, Harness, stubDesktop } from './s6-harness';
import {
  citation,
  done,
  errorBody,
  frame,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
  status,
  text,
  usage,
} from './s6-support';

beforeEach(() => {
  stubDesktop();
  focusAnchor.mockReset();
  window.localStorage.setItem('papertree.session', 'test-token');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SUMMARY = (statusValue: 'complete' | 'partial', bullets = 5) => ({
  generation: 1,
  model: 'MiniMax-M3',
  prompt_version: 'summary-v1',
  created_at: '2026-10-15T00:00:00Z',
  status: statusValue,
  bullets: Array.from({ length: bullets }, (_v, i) => ({
    text: `Point number ${String(i + 1)} [b${String(i + 1)}]`,
    citations: statusValue === 'partial' && i === 0 ? [] : [citation(`b${String(i + 1)}`)],
    supported: true,
  })),
});

async function open(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Summarize paper' }));
}

describe('the paper summary', () => {
  it('a cached summary renders from GET and starts NO run', async () => {
    const { calls } = installFetch({
      [`GET /papers/${PAPER}/summary`]: () =>
        jsonResponse(200, { state: 'ready', summary: SUMMARY('complete') }),
    });
    render(<Harness />);
    await open();
    await waitFor(() => expect(document.querySelectorAll('[data-summary-bullet]')).toHaveLength(5));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(document.querySelector('[data-summary-warning]')).toBeNull();
    // markers work (#204: numbered by passage, the flash says which marker)
    fireEvent.click(document.querySelectorAll('[data-citation-id] button')[2] as Element);
    expect(focusAnchor.mock.calls[0]?.[0]).toMatchObject({ id: 'anchor-b3' });
    expect(focusAnchor.mock.calls[0]?.[1]).toEqual({
      flash: true,
      from: { n: 3, page: 4, para: null, notVerified: false },
    });
  });

  it('with none cached: POSTs, shows the progress label, then the bullets from GET', async () => {
    let gets = 0;
    let handle: { push(c: string): void; close(): void } | undefined;
    installFetch({
      [`GET /papers/${PAPER}/summary`]: () => {
        gets += 1;
        return jsonResponse(
          200,
          gets === 1
            ? { state: 'none', summary: null }
            : { state: 'ready', summary: SUMMARY('complete', 6) },
        );
      },
      [`POST /papers/${PAPER}/summary`]: (_c, signal) =>
        sseResponse(
          [
            run({ thread_id: null }),
            status({ phase: 'tool', label: 'Reading p. 2 · 2. Unified Detection' }),
          ],
          {
            hold: true,
            signal,
            onHandle: (h) => (handle = h),
          },
        ),
    });
    render(<Harness />);
    await open();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'Reading p. 2 · 2. Unified Detection',
      ),
    );
    handle?.push(text('- raw streamed bullet [b1]\n'));
    handle?.push(frame('citations', { items: [] }) + usage() + done());
    handle?.close();
    await waitFor(() => expect(document.querySelectorAll('[data-summary-bullet]')).toHaveLength(6));
    expect(screen.queryByText(/raw streamed bullet/)).toBeNull();
    expect(document.querySelector('[data-usage-line]')?.textContent).toContain('(estimate)');
  });

  it('a partial summary says so in plain words and marks the bullet without a passage', async () => {
    installFetch({
      [`GET /papers/${PAPER}/summary`]: () =>
        jsonResponse(200, { state: 'partial', summary: SUMMARY('partial') }),
    });
    render(<Harness />);
    await open();
    await waitFor(() =>
      expect(document.querySelector('[data-summary-warning]')?.textContent).toBe(
        'Some points could not be linked to a passage.',
      ),
    );
    expect(screen.getByText("no citation · the AI's own reading")).toBeTruthy();
  });

  it('a failed run shows a designed error with Retry', async () => {
    installFetch({
      [`GET /papers/${PAPER}/summary`]: () => jsonResponse(200, { state: 'none', summary: null }),
      [`POST /papers/${PAPER}/summary`]: () => jsonResponse(429, errorBody('budget_exhausted')),
    });
    render(<Harness />);
    await open();
    expect((await screen.findByRole('alert')).textContent).toContain('Daily spend cap reached');
  });

  it('a cached PARTIAL summary can be summarised again: it POSTs {regenerate: true} and shows the new one', async () => {
    let gets = 0;
    const { calls } = installFetch({
      [`GET /papers/${PAPER}/summary`]: () => {
        gets += 1;
        return jsonResponse(
          200,
          gets <= 1
            ? { state: 'partial', summary: SUMMARY('partial') }
            : { state: 'ready', summary: SUMMARY('complete', 7) },
        );
      },
      [`POST /papers/${PAPER}/summary`]: (_c, signal) =>
        sseResponse([run({ thread_id: null }), usage(), done()], { signal }),
    });
    render(<Harness />);
    await open();
    const button = await screen.findByRole('button', { name: 'Summarise again' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    fireEvent.click(button);
    await waitFor(() => expect(document.querySelectorAll('[data-summary-bullet]')).toHaveLength(7));
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ regenerate: true });
    expect(document.querySelector('[data-summary-warning]')).toBeNull();
    // A new run spent tokens: its footer gives the usage, never "no new tokens used".
    expect(document.querySelector('[data-summary-footer]')?.textContent).toMatch(
      /made with M3 · [\d,]+ tokens · ≈ \$[\d.]+ \(estimate\)$/,
    );
  });

  it('a complete summary can be summarised again too (frame 04d)', async () => {
    installFetch({
      [`GET /papers/${PAPER}/summary`]: () =>
        jsonResponse(200, { state: 'ready', summary: SUMMARY('complete') }),
    });
    render(<Harness />);
    await open();
    await waitFor(() => expect(document.querySelectorAll('[data-summary-bullet]')).toHaveLength(5));
    expect(screen.getByRole('button', { name: 'Summarise again' })).toBeTruthy();
  });
});
