/**
 * S7: `sendToCanvas` creates the excerpt / explanation node (with the Anchor, never a bare block id),
 * places it clear of the existing nodes, and shows a toast with an "Open canvas" link. A failure
 * rejects. The API module is the only stub.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GAP } from '@/components/canvas/placement';
import { dismissCanvasToast } from '@/components/canvas/toast';
import { sendToCanvas } from '@/components/canvas/sendToCanvas';
import { boardsApi } from '@/lib/api/boards';
import { threadsApi } from '@/lib/api/threads';
import { ApiError, type Anchor, type CanvasNode } from '@/lib/api/types';

vi.mock('@/lib/api/boards', () => ({ boardsApi: { get: vi.fn(), createNode: vi.fn() } }));
vi.mock('@/lib/api/threads', () => ({ threadsApi: { list: vi.fn(), get: vi.fn() } }));

const get = vi.mocked(boardsApi.get);
const createNode = vi.mocked(boardsApi.createNode);
const PAPER = 'ppr_TESTTESTTEST';
const ANCHOR = {
  id: 'a1',
  doc: { paperId: PAPER },
  selectors: [{ type: 'TextQuoteSelector', exact: 'Residual learning\nframework', prefix: '', suffix: '' }],
} as unknown as Anchor;

function existing(x: number, y: number): CanvasNode {
  return {
    node_id: 'cn_existing0001', board_id: 'brd_1', kind: 'note', group_id: null, x, y, w: 260, h: 150,
    z: 0, title: null, body: '', source_anchor: null, source_message_id: null, version: 1,
    created_at: '', updated_at: '',
  };
}

beforeEach(() => {
  get.mockReset();
  createNode.mockReset();
  vi.mocked(threadsApi.list).mockReset();
  vi.mocked(threadsApi.get).mockReset();
  get.mockResolvedValue({ board: null, nodes: [], edges: [] });
  createNode.mockResolvedValue({ board: {} as never, node: {} as never });
});
afterEach(() => {
  dismissCanvasToast();
  cleanup();
  document.getElementById('pt-canvas-toast-host')?.remove();
});

describe('sendToCanvas', () => {
  it('sends a passage as an excerpt node holding the Anchor, and toasts with an Open canvas link', async () => {
    await sendToCanvas(PAPER, { kind: 'excerpt', anchor: ANCHOR });

    expect(createNode).toHaveBeenCalledTimes(1);
    const [paperId, body] = createNode.mock.calls[0]!;
    expect(paperId).toBe(PAPER);
    expect(body.kind).toBe('excerpt');
    expect(body.source_anchor).toBe(ANCHOR);
    expect(body.node_id).toMatch(/^cn_[0-9a-f-]{36}$/);
    expect(body.body).toBe('Residual learning framework');

    await vi.waitFor(() => expect(document.querySelector('[data-testid="canvas-toast"]')).not.toBeNull());
    const link = document.querySelector<HTMLAnchorElement>('[data-testid="canvas-toast"] a');
    expect(link?.textContent).toBe('Open canvas');
    expect(link?.getAttribute('href')).toBe(`/paper/${PAPER}/canvas`);
  });

  it('places the new node clear of the nodes already on the board', async () => {
    get.mockResolvedValue({ board: {} as never, nodes: [existing(0, 0)], edges: [] });
    await sendToCanvas(PAPER, { kind: 'excerpt', anchor: ANCHOR });
    const body = createNode.mock.calls[0]![1];
    const clear =
      body.x >= 260 + GAP || body.y >= 150 + GAP || body.x + body.w <= -GAP || body.y + body.h <= -GAP;
    expect(clear).toBe(true);
  });

  it('sends an explanation with the answer text and its message id, found in the newest thread', async () => {
    vi.mocked(threadsApi.list).mockResolvedValue([
      { thread_id: 'thr_old', title: 'Old', updated_at: '2026-01-01T00:00:00Z' } as never,
      { thread_id: 'thr_new', title: 'Explain: residuals', updated_at: '2026-02-01T00:00:00Z' } as never,
    ]);
    vi.mocked(threadsApi.get).mockResolvedValue({
      thread: {} as never,
      messages: [{ message_id: 'msg_answer0001', content: 'It learns the residual.' } as never],
    });

    await sendToCanvas(PAPER, { kind: 'explanation', messageId: 'msg_answer0001' });

    expect(threadsApi.get).toHaveBeenCalledWith(PAPER, 'thr_new');
    const body = createNode.mock.calls[0]![1];
    expect(body).toMatchObject({
      kind: 'explanation',
      source_message_id: 'msg_answer0001',
      body: 'It learns the residual.',
      title: 'Explain: residuals',
    });
  });

  it('rejects, and says so on screen for an explanation, when the node cannot be created', async () => {
    createNode.mockRejectedValue(new ApiError(422, 'validation_failed', 'source_message_id: no such answer on this paper', false));
    vi.mocked(threadsApi.list).mockResolvedValue([{ thread_id: 't', title: 'T', updated_at: '' } as never]);
    vi.mocked(threadsApi.get).mockResolvedValue({ thread: {} as never, messages: [{ message_id: 'm1', content: 'x' } as never] });
    await expect(sendToCanvas(PAPER, { kind: 'explanation', messageId: 'm1' })).rejects.toBeInstanceOf(ApiError);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="canvas-toast"]')?.textContent).toContain('no such answer'),
    );
  });

  it('makes no request for a fixture paper', async () => {
    await expect(sendToCanvas(null, { kind: 'excerpt', anchor: ANCHOR })).rejects.toThrow(/not in your library/);
    expect(get).not.toHaveBeenCalled();
    expect(createNode).not.toHaveBeenCalled();
  });
});
