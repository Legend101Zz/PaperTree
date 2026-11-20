/**
 * An image root on the board (v0.3 #348, item 5): asks and span branches work on it exactly as on a
 * passage card, through the same board ask path (`POST .../nodes/{id}/asks`); the server sends the
 * root's crop on every ask down that tree, so nothing about the request differs and the web adds
 * no field. Through the real controller and tree hooks, `boardsApi` the only stub.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';
import { threadsApi } from '@/lib/api/threads';

import { hostOf } from '../../../../test/branch-harness';
import { askAnchorFixture } from '../model/imageFixtures';
import { node, resetClock, spanOf, type NodeSpec } from '../model/treeFixtures';
import { useBoardController } from './useBoardController';
import { useBranchBoard } from './useBranchBoard';

import type { Board, CanvasNode, SseEvent } from '@/lib/api/types';

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => ({ setViewport: vi.fn(() => Promise.resolve(true)), getZoom: () => 1 }),
}));
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
    ask: vi.fn(),
    keepNote: vi.fn(),
    tidy: vi.fn(),
  },
}));
vi.mock('@/lib/api/threads', () => ({ threadsApi: { cancelRun: vi.fn() } }));

const api = vi.mocked(boardsApi);
const BOARD = { board_id: 'brd_1', paper_id: 'ppr_1', title: 'Board', viewport: null } as Board;
const ANSWER = 'The 56-layer net trains worse, which is the degradation problem.';
const SPAN = spanOf(ANSWER, 'degradation problem');

function rows(): CanvasNode[] {
  return [
    {
      ...node({ id: 'img', x: 40, y: 60, body: 'Figure 1. Training error (left) and test error.' }),
      source_anchor: askAnchorFixture(0),
    },
    node({
      id: 'a',
      parent: 'img',
      branch: 'right',
      question: 'Why is it worse?',
      finalText: ANSWER,
    }),
  ];
}

async function mount() {
  api.get.mockResolvedValue({ board: BOARD, nodes: rows(), edges: [] });
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: 800 });
  Object.defineProperty(el, 'clientWidth', { value: 1000 });
  const hook = renderHook(
    () => {
      const ctl = useBoardController('ppr_1');
      const branch = useBranchBoard('ppr_1', ctl, { current: el }, hostOf());
      return { ctl, branch };
    },
    { wrapper: ReactFlowProvider },
  );
  await waitFor(() => expect(hook.result.current.ctl.status).toBe('ready'));
  return hook;
}

async function* stream(events: unknown[]): AsyncGenerator<SseEvent> {
  for (const e of events) yield e as SseEvent;
}

const frames = (id: string, parent: string, over: Partial<NodeSpec> = {}): unknown[] => [
  { event: 'node', data: node({ id, parent, branch: 'right', ...over }) },
  { event: 'text', data: { delta: 'It is a shortcut.' } },
  { event: 'done', data: { status: 'complete', error: null, message_id: 'm' } },
];

beforeEach(() => {
  resetClock();
  for (const fn of Object.values(api)) fn.mockReset();
  window.localStorage.clear();
  window.history.pushState({}, '', '/paper/ppr_1/board');
  vi.mocked(threadsApi.cancelRun).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('an image root is a tree root like a passage', () => {
  it('is a root with no parent, and its answer is its child', async () => {
    const { result } = await mount();
    const { tree } = result.current.branch.view;
    expect(tree.roots.map((r) => r.node_id)).toEqual(['img']);
    expect(tree.children.get('img')?.map((n) => n.node_id)).toEqual(['a']);
  });

  it('an ask from the picture goes through the board ask path with the same body as for a passage', async () => {
    api.ask.mockImplementation(() =>
      stream(frames('b', 'img', { question: 'What is the dashed line?' })),
    );
    const { result } = await mount();
    act(() => result.current.branch.control.openAsk('img'));
    act(() => result.current.branch.control.setText('What is the dashed line?'));
    const draft = result.current.branch.view.draft!;
    await act(() => result.current.branch.ask.send(draft));
    expect(api.ask).toHaveBeenCalledTimes(1);
    const [board, parent, body] = api.ask.mock.calls[0]!;
    expect([board, parent]).toEqual(['brd_1', 'img']);
    expect(body).toEqual({
      question: 'What is the dashed line?',
      uses: { path: true, paper: 'page', level: 'familiar', diagram: 'may', extra_node_ids: [] },
      level: 'familiar',
    });
    // The web sends no crop and no picture field: the server attaches the root's crop itself.
    expect(JSON.stringify(body)).not.toMatch(/crop|image|data_base64/);
    await waitFor(() => expect(result.current.ctl.nodes.some((n) => n.id === 'b')).toBe(true));
  });

  it('a span branch from the answer on a picture is the same call as on a passage', async () => {
    api.ask.mockImplementation(() => stream(frames('c', 'a', { span: SPAN })));
    const { result } = await mount();
    await act(() => result.current.branch.ask.quick('a', SPAN, 'simpler'));
    const [, parent, body] = api.ask.mock.calls[0]!;
    expect(parent).toBe('a');
    expect(body).toMatchObject({ span: SPAN, quick: 'simpler' });
  });
});
