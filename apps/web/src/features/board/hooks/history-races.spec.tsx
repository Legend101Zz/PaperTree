/**
 * #215 review: undo and redo when writes race or another tab changes the board, through the real
 * controller with `boardsApi` stubbed (the reviewer's probes, now as the rules). The Undo toast
 * takes back its own step or nothing, and a deleted card stays restorable while it shows (S1); a
 * reload keeps the versions held for cards with steps (S2); a thread step reads the thread first
 * (S3) and one thread write waits for the last (S4); a gesture made while a replay saves is
 * recorded after it (S5); a thread whose card is gone and a card deleted elsewhere say so (N1, N2).
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';
import { ApiError, type Board, type CanvasEdge, type CanvasNode } from '@/lib/api/types';

import { cardRow } from '../model/test-data';
import { NOT_NEWEST, useBoardController } from './useBoardController';
import { useBoardHistory, type HistoryHooks } from './useBoardHistory';

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
const STALE = () => new ApiError(409, 'stale_version', 'stale', false);
const note = (id: string, extra: Partial<CanvasNode> = {}) =>
  cardRow('note', { node_id: id, body: id.slice(3), ...extra });

async function mount(nodes: CanvasNode[], edges: CanvasEdge[] = []) {
  api.get.mockResolvedValue({ board: BOARD, nodes, edges });
  const hook = renderHook(() => useBoardController('ppr_1'));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return hook;
}

function drag(result: Ctl, id: string, x: number, y: number) {
  act(() => {
    result.current.onNodesChange([{ type: 'position', id, position: { x, y }, dragging: true }]);
    result.current.onNodesChange([{ type: 'position', id, position: { x, y }, dragging: false }]);
    result.current.onNodeDragStop();
  });
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** The next PATCH of a card waits until `release` (or `refuse`) is called. */
function holdNextPatch() {
  const held = { release: () => undefined, refuse: (_e: unknown) => undefined } as {
    release: () => void;
    refuse: (e: unknown) => void;
  };
  api.patchNode.mockImplementationOnce(
    (_b, id, body) =>
      new Promise((resolve, reject) => {
        held.release = () => resolve(note(id, { version: body.version + 1 }));
        held.refuse = reject;
      }),
  );
  return held;
}

afterEach(cleanup);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.patchNode.mockImplementation(async (_b, id, body) => note(id, { version: body.version + 1 }));
  api.deleteNode.mockResolvedValue(undefined);
  api.deleteEdge.mockResolvedValue(undefined);
  api.patchEdge.mockImplementation(async (_b, id, body) => ({ ...EDGE, edge_id: id, ...body }));
  api.createEdge.mockImplementation(async (_b, body) => ({ ...EDGE, ...body }) as CanvasEdge);
  api.createNode.mockImplementation(async (_p, body) => ({
    board: BOARD,
    node: cardRow(body.kind, { ...body, title: body.title ?? null, body: body.body ?? '' }),
  }));
});

