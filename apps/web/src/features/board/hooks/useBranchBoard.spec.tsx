/**
 * The branching board through the real controller and the real tree hooks, `boardsApi` the only
 * stub (v03-BOARD-SPEC section 3): a drag moves a whole branch and saves ONE offset, Tidy is one
 * request per tree, Fold makes the pill, Keep as note makes a note and no ask, the Uses pickers
 * reach the ask's body, a follow-up goes down and every other ask goes right, a path focus dims,
 * Escape backs out one level, and `?card=` centres the card and its ask box.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';
import { threadsApi } from '@/lib/api/threads';

import { DRAFT_ID } from '../model/display';
import { CARD_WIDTH, COLUMN_GAP, DOWN_GAP } from '../model/layout';
import { node, resetClock, spanOf } from '../model/treeFixtures';
import { useBoardController } from './useBoardController';
import { useBranchBoard } from './useBranchBoard';

import type { Board, CanvasNode, SseEvent } from '@/lib/api/types';

const flowStub = vi.hoisted(() => ({
  setViewport: vi.fn(
    (_view: { x: number; y: number; zoom: number }, _options?: { duration: number }) =>
      Promise.resolve(true),
  ),
  getZoom: vi.fn(() => 1),
}));

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => flowStub,
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
const TEXT = 'An identity mapping adds no extra parameters, so the block can do nothing.';
const SPAN = spanOf(TEXT, 'identity mapping');

/** A passage, the answer to its right, the answer's follow-up below and a note kept from words. */
function tree(): CanvasNode[] {
  return [
    node({ id: 'p', x: 40, y: 60, body: 'Residual learning.' }),
    node({ id: 'a', parent: 'p', branch: 'right', question: 'why?', finalText: TEXT }),
    node({ id: 'b', parent: 'a', branch: 'down', question: 'so?', finalText: 'Yes.' }),
    node({
      id: 'n',
      kind: 'note',
      parent: 'a',
      branch: 'right',
      span: SPAN,
      body: 'identity mapping',
    }),
  ];
}

function stageEl(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: 800 });
  Object.defineProperty(el, 'clientWidth', { value: 1000 });
  return el;
}

async function mount(rows: CanvasNode[]) {
  api.get.mockResolvedValue({ board: BOARD, nodes: rows, edges: [] });
  const stage = { current: stageEl() };
  const hook = renderHook(
    () => {
      const ctl = useBoardController('ppr_1');
      const branch = useBranchBoard('ppr_1', ctl, stage);
      return { ctl, branch };
    },
    { wrapper: ReactFlowProvider },
  );
  await waitFor(() => expect(hook.result.current.ctl.status).toBe('ready'));
  return hook;
}

/** Every card reports a height, as its ResizeObserver does. */
function measure(
  result: { current: { branch: ReturnType<typeof useBranchBoard> } },
  ids: string[],
  h = 120,
) {
  act(() => ids.forEach((id) => result.current.branch.view.reports.height(id, h)));
}

const card = (result: { current: { branch: ReturnType<typeof useBranchBoard> } }, id: string) =>
  result.current.branch.view.layout.cards.get(id)!;

async function* stream(events: unknown[]): AsyncGenerator<SseEvent> {
  for (const e of events) yield e as SseEvent;
}

