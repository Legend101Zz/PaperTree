/**
 * s7b-plate-review — the plate's review fixes (#217): a Stop before the first part is the reader's
 * and says so on every path (Stop, switching threads, closing the panel; a Redraw's, since the
 * reader no longer starts a first plate, #339), never a server failure or
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
  BAD_THREAD,
  exchange,
  focusAnchor,
  keyRows,
  mount,
  mountRedrawing,
  PAPER,
  redrawStoppedEmpty,
  routes,
  storedWith,
  THREAD,
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

/** The Redraw's run, as the bad run's frames re-addressed to the stored thread. */
const redrawFrames = () =>
  plateFrames('diagram-plate-bad').map((f) => f.replaceAll(BAD_THREAD, THREAD));
const THINKING = redrawFrames().slice(0, 2); // run, status: nothing drawn yet
const SERVER_FAILURE = /went wrong on the server|What arrived is kept|parts that arrived are kept/;
/** What the server keeps for a Redraw stopped before its first part. */
const stoppedEmpty = redrawStoppedEmpty;

const hatched = (part: Element): boolean =>
  Array.from(part.querySelectorAll('rect')).some((r) => r.getAttribute('fill')?.startsWith('url('));

function panelText(): string {
  return screen.getByRole('complementary', { name: 'Explain' }).textContent ?? '';
}

describe('Stop a Redraw before its first part (review B2)', () => {
  it('Stop while "Thinking…": "Stopped before any part arrived.", then and after the stored read', async () => {
    const { calls } = routes(
      (signal) => sseResponse(THINKING, { hold: true, signal }),
      stoppedEmpty(),
    );
    const panel = await mountRedrawing();
    await within(panel).findByText(/Thinking/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop' }));
    const note = await within(panel).findByText('Stopped before any part arrived.');
    expect(note.getAttribute('role')).toBe('status');
    expect(panelText()).not.toMatch(SERVER_FAILURE);
    expect(exchange(panel, 1).querySelector('.pt-plate, .pt-plate-answer')).toBeNull(); // no plate, no model line
    // The stored copy lands (status `aborted`, no part): the same honest note.
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === `/papers/${PAPER}/threads/${THREAD}`).length,
      ).toBeGreaterThan(1),
    );
    await act(async () => new Promise((settle) => setTimeout(settle, 50)));
    expect(within(panel).getByText('Stopped before any part arrived.')).toBeTruthy();
    expect(panelText()).not.toMatch(SERVER_FAILURE);
  });

  it('switching threads mid-draw, then back: the stored plate says it stopped before any part', async () => {
    routes((signal) => sseResponse(THINKING, { hold: true, signal }), stoppedEmpty());
    const panel = await mountRedrawing();
    await within(panel).findByText(/Thinking/);
    fireEvent.click(screen.getByRole('button', { name: 'switch away' }));
    fireEvent.click(screen.getByRole('button', { name: 'switch back' }));
    expect(await within(panel).findByText('Stopped before any part arrived.')).toBeTruthy();
    expect(panelText()).not.toMatch(SERVER_FAILURE);
  });

  it('closing the panel mid-draw, then opening it: the same note, no failure', async () => {
    routes((signal) => sseResponse(THINKING, { hold: true, signal }), stoppedEmpty());
    const panel = await mountRedrawing();
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
    routes((signal) => sseResponse(redrawFrames().slice(0, 5), { hold: true, signal }));
    const panel = await mountRedrawing();
    await waitFor(() => expect(keyRows(exchange(panel, 1))).toHaveLength(1));
    const stop = within(panel).getByRole('button', { name: 'Stop' });
    stop.focus();
    fireEvent.click(stop);
    const note = await within(panel).findByText('Stopped. The parts that arrived are kept.');
    expect(note.getAttribute('role')).toBe('status');
    // The plate has parts, so its own Redraw takes focus (an empty one hands it to Retry).
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Redraw'));
  });
});

/** Part A found near its passage, not word for word: it has an Anchor and so a page, like any other. */
describe('a part found near its passage (#340)', () => {
  it('shows only its quiet page: no marker, tab, caption or verdict, and the quote is not shown', async () => {
    routes();
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    await waitFor(() =>
      expect(panel.querySelector('[data-plate-phase="complete"]')).not.toBeNull(),
    );
    const row = panel.querySelector('[data-letter="A"]') as HTMLElement;
    expect(row.querySelector('.pt-plate-key__source')?.textContent).toBe('From the paper: p. 4');
    expect(row.querySelector('.pt-tab, .pt-marker')).toBeNull();
    expect(row.textContent).not.toMatch(/not verified|verified|grounded/i);
    expect(
      panel.querySelector('[data-part="A"] .pt-plate__mark, [data-part="A"] .pt-plate__caption'),
    ).toBeNull();
    expect(panel.querySelector('[data-plate-readout]')?.textContent).toBe(
      '6 parts · drawn by AI from p. 4',
    );
    fireEvent.click(within(row).getByRole('button'));
    expect(focusAnchor.mock.calls[0]?.[1]).toEqual({ flash: true });
  });

  it('a quote found nowhere has no page and no mark in the drawing, and keeps its hatched shadow', async () => {
    routes();
    const panel = await mountRedrawing();
    const second = exchange(panel, 1);
    await waitFor(() =>
      expect(second.querySelector('[data-plate-phase="complete"]')).not.toBeNull(),
    );
    const c = second.querySelector('[data-part="C"]') as Element;
    expect(c.querySelector('.pt-plate__mark, .pt-plate__caption')).toBeNull();
    expect(hatched(c)).toBe(true);
    expect(hatched(panel.querySelector('[data-part="A"]') as Element)).toBe(true);
  });
});

describe('the key says everything the drawing does (review S2)', () => {
  it('names each row by its own words: the label, the AI’s line, its page, the arrows', async () => {
    routes();
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
      name: /^Part A: Q, K, V\s*\.\s*queries and keys of dimension dk[\s\S]*\.\s*From the paper: p\. 4 Show in paper\.$/,
    });
    within(panel).getByRole('button', {
      name: /^Part E: [\s\S]*Arrows in from D and A \(V\)\. Show in paper\.$/,
    });
    within(panel).getByRole('button', {
      name: /^Part F: Weights sum to 1\s*\.\s*each query's weights over the keys add up to one Arrow in from D\.$/,
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
  it('a Redraw that failed, whose Retry is refused, shows the refusal, not the old failure', async () => {
    let n = 0;
    routes(() => {
      n += 1;
      return n === 1
        ? jsonResponse(503, { detail: 'down', code: 'agent_unavailable', retryable: true })
        : jsonResponse(409, { detail: 'busy', code: 'busy', retryable: true });
    });
    const panel = await mountRedrawing();
    const first = await within(panel).findByRole('alert');
    expect(first.getAttribute('data-error-code')).toBe('agent_unavailable');
    expect(panel.querySelector('.pt-exchange__not-sent')?.textContent).toBe('not sent');
    fireEvent.click(within(first).getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(within(panel).getByRole('alert').getAttribute('data-error-code')).toBe('busy'),
    );
  });
});
