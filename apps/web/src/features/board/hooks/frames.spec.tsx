/**
 * #214: frames on the controller — Add frame makes an empty frame and opens its name, a card dropped
 * in a frame joins it in the PATCH of its move, a frame carries its cards, a resize takes cards in
 * and lets them go. `boardsApi` is the only stub.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';

import { cardRow } from '../model/test-data';
import { useBoardController } from './useBoardController';

import type { Board, CanvasNode } from '@/lib/api/types';

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
const BOARD = { board_id: 'brd_1', paper_id: 'ppr_1', title: 'Board', viewport: null } as Board;
const FRAME = cardRow('group', { node_id: 'cn_g', x: 0, y: 0, w: 400, h: 300, title: 'Why' });

async function mount(nodes: CanvasNode[]) {
  api.get.mockResolvedValue({ board: BOARD, nodes, edges: [] });
  const hook = renderHook(() => useBoardController('ppr_1'));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return hook;
}

/** A drag of one node to (x, y), ended the way xyflow ends one. */
function drag(
  result: { current: ReturnType<typeof useBoardController> },
  id: string,
  x: number,
  y: number,
) {
  act(() => {
    result.current.onNodesChange([{ type: 'position', id, position: { x, y }, dragging: true }]);
    result.current.onNodesChange([{ type: 'position', id, position: { x, y }, dragging: false }]);
    result.current.onNodeDragStop();
  });
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.patchNode.mockImplementation(async (_b, id, body) =>
    cardRow('note', { node_id: id, version: body.version + 1 }),
  );
});

describe('frames on the board (#214)', () => {
  it('Add frame makes an empty frame centred on the view, with its name ready to type', async () => {
    api.createNode.mockImplementation(async (_p, body) => ({
      board: BOARD,
      node: cardRow(body.kind, { ...body, title: body.title ?? null, body: '' }),
    }));
    const { result } = await mount([cardRow('note', { node_id: 'cn_n', x: 300, y: 100 })]);
    await act(async () => {
      await result.current.addFrame({ x: 500, y: 400 });
    });
    expect(api.createNode).toHaveBeenCalledTimes(1);
    const body = api.createNode.mock.calls[0]![1];
    expect(body).toMatchObject({
      kind: 'group',
      x: 300,
      y: 250,
      w: 400,
      h: 300,
      title: 'New frame',
    });
    expect(result.current.editingId).toBe(body.node_id);
    // Empty: the note it lies over was not taken in, and nothing else was written.
    expect(result.current.nodes.find((n) => n.id === 'cn_n')?.data.node.group_id).toBeNull();
    expect(api.patchNode).not.toHaveBeenCalled();
  });

  it('a card dropped in a frame joins it, in the one PATCH of its move', async () => {
    const { result } = await mount([FRAME, cardRow('note', { node_id: 'cn_a', x: 600, y: 0 })]);
    drag(result, 'cn_a', 40, 60);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_a', {
      version: 1,
      x: 40,
      y: 60,
      group_id: 'cn_g',
    });
    expect(result.current.nodes.find((n) => n.id === 'cn_a')?.data.node.group_id).toBe('cn_g');
  });

  it('a card dragged out of its frame leaves it', async () => {
    const { result } = await mount([
      FRAME,
      cardRow('note', { node_id: 'cn_a', x: 40, y: 60, group_id: 'cn_g' }),
    ]);
    drag(result, 'cn_a', 900, 900);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_a', {
      version: 1,
      x: 900,
      y: 900,
      group_id: null,
    });
  });

  it('moving a frame by its tag carries its cards, which stay in it', async () => {
    const { result } = await mount([
      FRAME,
      cardRow('note', { node_id: 'cn_a', x: 40, y: 60, group_id: 'cn_g' }),
      cardRow('note', { node_id: 'cn_b', x: 900, y: 0 }),
    ]);
    drag(result, 'cn_g', 100, 50);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(2));
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_g', { version: 1, x: 100, y: 50 });
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_a', { version: 1, x: 140, y: 110 });
    expect(result.current.nodes.find((n) => n.id === 'cn_b')?.position).toEqual({ x: 900, y: 0 });
  });

  it('a resized frame takes in the cards it now holds and lets go of the ones it does not', async () => {
    const { result } = await mount([
      FRAME,
      cardRow('note', { node_id: 'cn_in', x: 40, y: 60, group_id: 'cn_g' }),
      cardRow('note', { node_id: 'cn_out', x: 500, y: 40 }),
    ]);
    act(() => result.current.commitSize('cn_g', { x: 0, y: 0, w: 900, h: 300 }));
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(2));
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_out', { version: 1, group_id: 'cn_g' });
    act(() => result.current.commitSize('cn_g', { x: 0, y: 0, w: 200, h: 120 }));
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(5));
    const groupOf = (id: string) =>
      result.current.nodes.find((n) => n.id === id)?.data.node.group_id;
    expect(groupOf('cn_in')).toBeNull();
    expect(groupOf('cn_out')).toBeNull();
  });
});