beforeEach(() => {
  resetClock();
  for (const fn of Object.values(api)) fn.mockReset();
  flowStub.setViewport.mockClear();
  window.localStorage.clear();
  window.history.pushState({}, '', '/paper/ppr_1/board');
  api.patchNode.mockImplementation(async (_b, id, body) => ({
    ...node({ id, kind: 'note' }),
    version: body.version + 1,
  }));
  api.tidy.mockResolvedValue({});
  vi.mocked(threadsApi.cancelRun).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('dragging a card moves its whole branch', () => {
  it('saves one offset on the dragged card; the cards under it follow from the layout', async () => {
    const { result } = await mount(tree());
    measure(result, ['p', 'a', 'b', 'n']);
    const was = {
      a: { ...card(result, 'a') },
      b: { ...card(result, 'b') },
      n: { ...card(result, 'n') },
    };

    act(() => {
      const { ctl, branch } = result.current;
      branch.view.onNodesChange(
        [
          {
            type: 'position',
            id: 'a',
            position: { x: was.a.x + 100, y: was.a.y + 50 },
            dragging: true,
          },
        ],
        ctl.onNodesChange,
      );
    });
    // Mid-drag: the follow-up and the note already moved with it, and nothing was sent yet.
    expect(card(result, 'b')).toMatchObject({ x: was.b.x + 100, y: was.b.y + 50 });
    expect(card(result, 'n')).toMatchObject({ x: was.n.x + 100, y: was.n.y + 50 });
    expect(api.patchNode).not.toHaveBeenCalled();

    act(() => result.current.branch.view.onDragStop());
    await waitFor(() => expect(api.patchNode).toHaveBeenCalledTimes(1));
    expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'a', {
      version: 1,
      offset_x: 100,
      offset_y: 50,
    });
    expect(result.current.ctl.history.undoName).toContain('move of');
  });
});

describe('Tidy', () => {
  it('is one request per tree that has an offset, and clears the offsets', async () => {
    const rows = tree();
    rows[1] = node({
      id: 'a',
      parent: 'p',
      branch: 'right',
      finalText: TEXT,
      offset: { x: 90, y: 40 },
    });
    const { result } = await mount(rows);
    measure(result, ['p', 'a', 'b', 'n']);
    // The server clears the offsets; the board reads itself again for the new versions.
    api.tidy.mockImplementation(async () => {
      api.get.mockResolvedValue({ board: BOARD, nodes: tree(), edges: [] });
      return {};
    });

    await act(() => result.current.branch.ask.tidy());
    expect(api.tidy).toHaveBeenCalledTimes(1);
    expect(api.tidy).toHaveBeenCalledWith('brd_1', 'p');
    const cleared = result.current.ctl.nodes.find((n) => n.id === 'a')!.data.node;
    expect(cleared).toMatchObject({ offset_x: 0, offset_y: 0 });
  });

  it('sends nothing when every branch is already where the board puts it', async () => {
    const { result } = await mount(tree());
    await act(() => result.current.branch.ask.tidy());
    expect(api.tidy).not.toHaveBeenCalled();
  });
});

describe('Fold', () => {
  it('folds a branch into a pill that counts its answers and notes, saved as folded', async () => {
    const { result } = await mount(tree());
    measure(result, ['p', 'a', 'b', 'n']);
    act(() => result.current.branch.ask.fold('a', true));
    await waitFor(() =>
      expect(api.patchNode).toHaveBeenCalledWith('brd_1', 'a', { version: 1, folded: true }),
    );
    expect(card(result, 'a').pill?.label).toBe('2 answers · 1 note');
    expect(result.current.branch.view.layout.hidden.has('b')).toBe(true);
    expect(result.current.branch.view.nodes.find((n) => n.id === 'n')?.hidden).toBe(true);

    act(() => result.current.branch.ask.fold('a', false));
    expect(card(result, 'a').pill).toBeNull();
  });
});

describe('Keep as note', () => {
  it('calls the notes endpoint with the words and never asks the AI', async () => {
    api.keepNote.mockResolvedValue(
      node({ id: 'n2', kind: 'note', parent: 'a', branch: 'right', span: SPAN, body: SPAN.quote }),
    );
    const { result } = await mount(tree());
    await act(() => result.current.branch.ask.keepNote('a', SPAN));
    expect(api.keepNote).toHaveBeenCalledWith('brd_1', 'a', {
      span: SPAN,
      text: 'identity mapping',
    });
    expect(api.ask).not.toHaveBeenCalled();
    expect(result.current.ctl.nodes.some((n) => n.id === 'n2')).toBe(true);
    expect(result.current.branch.control.ui.focusId).toBe('n2');
  });
});

describe('asking from the Uses line', () => {
  it('sends what the pickers chose, and the level sticks for the board', async () => {
    api.ask.mockImplementation(() =>
      stream([
        {
          event: 'node',
          data: {
            node: node({
              id: 'new',
              parent: 'a',
              branch: 'right',
              span: SPAN,
              question: 'what is it?',
            }),
          },
        },
        {
          event: 'run',
          data: {
            run_id: 'run_1',
            thread_id: 't',
            user_message_id: null,
            message_id: 'm',
            generation: 1,
          },
        },
        { event: 'text', data: { delta: 'It is ' } },
        { event: 'text', data: { delta: 'a shortcut.' } },
        { event: 'done', data: { status: 'complete', error: null, message_id: 'm' } },
      ]),
    );
    const { result } = await mount(tree());
    act(() => result.current.branch.control.openAsk('a', { span: SPAN }));
    act(() =>
      result.current.branch.control.setUses({ paper: 'off', level: 'new', diagram: 'never' }),
    );
    act(() => result.current.branch.control.setText('what is it?'));
    const draft = result.current.branch.view.draft!;
    expect(draft.uses).toMatchObject({ paper: 'off', level: 'new', diagram: 'never', path: true });

    await act(() => result.current.branch.ask.send(draft));
    expect(api.ask).toHaveBeenCalledTimes(1);
    const [board, parent, body] = api.ask.mock.calls[0]!;
    expect([board, parent]).toEqual(['brd_1', 'a']);
    expect(body).toEqual({
      question: 'what is it?',
      span: SPAN,
      uses: { path: true, paper: 'off', level: 'new', diagram: 'never', extra_node_ids: [] },
      level: 'new',
    });
    // The card exists from the `node` frame, its words arrive, and the box is gone.
    await waitFor(() =>
      expect(result.current.branch.ask.streams.get('new')?.status).toBe('complete'),
    );
    expect(result.current.branch.ask.streams.get('new')?.text).toBe('It is a shortcut.');
    expect(result.current.ctl.nodes.find((n) => n.id === 'new')?.data.node.final_text).toBe(
      'It is a shortcut.',
    );
    expect(result.current.branch.control.ui.draft).toBeNull();
    expect(window.localStorage.getItem('papertree.board.brd_1.level')).toBe('new');
  });

  it('a quick ask sends its own words and no typed question', async () => {
    api.ask.mockImplementation(() => stream([]));
    const { result } = await mount(tree());
    await act(() => result.current.branch.ask.quick('a', SPAN, 'diagram'));
    expect(api.ask.mock.calls[0]![2]).toMatchObject({
      question: 'Draw this as a small diagram.',
      quick: 'diagram',
      span: SPAN,
      uses: { diagram: 'always' },
    });
  });

  it('a refusal before the stream is a sentence, and the box stays open with what was typed', async () => {
    api.ask.mockImplementation(() => {
      throw new Error('budget');
    });
    const { result } = await mount(tree());
    act(() => result.current.branch.control.openAsk('a'));
    act(() => result.current.branch.control.setText('again?'));
    await act(() => result.current.branch.ask.send(result.current.branch.view.draft!));
    expect(result.current.ctl.notice).not.toBeNull();
    expect(result.current.branch.control.ui.draft?.text).toBe('again?');
  });

  it('Stop cancels the run and keeps what arrived', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    api.ask.mockImplementation(async function* () {
      yield {
        event: 'node',
        data: { node: node({ id: 'new', parent: 'a', branch: 'right' }) },
      } as unknown as SseEvent;
      yield {
        event: 'run',
        data: {
          run_id: 'run_9',
          thread_id: 't',
          user_message_id: null,
          message_id: 'm',
          generation: 1,
        },
      } as SseEvent;
      yield { event: 'text', data: { delta: 'Half an ans' } } as SseEvent;
      await gate;
    });
    const { result } = await mount(tree());
    act(() => result.current.branch.control.openAsk('a'));
    act(() => result.current.branch.control.setText('why?'));
    // Not inside `act`: the stream stays open until the test lets it go.
    void result.current.branch.ask.send(result.current.branch.view.draft!);
    await waitFor(() =>
      expect(result.current.branch.ask.streams.get('new')?.text).toBe('Half an ans'),
    );
    act(() => result.current.branch.ask.stop('new'));
    expect(threadsApi.cancelRun).toHaveBeenCalledWith('run_9');
    expect(result.current.branch.ask.streams.get('new')).toMatchObject({
      status: 'stopped',
      text: 'Half an ans',
    });
    release();
  });
});

