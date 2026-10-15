/**
 * W2UI #141 (S7 should-fixes): Undo after a delete restores the card AND its links with the same
 * ids; the Undo offer goes after 8 s; the stale-version notice names the card and clears itself.
 * `boardsApi` is the only stub.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STALE_NOTICE_MS,
  UNDO_VISIBLE_MS,
  staleSubject,
  useBoardController,
} from '@/components/canvas/useBoardController';
import { cardName } from '@/components/canvas/model';
import { boardsApi } from '@/lib/api/boards';
import { ApiError, type Board, type CanvasEdge, type CanvasNode } from '@/lib/api/types';

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
const BOARD: Board = { board_id: 'brd_1', paper_id: 'ppr_1', title: 'Canvas', viewport: null, created_at: '', updated_at: '' };
const ANCHOR = { id: 'anc_1', doc: { paperId: 'ppr_1' }, selectors: [] } as never;

function node(id: string, extra: Partial<CanvasNode> = {}): CanvasNode {
  return {
    node_id: id, board_id: 'brd_1', kind: 'note', group_id: null, x: 0, y: 0, w: 260, h: 150, z: 0,
    title: null, body: 'b', source_anchor: null, source_message_id: null, version: 1,
    created_at: '', updated_at: '', ...extra,
  };
}
function edge(id: string, from: string, to: string): CanvasEdge {
  return { edge_id: id, board_id: 'brd_1', from_node_id: from, to_node_id: to, kind: 'supports', label: 'because' };
}

async function mount(nodes: CanvasNode[], edges: CanvasEdge[] = []) {
  api.get.mockResolvedValue({ board: BOARD, nodes, edges });
  const hook = renderHook(() => useBoardController('ppr_1'));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return hook;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.patchNode.mockImplementation(async (_b, id, body) => node(id, { version: body.version + 1 }));
  api.deleteNode.mockResolvedValue(undefined);
  api.deleteEdge.mockResolvedValue(undefined);
  api.createNode.mockImplementation(async (_p, body) => ({
    board: BOARD,
    node: node(body.node_id, { kind: body.kind, body: body.body ?? '', title: body.title ?? null, x: body.x, y: body.y, w: body.w, h: body.h }),
  }));
  api.createEdge.mockImplementation(async (_b, body) => edge(body.edge_id, body.from_node_id, body.to_node_id));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Undo after a delete', () => {
  it('offers Undo, and Undo re-POSTs the card and its link with the SAME ids', async () => {
    const passage = node('cn_a', {
      kind: 'excerpt', body: 'A long passage the reader selected', source_anchor: ANCHOR, x: 40, y: 50, w: 300, h: 200,
    });
    const { result } = await mount([passage, node('cn_b', { x: 500 })], [edge('ce_ab', 'cn_a', 'cn_b')]);

    act(() => result.current.deleteSelection(['cn_a'], []));
    expect(result.current.nodes.map((n) => n.id)).toEqual(['cn_b']);
    expect(result.current.edges).toHaveLength(0);
    expect(result.current.undo?.message).toBe('Deleted “A long passage the reader selected”.');
    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledWith('brd_1', 'cn_a'));

    await act(async () => {
      await result.current.runUndo();
    });

    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect(api.createNode.mock.calls[0]![0]).toBe('ppr_1');
    expect(api.createNode.mock.calls[0]![1]).toMatchObject({
      node_id: 'cn_a', kind: 'excerpt', x: 40, y: 50, w: 300, h: 200,
      body: 'A long passage the reader selected', source_anchor: ANCHOR,
    });
    expect(api.createEdge).toHaveBeenCalledWith('brd_1', {
      edge_id: 'ce_ab', from_node_id: 'cn_a', to_node_id: 'cn_b', kind: 'supports', label: 'because',
    });
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(['cn_a', 'cn_b']);
    expect(result.current.edges.map((e) => e.id)).toEqual(['ce_ab']);
    expect(result.current.undo).toBeNull();
  });

  it('a link deleted on its own is restored with its id', async () => {
    const { result } = await mount([node('cn_a'), node('cn_b')], [edge('ce_ab', 'cn_a', 'cn_b')]);
    act(() => result.current.deleteSelection([], ['ce_ab']));
    expect(result.current.undo?.message).toBe('Deleted a link.');
    await act(async () => {
      await result.current.runUndo();
    });
    expect(api.deleteEdge).toHaveBeenCalledWith('brd_1', 'ce_ab');
    expect(api.createEdge).toHaveBeenCalledWith('brd_1', expect.objectContaining({ edge_id: 'ce_ab' }));
    expect(api.createNode).not.toHaveBeenCalled();
  });

  it('restoring a deleted group puts its members back in it', async () => {
    const { result } = await mount([
      node('cn_g', { kind: 'group', title: 'Group' }),
      node('cn_a', { group_id: 'cn_g' }),
    ]);
    api.get.mockResolvedValue({ board: BOARD, nodes: [node('cn_a', { version: 3 })], edges: [] });
    act(() => result.current.deleteNodes(['cn_g']));
    await act(async () => {
      await result.current.runUndo();
    });
    expect(api.createNode.mock.calls[0]![1]).toMatchObject({ node_id: 'cn_g', kind: 'group' });
    // The member's version comes from a fresh read: the server's trigger ungrouped it.
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_a', { version: 3, group_id: 'cn_g' }));
    expect(result.current.nodes.find((n) => n.id === 'cn_a')?.data.node.group_id).toBe('cn_g');
  });

  it('the offer goes after 8 seconds and then cannot be run', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = await mount([node('cn_a')]);
    act(() => result.current.deleteSelection(['cn_a'], []));
    expect(result.current.undo).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_VISIBLE_MS - 100);
    });
    expect(result.current.undo).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.undo).toBeNull();
    await act(async () => {
      await result.current.runUndo();
    });
    expect(api.createNode).not.toHaveBeenCalled();
  });

  it('a failed restore is a sentence, and the board is reloaded', async () => {
    const { result } = await mount([node('cn_a')]);
    act(() => result.current.deleteSelection(['cn_a'], []));
    api.createNode.mockRejectedValueOnce(new ApiError(0, 'internal', 'offline', true));
    await act(async () => {
      await result.current.runUndo();
    });
    await waitFor(() => expect(result.current.notice).toMatch(/bring that back/i));
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});

describe('the stale-version notice', () => {
  it('names the card', async () => {
    const { result } = await mount([node('cn_a', { body: 'Residual blocks are the whole idea' })]);
    api.patchNode.mockRejectedValueOnce(new ApiError(409, 'stale_version', 'stale', false));
    // A drag-end (a position change) leaves the words alone, so the name is the card's own words.
    act(() => {
      result.current.onNodesChange([{ type: 'position', id: 'cn_a', position: { x: 90, y: 5 }, dragging: true }]);
      result.current.onNodeDragStop();
    });
    await waitFor(() =>
      expect(result.current.notice).toBe(
        'The card “Residual blocks are the whole idea” was changed somewhere else. The latest version is shown.',
      ),
    );
  });

  it('clears itself after 8 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = await mount([node('cn_a')]);
    api.patchNode.mockRejectedValueOnce(new ApiError(409, 'stale_version', 'stale', false));
    act(() => result.current.commitBody('cn_a', 'mine'));
    await waitFor(() => expect(result.current.notice).toMatch(/changed somewhere else/));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_NOTICE_MS + 100);
    });
    expect(result.current.notice).toBeNull();
  });

  it('clears after the next successful action', async () => {
    const { result } = await mount([node('cn_a'), node('cn_b')]);
    api.patchNode.mockRejectedValueOnce(new ApiError(409, 'stale_version', 'stale', false));
    act(() => result.current.commitBody('cn_a', 'mine'));
    await waitFor(() => expect(result.current.notice).toMatch(/changed somewhere else/));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    act(() => result.current.commitBody('cn_b', 'fine'));
    await waitFor(() => expect(result.current.notice).toBeNull());
  });

  it('other errors are left until dismissed', async () => {
    const { result } = await mount([node('cn_a')]);
    api.patchNode.mockRejectedValueOnce(new ApiError(500, 'internal', 'boom', true));
    act(() => result.current.commitBody('cn_a', 'mine'));
    await waitFor(() => expect(result.current.notice).toMatch(/Couldn't save/));
  });

  it('cardName and staleSubject read as sentences', () => {
    expect(cardName(node('x', { body: '' }))).toBe('an empty note');
    expect(cardName(node('x', { title: 'T', body: 'ignored' }))).toBe('“T”');
    expect(cardName(node('x', { body: 'w'.repeat(60) }))).toBe(`“${'w'.repeat(40)}…”`);
    expect(staleSubject('an empty note')).toBe('An empty note');
    expect(staleSubject(undefined)).toBe('A card');
  });
});
