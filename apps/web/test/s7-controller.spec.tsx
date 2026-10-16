/**
 * S7: the controller's request discipline (contracts.md §2.7): a settled canvas sends nothing, one
 * drag is one PATCH, a nudge burst is one PATCH after the debounce, a stale version reloads and says
 * so, deleting a group ungroups its members on screen. `boardsApi` is the only stub.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NUDGE_DEBOUNCE_MS, useBoardController } from '@/components/canvas/useBoardController';
import { boardsApi } from '@/lib/api/boards';
import { ApiError, type Board, type CanvasNode } from '@/lib/api/types';

vi.mock('@/lib/api/boards', () => ({
  boardsApi: {
    get: vi.fn(),
    createNode: vi.fn(),
    patchNode: vi.fn(),
    deleteNode: vi.fn(),
    createEdge: vi.fn(),
    patchEdge: vi.fn(),
    deleteEdge: vi.fn(),
    patchBoard: vi.fn(),
  },
}));

const api = vi.mocked(boardsApi);
const BOARD: Board = {
  board_id: 'brd_1',
  paper_id: 'ppr_1',
  title: 'Canvas',
  viewport: null,
  created_at: '',
  updated_at: '',
};

function node(id: string, extra: Partial<CanvasNode> = {}): CanvasNode {
  return {
    node_id: id,
    board_id: 'brd_1',
    kind: 'note',
    group_id: null,
    x: 0,
    y: 0,
    w: 260,
    h: 150,
    z: 0,
    title: null,
    body: 'b',
    source_anchor: null,
    source_message_id: null,
    version: 1,
    created_at: '',
    updated_at: '',
    ...extra,
  };
}

async function mount(nodes: CanvasNode[]) {
  api.get.mockResolvedValue({ board: BOARD, nodes, edges: [] });
  const hook = renderHook(() => useBoardController('ppr_1'));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return hook;
}

const move = (id: string, x: number, y: number, dragging: boolean) =>
  ({ type: 'position', id, position: { x, y }, dragging }) as const;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.patchNode.mockImplementation(async (_b, id, body) => node(id, { version: body.version + 1 }));
  api.deleteNode.mockResolvedValue(undefined);
});

describe('useBoardController', () => {
  it('loads once and then makes no request at all', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mount([node('cn_a')]);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(api.get).toHaveBeenCalledTimes(1);
      for (const [name, fn] of Object.entries(api)) {
        if (name !== 'get') expect(fn, name).not.toHaveBeenCalled();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends exactly one PATCH for a drag, however many move events it had', async () => {
    const { result } = await mount([node('cn_a'), node('cn_b', { x: 500 })]);
    act(() => {
      for (let i = 1; i <= 20; i += 1)
        result.current.onNodesChange([move('cn_a', i * 5, i * 3, true)]);
    });
    expect(api.patchNode).not.toHaveBeenCalled();
    act(() => {
      result.current.onNodesChange([move('cn_a', 100, 60, false)]);
      result.current.onNodeDragStop();
    });
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_a', { version: 1, x: 100, y: 60 });
    // The debounced nudge flush that the drag-end change also scheduled must find nothing to send.
    await new Promise((done) => setTimeout(done, NUDGE_DEBOUNCE_MS + 100));
    expect(api.patchNode).toHaveBeenCalledTimes(1);
  });

  it('sends a burst of arrow-key nudges as one PATCH after the debounce', async () => {
    const { result } = await mount([node('cn_a')]);
    act(() => {
      result.current.onNodesChange([move('cn_a', 10, 0, false)]);
      result.current.onNodesChange([move('cn_a', 20, 0, false)]);
      result.current.onNodesChange([move('cn_a', 30, 0, false)]);
    });
    expect(api.patchNode).not.toHaveBeenCalled();
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_a', { version: 1, x: 30, y: 0 });
  });

  it('chains a second change after the first and carries the version the first returned', async () => {
    const { result } = await mount([node('cn_a')]);
    act(() => {
      result.current.commitBody('cn_a', 'one');
      result.current.commitBody('cn_a', 'two');
    });
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(2));
    expect(api.patchNode.mock.calls.map((c) => c[2])).toEqual([
      { version: 1, body: 'one' },
      { version: 2, body: 'two' },
    ]);
  });

  it('commits an unchanged note without a request', async () => {
    const { result } = await mount([node('cn_a', { body: 'same' })]);
    act(() => result.current.commitBody('cn_a', 'same'));
    expect(api.patchNode).not.toHaveBeenCalled();
  });

  it('on a stale version it says so and reloads the board', async () => {
    const { result } = await mount([node('cn_a')]);
    api.patchNode.mockRejectedValueOnce(new ApiError(409, 'stale_version', 'stale', false));
    act(() => result.current.commitBody('cn_a', 'mine'));
    await waitFor(() => expect(result.current.notice).toMatch(/changed somewhere else/));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('deleting a group ungroups its members on screen and removes only the group', async () => {
    const { result } = await mount([
      node('cn_g', { kind: 'group' }),
      node('cn_a', { group_id: 'cn_g' }),
      node('cn_b', { group_id: 'cn_g' }),
    ]);
    act(() => result.current.deleteNodes(['cn_g']));
    expect(result.current.nodes.map((n) => [n.id, n.data.node.group_id])).toEqual([
      ['cn_a', null],
      ['cn_b', null],
    ]);
    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledWith('brd_1', 'cn_g'));
    expect(api.deleteNode).toHaveBeenCalledTimes(1);
  });

  it('dragging a group carries its members and sends one PATCH per node that moved', async () => {
    const { result } = await mount([
      node('cn_g', { kind: 'group', x: 0, y: 0 }),
      node('cn_a', { group_id: 'cn_g', x: 10, y: 10 }),
      node('cn_b', { x: 900, y: 900 }),
    ]);
    act(() => {
      result.current.onNodesChange([move('cn_g', 50, 0, true)]);
      result.current.onNodesChange([move('cn_g', 50, 0, false)]);
      result.current.onNodeDragStop();
    });
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(2));
    const sent = api.patchNode.mock.calls.map((c) => [c[1], (c[2] as { x: number }).x]).sort();
    expect(sent).toEqual([
      ['cn_a', 60],
      ['cn_g', 50],
    ]);
  });

  it('saves the viewport only when it changed, and only through patchBoard', async () => {
    const { result } = await mount([node('cn_a')]);
    api.patchBoard.mockResolvedValue(BOARD);
    act(() => {
      result.current.saveViewport({ x: 1, y: 2, zoom: 1 });
      result.current.saveViewport({ x: 1, y: 2, zoom: 1 });
    });
    expect(api.patchBoard).toHaveBeenCalledTimes(1);
    expect(api.patchBoard).toHaveBeenCalledWith('brd_1', { viewport: { x: 1, y: 2, zoom: 1 } });
  });
});