describe('the Undo toast takes back its own step (review S1)', () => {
  it('a member’s 409 leaves the frame’s delete on top, and the toast brings the frame back', async () => {
    const frame = cardRow('group', { node_id: 'cn_g', w: 400, h: 300, title: 'Why' });
    const member = note('cn_m', { x: 40, y: 60, group_id: 'cn_g' });
    const { result } = await mount([frame, member, note('cn_n', { x: 900 })]);
    act(() => result.current.commitBody('cn_n', 'n2'));
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    const move = holdNextPatch();
    drag(result, 'cn_m', 60, 80);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(2));
    act(() => result.current.deleteNodes(['cn_g']));
    expect(result.current.undo?.message).toBe('Deleted “Why”.');
    await act(async () => {
      move.refuse(STALE());
      await flush();
    });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(result.current.history.undoName).toBe('delete of “Why”');
    await act(() => result.current.runUndo());
    expect(api.createNode.mock.calls[0]![1]).toMatchObject({ node_id: 'cn_g', kind: 'group' });
    // The unrelated edit was not taken back, and the conflicting member was not rejoined.
    expect(api.patchNode.mock.calls.map((c) => c[1])).toEqual(['cn_n', 'cn_m']);
  });

  it('a card deleted right after a move that 409s stays restorable from its toast', async () => {
    const { result } = await mount([note('cn_a'), note('cn_n', { x: 900 })]);
    const move = holdNextPatch();
    drag(result, 'cn_a', 60, 80);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    act(() => result.current.deleteNodes(['cn_a']));
    await act(async () => {
      move.refuse(STALE());
      await flush();
    });
    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledWith('brd_1', 'cn_a'));
    // The reload raced the DELETE: the card is not shown again.
    expect(result.current.nodes.map((n) => n.id)).toEqual(['cn_n']);
    expect(result.current.history.undoName).toBe('delete of “a”');
    expect(result.current.undo?.message).toBe('Deleted “a”.');
    await act(() => result.current.runUndo());
    expect(api.createNode).toHaveBeenCalledWith(
      'ppr_1',
      expect.objectContaining({ node_id: 'cn_a' }),
    );
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(['cn_a', 'cn_n']);
  });

  it('during a nudge’s debounce the toast brings the card back and leaves the nudge alone', async () => {
    const { result } = await mount([note('cn_a'), note('cn_b', { x: 600 })]);
    act(() => result.current.deleteSelection(['cn_a'], []));
    act(() =>
      result.current.onNodesChange([
        { type: 'position', id: 'cn_b', position: { x: 620, y: 0 }, dragging: false },
      ]),
    );
    await act(() => result.current.runUndo());
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect(api.patchNode).not.toHaveBeenCalled();
    // The nudge is still sent, after its debounce, and is the newest step.
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(api.patchNode).toHaveBeenLastCalledWith('brd_1', 'cn_b', { version: 1, x: 620, y: 0 });
    expect(result.current.history.undoName).toBe('move of “b”');
  });

  it('a keyed step that is not the newest is never taken back, and nothing is replayed', async () => {
    const io = {
      patchCards: vi.fn(async () => true),
      patchThread: vi.fn(async () => true),
      restore: vi.fn(async () => true),
      remove: vi.fn(async () => true),
    };
    const hooks = { current: { before: vi.fn(), io: () => io } satisfies HistoryHooks };
    const { result } = renderHook(() => useBoardHistory(hooks));
    const rows = { nodes: [note('cn_a')], edges: [], members: [] };
    act(() => result.current.record({ type: 'remove', label: 'delete', key: 'toast-1', ...rows }));
    act(() => result.current.record({ type: 'patch', label: 'move of b', cards: [] }));
    let got: boolean | null = true;
    await act(async () => {
      got = await result.current.undoIf('toast-1');
    });
    expect(got).toBeNull();
    expect(io.restore).not.toHaveBeenCalled();
    expect(io.patchCards).not.toHaveBeenCalled();
    expect(result.current.view.undoName).toBe('move of b');
    expect(NOT_NEWEST).toMatch(/^That was not undone/);
  });
});

describe('a reload keeps the versions held for cards with steps (review S2)', () => {
  it('an undo of a card another tab moved answers 409 instead of overwriting it', async () => {
    const { result } = await mount([note('cn_a'), note('cn_b', { x: 600 })]);
    drag(result, 'cn_a', 100, 0);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    // Another tab moved a to 300 (version 3) and edited b.
    api.get.mockResolvedValue({
      board: BOARD,
      nodes: [
        note('cn_a', { x: 300, version: 3 }),
        note('cn_b', { x: 600, version: 2, body: 'b2' }),
      ],
      edges: [],
    });
    api.patchNode.mockRejectedValueOnce(STALE());
    drag(result, 'cn_b', 700, 0);
    await waitFor(() => expect(result.current.nodes[0]?.position).toEqual({ x: 300, y: 0 }));
    api.patchNode.mockRejectedValueOnce(STALE());
    await act(() => result.current.history.undo());
    // The version held after this tab's own move, not the 3 the reload read.
    expect(api.patchNode).toHaveBeenLastCalledWith('brd_1', 'cn_a', { version: 2, x: 0, y: 0 });
    await waitFor(() =>
      expect(result.current.notice).toBe(
        "Couldn't undo move of “a”. The card “a” was changed somewhere else. The latest version is shown.",
      ),
    );
    expect(result.current.history.undoName).toBeNull();
  });
});

