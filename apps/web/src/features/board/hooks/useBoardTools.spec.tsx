/**
 * #214 review S2: what each board tool does with the selection, through `useBoardTools` itself:
 * Thread links the cards in the order they were picked (or walks from one, or puts a drawn thread
 * away), Frame selected cards frames the cards only, Remove frame is on only for a frame and removes
 * only the frame, Delete passes the nodes and the links, Add frame is centred on the view. The last
 * test runs Remove frame (v0.1's Ungroup) through the real controller, `boardsApi` stubbed.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';

import { toFlowNode } from '../model/flow';
import { cardRow } from '../model/test-data';
import { useBoardController, type BoardController } from './useBoardController';
import { useBoardTools, type BoardToolsInput } from './useBoardTools';

import type { BoardSelection } from './useBoardSelection';
import type { LinkAs } from './useLinkAs';
import type { ThreadDrawing } from './useThreadDrawing';
import type { BoardToolbarProps } from '../components/BoardToolbar';
import type { Board } from '@/lib/api/types';

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

afterEach(cleanup);

const ROWS = [
  cardRow('group', { node_id: 'cn_g', x: 0, y: 0, w: 600, h: 400, title: 'Why' }),
  cardRow('note', { node_id: 'cn_a', x: 40, y: 60, group_id: 'cn_g' }),
  cardRow('note', { node_id: 'cn_b', x: 900, y: 0 }),
];

function stubs() {
  const ctl = {
    status: 'ready',
    nodes: ROWS.map((r) => toFlowNode(r, 'ppr_1')),
    addNote: vi.fn(async () => undefined),
    addFrame: vi.fn(async () => undefined),
    groupNodes: vi.fn(async () => undefined),
    deleteNodes: vi.fn(),
    deleteSelection: vi.fn(),
  };
  const drawing = { linking: null as unknown, cancel: vi.fn(), link: vi.fn() };
  const link = { keyboard: { start: vi.fn() } };
  return { ctl, drawing, link };
}

type Stubs = ReturnType<typeof stubs>;

function tools(s: Stubs, nodes: string[], edges: string[] = []): BoardToolbarProps {
  const stage = {
    current: {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
    },
  } as unknown as BoardToolsInput['stage'];
  const input: BoardToolsInput = {
    ctl: s.ctl as unknown as BoardController,
    selection: { nodes, edges } satisfies BoardSelection,
    drawing: s.drawing as unknown as ThreadDrawing,
    link: s.link as unknown as LinkAs,
    stage,
    areaMode: false,
    setAreaMode: vi.fn(),
    fitOptions: {},
  };
  return renderHook(() => useBoardTools(input), { wrapper: ReactFlowProvider }).result.current;
}

const more = (t: BoardToolbarProps, label: string) => t.more.find((m) => m.label === label)!;

describe('useBoardTools: what each tool does with the selection', () => {
  it('Thread with two cards links them first-picked to second-picked, either way round', () => {
    const s = stubs();
    tools(s, ['cn_b', 'cn_a']).thread.run();
    expect(s.drawing.link).toHaveBeenCalledWith('cn_b', 'cn_a');
    tools(s, ['cn_a', 'cn_b']).thread.run();
    expect(s.drawing.link).toHaveBeenLastCalledWith('cn_a', 'cn_b');
    expect(s.link.keyboard.start).not.toHaveBeenCalled();
  });

  it('Thread with one card (a frame beside it does not count) walks from that card', () => {
    const s = stubs();
    const t = tools(s, ['cn_g', 'cn_b']);
    expect(t.thread.action).toBe('walk');
    t.thread.run();
    expect(s.link.keyboard.start).toHaveBeenCalledWith('cn_b');
    expect(s.drawing.link).not.toHaveBeenCalled();
  });

  it('Thread while a thread is drawn puts it away, and is pressed', () => {
    const s = stubs();
    s.drawing.linking = { from: 'cn_a' };
    const t = tools(s, ['cn_a', 'cn_b']);
    expect(t.thread.pressed).toBe(true);
    t.thread.run();
    expect(s.drawing.cancel).toHaveBeenCalledTimes(1);
    expect(s.drawing.link).not.toHaveBeenCalled();
  });

  it('Remove frame is off unless a frame is selected', () => {
    const s = stubs();
    expect(more(tools(s, []), 'Remove frame').enabled).toBe(false);
    expect(more(tools(s, ['cn_a', 'cn_b']), 'Remove frame').enabled).toBe(false);
    expect(more(tools(s, ['cn_g']), 'Remove frame').enabled).toBe(true);
  });

  it('Remove frame removes only the frame, never the cards selected with it', () => {
    const s = stubs();
    more(tools(s, ['cn_a', 'cn_g', 'cn_b']), 'Remove frame').run();
    expect(s.ctl.deleteNodes).toHaveBeenCalledTimes(1);
    expect(s.ctl.deleteNodes).toHaveBeenCalledWith(['cn_g']);
    expect(s.ctl.deleteSelection).not.toHaveBeenCalled();
  });

  it('Frame selected cards frames the cards only, and needs two', () => {
    const s = stubs();
    expect(more(tools(s, ['cn_g', 'cn_a']), 'Frame selected cards').enabled).toBe(false);
    more(tools(s, ['cn_g', 'cn_a', 'cn_b']), 'Frame selected cards').run();
    expect(s.ctl.groupNodes).toHaveBeenCalledWith(['cn_a', 'cn_b']);
  });

  it('Delete passes every selected node and link, and is off with nothing selected', () => {
    const s = stubs();
    expect(more(tools(s, []), 'Delete').enabled).toBe(false);
    more(tools(s, ['cn_g', 'cn_a'], ['ce_1']), 'Delete').run();
    expect(s.ctl.deleteSelection).toHaveBeenCalledWith(['cn_g', 'cn_a'], ['ce_1']);
  });

  it('Add frame asks for a frame at the middle of the view', () => {
    const s = stubs();
    tools(s, []).addFrame.run();
    // No board is mounted, so xyflow's screen-to-board mapping is the identity.
    expect(s.ctl.addFrame).toHaveBeenCalledWith({ x: 500, y: 350 });
  });
});

describe('Remove frame (v0.1’s Ungroup) through the controller', () => {
  const api = vi.mocked(boardsApi);
  const BOARD = { board_id: 'brd_1', paper_id: 'ppr_1', title: 'Board', viewport: null } as Board;

  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.get.mockResolvedValue({ board: BOARD, nodes: ROWS, edges: [] });
    api.deleteNode.mockResolvedValue(undefined);
    api.createNode.mockImplementation(async (_p, body) => ({
      board: BOARD,
      node: cardRow(body.kind, { ...body, title: body.title ?? null, body: body.body ?? '' }),
    }));
    api.patchNode.mockImplementation(async (_b, id, body) =>
      cardRow('note', { node_id: id, version: body.version + 1, group_id: 'cn_g' }),
    );
  });

  it('removes the frame alone, keeps its cards (now in no frame), and Undo puts both back', async () => {
    const s = stubs();
    const { result } = renderHook(
      () => {
        const ctl = useBoardController('ppr_1');
        const input: BoardToolsInput = {
          ctl,
          // The frame and both cards are selected: only the frame goes.
          selection: { nodes: ['cn_a', 'cn_g', 'cn_b'], edges: [] },
          drawing: s.drawing as unknown as ThreadDrawing,
          link: s.link as unknown as LinkAs,
          stage: { current: null },
          areaMode: false,
          setAreaMode: vi.fn(),
          fitOptions: {},
        };
        return { ctl, tools: useBoardTools(input) };
      },
      { wrapper: ReactFlowProvider },
    );
    await waitFor(() => expect(result.current.ctl.status).toBe('ready'));
    act(() => more(result.current.tools, 'Remove frame').run());
    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledTimes(1));
    expect(api.deleteNode).toHaveBeenCalledWith('brd_1', 'cn_g');
    const node = (id: string) => result.current.ctl.nodes.find((n) => n.id === id);
    expect(node('cn_g')).toBeUndefined();
    expect(node('cn_a')?.data.node.group_id).toBeNull();
    expect(node('cn_b')).toBeDefined();

    await act(async () => {
      await result.current.ctl.runUndo();
    });
    expect(api.createNode).toHaveBeenCalledWith(
      'ppr_1',
      expect.objectContaining({ node_id: 'cn_g', kind: 'group', title: 'Why' }),
    );
    await waitFor(() =>
      expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'cn_a', {
        version: 1,
        group_id: 'cn_g',
      }),
    );
    expect(node('cn_a')?.data.node.group_id).toBe('cn_g');
    expect(api.deleteNode).toHaveBeenCalledTimes(1);
  });
});