describe('down or right (rule 3)', () => {
  it('a follow-up on an answer with no next turn goes below it', async () => {
    const { result } = await mount(tree());
    measure(result, ['p', 'a', 'b', 'n']);
    act(() => result.current.branch.control.focus('b'));
    const stub = result.current.branch.view.draft!;
    expect(stub).toMatchObject({ parentId: 'b', expanded: false, askDifferently: false });
    measure(result, [DRAFT_ID], 40);
    expect(card(result, DRAFT_ID)).toMatchObject({ x: card(result, 'b').x });
    expect(card(result, DRAFT_ID).y).toBe(card(result, 'b').y + card(result, 'b').h + DOWN_GAP);
  });

  it('words, "Ask differently" and any ask on a passage go to the right', async () => {
    const { result } = await mount(tree());
    measure(result, ['p', 'a', 'b', 'n']);
    act(() => result.current.branch.control.openAsk('b', { span: spanOf('Yes.', 'Yes') }));
    measure(result, [DRAFT_ID], 100);
    expect(card(result, DRAFT_ID).x).toBe(card(result, 'b').x + card(result, 'b').w + COLUMN_GAP);

    act(() => result.current.branch.control.openAsk('b', { askDifferently: true }));
    expect(card(result, DRAFT_ID).x).toBeGreaterThan(card(result, 'b').x + card(result, 'b').w);

    act(() => result.current.branch.control.openAsk('p'));
    expect(card(result, DRAFT_ID).x).toBe(40 + CARD_WIDTH.passage + COLUMN_GAP);
  });

  it('a card that already has a next turn shows no follow-up stub', async () => {
    const { result } = await mount(tree());
    act(() => result.current.branch.control.focus('a'));
    expect(result.current.branch.view.draft).toBeNull();
  });
});