describe('thread steps (review S3, S4)', () => {
  const cards = () => [note('cn_a'), note('cn_b', { x: 300 })];

  it('an undo of a thread another tab changed is refused, with the latest shown', async () => {
    const { result } = await mount(cards(), [EDGE]);
    act(() => result.current.patchEdge('ce_1', { kind: 'contradicts' }));
    await waitFor(() => expect(api.patchEdge).toHaveBeenCalledTimes(1));
    api.get.mockResolvedValue({
      board: BOARD,
      nodes: cards(),
      edges: [{ ...EDGE, kind: 'derives_from' }],
    });
    await act(() => result.current.history.undo());
    expect(api.patchEdge).toHaveBeenCalledTimes(1);
    expect(result.current.notice).toBe(
      "Couldn't undo change to “contradicts”. The thread was changed somewhere else. The latest version is shown.",
    );
    expect(result.current.edges[0]?.data?.edge.kind).toBe('derives_from');
    expect(result.current.history).toMatchObject({ undoName: null, redoName: null });
  });

  it('the undo of a re-kind waits for the re-kind to be saved before it reads and sends', async () => {
    const { result } = await mount(cards(), [EDGE]);
    const held: (() => void)[] = [];
    api.patchEdge.mockImplementation(
      (_b, id, body) =>
        new Promise((resolve) =>
          held.push(() => resolve({ ...EDGE, edge_id: id, ...body } as CanvasEdge)),
        ),
    );
    act(() => result.current.patchEdge('ce_1', { kind: 'contradicts' }));
    api.get.mockResolvedValue({
      board: BOARD,
      nodes: cards(),
      edges: [{ ...EDGE, kind: 'contradicts' }],
    });
    let undone!: Promise<void>;
    await act(async () => {
      undone = result.current.history.undo();
      await flush();
    });
    expect(api.patchEdge).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      held[0]!();
      await flush();
    });
    await waitFor(() => expect(api.patchEdge).toHaveBeenCalledTimes(2));
    expect(api.patchEdge.mock.calls.map((c) => c[2])).toEqual([
      { kind: 'contradicts' },
      { kind: 'supports' },
    ]);
    await act(async () => {
      held[1]!();
      await undone;
    });
    expect(result.current.edges[0]?.data?.edge.kind).toBe('supports');
  });
});

describe('a gesture made while a replay saves (review S5)', () => {
  it('during a redo, the new move is recorded after the redone one', async () => {
    const { result } = await mount([note('cn_a'), note('cn_b', { x: 600 })]);
    drag(result, 'cn_a', 100, 0);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    await act(() => result.current.history.undo());
    const redo = holdNextPatch();
    let redone!: Promise<void>;
    await act(async () => {
      redone = result.current.history.redo();
      await flush();
    });
    drag(result, 'cn_b', 700, 0);
    await act(async () => {
      redo.release();
      await redone;
    });
    expect(result.current.history.undoName).toBe('move of “b”');
    await act(() => result.current.history.undo());
    expect(api.patchNode).toHaveBeenLastCalledWith('brd_1', 'cn_b', { version: 2, x: 600, y: 0 });
    expect(result.current.history.undoName).toBe('move of “a”');
  });

  it('during an undo, the new move clears the redo for good', async () => {
    const { result } = await mount([note('cn_a'), note('cn_b', { x: 600 })]);
    drag(result, 'cn_a', 100, 0);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    const undo = holdNextPatch();
    let undone!: Promise<void>;
    await act(async () => {
      undone = result.current.history.undo();
      await flush();
    });
    drag(result, 'cn_b', 700, 0);
    await act(async () => {
      undo.release();
      await undone;
    });
    expect(result.current.history).toMatchObject({ undoName: 'move of “b”', redoName: null });
  });
});

describe('what an undo says when its row is gone (review N1, N2)', () => {
  it('a thread whose card was deleted elsewhere is not brought back, and the board says why', async () => {
    const { result } = await mount(
      [note('cn_a'), note('cn_b', { x: 300 }), note('cn_c', { x: 600 })],
      [EDGE],
    );
    act(() => result.current.deleteEdges(['ce_1']));
    api.get.mockResolvedValue({
      board: BOARD,
      nodes: [note('cn_a'), note('cn_c', { x: 600, version: 2 })],
      edges: [],
    });
    api.patchNode.mockRejectedValueOnce(STALE());
    drag(result, 'cn_c', 700, 0);
    await waitFor(() => expect(result.current.notice).toMatch(/changed somewhere else/));
    await act(() => result.current.history.undo());
    expect(api.createEdge).not.toHaveBeenCalled();
    expect(result.current.notice).toBe(
      "Couldn't undo delete of a thread. A card that thread joined is no longer on the board.",
    );
    expect(result.current.history.redoName).toBeNull();
  });

  it('an undo of a move of a card deleted elsewhere says the card is gone, in the board’s words', async () => {
    const { result } = await mount([note('cn_a')]);
    drag(result, 'cn_a', 100, 0);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    api.patchNode.mockRejectedValueOnce(
      new ApiError(404, 'not_found', 'no such node on this board', false),
    );
    await act(() => result.current.history.undo());
    await waitFor(() =>
      expect(result.current.notice).toBe(
        "Couldn't undo move of “a”. That card is no longer on the board.",
      ),
    );
  });
});
