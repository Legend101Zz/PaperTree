/**
 * #215: undo and redo through the real controller, `boardsApi` the only stub. A drag (many move
 * events) is one step, a frame and the cards it carries are one step, every step replays through
 * the same requests with the version held when it runs, a 409 on undo reloads and says so and the
 * steps about that card are forgotten, and the delete toast's Undo is the stack's own step.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';
import { ApiError, type Board, type CanvasEdge, type CanvasNode } from '@/lib/api/types';

import { cardRow, citation } from '../model/test-data';
import { useBoardController } from './useBoardController';

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
type Ctl = { current: ReturnType<typeof useBoardController> };

const EDGE: CanvasEdge = {
  edge_id: 'ce_1',
  board_id: 'brd_1',
  from_node_id: 'cn_a',
  to_node_id: 'cn_b',
  kind: 'supports',
  label: null,
  from_port: 'claim_out',
  to_port: 'evidence_in',
  created_at: '',
};

async function mount(nodes: CanvasNode[], edges: CanvasEdge[] = []) {
  api.get.mockResolvedValue({ board: BOARD, nodes, edges });
  const hook = renderHook(() => useBoardController('ppr_1'));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return hook;
}

/** A drag of `id` through `steps` move events to (x, y), ended the way xyflow ends one. */
function drag(result: Ctl, id: string, x: number, y: number, steps = 20) {
  act(() => {
    for (let i = 1; i <= steps; i += 1) {
      const at = { x: (x * i) / steps, y: (y * i) / steps };
      result.current.onNodesChange([{ type: 'position', id, position: at, dragging: true }]);
    }
    result.current.onNodesChange([{ type: 'position', id, position: { x, y }, dragging: false }]);
    result.current.onNodeDragStop();
  });
}

const undo = (result: Ctl) => act(() => result.current.history.undo());
const redo = (result: Ctl) => act(() => result.current.history.redo());
const at = (result: Ctl, id: string) => result.current.nodes.find((n) => n.id === id)?.position;

afterEach(cleanup);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.patchNode.mockImplementation(async (_b, id, body) =>
    cardRow('note', { node_id: id, version: body.version + 1 }),
  );
  api.deleteNode.mockResolvedValue(undefined);
  api.deleteEdge.mockResolvedValue(undefined);
  api.patchEdge.mockImplementation(async (_b, id, body) => ({ ...EDGE, edge_id: id, ...body }));
  api.createEdge.mockImplementation(async (_b, body) => ({ ...EDGE, ...body }) as CanvasEdge);
  api.createNode.mockImplementation(async (_p, body) => ({
    board: BOARD,
    node: cardRow(body.kind, { ...body, title: body.title ?? null, body: body.body ?? '' }),
  }));
});

