/**
 * When a Delete is sent (#214 review, e2e/s7/canvas-keyboard's flake): at once, never on the 400 ms
 * debounce that arrow-key moves use, and never held behind another card's move still in flight;
 * only a move of the SAME card that is still on the wire goes first, so the server never sees that
 * card's PATCH after its DELETE. `boardsApi` is the only stub.
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
const NOTES = [
  cardRow('note', { node_id: 'cn_a', x: 0, y: 0 }),
  cardRow('note', { node_id: 'cn_b', x: 400, y: 0 }),
];

/** The PATCHes that have not been answered yet, by card. */
let answer: Map<string, (row: CanvasNode) => void>;

async function mount() {
  api.get.mockResolvedValue({ board: BOARD, nodes: NOTES, edges: [] });
  const hook = renderHook(() => useBoardController('ppr_1'));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return hook;
}

/** One arrow-key nudge of `id`, then the debounce flush that sends its PATCH. */
async function nudge(result: { current: ReturnType<typeof useBoardController> }, id: string) {
  act(() =>
    result.current.onNodesChange([
      { type: 'position', id, position: { x: 20, y: 0 }, dragging: false },
    ]),
  );
  await waitFor(() => expect(answer.has(id)).toBe(true), { timeout: 2000 });
}

afterEach(cleanup);
beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  answer = new Map();
  api.patchNode.mockImplementation(
    (_b, id) => new Promise<CanvasNode>((done) => answer.set(id, done)),
  );
  api.deleteNode.mockResolvedValue(undefined);
});

describe('a Delete goes out at once', () => {
  it('is sent without any debounce', async () => {
    const { result } = await mount();
    act(() => result.current.deleteSelection(['cn_a'], []));
    // Microtasks only: no timer has to run for the DELETE to start.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.deleteNode).toHaveBeenCalledWith('brd_1', 'cn_a');
  });

  it('is not held behind another card’s move that is still in flight', async () => {
    const { result } = await mount();
    await nudge(result, 'cn_b'); // B's PATCH is on the wire and never answered here
    act(() => result.current.deleteSelection(['cn_a'], []));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.deleteNode).toHaveBeenCalledWith('brd_1', 'cn_a');
  });

  it('waits only for the same card’s move on the wire, then deletes it', async () => {
    const { result } = await mount();
    await nudge(result, 'cn_a');
    act(() => result.current.deleteSelection(['cn_a'], []));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.deleteNode).not.toHaveBeenCalled(); // A's PATCH must land first
    await act(async () => {
      answer.get('cn_a')!(cardRow('note', { node_id: 'cn_a', x: 20, version: 2 }));
    });
    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledWith('brd_1', 'cn_a'));
    expect(result.current.nodes.map((n) => n.id)).toEqual(['cn_b']);
  });
});
