/**
 * Board beside, mounted the way `ReaderWorkspace` mounts it (#344, P4 step 7): the real
 * `ReaderActionsMount` with the real explain controller and the real split state, around a stub of
 * the board (the board's own behaviour is specified in `features/board`). What is held here is the
 * wiring: the board opens and closes, shares the right side with Explain, a source click flashes
 * the paper while the board stays, a dropped passage is sent at the drop point, and Esc closes the
 * board on its own level.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createContext, useContext, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { indexDocument, type PaperSource } from '@papertree/anchoring';

import { setDraggedPassage } from '@/features/split';
import { useBoardBeside } from '@/features/split';
import { ReaderActionsMount } from '@/features/reader/components/ReaderActionsMount';
import { useReaderActions } from '@/components/reader/actions';
import { buildImageAnchor } from '@/lib/imageAnchor';

import { TestQueryProvider } from './query-client';
import { stubDesktop } from './s6-harness';
import { anchorFixture } from './s6-support';

import type { BoardHost } from '@/features/board';

const sent = vi.hoisted(() => vi.fn());
vi.mock('@/components/canvas/sendToCanvas', () => ({ sendToCanvas: sent }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/paper/ppr_1/read',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/features/board', () => {
  const Context = createContext<BoardHost | null>(null);
  return {
    BoardHostProvider: Context.Provider,
    BoardView: () => {
      const host = useContext(Context)!;
      return (
        <div data-testid="board" data-beside={String(host.beside)}>
          <button
            type="button"
            onClick={() => host.showInPaper({ nodeId: 'cn_1', anchor: anchorFixture('cited') })}
          >
            p. 3
          </button>
          <button type="button" onClick={() => host.onEscapeUnused()}>
            nothing left to close
          </button>
          <button type="button" onClick={() => host.onBranched()}>
            first branch
          </button>
          <button type="button" onClick={() => host.dragIn?.drop({ x: 356, y: 372 })}>
            drop
          </button>
          <span data-testid="arrival">{host.arrival?.cardId ?? 'none'}</span>
          <span data-testid="centre">{String(host.arrival?.centre)}</span>
          <span data-testid="pages">{[...host.visiblePages].join(',')}</span>
        </div>
      );
    },
  };
});

const focusAnchor = vi.fn();
const onNotice = vi.fn();

function Reader({
  pages = new Set<number>([2]),
}: {
  readonly pages?: ReadonlySet<number>;
}): ReactNode {
  const beside = useBoardBeside();
  return (
    <ReaderActionsMount
      paper={{ kind: 'api', paperId: 'ppr_1' }}
      onFocusAnchor={focusAnchor}
      beside={beside}
      visiblePages={pages}
      onNotice={onNotice}
    >
      <Controls openOn={beside.openOn} />
    </ReaderActionsMount>
  );
}

function Controls({ openOn }: { readonly openOn: (cardId: string | null) => void }): ReactNode {
  const actions = useReaderActions();
  return (
    <>
      <button type="button" onClick={() => openOn('cn_sent')}>
        send beside
      </button>
      <button
        type="button"
        onClick={() =>
          actions.openExplain({ anchor: anchorFixture('sel'), quote: 'A selected passage.' })
        }
      >
        explain
      </button>
    </>
  );
}

const mount = (pages?: ReadonlySet<number>) =>
  render(
    <TestQueryProvider>
      <Reader {...(pages === undefined ? {} : { pages })} />
    </TestQueryProvider>,
  );

beforeEach(() => {
  stubDesktop();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
  );
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
  window.localStorage.clear();
  sent.mockReset();
  focusAnchor.mockReset();
  onNotice.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDraggedPassage(null);
});

describe('Board beside, as the reader mounts it', () => {
  it('B opens the board beside the paper and B closes it, with the pages on screen told to it', () => {
    mount(new Set([2, 3]));
    expect(screen.queryByTestId('board')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(screen.getByTestId('board').getAttribute('data-beside')).toBe('true');
    expect(screen.getByTestId('pages').textContent).toBe('2,3');
    expect(document.documentElement.getAttribute('data-pt-board')).toBe('open');
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it('a card sent with Board beside opens the board on it', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'send beside' }));
    expect(screen.getByTestId('arrival').textContent).toBe('cn_sent');
  });

  it('shares the right side with Explain: opening one closes the other', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'send beside' }));
    expect(screen.getByTestId('board')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'explain' }));
    await waitFor(() => expect(screen.queryByTestId('board')).toBeNull());
    expect(screen.getByRole('complementary', { name: 'Explain' })).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'b' });
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull(),
    );
    expect(screen.getByTestId('board')).not.toBeNull();
  });

  it('a source click flashes the passage in the paper, and the board stays', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'b' });
    fireEvent.click(screen.getByRole('button', { name: 'p. 3' }));
    expect(focusAnchor).toHaveBeenCalledWith(expect.objectContaining({ id: 'anchor-cited' }), {
      flash: true,
    });
    expect(screen.getByTestId('board')).not.toBeNull();
  });

  it('Escape with nothing left to close in the board closes the board', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'b' });
    fireEvent.click(screen.getByRole('button', { name: 'nothing left to close' }));
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it('after the first branch the board widens and the paper folds to a strip, one click to restore', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'b' });
    fireEvent.click(screen.getByRole('button', { name: 'first branch' }));
    expect(document.documentElement.style.getPropertyValue('--pt-board-width')).toBe('1396px');
    const [show] = screen.getAllByRole('button', { name: 'Show the paper' });
    fireEvent.click(show!);
    expect(document.documentElement.style.getPropertyValue('--pt-board-width')).toBe('720px');
  });

  it('a source click while the paper is a strip brings the paper back, then flashes', () => {
    vi.useFakeTimers();
    mount();
    fireEvent.keyDown(document.body, { key: 'b' });
    fireEvent.click(screen.getByRole('button', { name: 'first branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'p. 3' }));
    expect(document.documentElement.style.getPropertyValue('--pt-board-width')).toBe('720px');
    expect(focusAnchor).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(400));
    expect(focusAnchor).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a passage dragged across and dropped is sent at the drop point and arrives there, view kept', async () => {
    sent.mockResolvedValue('cn_dropped');
    mount();
    fireEvent.keyDown(document.body, { key: 'b' });
    setDraggedPassage({ anchor: anchorFixture('dragged'), text: 'Dragged words.' });
    fireEvent.click(screen.getByRole('button', { name: 'drop' }));
    expect(sent).toHaveBeenCalledWith(
      'ppr_1',
      expect.objectContaining({ kind: 'excerpt', toast: 'none', at: { x: 356, y: 372 } }),
    );
    await waitFor(() => expect(screen.getByTestId('arrival').textContent).toBe('cn_dropped'));
  });

  it('a figure dragged across and dropped is sent as an image card: its anchor, its caption as the body (#348)', async () => {
    sent.mockResolvedValue('cn_picture');
    mount();
    fireEvent.keyDown(document.body, { key: 'b' });
    const picture = buildImageAnchor({
      doc: indexDocument(
        JSON.parse(
          readFileSync(`${process.cwd()}/test/fixtures/real-resnet-p1-2.ir.json`, 'utf8'),
        ) as PaperSource,
        'beside-image',
      ),
      page: 0,
      box: [309, 224, 545, 347],
      kind: 'figure',
      id: 'dragged-figure',
      at: '2026-11-20T10:00:00.000Z',
      client: 'test',
    });
    setDraggedPassage({ anchor: picture, text: 'Figure 1. Training error.', image: true });
    fireEvent.click(screen.getByRole('button', { name: 'drop' }));
    expect(sent).toHaveBeenCalledWith(
      'ppr_1',
      expect.objectContaining({
        kind: 'excerpt',
        anchor: picture,
        body: 'Figure 1. Training error.',
        toast: 'none',
        at: { x: 356, y: 372 },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('arrival').textContent).toBe('cn_picture'));
  });

  it('a drop on a passage already on the board with a tree pans to it and glows it; a moved or new one keeps the view', async () => {
    sent.mockImplementation((_paper: string, input: { onOutcome?: (o: string) => void }) => {
      input.onOutcome?.('existing');
      return Promise.resolve('cn_has_tree');
    });
    mount();
    fireEvent.keyDown(document.body, { key: 'b' });
    setDraggedPassage({ anchor: anchorFixture('dragged'), text: 'Dragged words.' });
    fireEvent.click(screen.getByRole('button', { name: 'drop' }));
    await waitFor(() => expect(screen.getByTestId('arrival').textContent).toBe('cn_has_tree'));
    expect(screen.getByTestId('centre').textContent).toBe('true');

    sent.mockImplementation((_paper: string, input: { onOutcome?: (o: string) => void }) => {
      input.onOutcome?.('moved');
      return Promise.resolve('cn_moved');
    });
    setDraggedPassage({ anchor: anchorFixture('dragged'), text: 'Dragged words.' });
    fireEvent.click(screen.getByRole('button', { name: 'drop' }));
    await waitFor(() => expect(screen.getByTestId('arrival').textContent).toBe('cn_moved'));
    expect(screen.getByTestId('centre').textContent).toBe('false');
  });

  it('says so when the dropped passage cannot be sent', async () => {
    sent.mockRejectedValue(new Error('no'));
    mount();
    fireEvent.keyDown(document.body, { key: 'b' });
    setDraggedPassage({ anchor: anchorFixture('dragged'), text: 'Dragged words.' });
    fireEvent.click(screen.getByRole('button', { name: 'drop' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
  });
});
