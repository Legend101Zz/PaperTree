/**
 * #214: frames on the controller — Add frame makes an empty frame and opens its name, a card dropped
 * in a frame joins it in the PATCH of its move, a frame carries its cards (by drag and by keyboard,
 * every carried card saved once per gesture), a resize from any edge leaves the cards where they are
 * and only at its end takes cards in and lets them go. `boardsApi` is the only stub.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** One step of a NodeResizer drag, as xyflow batches it: the moved corner (left/top) and the size. */
function resizeStep(
  result: { current: ReturnType<typeof useBoardController> },
  id: string,
  rect: { x: number; y: number; w: number; h: number },
) {
  act(() =>
    result.current.onNodesChange([
      { type: 'position', id, position: { x: rect.x, y: rect.y } },
      {
        type: 'dimensions',
        id,
        resizing: true,
        setAttributes: true,
        dimensions: { width: rect.w, height: rect.h },
      },
    ]),
  );
}

const MEMBER = cardRow('note', { node_id: 'cn_a', x: 40, y: 60, group_id: 'cn_g' });
const positionOf = (result: { current: ReturnType<typeof useBoardController> }, id: string) =>
  result.current.nodes.find((n) => n.id === id)?.position;
const settle = () => new Promise((done) => setTimeout(done, 600)); // past the 400 ms nudge debounce

afterEach(cleanup);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.patchNode.mockImplementation(async (_b, id, body) =>
    cardRow('note', { node_id: id, version: body.version + 1 }),
  );
  api.createNode.mockImplementation(async (_p, body) => ({
    board: BOARD,
    node: cardRow(body.kind, { ...body, title: body.title ?? null, body: '' }),
  }));
});

describe('frames on the board (#214)', () => {
  it('Add frame centres an empty frame on the view when that is clear, its name ready to type', async () => {
    const { result } = await mount([cardRow('note', { node_id: 'cn_n', x: 2000, y: 0 })]);
    await act(async () => {
      await result.current.addFrame({ x: 500, y: 400 });
    });
    expect(api.createNode).toHaveBeenCalledTimes(1);
    const body = api.createNode.mock.calls[0]![1];
    expect(body).toMatchObject({ kind: 'group', x: 300, y: 250, w: 400, h: 300 });
    expect(body.title).toBe('New frame');
    expect(result.current.editingId).toBe(body.node_id);
    expect(api.patchNode).not.toHaveBeenCalled();
  });

  it('Add frame never lands on a card: it takes the clear spot nearest the view’s middle', async () => {
    // The note (300–560 × 100–280) lies under the centred spot (300–700 × 250–550).
    const { result } = await mount([cardRow('note', { node_id: 'cn_n', x: 300, y: 100 })]);
    await act(async () => {
      await result.current.addFrame({ x: 500, y: 400 });
    });
    const body = api.createNode.mock.calls[0]![1];
    // Two 32-unit steps down clears the note by the 32-unit gap: the nearest free spot.
    expect(body).toMatchObject({ kind: 'group', x: 300, y: 314, w: 400, h: 300 });
    // Empty: the note beside it was not taken in, and nothing else was written.
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

  it('a keyboard nudge of a frame saves the cards it carried, one PATCH per node for the run', async () => {
    const { result } = await mount([FRAME, MEMBER]);
    // Three arrow presses: xyflow sends a position change with `dragging: false` for each.
    for (const x of [10, 20, 30]) {
      act(() =>
        result.current.onNodesChange([
          { type: 'position', id: 'cn_g', position: { x, y: 0 }, dragging: false },
        ]),
      );
    }
    expect(positionOf(result, 'cn_a')).toEqual({ x: 70, y: 60 });
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_g', { version: 1, x: 30, y: 0 });
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_a', { version: 1, x: 70, y: 60 });
    await settle();
    expect(api.patchNode).toHaveBeenCalledTimes(2);
  });

  it('resizing from the top-left corner leaves the cards where they are and saves once, at the end', async () => {
    const { result } = await mount([FRAME, MEMBER]);
    resizeStep(result, 'cn_g', { x: -50, y: -25, w: 450, h: 325 });
    resizeStep(result, 'cn_g', { x: -100, y: -50, w: 500, h: 350 });
    expect(positionOf(result, 'cn_g')).toEqual({ x: -100, y: -50 });
    expect(positionOf(result, 'cn_a')).toEqual({ x: 40, y: 60 });
    // A long resize sends nothing while it lasts (no nudge flush mid-gesture).
    await settle();
    expect(api.patchNode).not.toHaveBeenCalled();
    act(() => result.current.commitSize('cn_g', { x: -100, y: -50, w: 500, h: 350 }));
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_g', {
      version: 1,
      x: -100,
      y: -50,
      w: 500,
      h: 350,
    });
    await settle();
    expect(api.patchNode).toHaveBeenCalledTimes(1);
    expect(positionOf(result, 'cn_a')).toEqual({ x: 40, y: 60 });
  });

  it('shrinking a frame from its left edge past a card’s centre lets the card go', async () => {
    const { result } = await mount([FRAME, MEMBER]); // the note's centre is at x = 40 + 130 = 170
    resizeStep(result, 'cn_g', { x: 200, y: 0, w: 200, h: 300 });
    expect(positionOf(result, 'cn_a')).toEqual({ x: 40, y: 60 });
    act(() => result.current.commitSize('cn_g', { x: 200, y: 0, w: 200, h: 300 }));
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(2));
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_a', { version: 1, group_id: null });
    expect(result.current.nodes.find((n) => n.id === 'cn_a')?.data.node.group_id).toBeNull();
  });

  it('a bottom-right resize (a size change alone) carries nothing and saves nothing until its end', async () => {
    const { result } = await mount([FRAME, MEMBER]);
    act(() =>
      result.current.onNodesChange([
        {
          type: 'dimensions',
          id: 'cn_g',
          resizing: true,
          setAttributes: true,
          dimensions: { width: 600, height: 400 },
        },
      ]),
    );
    await settle();
    expect(api.patchNode).not.toHaveBeenCalled();
    expect(positionOf(result, 'cn_a')).toEqual({ x: 40, y: 60 });
  });
});
