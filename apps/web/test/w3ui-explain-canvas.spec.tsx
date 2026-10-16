/**
 * W3UI round 2 (#141): the explain panel's quote, a markdown answer with chips, the canvas toast's
 * clock, the canvas citation reader, and the stale-version notice naming the SERVER's card.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubDesktop } from './s6-harness';
import { QuoteProbe } from './w3ui-quote-probe';
import { citation, done, installFetch, PAPER, run, sseResponse, text } from './s6-support';

vi.mock('@/lib/api/boards', () => ({
  boardsApi: { get: vi.fn(), patchNode: vi.fn() },
}));
vi.mock('@/lib/api/threads', () => ({
  threadsApi: { list: vi.fn(), get: vi.fn() },
}));

import { dismissCanvasToast, showCanvasToast } from '@/components/canvas/toast';
import { useBoardController } from '@/features/board/hooks/useBoardController';
import { useCardSources } from '@/features/board/hooks/useCardSources';
import { toFlowNode } from '@/features/board/model/flow';
import { boardsApi } from '@/lib/api/boards';
import { threadsApi } from '@/lib/api/threads';
import { ApiError, type CanvasNode } from '@/lib/api/types';

describe('the explain panel quote', () => {
  beforeEach(() => {
    stubDesktop();
    window.localStorage.setItem('papertree.session', 'test-token');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('quotes the selection de-hyphenated on the call slip, in the paper’s voice', async () => {
    installFetch({
      [`POST /papers/${PAPER}/threads`]: () =>
        sseResponse([run(), text('ok'), done()], { hold: true }),
    });
    const long =
      'A sin- gle convolutional network predicts multi- ple bounding boxes and class probabilities for those boxes in one evaluation, which is end-to-end and ' +
      'improves detec- tion performance. '.repeat(6);
    render(<QuoteProbe quote={long} />);
    fireEvent.click(screen.getByText('open'));
    // #202: the selection is the first call slip's quote; the slip shows it on one line (CSS) and
    // keeps the whole passage in the DOM, so nothing is cut from what a screen reader hears.
    const slip = await waitFor(() => {
      const found = document.querySelector('[data-explain-quote] [data-voice="paper"]');
      expect(found).not.toBeNull();
      return found as Element;
    });
    const shown = slip.textContent ?? '';
    expect(shown).toContain('A single convolutional network');
    expect(shown).toContain('multiple bounding boxes');
    expect(shown).toContain('end-to-end');
    expect(shown).toContain('detection performance.');
    expect(shown).not.toMatch(/sin- gle|multi- ple|detec- tion/);
    expect(document.querySelector('[data-explain-quote] [data-voice="you"]')?.textContent).toBe(
      'Explain this passage.',
    );
  });
});

describe('the canvas toast clock', () => {
  afterEach(() => {
    act(() => dismissCanvasToast());
    vi.useRealTimers();
  });

  it('stays 8 s, and stops while hovered or focused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const tick = async (ms: number): Promise<void> => {
      await act(async () => {
        vi.advanceTimersByTime(ms);
        await new Promise<void>((r) => setImmediate(r));
      });
    };
    act(() => showCanvasToast({ message: 'Passage added to your board.', href: '/paper/x/board' }));
    await tick(7500);
    expect(screen.getByTestId('canvas-toast')).toBeTruthy();
    await tick(700);
    expect(screen.queryByTestId('canvas-toast')).toBeNull();

    act(() => showCanvasToast({ message: 'Again', href: '/paper/x/board' }));
    const toast = screen.getByTestId('canvas-toast');
    fireEvent.pointerEnter(toast);
    await tick(60_000);
    expect(screen.getByTestId('canvas-toast')).toBeTruthy();
    fireEvent.pointerLeave(toast);
    await tick(1000);
    expect(screen.getByTestId('canvas-toast')).toBeTruthy();
    // Focus pauses as well, and "Open board" is a real link in the tab order.
    const link = screen.getByRole('link', { name: 'Open board' });
    expect(link.getAttribute('tabindex')).not.toBe('-1');
    act(() => link.focus());
    await tick(60_000);
    expect(screen.getByTestId('canvas-toast')).toBeTruthy();
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(screen.queryByTestId('canvas-toast')).toBeNull();
  });
});

describe('the canvas toast and the keyboard', () => {
  afterEach(() => {
    act(() => dismissCanvasToast());
  });

  it('moves a keyboard user to Open board and Escape puts them back', async () => {
    const button = document.createElement('button');
    button.textContent = 'Send to board';
    document.body.appendChild(button);
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // The button disables itself while it works and drops focus, as the real one does.
    button.blur();
    act(() => showCanvasToast({ message: 'Answer added to your board.', href: '/paper/x/board' }));
    const link = screen.getByRole('link', { name: 'Open board' });
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(screen.queryByTestId('canvas-toast')).toBeNull();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('leaves focus alone after a mouse press', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    window.dispatchEvent(new Event('pointerdown'));
    act(() => showCanvasToast({ message: 'Passage added to your board.', href: '/paper/x/board' }));
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: 'Open board' }));
    button.remove();
  });
});

describe('canvas citations', () => {
  const message = (id: string, markers: string[]) => ({
    message_id: id,
    citations: markers.map((m) => citation(m)),
  });
  const explanation = (id: string, messageId: string): CanvasNode =>
    ({
      node_id: id,
      board_id: 'b',
      kind: 'explanation',
      group_id: null,
      x: 0,
      y: 0,
      w: 300,
      h: 200,
      z: 0,
      title: 'T',
      body: 'x [b1]',
      source_anchor: null,
      source_message_id: messageId,
      version: 1,
      created_at: '',
      updated_at: '',
    }) as CanvasNode;

  it("reads a message's citations from its thread", async () => {
    vi.mocked(threadsApi.list).mockResolvedValue([
      { thread_id: 'thr_old', updated_at: '2026-01-01' },
      { thread_id: 'thr_new', updated_at: '2026-02-01' },
    ] as never);
    vi.mocked(threadsApi.get).mockImplementation(async (_p, tid) => ({
      thread: {} as never,
      messages: (tid === 'thr_old'
        ? [message('msg_1', ['b1', 'b2'])]
        : [message('msg_other', ['b1'])]) as never,
    }));
    const nodes = [toFlowNode(explanation('cn_1', 'msg_1'), 'ppr_1')];
    const { result } = renderHook(() => useCardSources('ppr_1', nodes));
    await waitFor(() =>
      expect(result.current.explanations.get('msg_1')?.answer.citations).toHaveLength(2),
    );
  });

  it('gives no entry when the read fails', async () => {
    vi.mocked(threadsApi.list).mockRejectedValue(new Error('offline'));
    const nodes = [toFlowNode(explanation('cn_1', 'msg_1'), 'ppr_1')];
    const { result } = renderHook(() => useCardSources('ppr_1', nodes));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.explanations.has('msg_1')).toBe(false);
  });
});

describe('the stale-version notice', () => {
  it('names the card by the server text after the reload, not the unsaved edit', async () => {
    const server: CanvasNode = {
      node_id: 'cn_a',
      board_id: 'brd_1',
      kind: 'note',
      group_id: null,
      x: 0,
      y: 0,
      w: 260,
      h: 150,
      z: 0,
      title: null,
      body: 'Server text',
      source_anchor: null,
      source_message_id: null,
      source_page_id: null,
      source_diagram_id: null,
      counts: null,
      version: 2,
      created_at: '',
      updated_at: '',
    };
    const board = {
      board_id: 'brd_1',
      paper_id: 'ppr_1',
      title: 'Canvas',
      viewport: null,
      created_at: '',
      updated_at: '',
    };
    vi.mocked(boardsApi.get).mockResolvedValue({
      board,
      nodes: [{ ...server, version: 1, body: 'Original' }],
      edges: [],
    } as never);
    const { result } = renderHook(() => useBoardController('ppr_1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    vi.mocked(boardsApi.patchNode).mockRejectedValueOnce(
      new ApiError(409, 'stale_version', 'stale', false),
    );
    vi.mocked(boardsApi.get).mockResolvedValue({ board, nodes: [server], edges: [] } as never);
    act(() => result.current.commitBody('cn_a', 'My edit'));
    await waitFor(() =>
      expect(result.current.notice).toBe(
        'The card “Server text” was changed somewhere else. The latest version is shown.',
      ),
    );
    expect(result.current.notice).not.toContain('My edit');
  });
});
