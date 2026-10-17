/**
 * #215: undo and redo as a person reaches them — Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z and Ctrl+Y on the
 * board, the toolbar's Undo and Redo named by the step they take back, and no history key while a
 * text field (or the Link-as picker) has it. The real controller, toolbar and key hook; `boardsApi`
 * is the only stub, and the gestures arrive as xyflow hands them to the controller.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';

import { useBoardController } from '../hooks/useBoardController';
import { historyTool } from '../hooks/useBoardTools';
import { useUndoKeys } from '../hooks/useUndoKeys';
import { threadTool } from '../model/chrome';
import { cardRow, citation } from '../model/test-data';
import { BoardToolbar } from './BoardToolbar';

import type { Board, CanvasEdge } from '@/lib/api/types';

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
const PASSAGE = cardRow('excerpt', {
  node_id: 'cn_a',
  body: 'Attention is all you need.',
  source_anchor: citation('b1', 0, 1).anchor,
});
const NOTE = cardRow('note', { node_id: 'cn_b', body: 'Read 3.2 next.', x: 600 });

let ctl: ReturnType<typeof useBoardController>;
const off = { label: 'x', run: () => undefined };

/** The board's history as the page wires it: the controller, the key hook, the toolbar. */
function Board() {
  ctl = useBoardController('ppr_1');
  useUndoKeys(ctl.history);
  return (
    <>
      <BoardToolbar
        select={off}
        addNote={off}
        addFrame={off}
        thread={{ ...threadTool(0, false), pressed: false, run: () => undefined }}
        fitAll={off}
        undo={historyTool('Undo', ctl.history)}
        redo={historyTool('Redo', ctl.history)}
        zoom={() => undefined}
        more={[]}
      />
      <textarea aria-label="Note text" />
      <div className="nokey">
        <button type="button">supports</button>
      </div>
    </>
  );
}

async function mount() {
  render(
    <ReactFlowProvider>
      <Board />
    </ReactFlowProvider>,
  );
  await waitFor(() => expect(ctl.status).toBe('ready'));
}

const key = async (init: KeyboardEventInit, target: Element = document.body) => {
  await act(async () => {
    fireEvent.keyDown(target, init);
    await Promise.resolve();
  });
};
const UNDO = { key: 'z', metaKey: true };
const REDO = { key: 'Z', metaKey: true, shiftKey: true };

function dragNote(x: number) {
  act(() => {
    ctl.onNodesChange([{ type: 'position', id: 'cn_b', position: { x, y: 0 }, dragging: true }]);
    ctl.onNodesChange([{ type: 'position', id: 'cn_b', position: { x, y: 0 }, dragging: false }]);
    ctl.onNodeDragStop();
  });
}

afterEach(cleanup);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockResolvedValue({ board: BOARD, nodes: [PASSAGE, NOTE], edges: [EDGE] });
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

describe('undo and redo by keyboard and from the toolbar (#215)', () => {
  it('names the buttons by the step they take back, and they run it', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-disabled')).toBe('true');
    dragNote(900);
    const undo = screen.getByRole('button', { name: 'Undo move of “Read 3.2 next.”' });
    expect(undo.getAttribute('aria-keyshortcuts')).toBe('Meta+Z Control+Z');
    expect(undo.title).toBe('Undo move of “Read 3.2 next.” (Cmd/Ctrl+Z)');
    await act(async () => fireEvent.click(undo));
    await waitFor(() =>
      expect(api.patchNode).toHaveBeenLastCalledWith('brd_1', 'cn_b', { version: 2, x: 600, y: 0 }),
    );
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-disabled')).toBe('true');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Redo move of “Read 3.2 next.”' })),
    );
    await waitFor(() =>
      expect(api.patchNode).toHaveBeenLastCalledWith('brd_1', 'cn_b', { version: 3, x: 900, y: 0 }),
    );
  });

  it('Cmd+Z takes a move back, Shift+Cmd+Z and Ctrl+Y bring it again', async () => {
    await mount();
    dragNote(900);
    await key(UNDO);
    await waitFor(() => expect(ctl.nodes.find((n) => n.id === 'cn_b')?.position.x).toBe(600));
    await key(REDO);
    await waitFor(() => expect(ctl.nodes.find((n) => n.id === 'cn_b')?.position.x).toBe(900));
    await key({ key: 'z', ctrlKey: true });
    await waitFor(() => expect(ctl.history.redoName).not.toBeNull());
    await key({ key: 'y', ctrlKey: true });
    await waitFor(() => expect(ctl.nodes.find((n) => n.id === 'cn_b')?.position.x).toBe(900));
    expect(api.patchNode).toHaveBeenCalledTimes(5);
  });

  it('Ctrl+Z takes a new thread away and Ctrl+Shift+Z draws it again', async () => {
    api.get.mockResolvedValue({ board: BOARD, nodes: [PASSAGE, NOTE], edges: [] });
    await mount();
    await act(async () => {
      await ctl.connect('cn_b', 'cn_a', 'supports', null, {
        from_port: 'claim_out',
        to_port: 'evidence_in',
      });
    });
    expect(screen.getByRole('button', { name: 'Undo new thread “supports”' })).toBeTruthy();
    await key({ key: 'z', ctrlKey: true });
    await waitFor(() => expect(ctl.edges).toHaveLength(0));
    expect(api.deleteEdge).toHaveBeenCalledTimes(1);
    await key({ key: 'Z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(ctl.edges).toHaveLength(1));
    expect(api.createEdge).toHaveBeenCalledTimes(2);
  });

  it('Cmd+Z brings a deleted passage back with its words and anchor, and its thread', async () => {
    await mount();
    act(() => ctl.deleteSelection(['cn_a'], []));
    expect(screen.getByRole('button', { name: 'Undo delete of “Attention is all you need.”' }));
    await key(UNDO);
    await waitFor(() => expect(ctl.edges.map((e) => e.id)).toEqual(['ce_1']));
    const back = ctl.nodes.find((n) => n.id === 'cn_a')?.data.node;
    expect(back?.body).toBe('Attention is all you need.');
    expect(back?.source_anchor).toEqual(PASSAGE.source_anchor);
  });

  it('Cmd+Z puts a thread’s old kind back', async () => {
    await mount();
    act(() => ctl.patchEdge('ce_1', { kind: 'contradicts' }));
    expect(screen.getByRole('button', { name: 'Undo change to “contradicts”' })).toBeTruthy();
    api.get.mockResolvedValue({
      board: BOARD,
      nodes: [PASSAGE, NOTE],
      edges: [{ ...EDGE, kind: 'contradicts' }],
    });
    await key(UNDO);
    await waitFor(() => expect(ctl.edges[0]?.data?.edge.kind).toBe('supports'));
    expect(api.patchEdge).toHaveBeenLastCalledWith('brd_1', 'ce_1', { kind: 'supports' });
  });

  it('never undoes while a text field or the picker has the key', async () => {
    await mount();
    dragNote(900);
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    const text = screen.getByRole('textbox', { name: 'Note text' });
    text.focus();
    await key(UNDO, text);
    await key({ key: 'y', ctrlKey: true }, text);
    await key(UNDO, screen.getByRole('button', { name: 'supports' }));
    expect(api.patchNode).toHaveBeenCalledTimes(1);
    expect(ctl.history.undoName).toBe('move of “Read 3.2 next.”');
  });
});