describe('undo and redo on the board (#215)', () => {
  it('a drag of twenty moves is one step, undone and redone with the version held then', async () => {
    const { result } = await mount([cardRow('note', { node_id: 'cn_b', body: 'b', x: 10 })]);
    drag(result, 'cn_b', 300, 120);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    expect(result.current.history.undoName).toBe('move of “b”');

    await undo(result);
    expect(at(result, 'cn_b')).toEqual({ x: 10, y: 0 });
    expect(api.patchNode).toHaveBeenLastCalledWith('brd_1', 'cn_b', { version: 2, x: 10, y: 0 });
    expect(result.current.history).toMatchObject({ undoName: null, redoName: 'move of “b”' });

    await redo(result);
    expect(at(result, 'cn_b')).toEqual({ x: 300, y: 120 });
    expect(api.patchNode).toHaveBeenLastCalledWith('brd_1', 'cn_b', { version: 3, x: 300, y: 120 });
    expect(api.patchNode).toHaveBeenCalledTimes(3);
    expect(result.current.history.undoName).toBe('move of “b”');
  });

  it('a frame and the cards it carries are one step, and undo puts them all back', async () => {
    const frame = cardRow('group', { node_id: 'cn_g', w: 400, h: 300, title: 'Why' });
    const member = cardRow('note', { node_id: 'cn_a', x: 40, y: 60, group_id: 'cn_g' });
    const { result } = await mount([frame, member]);
    drag(result, 'cn_g', 100, 50);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(2));
    expect(result.current.history.undoName).toBe('move of a card and a frame');

    await undo(result);
    expect(at(result, 'cn_g')).toEqual({ x: 0, y: 0 });
    expect(at(result, 'cn_a')).toEqual({ x: 40, y: 60 });
    const sent = api.patchNode.mock.calls.slice(2).map((c) => [c[1], c[2]]);
    expect(sent).toEqual([
      ['cn_g', { version: 2, x: 0, y: 0 }],
      ['cn_a', { version: 2, x: 40, y: 60 }],
    ]);
    expect(result.current.history.undoName).toBeNull();
  });

  it('a card dropped into a frame comes out of it again on undo', async () => {
    const frame = cardRow('group', { node_id: 'cn_g', w: 400, h: 300, title: 'Why' });
    const { result } = await mount([frame, cardRow('note', { node_id: 'cn_a', x: 900 })]);
    drag(result, 'cn_a', 40, 40);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    await undo(result);
    expect(api.patchNode).toHaveBeenLastCalledWith('brd_1', 'cn_a', {
      version: 2,
      x: 900,
      y: 0,
      group_id: null,
    });
    expect(result.current.nodes.find((n) => n.id === 'cn_a')?.data.node.group_id).toBeNull();
  });

  it('a 409 on undo reloads, says so, and forgets the steps about that card', async () => {
    const { result } = await mount([
      cardRow('note', { node_id: 'cn_b', body: 'b' }),
      cardRow('note', { node_id: 'cn_c', body: 'c', x: 600 }),
    ]);
    drag(result, 'cn_c', 600, 300);
    drag(result, 'cn_b', 200, 100);
    act(() => result.current.commitBody('cn_b', 'changed'));
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(3));
    // The edit undoes; the move under it was changed in another tab meanwhile.
    await undo(result);
    api.patchNode.mockRejectedValueOnce(new ApiError(409, 'stale_version', 'stale', false));
    await undo(result);
    await waitFor(() =>
      expect(result.current.notice).toBe(
        "Couldn't undo move of “b”. The card “b” was changed somewhere else. The latest version is shown.",
      ),
    );
    expect(api.get).toHaveBeenCalledTimes(2);
    // The redo of the edit was about that card too: both are gone; the other card's step stays.
    expect(result.current.history).toMatchObject({
      undoName: 'move of “c”',
      redoName: null,
    });
  });

  it('a delete comes back with its id, words and anchor; redo deletes it again', async () => {
    const anchor = citation('b1', 0, 1).anchor;
    const passage = cardRow('excerpt', {
      node_id: 'cn_a',
      body: 'Attention is all you need.',
      source_anchor: anchor,
      x: 40,
      y: 50,
    });
    const { result } = await mount([passage, cardRow('note', { node_id: 'cn_b' })], [EDGE]);
    act(() => result.current.deleteSelection(['cn_a'], []));
    expect(result.current.history.undoName).toBe('delete of “Attention is all you need.”');
    // The toast's Undo is that step.
    await act(() => result.current.runUndo());
    expect(api.createNode.mock.calls[0]![1]).toMatchObject({
      node_id: 'cn_a',
      kind: 'excerpt',
      body: 'Attention is all you need.',
      source_anchor: anchor,
      x: 40,
      y: 50,
    });
    expect(api.createEdge).toHaveBeenCalledWith(
      'brd_1',
      expect.objectContaining({ edge_id: 'ce_1' }),
    );
    expect(result.current.history.redoName).toBe('delete of “Attention is all you need.”');

    await redo(result);
    expect(api.deleteNode).toHaveBeenLastCalledWith('brd_1', 'cn_a');
    expect(result.current.nodes.map((n) => n.id)).toEqual(['cn_b']);
    expect(result.current.edges).toHaveLength(0);
  });

  it('a new thread is undone by deleting it, and redone with the same id and pins', async () => {
    const { result } = await mount([
      cardRow('note', { node_id: 'cn_a' }),
      cardRow('note', { node_id: 'cn_b' }),
    ]);
    await act(async () => {
      await result.current.connect('cn_a', 'cn_b', 'supports', null, {
        from_port: 'claim_out',
        to_port: 'evidence_in',
      });
    });
    const id = api.createEdge.mock.calls[0]![1].edge_id;
    expect(result.current.history.undoName).toBe('new thread “supports”');
    await undo(result);
    expect(api.deleteEdge).toHaveBeenCalledWith('brd_1', id);
    expect(result.current.edges).toHaveLength(0);
    await redo(result);
    expect(api.createEdge).toHaveBeenLastCalledWith('brd_1', {
      edge_id: id,
      from_node_id: 'cn_a',
      to_node_id: 'cn_b',
      kind: 'supports',
      label: null,
      from_port: 'claim_out',
      to_port: 'evidence_in',
    });
    expect(result.current.edges.map((e) => e.id)).toEqual([id]);
  });

  it('a change of kind is undone to the old kind', async () => {
    const { result } = await mount(
      [cardRow('note', { node_id: 'cn_a' }), cardRow('note', { node_id: 'cn_b' })],
      [EDGE],
    );
    act(() => result.current.patchEdge('ce_1', { kind: 'contradicts' }));
    expect(result.current.history.undoName).toBe('change to “contradicts”');
    // The undo reads the thread first: the server has it as the step left it.
    api.get.mockResolvedValue({
      board: BOARD,
      nodes: [cardRow('note', { node_id: 'cn_a' }), cardRow('note', { node_id: 'cn_b' })],
      edges: [{ ...EDGE, kind: 'contradicts' }],
    });
    await undo(result);
    expect(api.patchEdge).toHaveBeenLastCalledWith('brd_1', 'ce_1', { kind: 'supports' });
    expect(result.current.edges[0]?.data?.edge.kind).toBe('supports');
  });

  it('a new note is taken away and brought back with the same id; an edit is one step', async () => {
    const { result } = await mount([]);
    await act(() => result.current.addNote({ x: 0, y: 0 }));
    const id = api.createNode.mock.calls[0]![1].node_id;
    act(() => result.current.commitBody(id, 'Read 3.2 next.'));
    expect(result.current.history.undoName).toBe('edit of an empty note');
    await undo(result);
    expect(api.patchNode).toHaveBeenLastCalledWith('brd_1', id, { version: 2, body: '' });
    expect(result.current.history.undoName).toBe('new note');
    await undo(result);
    expect(api.deleteNode).toHaveBeenCalledWith('brd_1', id);
    await redo(result);
    expect(api.createNode).toHaveBeenLastCalledWith(
      'ppr_1',
      expect.objectContaining({ node_id: id }),
    );
    expect(result.current.nodes.map((n) => n.id)).toEqual([id]);
  });

  it('a resize and the cards the frame takes in are one step', async () => {
    const frame = cardRow('group', { node_id: 'cn_g', w: 400, h: 300, title: 'Why' });
    const { result } = await mount([frame, cardRow('note', { node_id: 'cn_a', x: 500, y: 0 })]);
    act(() => result.current.commitSize('cn_g', { x: 0, y: 0, w: 900, h: 300 }));
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(2));
    expect(result.current.history.undoName).toBe('resize of “Why”');
    await undo(result);
    const back = api.patchNode.mock.calls.slice(2).map((c) => [c[1], c[2]]);
    expect(back).toEqual([
      ['cn_g', { version: 2, x: 0, y: 0, w: 400, h: 300 }],
      ['cn_a', { version: 2, group_id: null }],
    ]);
    expect(result.current.nodes.find((n) => n.id === 'cn_g')?.width).toBe(400);
  });
});
