/**
 * s7b-plate-review — the plate's review fixes (#217): a Stop before the first part is the reader's
 * and says so on every path (Stop, switching threads, closing the panel), never a server failure or
 * "kept" with nothing kept; a part not verified near a passage is said and drawn as such; the key
 * says everything the drawing does; a keyboard Stop hands focus to Retry and is announced.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { layoutPlate } from '@/features/diagram';
import { structureOf } from '@/features/diagram/components/PlateKey';

import { plateFrames } from './fixtures/diagram-plate';
import { stubDesktop } from './s6-harness';
import { jsonResponse, sseResponse } from './s6-support';
import {
  focusAnchor,
  keyRows,
  mount,
  PAPER,
  routes,
  storedWith,
  THREAD,
  withPart,
} from './s7b-support';

import type { DiagramPart } from '@/lib/api/types';

beforeEach(() => {
  stubDesktop();
  window.localStorage.setItem('papertree.session', 'test-token');
  focusAnchor.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const THINKING = plateFrames('diagram-plate').slice(0, 2); // run, status: nothing drawn yet
const SERVER_FAILURE = /went wrong on the server|What arrived is kept|parts that arrived are kept/;
/** What the server keeps for a plate stopped before its first part. */
const stoppedEmpty = () => storedWith(() => [], 'aborted');

const hatched = (part: Element): boolean =>
  Array.from(part.querySelectorAll('rect')).some((r) => r.getAttribute('fill')?.startsWith('url('));

function panelText(): string {
  return screen.getByRole('complementary', { name: 'Explain' }).textContent ?? '';
}

describe('Stop before the first part (review B2)', () => {
  it('Stop while "Thinking…": "Stopped before any part arrived.", then and after the stored read', async () => {
    const { calls } = routes(
      (signal) => sseResponse(THINKING, { hold: true, signal }),
      stoppedEmpty(),
    );
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await within(panel).findByText(/Thinking/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop' }));
    const note = await within(panel).findByText('Stopped before any part arrived.');
    expect(note.getAttribute('role')).toBe('status');
    expect(panelText()).not.toMatch(SERVER_FAILURE);
    expect(panel.querySelector('.pt-plate, .pt-plate-answer')).toBeNull(); // no plate, no model line
    // The stored copy lands (status `aborted`, no part): the same honest note.
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === `/papers/${PAPER}/threads/${THREAD}`).length,
      ).toBeGreaterThan(0),
    );
    await act(async () => new Promise((settle) => setTimeout(settle, 50)));
    expect(within(panel).getByText('Stopped before any part arrived.')).toBeTruthy();
    expect(panelText()).not.toMatch(SERVER_FAILURE);
  });

  it('switching threads mid-draw, then back: the stored plate says it stopped before any part', async () => {
    routes((signal) => sseResponse(THINKING, { hold: true, signal }), stoppedEmpty());
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await within(panel).findByText(/Thinking/);
    fireEvent.click(screen.getByRole('button', { name: 'switch away' }));
    fireEvent.click(screen.getByRole('button', { name: 'switch back' }));
    expect(await within(panel).findByText('Stopped before any part arrived.')).toBeTruthy();
    expect(panelText()).not.toMatch(SERVER_FAILURE);
  });

  it('closing the panel mid-draw, then opening it: the same note, no failure', async () => {
    routes((signal) => sseResponse(THINKING, { hold: true, signal }), stoppedEmpty());
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await within(panel).findByText(/Thinking/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Close explain panel' }));
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Explain/ }));
    const again = await screen.findByRole('complementary', { name: 'Explain' });
    expect(await within(again).findByText('Stopped before any part arrived.')).toBeTruthy();
    expect(panelText()).not.toMatch(SERVER_FAILURE);
  });
});

describe('a keyboard Stop (review S5)', () => {
  it('hands focus to Redraw and announces the stopped plate', async () => {
    const frames = plateFrames('diagram-plate');
    routes((signal) => sseResponse(frames.slice(0, 5), { hold: true, signal }));
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await waitFor(() => expect(keyRows()).toHaveLength(1));
    const stop = within(panel).getByRole('button', { name: 'Stop' });
    stop.focus();
    fireEvent.click(stop);
    const note = await within(panel).findByText('Stopped. The parts that arrived are kept.');
    expect(note.getAttribute('role')).toBe('status');
    // The plate has parts, so its own Redraw takes focus (an empty one hands it to Retry).
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Redraw'));
  });
});

/** Part A found near its passage but not word for word: an Anchor, `supported: false`. */
const near = (part: DiagramPart): DiagramPart => ({
  ...part,
  cite: part.cite === null ? null : { ...part.cite, supported: false },
});

