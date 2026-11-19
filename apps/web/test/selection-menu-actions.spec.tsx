/**
 * selection-menu-actions: what the menu's items do, and the two keys (#346, #349, P4 steps 5 and 7).
 * Enter on a fresh selection is Explain; Esc clears it; Send to board has two choices (Board beside
 * opens the board, Just send stays and toasts "Added" with Show); Note makes a highlight and asks
 * for its note field, with no AI call and no board card.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendToCanvas } from '@/components/canvas/sendToCanvas';
import { dismissCanvasToast } from '@/components/canvas/toast';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';
import { useSelectionActions } from '@/components/reader/useSelectionActions';
import { boardsApi } from '@/lib/api/boards';

import type { SelectionActions } from '@/components/reader/SelectionItems';
import type { PendingSelection, SelectionCapture } from '@/components/reader/useSelectionCapture';
import type { Anchor } from '@/lib/api/types';

vi.mock('@/lib/api/boards', () => ({ boardsApi: { get: vi.fn(), createNode: vi.fn() } }));
vi.mock('@/lib/api/threads', () => ({ threadsApi: { list: vi.fn(), get: vi.fn() } }));

const ANCHOR = { id: 'a1', doc: { paperId: 'ppr_1' }, selectors: [] } as unknown as Anchor;
const CAPTURED = {
  anchor: ANCHOR,
  anchors: [ANCHOR],
  selection: { text: 'The formulation of F(x) + x' },
} as unknown as SelectionCapture;

interface Spies {
  readonly openExplain: ReturnType<typeof vi.fn>;
  readonly askAbout: ReturnType<typeof vi.fn>;
  readonly sendToCanvas: ReturnType<typeof vi.fn>;
  readonly clear: ReturnType<typeof vi.fn>;
  readonly onCreateHighlight: ReturnType<typeof vi.fn>;
  readonly onCreateNote: ReturnType<typeof vi.fn>;
  readonly onOpenBoard: ReturnType<typeof vi.fn>;
  readonly onNotice: ReturnType<typeof vi.fn>;
  actions: SelectionActions | null;
}

function spies(): Spies {
  return {
    openExplain: vi.fn(),
    askAbout: vi.fn(),
    sendToCanvas: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    onCreateHighlight: vi.fn(),
    onCreateNote: vi.fn(),
    onOpenBoard: vi.fn(),
    onNotice: vi.fn(),
    actions: null,
  };
}

function Harness({ spy, selected }: { spy: Spies; selected: boolean }): ReactNode {
  const reader = useMemo<ReaderActions>(
    () => ({
      openExplain: spy.openExplain,
      askAbout: spy.askAbout,
      sendToCanvas: spy.sendToCanvas,
      focusAnchor: () => undefined,
    }),
    [spy],
  );
  return (
    <ReaderActionsProvider value={reader}>
      <Inner spy={spy} selected={selected} />
      <button type="button">a button on the page</button>
    </ReaderActionsProvider>
  );
}

function Inner({ spy, selected }: { spy: Spies; selected: boolean }): ReactNode {
  const actions = useSelectionActions({
    selection: selected ? ({ text: 'x' } as PendingSelection) : null,
    capture: () => CAPTURED,
    clear: spy.clear,
    root: null,
    onCreateHighlight: spy.onCreateHighlight,
    onCreateNote: spy.onCreateNote,
    onOpenBoard: spy.onOpenBoard,
    onNotice: spy.onNotice,
  });
  useEffect(() => {
    spy.actions = actions;
  });
  return null;
}

afterEach(() => {
  vi.mocked(boardsApi.get).mockReset();
  vi.mocked(boardsApi.createNode).mockReset();
  dismissCanvasToast();
  cleanup();
  document.getElementById('pt-canvas-toast-host')?.remove();
});

describe('the keys on a selection', () => {
  it('Enter on a fresh selection is Explain, and clears the selection', () => {
    const spy = spies();
    render(<Harness spy={spy} selected />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(spy.openExplain).toHaveBeenCalledWith({
      anchor: ANCHOR,
      quote: 'The formulation of F(x) + x',
    });
    expect(spy.clear).toHaveBeenCalledTimes(1);
  });

  it('Enter does nothing without a selection, or on a control that takes Enter itself', () => {
    const spy = spies();
    const { rerender, getByRole } = render(<Harness spy={spy} selected={false} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    rerender(<Harness spy={spy} selected />);
    fireEvent.keyDown(getByRole('button', { name: 'a button on the page' }), { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Enter', shiftKey: true });
    expect(spy.openExplain).not.toHaveBeenCalled();
  });

  it('Esc clears the selection and its menu, once, and asks nothing', () => {
    const spy = spies();
    render(<Harness spy={spy} selected />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(spy.clear).toHaveBeenCalledTimes(1);
    expect(spy.openExplain).not.toHaveBeenCalled();
  });
});

describe('the items', () => {
  beforeEach(() => {
    vi.mocked(boardsApi.get).mockResolvedValue({ board: null, nodes: [], edges: [] });
    vi.mocked(boardsApi.createNode).mockResolvedValue({ board: {} as never, node: {} as never });
  });

  it('Explain and Ask hand the passage on and clear the selection', () => {
    const spy = spies();
    render(<Harness spy={spy} selected />);
    spy.actions?.onExplain?.();
    spy.actions?.onAsk?.();
    expect(spy.openExplain).toHaveBeenCalledTimes(1);
    expect(spy.askAbout).toHaveBeenCalledWith({
      anchor: ANCHOR,
      quote: 'The formulation of F(x) + x',
    });
    expect(spy.clear).toHaveBeenCalledTimes(2);
  });

  it('a colour keeps the highlight in that colour', () => {
    const spy = spies();
    render(<Harness spy={spy} selected />);
    spy.actions?.onHighlight('pink');
    expect(spy.onCreateHighlight).toHaveBeenCalledWith(CAPTURED, 'pink');
  });

  it('Note makes a highlight with its note field open: no AI call, no board card', () => {
    const spy = spies();
    render(<Harness spy={spy} selected />);
    spy.actions?.onNote?.();
    expect(spy.onCreateNote).toHaveBeenCalledTimes(1);
    expect(spy.onCreateNote.mock.calls[0]?.[0]).toBe(CAPTURED);
    expect(spy.openExplain).not.toHaveBeenCalled();
    expect(spy.askAbout).not.toHaveBeenCalled();
    expect(spy.sendToCanvas).not.toHaveBeenCalled();
    expect(spy.clear).toHaveBeenCalledTimes(1);
  });

  it('Just send stays in the reader and asks for the "Added" toast', async () => {
    const spy = spies();
    render(<Harness spy={spy} selected />);
    spy.actions?.onSendToBoard?.('just-send');
    await vi.waitFor(() => expect(spy.sendToCanvas).toHaveBeenCalledTimes(1));
    expect(spy.sendToCanvas).toHaveBeenCalledWith({
      kind: 'excerpt',
      anchor: ANCHOR,
      toast: 'added',
    });
    expect(spy.onOpenBoard).not.toHaveBeenCalled();
  });

  it('Board beside sends without a toast, then opens the board', async () => {
    const spy = spies();
    render(<Harness spy={spy} selected />);
    spy.actions?.onSendToBoard?.('beside');
    await vi.waitFor(() => expect(spy.onOpenBoard).toHaveBeenCalledTimes(1));
    expect(spy.sendToCanvas).toHaveBeenCalledWith({
      kind: 'excerpt',
      anchor: ANCHOR,
      toast: 'none',
    });
  });

  it('a failed send says so and does not open the board', async () => {
    const spy = spies();
    spy.sendToCanvas.mockRejectedValue(new Error('no'));
    render(<Harness spy={spy} selected />);
    spy.actions?.onSendToBoard?.('beside');
    await vi.waitFor(() => expect(spy.onNotice).toHaveBeenCalledTimes(1));
    expect(spy.onOpenBoard).not.toHaveBeenCalled();
  });
});

describe('the "Added · Show" toast', () => {
  const toast = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-testid="canvas-toast"]');

  beforeEach(() => {
    vi.mocked(boardsApi.get).mockResolvedValue({ board: null, nodes: [], edges: [] });
    vi.mocked(boardsApi.createNode).mockResolvedValue({ board: {} as never, node: {} as never });
  });

  it('says Added, and Show opens the board on the card that was made', async () => {
    await sendToCanvas('ppr_1', { kind: 'excerpt', anchor: ANCHOR, toast: 'added' });
    await vi.waitFor(() => expect(toast()?.textContent).toContain('Added'));
    const created = vi.mocked(boardsApi.createNode).mock.calls[0]?.[1];
    const show = toast()?.querySelector('a');
    expect(show?.textContent).toBe('Show');
    expect(show?.getAttribute('href')).toBe(
      `/paper/ppr_1/board?card=${encodeURIComponent(created?.node_id ?? '')}`,
    );
    expect(created?.node_id).toMatch(/^cn_/);
  });

  it('says nothing when the board is about to open', async () => {
    await sendToCanvas('ppr_1', { kind: 'excerpt', anchor: ANCHOR, toast: 'none' });
    expect(boardsApi.createNode).toHaveBeenCalledTimes(1);
    expect(toast()).toBeNull();
  });
});
