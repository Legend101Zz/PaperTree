/**
 * #214: "Board" wherever a person reads it outside the board page: the explain panel's Send to
 * board (idle, sent, failed), the reader's selection toolbar, and every toast `sendToCanvas` shows
 * (added, already there, no board for a sample paper) say "board", never "canvas", in their text,
 * names and tooltips. The board page itself is scanned in `features/board/components/chrome.spec`.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendToCanvas } from '@/components/canvas/sendToCanvas';
import { dismissCanvasToast } from '@/components/canvas/toast';
import { SelectionToolbar } from '@/components/reader/SelectionToolbar';
import { Exchange } from '@/features/explain/components/Exchange';
import { buildExchanges, type Exchange as ExchangeModel } from '@/features/explain/model/exchange';
import { boardsApi } from '@/lib/api/boards';

import { anchorFixture, citation } from './s6-support';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { Anchor, Citation } from '@/lib/api/types';

vi.mock('@/lib/api/boards', () => ({ boardsApi: { get: vi.fn(), createNode: vi.fn() } }));
vi.mock('@/lib/api/threads', () => ({ threadsApi: { list: vi.fn(), get: vi.fn() } }));

/** Everything a person can read or hear in `root`: text, accessible names, tooltips. */
const said = (root: ParentNode): string =>
  [
    root.textContent ?? '',
    ...Array.from(root.querySelectorAll('[aria-label], [title], [placeholder]')).flatMap((el) =>
      ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
    ),
  ].join(' ');

const toast = () => document.querySelector<HTMLElement>('[data-testid="canvas-toast"]');

beforeEach(() => {
  vi.mocked(boardsApi.get).mockResolvedValue({ board: null, nodes: [], edges: [] });
  vi.mocked(boardsApi.createNode).mockResolvedValue({ board: {} as never, node: {} as never });
});
afterEach(() => {
  dismissCanvasToast();
  cleanup();
  document.getElementById('pt-canvas-toast-host')?.remove();
});

describe('“board”, never “canvas”, around the board (#214)', () => {
  it('the explain panel’s Send to board, sent and failed', async () => {
    const answer = {
      key: 'm1',
      role: 'assistant',
      text: 'The model uses eight heads [b1].',
      messageId: 'msg_1',
      runId: 'run_1',
      status: 'complete',
      stopped: false,
      label: null,
      failure: null,
      citations: [citation('b1') as Citation],
      usage: null,
      question: 'q',
      createdAt: null,
      coverage: null,
      generation: null,
    } as ViewMessage;
    const [exchange] = buildExchanges(
      [{ ...answer, key: 'u1', role: 'user', text: 'Explain.' }, answer],
      {
        anchor: anchorFixture('sel'),
        quote: 'We reframe detection.',
      },
    );
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { container } = render(
      <Exchange
        exchange={exchange as ExchangeModel<ViewMessage>}
        initial="M"
        onShow={() => undefined}
        onRetry={() => undefined}
        onStop={() => undefined}
        onSendToCanvas={send}
      />,
    );
    expect(said(container)).not.toMatch(/canvas/i);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send to board' })));
    expect(screen.getByRole('alert').textContent).toBe(
      "Couldn't send this to the board. Try again.",
    );
    expect(said(container)).not.toMatch(/canvas/i);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send to board' })));
    expect(screen.getByRole('button', { name: 'Sent to board' })).toBeTruthy();
    expect(said(container)).not.toMatch(/canvas/i);
  });

  it('the reader’s selection toolbar', () => {
    const { container } = render(
      <SelectionToolbar
        placement={{ kind: 'sheet' }}
        onHighlight={() => undefined}
        onCopy={() => undefined}
        onExplain={() => undefined}
        onAsk={() => undefined}
        onSendToBoard={() => undefined}
      />,
    );
    // #203 drew it with its words beside the pin; #214 keeps them "board".
    expect(screen.getByRole('button', { name: 'Send to board' }).textContent).toBe('Send to board');
    expect(said(container)).not.toMatch(/canvas/i);
  });

  it('every toast a send shows, and where its link goes', async () => {
    const anchor = {
      id: 'a1',
      doc: { paperId: 'ppr_1' },
      selectors: [
        { type: 'PageSelector', index: 0 },
        { type: 'TextQuoteSelector', exact: 'Residual learning', prefix: '', suffix: '' },
      ],
    } as unknown as Anchor;
    await sendToCanvas('ppr_1', { kind: 'excerpt', anchor });
    await vi.waitFor(() => expect(toast()?.textContent).toContain('Passage added to your board.'));
    expect(toast()!.querySelector('a')?.getAttribute('href')).toBe('/paper/ppr_1/board');
    expect(said(toast()!)).not.toMatch(/canvas/i);

    vi.mocked(boardsApi.get).mockResolvedValue({
      board: null,
      nodes: [{ kind: 'excerpt', source_anchor: anchor } as never],
      edges: [],
    });
    await sendToCanvas('ppr_1', { kind: 'excerpt', anchor });
    await vi.waitFor(() => expect(toast()?.textContent).toContain('Already on your board'));
    expect(said(toast()!)).not.toMatch(/canvas/i);

    await expect(sendToCanvas(null, { kind: 'explanation', messageId: 'm1' })).rejects.toThrow(
      'This sample paper is not in your library, so it has no board.',
    );
    await vi.waitFor(() => expect(toast()?.textContent).toContain('so it has no board.'));
    expect(said(toast()!)).not.toMatch(/canvas/i);
  });
});
