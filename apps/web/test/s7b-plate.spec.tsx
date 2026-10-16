/**
 * s7b-plate — the engraved plate in the explain panel (#217), driven by RECORDED SSE frames of the
 * faux diagram runs (`fixtures/diagram-plate.ts`) through the real controller, panel and SSE
 * parser: the plate builds part by part with its slots fixed, Stop freezes it, a tap flashes the
 * cited passage, an inferred or not-verified part says so in words, and a refused plate is said.
 */
import axe from 'axe-core';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { plateFrames } from './fixtures/diagram-plate';
import { stubDesktop } from './s6-harness';
import { installFetch, jsonResponse, sseResponse, type SseHandle } from './s6-support';
import {
  box,
  focusAnchor,
  keyRows,
  mount,
  PAPER,
  routes,
  RUN,
  stoppedAtThree,
  THREAD,
} from './s7b-support';

beforeEach(() => {
  stubDesktop();
  window.localStorage.setItem('papertree.session', 'test-token');
  focusAnchor.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the plate builds as the parts stream in', () => {
  it('thinks on an empty plate, places each part where it stays, then Stop freezes it', async () => {
    const frames = plateFrames('diagram-plate');
    let handle: SseHandle | undefined;
    const { calls } = routes(
      (signal) =>
        sseResponse(frames.slice(0, 3), { hold: true, signal, onHandle: (h) => (handle = h) }),
      stoppedAtThree(),
    );
    mount();

    // 07a: the ask, the empty plate, Thinking, Stop; the composer is gone (a plate is redrawn).
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    expect(await within(panel).findByText('Explain with a diagram.')).toBeTruthy();
    expect(within(panel).getByRole('status').textContent).toContain('Thinking');
    expect(panel.querySelector('[data-plate-empty]')?.textContent).toContain('Plate 1');
    expect(within(panel).queryByLabelText('Ask a question about this paper')).toBeNull();
    expect(calls[0]?.body).toMatchObject({ kind: 'diagram', anchor: { id: 'anchor-sel' } });

    // 07b: three parts, one at a time; A never moves, the next letter is "arriving…".
    const parts = frames.filter((f) => f.startsWith('event: part'));
    await act(async () => handle?.push(frames[3] as string)); // plate
    await act(async () => handle?.push(parts[0] as string));
    await waitFor(() => expect(keyRows()).toHaveLength(1));
    const aY = box('A');
    for (const [i, frame] of parts.slice(1, 3).entries()) {
      await act(async () => handle?.push(frame));
      await waitFor(() => expect(keyRows()).toHaveLength(i + 2));
      expect(box('A')).toBe(aY);
    }
    expect(within(panel).getByRole('status').textContent).toContain('Drawing the diagram');
    expect(document.querySelector('[data-plate-readout]')?.textContent).toBe(
      '3 parts so far · 3 cited',
    );
    expect(document.querySelector('[data-ghost="D"]')).not.toBeNull();

    // Stop: the run is cancelled, the three parts stay, nothing is arriving any more.
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(document.querySelector('[data-stopped]')).not.toBeNull());
    expect(calls.some((c) => c.path === `/runs/${RUN}/cancel`)).toBe(true);
    expect(keyRows().map((r) => r.dataset.letter)).toEqual(['A', 'B', 'C']);
    expect(document.querySelector('[data-ghost]')).toBeNull();
    expect(document.querySelector('[data-plate-readout]')?.textContent).toBe(
      '3 parts · 3 cited · drawn by AI from p. 4',
    );
    expect(within(panel).queryByRole('button', { name: 'Stop' })).toBeNull();
    // The stored copy read after the Stop replaces the live one without moving a part.
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === `/papers/${PAPER}/threads/${THREAD}`).length,
      ).toBeGreaterThan(0),
    );
    await new Promise((settle) => setTimeout(settle, 50));
    expect(keyRows().map((r) => r.dataset.letter)).toEqual(['A', 'B', 'C']);
    expect(box('A')).toBe(aY);
    expect(document.querySelector('[data-stopped]')).not.toBeNull();
  });
});