describe('not verified near a passage (review S1)', () => {
  it('is dashed and said in the key, marked in the drawing, flashed as not verified, counted', async () => {
    routes(
      (signal) => sseResponse(withPart(plateFrames('diagram-plate'), 'A', near), { signal }),
      storedWith((parts) => parts.map((p) => (p.letter === 'A' ? near(p) : p))),
    );
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await waitFor(() =>
      expect(panel.querySelector('[data-plate-phase="complete"]')).not.toBeNull(),
    );
    await act(async () => new Promise((settle) => setTimeout(settle, 50))); // the stored read too
    const row = panel.querySelector('[data-letter="A"]') as HTMLElement;
    expect(row.dataset.verdict).toBe('not-verified');
    expect(row.querySelector('.pt-tab--not-verified')).not.toBeNull();
    expect(row.querySelector('.pt-marker--not-verified')).not.toBeNull();
    expect(row.textContent).toContain('not verified');
    // The model's quote is not the paper's words: never in the paper's voice.
    expect(row.querySelector('[data-voice="paper"]')).toBeNull();
    expect(row.querySelector('[data-voice="ai"].pt-plate-key__ai-quote')).not.toBeNull();
    const mark = panel.querySelector('[data-part="A"] .pt-plate__mark');
    expect(mark?.getAttribute('data-not-verified')).toBe('true');
    expect(panel.querySelector('[data-part="A"] .pt-plate__caption')?.textContent).toBe(
      'not verified',
    );
    expect(panel.querySelector('[data-plate-readout]')?.textContent).toBe(
      '6 parts · 4 cited · 1 not verified · drawn by AI from p. 4',
    );
    fireEvent.click(within(row).getByRole('button'));
    expect(focusAnchor.mock.calls[0]?.[1]).toMatchObject({ from: { n: 1, notVerified: true } });
  });

  it('a quote found nowhere: a "?" marker and "not verified" in the drawing, no hatching (S3)', async () => {
    routes((signal) => sseResponse(plateFrames('diagram-plate-bad'), { signal }));
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await waitFor(() =>
      expect(panel.querySelector('[data-plate-phase="complete"]')).not.toBeNull(),
    );
    const c = panel.querySelector('[data-part="C"]') as Element;
    expect(c.querySelector('.pt-plate__mark text')?.textContent).toBe('?');
    expect(c.querySelector('.pt-plate__mark')?.getAttribute('data-not-verified')).toBe('true');
    expect(c.querySelector('.pt-plate__caption')?.textContent).toBe('not verified');
    expect(hatched(c)).toBe(false);
    // A cited part keeps its hatched shadow; an inferred one has the dashed caption of its own.
    expect(hatched(panel.querySelector('[data-part="A"]') as Element)).toBe(true);
  });
});

describe('the key says everything the drawing does (review S2)', () => {
  it('names each row by its own words: the quote, the AI’s own line, the arrows', async () => {
    routes((signal) => sseResponse(plateFrames('diagram-plate'), { signal }));
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await waitFor(() =>
      expect(panel.querySelector('[data-plate-phase="complete"]')).not.toBeNull(),
    );
    for (const button of panel.querySelectorAll('.pt-plate-key__part')) {
      expect(button.hasAttribute('aria-label')).toBe(false);
    }
    const name = (letter: string) =>
      within(panel).getByRole('button', { name: new RegExp(`^Part ${letter}:`) });
    expect(name('A')).toBeTruthy();
    within(panel).getByRole('button', {
      name: /^Part A: Q, K, V\s*\. Passage 1, p\. 4 ¶1\s*\. “queries and keys of dimension dk, and values of dimension dv” Show in paper\.$/,
    });
    within(panel).getByRole('button', {
      name: /^Part E: .*“We compute the matrix of outputs as” Arrows in from D and A \(V\)\. Show in paper\.$/,
    });
    within(panel).getByRole('button', {
      name: /^Part F: Weights sum to 1\s*\. Inferred, no passage\s*\. The AI's own line: each query's weights over the keys add up to one Arrow in from D\.$/,
    });
  });

  it('says feedback links in words, from the routes the drawing draws', () => {
    const parts = [
      { letter: 'A', kind: 'input' as const, after: [], edge: [] },
      { letter: 'B', kind: 'step' as const, after: ['A'], edge: ['scores'] },
      { letter: 'C', kind: 'step' as const, after: ['B', 'A'], edge: [null, 'V'] },
    ];
    const { routes: drawn } = layoutPlate(
      parts,
      [{ source: 'C', target: 'A', label: 'again' }],
      false,
    );
    expect(structureOf('B', drawn)).toBe('Arrow in from A (scores).');
    expect(structureOf('C', drawn)).toBe('Arrows in from B and A (V). Link back to A (again).');
    expect(structureOf('A', drawn)).toBeNull();
  });
});

describe('a refused Retry says why (B1, S4d refusal fields)', () => {
  it('a failed first plate whose Retry is refused shows the refusal, not the old failure', async () => {
    let n = 0;
    routes(() => {
      n += 1;
      return n === 1
        ? jsonResponse(503, { detail: 'down', code: 'agent_unavailable', retryable: true })
        : jsonResponse(409, { detail: 'busy', code: 'busy', retryable: true });
    });
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    const first = await within(panel).findByRole('alert');
    expect(first.getAttribute('data-error-code')).toBe('agent_unavailable');
    expect(panel.querySelector('.pt-exchange__not-sent')?.textContent).toBe('not sent');
    fireEvent.click(within(first).getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(within(panel).getByRole('alert').getAttribute('data-error-code')).toBe('busy'),
    );
  });
});
