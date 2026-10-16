import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';
import { request } from '@/lib/api/client';

import { threadTool } from '../model/chrome';
import { FRAME_HANDLES, toFlowNode, type PtNode } from '../model/flow';
import { cardRow } from '../model/test-data';
import { CanvasActionsProvider, type CanvasActions } from './BoardContext';
import { BoardHeader } from './BoardHeader';
import { BoardMinimap } from './BoardMinimap';
import { BoardToolbar, type BoardToolbarProps } from './BoardToolbar';
import { BoardView } from './BoardView';
import { FrameNode } from './cards/FrameNode';
import { EMPTY_BOARD, EmptyBoard } from './EmptyBoard';

vi.mock('@/lib/api/boards', () => ({ boardsApi: { get: vi.fn(), patchBoard: vi.fn() } }));
vi.mock('@/lib/api/client', () => ({ request: vi.fn() }));

afterEach(cleanup);

/** The phone breakpoint answers as a phone would (`useWide`). */
function asPhone(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

const tool = (label: string, extra = {}) => ({ label, run: vi.fn(), ...extra });

function toolbar(extra: Partial<BoardToolbarProps> = {}) {
  const props: BoardToolbarProps = {
    select: tool('Select', { pressed: false }),
    addNote: tool('Add note'),
    addFrame: tool('Add frame'),
    thread: { ...threadTool(0, false), pressed: false, run: vi.fn() },
    fitAll: tool('Fit all'),
    zoom: vi.fn(),
    more: [tool('Frame selected cards'), tool('Remove frame'), tool('Delete', { danger: true })],
    ...extra,
  };
  render(
    <ReactFlowProvider>
      <BoardToolbar {...props} />
    </ReactFlowProvider>,
  );
  return props;
}

const names = (root: HTMLElement) =>
  within(root)
    .getAllByRole('button')
    .map((b) => (b.textContent === '' ? b.getAttribute('aria-label') : b.textContent));

describe('the toolbar (frame 06)', () => {
  it('names the design’s tools, reads the zoom, and keeps v0.1’s tools in More', () => {
    const props = toolbar();
    const bar = screen.getByRole('toolbar', { name: 'Board tools' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.querySelector('.pt-boardtool__label')?.textContent),
    ).toEqual([
      'Select',
      'Add note',
      'Add frame',
      'Thread',
      'Fit all',
      'Zoom out',
      'Zoom in',
      'More board tools',
    ]);
    expect(within(bar).getByText('100%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More board tools' }));
    const menu = screen.getByRole('group', { name: 'More board tools' });
    expect(
      within(menu)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Frame selected cards', 'Remove frame', 'Delete']);
    fireEvent.click(within(menu).getByRole('button', { name: 'Delete' }));
    expect(props.more[2]!.run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'More board tools' })).toBeNull();
  });

  it('Thread (L) says why it is off, and starts linking once a card is selected', () => {
    const off = toolbar();
    const thread = screen.getByRole('button', { name: 'Thread' });
    expect(thread.getAttribute('aria-keyshortcuts')).toBe('L');
    expect(thread.getAttribute('aria-disabled')).toBe('true');
    expect(thread.title).toMatch(/Select a card/);
    fireEvent.click(thread);
    expect(off.thread.run).not.toHaveBeenCalled();
    cleanup();
    const on = toolbar({ thread: { ...threadTool(1, false), pressed: false, run: vi.fn() } });
    fireEvent.click(screen.getByRole('button', { name: 'Thread' }));
    expect(on.thread.run).toHaveBeenCalledTimes(1);
  });

  it('Escape closes More and gives focus back to it', () => {
    toolbar();
    const more = screen.getByRole('button', { name: 'More board tools' });
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Escape' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
  });

  it('on a phone, Select and the zoom move into More so the bar is one row', () => {
    asPhone();
    toolbar();
    const bar = screen.getByRole('toolbar', { name: 'Board tools' });
    expect(within(bar).queryByRole('button', { name: 'Zoom in' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More board tools' }));
    const menu = screen.getByRole('group', { name: 'More board tools' });
    expect(names(menu).slice(0, 3)).toEqual(['Select', 'Zoom out', 'Zoom in']);
    vi.restoreAllMocks();
  });
});

describe('the header and the empty board (06, 06b)', () => {
  it('says Board, the paper in italic, the counts, and the way back', () => {
    render(
      <BoardHeader
        paperId="ppr_1"
        paperTitle="Attention Is All You Need"
        counts="3 cards · 1 thread"
      >
        <span />
      </BoardHeader>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Board Attention Is All You Need',
    );
    expect(screen.getByText('3 cards · 1 thread')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the paper' }).getAttribute('href')).toBe(
      '/paper/ppr_1/read',
    );
  });

  it('shows 06b’s words and Back to the paper', () => {
    render(<EmptyBoard paperId="ppr_1" />);
    const card = screen.getByRole('region', { name: EMPTY_BOARD.title });
    expect(card.textContent).toContain(
      'Select a passage and choose Send to board, or Dive in from an explanation.',
    );
    expect(within(card).getByRole('link', { name: 'Back to the paper' }).getAttribute('href')).toBe(
      '/paper/ppr_1/read',
    );
    expect(screen.getByText('Passages arrive as cards')).toBeTruthy();
    expect(screen.getByText('Threads link them')).toBeTruthy();
  });
});

describe('the minimap', () => {
  const map = (empty: boolean) =>
    render(
      <ReactFlowProvider>
        <BoardMinimap empty={empty} />
      </ReactFlowProvider>,
    );

  it('is a named region captioned with the zoom, or “empty”', () => {
    map(true);
    expect(
      within(screen.getByRole('region', { name: 'Minimap' })).getByText('Map · empty'),
    ).toBeTruthy();
    cleanup();
    map(false);
    expect(screen.getByText('Map · 100%')).toBeTruthy();
  });

  it('folds behind a Map button on a phone, and the button opens it', () => {
    asPhone();
    map(false);
    const toggle = screen.getByRole('button', { name: 'Map' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Map · 100%')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Map · 100%')).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe('a frame’s paper tag', () => {
  function frame(ctx: Partial<CanvasActions>) {
    const actions: CanvasActions = {
      editingId: null,
      setEditingId: vi.fn(),
      commitBody: vi.fn(),
      commitTitle: vi.fn(),
      commitSize: vi.fn(),
      ...ctx,
    };
    const node = toFlowNode(cardRow('group', { node_id: 'cn_g', title: 'New frame' }), 'ppr_1');
    const props = { ...node, selected: false, dragging: false } as unknown as NodeProps<PtNode>;
    render(
      <ReactFlowProvider>
        <CanvasActionsProvider value={actions}>
          <FrameNode {...props} />
        </CanvasActionsProvider>
      </ReactFlowProvider>,
    );
    return actions;
  }

  it('a new frame opens with its whole name selected, and Enter names it', () => {
    const ctx = frame({ editingId: 'cn_g' });
    const name = screen.getByRole('textbox', { name: 'Frame name' }) as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 'New frame'.length]);
    fireEvent.change(name, { target: { value: 'Mechanism' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(ctx.commitTitle).toHaveBeenCalledWith('cn_g', 'Mechanism');
    expect(ctx.setEditingId).toHaveBeenCalledWith(null);
  });

  it('moves by its tag or its outline (so a card over the tag does not hide it), not by its name', () => {
    frame({});
    const handle = toFlowNode(cardRow('group'), 'p').dragHandle!;
    expect(handle).toBe(FRAME_HANDLES);
    expect(toFlowNode(cardRow('note'), 'p').dragHandle).toBeUndefined();
    // xyflow starts a drag where `element.matches(dragHandle)`: the tag and all four edge bands.
    const bands = Array.from(document.querySelectorAll('.pt-frame__edge'));
    expect(bands.map((b) => b.className.replace('pt-frame__edge pt-frame__edge--', ''))).toEqual([
      'top',
      'right',
      'bottom',
      'left',
    ]);
    for (const band of [...bands, document.querySelector('.pt-frame__tag')!]) {
      expect(band.matches(handle)).toBe(true);
    }
    const name = screen.getByRole('textbox', { name: 'Frame name' });
    expect(name.matches(handle)).toBe(false);
    expect(name.classList.contains('nodrag')).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('no “canvas” in anything the board says (#214)', () => {
  const said = (root: HTMLElement): string =>
    [
      root.textContent ?? '',
      ...Array.from(root.querySelectorAll('[aria-label], [title], [placeholder]')).flatMap((el) =>
        ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
      ),
    ].join(' ');

  beforeEach(() => {
    vi.mocked(request).mockResolvedValue({ title: 'Attention Is All You Need' });
  });

  const page = async (): Promise<HTMLElement> => {
    const view = render(<BoardView paperId="ppr_1" />);
    await act(async () => {
      await Promise.resolve();
    });
    return view.container as HTMLElement;
  };

  it('the empty board, its header, tools, menu and minimap', async () => {
    vi.mocked(boardsApi.get).mockResolvedValue({ board: null, nodes: [], edges: [] });
    const root = await page();
    await screen.findByText(EMPTY_BOARD.title);
    fireEvent.click(screen.getByRole('button', { name: 'More board tools' }));
    expect(screen.getByRole('main')).toBeTruthy();
    expect(said(root)).not.toMatch(/canvas/i);
  });

  it('the loading and the failed board', async () => {
    let fail: (e: Error) => void = () => undefined;
    vi.mocked(boardsApi.get).mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const root = await page();
    expect(screen.getByRole('status', { name: 'Loading your board' })).toBeTruthy();
    expect(said(root)).not.toMatch(/canvas/i);
    await act(async () => fail(new Error('offline')));
    await waitFor(() => expect(screen.getByRole('heading', { name: /didn.t load/ })).toBeTruthy());
    expect(said(root)).not.toMatch(/canvas/i);
  });
});