describe('path focus', () => {
  it('dims the cards off the focused path and lights the way down to it', async () => {
    const { result } = await mount(tree());
    act(() => result.current.branch.control.focus('b'));
    const cls = (id: string) =>
      result.current.branch.view.nodes.find((n) => n.id === id)?.className ?? '';
    expect(cls('n')).toContain('pt-tn--dim');
    expect(cls('a')).not.toContain('pt-tn--dim');
    expect(cls('p')).not.toContain('pt-tn--dim');
    expect([...result.current.branch.onPath!].sort()).toEqual(['a', 'b', 'p']);
  });
});

describe('Escape', () => {
  it('closes one level per press: picker, span menu, ask box, path focus', async () => {
    const { result } = await mount(tree());
    const c = () => result.current.branch.control;
    act(() => c().openAsk('a', { span: SPAN }));
    act(() => c().pick('paper'));
    act(() => c().openMenu({ cardId: 'a', span: SPAN, anchor: { x: 0, y: 0, w: 1, h: 1 } }));
    const open = () => {
      const { picker, menu, draft, focusId } = c().ui;
      return [picker && 'picker', menu && 'menu', draft && 'draft', focusId && 'focus'].filter(
        Boolean,
      );
    };
    expect(open()).toEqual(['picker', 'menu', 'draft', 'focus']);
    const presses: unknown[][] = [];
    for (let i = 0; i < 5; i += 1) {
      let used = false;
      act(() => {
        used = c().escape();
      });
      presses.push([used, ...open()]);
    }
    expect(presses).toEqual([
      [true, 'menu', 'draft', 'focus'],
      [true, 'draft', 'focus'],
      [true, 'focus'],
      [true],
      [false],
    ]);
  });

  it('a real Escape key press does the same, and leaves a key nothing used alone', async () => {
    const { result } = await mount(tree());
    act(() => result.current.branch.control.openAsk('a'));
    const press = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
        bubbles: true,
      });
      act(() => void window.dispatchEvent(event));
      return event.defaultPrevented;
    };
    expect(press()).toBe(true); // the ask box
    expect(result.current.branch.control.ui.draft).toBeNull();
    expect(press()).toBe(true); // the path focus
    expect(press()).toBe(false); // nothing left: the page may use it
  });
});

