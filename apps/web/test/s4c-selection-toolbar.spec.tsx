/**
 * s4c-selection-toolbar: the selection toolbar's items (#203, DESIGN.md §3 item 12) and the Ask that
 * waits for the reader's own question. Explain · Ask · Highlight with five washes · Send to board ·
 * Copy, in that order; "Explain with a diagram" only when the diagram slice provides it (never an
 * inert placeholder); a refused Highlight says why in the bar and greys its washes too.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExplainPanel, useExplainActions } from '@/components/explain';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';
import { SelectionToolbar } from '@/components/reader/SelectionToolbar';

import { TestQueryProvider } from './query-client';
import { stubDesktop } from './s6-harness';
import {
  anchorFixture,
  done,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
  text,
} from './s6-support';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MARGIN = { kind: 'margin', left: 640, top: 400 } as const;

function names(): string[] {
  const bar = screen.getByRole('toolbar', { name: 'Selection actions' });
  return within(bar)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? '');
}

describe('the selection toolbar', () => {
  it('lists the design’s items in order, as a vertical bar in the margin', () => {
    render(
      <SelectionToolbar
        placement={MARGIN}
        onExplain={() => undefined}
        onAsk={() => undefined}
        onHighlight={() => undefined}
        onSendToBoard={() => undefined}
        onCopy={() => undefined}
      />,
    );
    const bar = screen.getByRole('toolbar', { name: 'Selection actions' });
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    expect(bar.getAttribute('data-placement')).toBe('margin');
    expect(names()).toEqual([
      'Explain this passage',
      'Ask about this passage',
      'Highlight',
      'Highlight in amber',
      'Highlight in green',
      'Highlight in blue',
      'Highlight in pink',
      'Highlight in purple',
      'Send to board',
      'Copy',
    ]);
    // The visible words are the design's; the names begin with them (WCAG 2.5.3).
    expect(within(bar).getByText('Explain')).toBeTruthy();
    expect(within(bar).getByText('Ask')).toBeTruthy();
  });

  it('Highlight uses the last colour; a wash highlights in that colour', () => {
    const onHighlight = vi.fn();
    render(
      <SelectionToolbar placement={MARGIN} onHighlight={onHighlight} onCopy={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(onHighlight).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getByRole('button', { name: 'Highlight in green' }));
    expect(onHighlight).toHaveBeenLastCalledWith('green');
  });

  it('draws "Explain with a diagram" only when it is wired, and Ask only when it is', () => {
    const { rerender } = render(
      <SelectionToolbar
        placement={MARGIN}
        onHighlight={() => undefined}
        onCopy={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Explain with a diagram' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask about this passage' })).toBeNull();
    const diagram = vi.fn();
    rerender(
      <SelectionToolbar
        placement={{ kind: 'docked', edge: 'top' }}
        onHighlight={() => undefined}
        onCopy={() => undefined}
        onExplainWithDiagram={diagram}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Explain with a diagram' }));
    expect(diagram).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('toolbar', { name: 'Selection actions' }).getAttribute('aria-orientation'),
    ).toBe('horizontal');
  });

  it('a refused Highlight says why in the bar, and its washes are refused too', () => {
    const onHighlight = vi.fn();
    render(
      <SelectionToolbar
        placement={MARGIN}
        onHighlight={onHighlight}
        onCopy={() => undefined}
        highlightDisabledReason="This selection covers 80 passages; one highlight holds up to 64."
      />,
    );
    const highlight = screen.getByRole('button', { name: 'Highlight' }) as HTMLButtonElement;
    expect(highlight.disabled).toBe(true);
    const note = document.getElementById(highlight.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toMatch(/up to 64/);
    const amber = screen.getByRole('button', { name: 'Highlight in amber' }) as HTMLButtonElement;
    expect(amber.disabled).toBe(true);
    fireEvent.click(amber);
    expect(onHighlight).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('a press on the bar keeps the selection (pointerdown is prevented)', () => {
    render(
      <SelectionToolbar
        placement={MARGIN}
        onHighlight={() => undefined}
        onCopy={() => undefined}
      />,
    );
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    screen.getByRole('button', { name: 'Highlight' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

function AskHarness(): ReactNode {
  const explain = useExplainActions({ paperId: PAPER });
  const { openExplain, askAbout } = explain;
  const actions = useMemo<ReaderActions>(
    () => ({
      openExplain,
      askAbout,
      sendToCanvas: async () => undefined,
      focusAnchor: () => undefined,
    }),
    [openExplain, askAbout],
  );
  return (
    <ReaderActionsProvider value={actions}>
      <button
        type="button"
        onClick={() =>
          askAbout({ anchor: anchorFixture('sel1'), quote: 'We reframe object detection.' })
        }
      >
        ask about it
      </button>
      <ExplainPanel controller={explain} />
    </ReaderActionsProvider>
  );
}

describe('Ask: the panel waits for the reader’s own question about the passage', () => {
  beforeEach(() => {
    stubDesktop(true);
    window.localStorage.setItem('papertree.session', 'test-token');
  });

  it('opens on the passage with the question box focused, sends nothing, then asks that question', async () => {
    const { calls } = installFetch({
      [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, []),
      [`POST /papers/${PAPER}/threads`]: (_c, signal) =>
        sseResponse([run({ thread_id: 'thr_9' }), text('An answer.'), done()], { signal }),
    });
    render(
      <TestQueryProvider>
        <AskHarness />
      </TestQueryProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ask about it' }));
    const drawer = await screen.findByRole('complementary', { name: 'Explain' });
    expect(within(drawer).getByText(/We reframe object detection/)).toBeTruthy();
    expect(within(drawer).getByText('Type your question about this passage below.')).toBeTruthy();
    const box = within(drawer).getByLabelText('Ask a question about this paper');
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);

    fireEvent.change(box, { target: { value: 'Why a single regression?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    const body = calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>;
    expect(body.kind).toBe('explain');
    expect(body.question).toBe('Why a single regression?');
    expect(JSON.stringify(body.anchor)).toContain('sel1');
  });
});