describe('a finished plate', () => {
  async function finished(): Promise<HTMLElement> {
    routes((signal) => sseResponse(plateFrames('diagram-plate'), { signal }));
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await waitFor(() =>
      expect(panel.querySelector('[data-plate-phase="complete"]')).not.toBeNull(),
    );
    return panel;
  }

  it('reads out its counts from the data, with the usage as an estimate', async () => {
    const panel = await finished();
    expect(
      within(panel).getByRole('group', { name: /^Plate 1, Scaled dot-product attention/ }),
    ).toBeTruthy();
    expect(panel.querySelector('[data-plate-readout]')?.textContent).toBe(
      '6 parts · 5 cited · drawn by AI from p. 4',
    );
    expect(panel.querySelector('[data-usage-line]')?.textContent).toMatch(/\(estimate\)$/);
    expect(keyRows().map((r) => r.dataset.verdict)).toEqual([
      'cited',
      'cited',
      'cited',
      'cited',
      'cited',
      'inferred',
    ]);
  });

  it('flashes a part’s passage from its key row and from the drawing', async () => {
    const panel = await finished();
    fireEvent.click(
      within(panel).getByRole('button', { name: /^Part C: Scale ÷ √dk\s*\. Passage 1, p\. 4 ¶1/ }),
    );
    expect(focusAnchor).toHaveBeenCalledTimes(1);
    const [anchor, opts] = focusAnchor.mock.calls[0] as [{ id: string }, unknown];
    expect(anchor.id).toMatch(/^cit_/);
    expect(opts).toEqual({
      flash: true,
      from: {
        n: 1,
        page: 4,
        para: 1,
        notVerified: false,
        part: { letter: 'C', label: 'Scale ÷ √dk' },
      },
    });
    // A tap on box E in the picture: E stands on ¶2, passage 2.
    fireEvent.click(panel.querySelector('[data-part="E"]') as Element);
    expect(focusAnchor.mock.calls[1]?.[1]).toMatchObject({ from: { n: 2, para: 2 } });
    expect(panel.querySelector('[data-part="E"]')?.getAttribute('data-lit')).toBe('true');
  });

  it('says an inferred part in words, dashed, and flashes nothing for it', async () => {
    const panel = await finished();
    const row = panel.querySelector('[data-letter="F"]') as HTMLElement;
    expect(row.textContent).toContain('Inferred, no passage');
    expect(row.querySelector('[data-voice="paper"]')).toBeNull();
    expect(panel.querySelector('[data-part="F"]')?.getAttribute('data-verdict')).toBe('inferred');
    expect(panel.querySelector('[data-part="F"] .pt-plate__caption')?.textContent).toBe(
      'inferred, no passage',
    );
    fireEvent.click(within(row).getByRole('button'));
    expect(focusAnchor).not.toHaveBeenCalled();
    expect(panel.querySelector('[data-plate-said]')?.textContent).toBe(
      'Part F is inferred: no passage says it, so there is nothing to show in the paper.',
    );
  });

  it('keeps the voices apart and has no axe violations (layout rules aside)', async () => {
    const panel = await finished();
    // The quotes the paper holds are the paper's; the labels and the picture are the AI's.
    expect(panel.querySelectorAll('.pt-plate-key [data-voice="paper"]')).toHaveLength(5);
    expect(panel.querySelector('.pt-plate__figure')?.getAttribute('data-voice')).toBe('ai');
    expect(panel.querySelector('svg.pt-plate__drawing')?.getAttribute('aria-hidden')).toBe('true');
    const results = await axe.run(panel, {
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

describe('what a settled plate offers', () => {
  it('Send to board puts a diagram card holding the plate on the board, once', async () => {
    const { calls } = routes((signal) => sseResponse(plateFrames('diagram-plate'), { signal }));
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Send to board' }));
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'On your board' })).toBeTruthy(),
    );
    const created = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/board/nodes'));
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toMatchObject({
      kind: 'diagram',
      title: 'Scaled dot-product attention',
      source_diagram_id: 'msg_01M536X6ADDW22T669B1QXQM1E',
    });
    expect(
      within(panel).getByRole('button', { name: 'On your board' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('Redraw adds Plate 2 under its own ask, with redraw_of the first', async () => {
    const { calls } = routes((signal) => sseResponse(plateFrames('diagram-plate'), { signal }));
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await waitFor(() =>
      expect(panel.querySelector('[data-plate-phase="complete"]')).not.toBeNull(),
    );
    fireEvent.click(within(panel).getByRole('button', { name: 'Redraw' }));
    await waitFor(() =>
      expect(within(panel).getByRole('group', { name: /^Plate 2,/ })).toBeTruthy(),
    );
    const redraw = calls.find((c) => c.path.endsWith('/messages'));
    expect(redraw?.body).toEqual({
      question: 'Redraw the diagram.',
      redraw_of: 'msg_01M536X6ADDW22T669B1QXQM1E',
    });
    expect(within(panel).getByText('Redraw the diagram.')).toBeTruthy();
    // Plate 1 stays as it was, above.
    expect(within(panel).getByRole('group', { name: /^Plate 1,/ })).toBeTruthy();
  });

  it('offers the crafted figure as information only, with Not now and no job button', async () => {
    routes((signal) => sseResponse(plateFrames('diagram-plate'), { signal }));
    mount();
    const offer = await screen.findByRole('note', { name: 'A crafted figure, not available yet' });
    expect(offer.textContent).toContain('It is not available yet');
    expect(
      within(offer)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Not now']);
    fireEvent.click(within(offer).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('note', { name: 'A crafted figure, not available yet' })).toBeNull();
  });
});

describe('what the run left out, and a plate refused', () => {
  it('says a quote the paper does not hold is not verified, and lists what was dropped', async () => {
    routes((signal) => sseResponse(plateFrames('diagram-plate-bad'), { signal }));
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await waitFor(() =>
      expect(panel.querySelector('[data-plate-phase="complete"]')).not.toBeNull(),
    );
    const c = panel.querySelector('[data-letter="C"]') as HTMLElement;
    expect(c.dataset.verdict).toBe('not-verified');
    expect(c.textContent).toContain('not verified · not found in the paper');
    // The model's quote is not the paper's words, so it is not in the paper's voice.
    expect(c.querySelector('[data-voice="paper"]')).toBeNull();
    expect(panel.querySelector('[data-plate-readout]')?.textContent).toBe(
      '3 parts · 2 cited · 1 not verified · drawn by AI from p. 4',
    );
    expect(panel.querySelector('[data-plate-notes]')?.textContent).toContain(
      'Skipped a line of the plate that could not be read',
    );
  });

  it('a plate refused by the daily cap shows the cap card, never an empty plate', async () => {
    installFetch({
      [`POST /papers/${PAPER}/threads`]: () =>
        jsonResponse(429, {
          detail: 'Daily budget used.',
          code: 'budget_exhausted',
          retryable: false,
        }),
      'GET /usage': () =>
        jsonResponse(200, {
          runs: 9,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd_est: 0.97,
          budget_usd: 1,
          since: 'x',
          by_kind: {},
        }),
    });
    mount();
    // S4d's cap card: what was not sent, true here, and the figures.
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-error-code')).toBe('budget_exhausted');
    expect(alert.textContent).toContain('Nothing was sent to the AI.');
    await waitFor(() =>
      expect(alert.textContent).toContain('≈ $0.97 of $1.00 used in the last 24 hours (estimate).'),
    );
    expect(document.querySelector('.pt-plate')).toBeNull();
  });
});