describe('arriving from Send to board (#342)', () => {
  const MIDDLE = 500;

  it('opens the ask box under the card and centres the pair, then glows the card once', async () => {
    window.history.pushState({}, '', '/paper/ppr_1/board?card=p');
    const { result } = await mount([node({ id: 'p', x: 100, y: 100, body: 'Residual learning.' })]);
    measure(result, ['p'], 200);
    await waitFor(() => expect(result.current.branch.control.ui.draft?.parentId).toBe('p'));
    measure(result, [DRAFT_ID], 120);
    await waitFor(() => expect(flowStub.setViewport).toHaveBeenCalledTimes(1));

    const view = (
      flowStub.setViewport.mock.calls[0] as unknown as [{ x: number; y: number; zoom: number }]
    )[0];
    const p = card(result, 'p');
    const box = card(result, DRAFT_ID);
    // The pair's middle is the pane's middle.
    const left = Math.min(p.x, box.x);
    const right = Math.max(p.x + p.w, box.x + box.w);
    const top = Math.min(p.y, box.y);
    const bottom = Math.max(p.y + p.h, box.y + box.h);
    expect(view.x + ((left + right) / 2) * view.zoom).toBeCloseTo(MIDDLE, 0);
    expect(view.y + ((top + bottom) / 2) * view.zoom).toBeCloseTo(400, 0);
    expect(result.current.branch.view.nodes.find((n) => n.id === 'p')?.className).toContain(
      'pt-tn--arrived',
    );
  });

  it('with reduced motion it jumps, with no animation, and the still ring leaves after a second', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    window.history.pushState({}, '', '/paper/ppr_1/board?card=p');
    const { result } = await mount([node({ id: 'p', x: 0, y: 0, body: 'Words.' })]);
    measure(result, ['p'], 200);
    await waitFor(() => expect(result.current.branch.control.ui.draft?.parentId).toBe('p'));
    measure(result, [DRAFT_ID], 120);
    await waitFor(() => expect(flowStub.setViewport).toHaveBeenCalled());
    expect(flowStub.setViewport.mock.calls[0]![1]).toEqual({ duration: 0 });
    const lit = () => result.current.branch.view.nodes.find((n) => n.id === 'p')?.className ?? '';
    expect(lit()).toContain('pt-tn--arrived');
    await waitFor(() => expect(lit()).not.toContain('pt-tn--arrived'), { timeout: 2500 });
    vi.unstubAllGlobals();
  });

  it('does nothing for a card that is not on the board', async () => {
    window.history.pushState({}, '', '/paper/ppr_1/board?card=cn_gone');
    const { result } = await mount(tree());
    measure(result, ['p', 'a', 'b', 'n']);
    await Promise.resolve();
    expect(flowStub.setViewport).not.toHaveBeenCalled();
  });
});
