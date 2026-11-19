/**
 * s4c-selection-toolbar: the selection menu's items (#203, #346, P4 step 5) and the Ask that waits
 * for the reader's own question. Explain · Ask… · Send to board (Board beside, Just send) · Note ·
 * the five colours, in that order; no Copy and no "Explain with a diagram"; one tab stop with
 * arrows inside; a refused Highlight says why in the bar and greys its colours and Note too.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, type ReactNode } from 'react';

import type { PendingSelection } from '@/components/reader/useSelectionCapture';
import type { FloatingGeometry } from '@/components/reader/VirtualPageList';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useExplainActions } from '@/components/explain';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';
import { SelectionToolbar } from '@/components/reader/SelectionToolbar';
import { useSelectionToolbar } from '@/features/reader';

import { HeaderAndPanel } from './explain-toggle';
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
  it('lists the prototype’s items in order, as a vertical bar in the margin', () => {
    render(
      <SelectionToolbar
        placement={MARGIN}
        onExplain={() => undefined}
        onAsk={() => undefined}
        onHighlight={() => undefined}
        onSendToBoard={() => undefined}
        onNote={() => undefined}
      />,
    );
    const bar = screen.getByRole('toolbar', { name: 'Selection actions' });
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    expect(bar.getAttribute('data-placement')).toBe('margin');
    expect(names()).toEqual([
      'Explain',
      'Ask…',
      'Send to board',
      'Note',
      'Highlight in amber',
      'Highlight in green',
      'Highlight in blue',
      'Highlight in pink',
      'Highlight in purple',
    ]);
    // The names are the visible words (WCAG 2.5.3).
    for (const word of ['Explain', 'Ask…', 'Send to board', 'Note']) {
      expect(within(bar).getByText(word)).toBeTruthy();
    }
  });

  it('has no Copy, no standalone Highlight and no “Explain with a diagram”', () => {
    render(
      <SelectionToolbar
        placement={MARGIN}
        onExplain={() => undefined}
        onHighlight={() => undefined}
        onSendToBoard={() => undefined}
      />,
    );
    for (const gone of ['Copy', 'Highlight', 'Explain with a diagram', 'Diagram']) {
      expect(screen.queryByRole('button', { name: gone })).toBeNull();
    }
  });

  it('a colour highlights in that colour', () => {
    const onHighlight = vi.fn();
    render(<SelectionToolbar placement={MARGIN} onHighlight={onHighlight} />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight in green' }));
    expect(onHighlight).toHaveBeenLastCalledWith('green');
  });

  it('draws Ask and Note only when they are wired', () => {
    const { rerender } = render(
      <SelectionToolbar placement={MARGIN} onHighlight={() => undefined} />,
    );
    expect(screen.queryByRole('button', { name: 'Ask…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Note' })).toBeNull();
    const onNote = vi.fn();
    rerender(
      <SelectionToolbar
        placement={{ kind: 'docked', edge: 'top' }}
        onHighlight={() => undefined}
        onNote={onNote}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    expect(onNote).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('toolbar', { name: 'Selection actions' }).getAttribute('aria-orientation'),
    ).toBe('horizontal');
  });

  it('Send to board offers Board beside and Just send, and says which was chosen', () => {
    const onSendToBoard = vi.fn();
    render(
      <SelectionToolbar
        placement={MARGIN}
        onHighlight={() => undefined}
        onSendToBoard={onSendToBoard}
      />,
    );
    const send = screen.getByRole('button', { name: 'Send to board' });
    expect(send.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(send);
    expect(send.getAttribute('aria-expanded')).toBe('true');
    const choices = within(screen.getByRole('group', { name: 'Send to board' })).getAllByRole(
      'button',
    );
    expect(choices.map((c) => c.textContent)).toEqual([
      'Board besideopens it next to the paper',
      'Just sendkeep reading',
    ]);
    fireEvent.click(choices[1] as HTMLElement);
    expect(onSendToBoard).toHaveBeenLastCalledWith('just-send');
    // The choices close once one is made.
    expect(screen.queryByRole('group', { name: 'Send to board' })).toBeNull();
    fireEvent.click(send);
    fireEvent.click(screen.getByRole('button', { name: /^Board beside/ }));
    expect(onSendToBoard).toHaveBeenLastCalledWith('beside');
  });

  it('the docked row uses the short label for Send to board; its name stays whole', () => {
    render(
      <SelectionToolbar
        placement={{ kind: 'docked', edge: 'top' }}
        onHighlight={() => undefined}
        onSendToBoard={() => undefined}
      />,
    );
    const send = screen.getByRole('button', { name: 'Send to board' });
    expect(send.textContent).toBe('Board');
  });

  it('a refused Highlight says why in the bar, and its colours and Note are refused too', () => {
    const onHighlight = vi.fn();
    render(
      <SelectionToolbar
        placement={MARGIN}
        onHighlight={onHighlight}
        onNote={() => undefined}
        onExplain={() => undefined}
        highlightDisabledReason="This selection covers 80 passages; one highlight holds up to 64."
      />,
    );
    const colours = screen.getByRole('group', { name: 'Highlight colour' });
    const note = document.getElementById(colours.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toMatch(/up to 64/);
    const amber = screen.getByRole('button', { name: 'Highlight in amber' }) as HTMLButtonElement;
    expect(amber.disabled).toBe(true);
    fireEvent.click(amber);
    expect(onHighlight).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Note' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Explain' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('a press on the bar keeps the selection (pointerdown is prevented)', () => {
    render(
      <SelectionToolbar
        placement={MARGIN}
        onHighlight={() => undefined}
        onExplain={() => undefined}
      />,
    );
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    screen.getByRole('button', { name: 'Explain' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('is one tab stop, and the arrows walk its items', () => {
    render(
      <SelectionToolbar
        placement={MARGIN}
        onHighlight={() => undefined}
        onExplain={() => undefined}
        onAsk={() => undefined}
        onNote={() => undefined}
      />,
    );
    const bar = screen.getByRole('toolbar', { name: 'Selection actions' });
    const buttons = within(bar).getAllByRole('button');
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(buttons[0]?.tabIndex).toBe(0);
    buttons[0]?.focus();
    fireEvent.keyDown(bar, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]?.tabIndex).toBe(0);
    expect(buttons[0]?.tabIndex).toBe(-1);
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(bar, { key: 'End' });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
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
      <HeaderAndPanel explain={explain} />
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

/** Stubs every element's drawn size, as a real browser would report the wrapped bar. */
function stubDrawnSize(width: number, height: number): () => void {
  const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => height,
  });
  return () => {
    if (w !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', w);
    if (h !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', h);
  };
}

const NARROW: FloatingGeometry = {
  pageBox: () => ({ left: 0, top: 0, width: 400, height: 1000 }),
  irScale: () => 1,
  contentWidth: 400,
  viewport: { left: 0, top: 0, right: 400, bottom: 800 },
};

/** One selected line 62-68 px under the column top, in a column too narrow for a margin bar. */
const LINE = {
  pageIndex: 0,
  irQuads: [[87, 62, 309, 68]],
  irExtent: [87, 62, 309, 68],
  endPageIndex: 0,
  endQuads: [[87, 62, 309, 68]],
  endExtent: [87, 62, 309, 68],
} as unknown as PendingSelection;

function PlacedBar(): ReactNode {
  const toolbar = useSelectionToolbar({
    selection: LINE,
    doc: null,
    narrow: false,
    sheetOpen: false,
    actions: { onHighlight: () => undefined },
  });
  return (
    <>
      {toolbar.floating(NARROW)}
      {toolbar.dock}
    </>
  );
}

describe('the placement uses the bar as drawn (review B1)', () => {
  it('reports its drawn size', () => {
    const restore = stubDrawnSize(752, 84);
    const onMeasure = vi.fn();
    try {
      render(
        <SelectionToolbar
          placement={{ kind: 'docked', edge: 'top' }}
          onHighlight={() => undefined}
          onMeasure={onMeasure}
        />,
      );
      expect(onMeasure).toHaveBeenCalledWith({ width: 752, height: 84 });
    } finally {
      restore();
    }
  });

  it('a docked bar that wraps to 84 px moves to the bottom instead of covering the line', async () => {
    const restore = stubDrawnSize(352, 84);
    try {
      render(<PlacedBar />);
      const bar = await screen.findByRole('toolbar', { name: 'Selection actions' });
      await waitFor(() => expect(bar.className).toContain('pt-seltool--bottom'));
    } finally {
      restore();
    }
  });

  it('a one-row bar (52 px) clears that line and stays at the top', async () => {
    const restore = stubDrawnSize(352, 52);
    try {
      render(<PlacedBar />);
      const bar = await screen.findByRole('toolbar', { name: 'Selection actions' });
      expect(bar.className).toContain('pt-seltool--top');
    } finally {
      restore();
    }
  });
});
