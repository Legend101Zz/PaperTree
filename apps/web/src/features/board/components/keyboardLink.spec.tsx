import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLinkAs } from '../hooks/useLinkAs';
import { useThreadDrawing } from '../hooks/useThreadDrawing';
import { toFlowEdge, toFlowNode } from '../model/flow';
import { cardRow, citation } from '../model/test-data';
import { LinkAsLayer } from './LinkAsLayer';

import type { BoardController } from '../hooks/useBoardController';
import type { PtEdge, PtNode } from '../model/flow';

// The board's geometry, as xyflow would have measured it: each card at its row's x/y, its claim-out
// pin on the right edge and its evidence-in pin on the left, 48 px down; the stage at the origin.
const flow = vi.hoisted(() => ({
  nodes: [] as { id: string; x: number; y: number; w: number }[],
  api: null as unknown,
  setCenter: vi.fn(async () => true),
}));
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  // One object, as xyflow's own hook returns one: a new one per render would re-place forever.
  useReactFlow: () =>
    (flow.api ??= {
      getInternalNode: (id: string) => {
        const n = flow.nodes.find((x) => x.id === id);
        if (n === undefined) return undefined;
        const pin = (port: string, x: number) => ({ id: port, x, y: 41, width: 14, height: 14 });
        return {
          internals: {
            positionAbsolute: { x: n.x, y: n.y },
            handleBounds: { source: [pin('claim_out', n.w - 7)], target: [pin('evidence_in', -7)] },
          },
          measured: { width: n.w, height: 180 },
        };
      },
      flowToScreenPosition: (p: { x: number; y: number }) => p,
      setCenter: flow.setCenter,
      getZoom: () => 1,
    }),
}));

afterEach(cleanup);

const note = (id: string, body: string, x: number, y: number) =>
  toFlowNode(cardRow('note', { node_id: id, body, x, y }), 'p');
const A = note('cn_a', 'Depth is the question.', 0, 0);
const B = toFlowNode(
  cardRow('excerpt', {
    node_id: 'cn_b',
    body: 'Deeper networks are harder to train.',
    source_anchor: citation('b1', 0, 1).anchor,
    x: 600,
    y: 200,
  }),
  'p',
);
const C = note('cn_c', 'Far corner.', 1200, 600);
const Q = toFlowNode(cardRow('question', { node_id: 'cn_q', body: 'Why?', x: 600, y: 0 }), 'p');
const THREAD = toFlowEdge({
  edge_id: 'ce_1',
  board_id: 'brd_1',
  from_node_id: 'cn_a',
  to_node_id: 'cn_b',
  kind: 'supports',
  label: null,
  from_port: 'claim_out',
  to_port: 'evidence_in',
  created_at: '',
});

interface BoardProps {
  readonly ctl: BoardController;
  readonly nodes: PtNode[];
  /** The cards in the page (a big board draws only those in view); all of them when absent. */
  readonly shown?: readonly string[];
  /** What xyflow's own key handlers on a card would receive. */
  readonly onCardKey: (key: string) => void;
}

/** The board as `BoardView` wires it, with xyflow's cards and pins as plain elements. */
function Board({ ctl, nodes, shown, onCardKey }: BoardProps): ReactNode {
  const drawing = useThreadDrawing(nodes);
  const stage = useRef<HTMLDivElement>(null);
  const link = useLinkAs(ctl, drawing, nodes, stage);
  return (
    <>
      <button type="button">Add note</button>
      {/* The toolbar's Thread with one card selected (#214). */}
      <button type="button" onClick={() => link.keyboard.start('cn_a')}>
        Thread
      </button>
      <input aria-label="Search the library" />
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the test's stage */}
      <div ref={stage} onKeyDown={link.keyboard.onKeyDown} data-walking={link.keyboard.walking}>
        {nodes
          .filter((n) => shown === undefined || shown.includes(n.id))
          .map((n) => (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- xyflow's handler
            <div
              key={n.id}
              className="react-flow__node"
              data-id={n.id}
              aria-label={n.ariaLabel}
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- as xyflow renders it
              tabIndex={0}
              onKeyDown={(e) => onCardKey(e.key)}
            >
              <span className="react-flow__handle" data-handleid="evidence_in" />
            </div>
          ))}
        <textarea aria-label="Note text" />
        <button type="button" onClick={(e) => link.changeKind('ce_1', e.currentTarget)}>
          Kind
        </button>
        {link.request === null ? null : (
          <LinkAsLayer
            request={link.request}
            nodes={nodes}
            stage={stage}
            onChoose={link.choose}
            onCancel={link.cancel}
          />
        )}
        {drawing.refusal === null ? null : <p role="alert">{drawing.refusal}</p>}
        <p role="status">{link.said}</p>
      </div>
    </>
  );
}

const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

describe('linking by keyboard, and the picker on the board', () => {
  beforeEach(() => {
    flow.nodes = [
      { id: 'cn_a', x: 0, y: 0, w: 260 },
      { id: 'cn_b', x: 600, y: 200, w: 260 },
      { id: 'cn_c', x: 1200, y: 600, w: 260 },
      { id: 'cn_q', x: 600, y: 0, w: 260 },
    ];
  });

  function mount(nodes: PtNode[] = [A, B], edges: PtEdge[] = [], inPage?: readonly string[]) {
    const connect = vi.fn(async () => true);
    const keys: string[] = [];
    const ctl = (list: PtEdge[]) => ({ edges: list, connect, patchEdge: vi.fn() }) as unknown;
    const tree = (n: PtNode[], e: PtEdge[], shown = inPage) => (
      <ReactFlowProvider>
        <Board
          ctl={ctl(e) as BoardController}
          nodes={n}
          shown={shown}
          onCardKey={(k) => keys.push(k)}
        />
      </ReactFlowProvider>
    );
    const view = render(tree(nodes, edges));
    const card = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    const start = (id: string) => {
      card(id).focus();
      fireEvent.keyDown(card(id), { key: 'l', code: 'KeyL' });
    };
    return {
      connect,
      keys,
      card,
      start,
      rerender: (n: PtNode[], e: PtEdge[], shown?: readonly string[]) =>
        view.rerender(tree(n, e, shown)),
    };
  }
  const status = () => screen.getByRole('status').textContent;
  const picker = () => screen.queryByRole('group', { name: /link as/i });
  const walking = () => document.querySelector('[data-walking]')!.getAttribute('data-walking');

  it('L on a card, Enter on the highlighted target, 1: saved as supports, focus back', async () => {
    const { connect, card, start } = mount();
    start('cn_a');
    expect(status()).toBe(
      'Linking from Note ‘Depth is the question.’ Target 1 of 1, evidence in. Tab or the arrow keys choose, Enter links, Escape cancels.',
    );
    expect(document.activeElement).toBe(card('cn_b')); // focus follows the highlight
    press('Tab');
    expect(status()).toBe('Target 1 of 1, evidence in.'); // the card's name is said by focus
    press('Enter');
    expect(picker()?.textContent).toContain('Note ‘Depth is the question.’ → Passage p. 1');
    await act(async () => {
      press('1');
    });
    expect(connect).toHaveBeenCalledWith('cn_a', 'cn_b', 'supports', null, {
      from_port: 'claim_out',
      to_port: 'evidence_in',
    });
    // "Linked as supports." is the controller's Undo toast: said there, once, not here too.
    expect(status()).not.toContain('Linked');
    expect(document.activeElement).toBe(card('cn_a'));
    expect(picker()).toBeNull();
  });

  it('the toolbar’s Thread starts the same walk from the selected card, and Escape returns to it (#214)', () => {
    const { card } = mount([A, B]);
    const thread = screen.getByRole('button', { name: 'Thread' });
    thread.focus();
    fireEvent.click(thread);
    expect(walking()).toBe('true');
    expect(status()).toMatch(/^Linking from Note ‘Depth is the question.’ Target 1 of 1/);
    expect(document.activeElement).toBe(card('cn_b'));
    press('Escape');
    expect(walking()).toBe('false');
    expect(document.activeElement).toBe(thread);
  });

  it('on a big board a target out of the page is brought into view, then focused (#215 S6)', async () => {
    flow.setCenter.mockClear();
    const { card, start, rerender } = mount([A, B, C], [], ['cn_a', 'cn_b']);
    start('cn_a');
    expect(document.activeElement).toBe(card('cn_b'));
    expect(flow.setCenter).not.toHaveBeenCalled();
    press('Tab');
    expect(status()).toBe('Target 2 of 2, evidence in.');
    // The far corner card is not in the page: the board is centred on it (260 × 180 at 1200, 600).
    expect(flow.setCenter).toHaveBeenCalledWith(1330, 690, { zoom: 1 });
    expect(document.activeElement).toBe(card('cn_b'));
    // xyflow draws it once it is in view, and focus (which says its name) lands on it.
    rerender([A, B, C], [], ['cn_a', 'cn_b', 'cn_c']);
    await waitFor(() => expect(document.activeElement).toBe(card('cn_c')));
    expect(walking()).toBe('true');
  });

  it('walks a card once per pin, so a claim can reach a question card’s “question in”', async () => {
    const { connect, card, start } = mount([A, Q]);
    start('cn_a');
    expect(status()).toContain('Target 1 of 2, evidence in.');
    press('Tab');
    expect(status()).toBe('Target 2 of 2, question in.');
    expect(document.activeElement).toBe(card('cn_q'));
    press('Enter');
    await act(async () => {
      press('1');
    });
    expect(connect).toHaveBeenCalledWith('cn_a', 'cn_q', 'supports', null, {
      from_port: 'claim_out',
      to_port: 'question_in',
    });
  });

  it('the arrows never reach the card during a walk (xyflow would move a selected card)', () => {
    const { keys, card, start } = mount([A, B, C]);
    start('cn_a');
    keys.length = 0; // the L itself reached the card, as it reaches xyflow (which ignores it)
    const steps = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Tab', 'Enter'];
    const unprevented = steps.filter((key) => press(key)); // fireEvent is true unless prevented
    expect(keys).toEqual([]);
    expect(unprevented).toEqual([]);
    expect(picker()).not.toBeNull(); // Enter picked the target the walk had reached
    expect(card('cn_c')).toBeTruthy();
  });

  it('never takes a key from a text field, and the field keeps focus', () => {
    const { start } = mount([A, B, C]);
    start('cn_a');
    const field = screen.getByRole('textbox', { name: 'Note text' });
    field.focus(); // a note being edited, inside the board
    expect(press('ArrowLeft')).toBe(true);
    expect(press('Enter')).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(picker()).toBeNull();
  });

  it('takes no key from outside the board', () => {
    const { start } = mount([A, B, C]);
    start('cn_a');
    const tool = screen.getByRole('button', { name: 'Add note' });
    expect(fireEvent.keyDown(tool, { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(tool, { key: 'Enter' })).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/^Linking from/); // no step was taken
    expect(picker()).toBeNull();
  });

  it('ends, saving nothing, when focus leaves the board', () => {
    const { keys, card, start, connect } = mount([A, B, C]);
    start('cn_a');
    keys.length = 0;
    expect(walking()).toBe('true');
    act(() => screen.getByRole('textbox', { name: 'Search the library' }).focus());
    expect(walking()).toBe('false');
    act(() => card('cn_b').focus());
    expect(press('ArrowRight')).toBe(true);
    expect(keys).toEqual(['ArrowRight']); // the card's own keys work again
    press('Enter');
    expect(picker()).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it('ends on a press anywhere but a pin, so another tool can start', () => {
    const { start } = mount([A, B, C]);
    start('cn_a');
    fireEvent.pointerDown(document.querySelector('[data-id="cn_c"] .react-flow__handle')!);
    expect(walking()).toBe('true'); // a pin may still finish the thread by pointer
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add note' }));
    expect(walking()).toBe('false');
    expect(picker()).toBeNull();
  });

  it('Escape while choosing a target saves nothing and gives focus back', () => {
    const { connect, card, start } = mount();
    start('cn_a');
    press('Escape');
    expect(status()).toBe('Cancelled. Nothing was saved.');
    expect(document.activeElement).toBe(card('cn_a'));
    expect(picker()).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it('Escape in the picker keeps a plain link', async () => {
    const { connect, start } = mount();
    start('cn_a');
    press('Enter');
    await act(async () => {
      press('Escape');
    });
    expect(connect).toHaveBeenCalledWith('cn_a', 'cn_b', 'relates', null, expect.anything());
  });

  it('a card with no brass pin, or nothing to reach, says so once, as an alert', () => {
    const { start, connect } = mount([A, Q]);
    start('cn_q');
    expect(screen.getByRole('alert').textContent).toBe(
      'Question ‘Why?’ has no brass pin to start a thread from.',
    );
    expect(status()).toBe('');
    cleanup();
    const alone = mount([A]);
    alone.start('cn_a');
    expect(screen.getByRole('alert').textContent).toBe(
      'Nothing on this board can take a thread from Note ‘Depth is the question.’',
    );
    expect(status()).toBe('');
    expect(document.activeElement).toBe(alone.card('cn_a'));
    expect(connect).not.toHaveBeenCalled();
  });

  it('opens the picker centred on the thread’s midpoint', () => {
    const { start } = mount();
    const proto = HTMLElement.prototype;
    const saved = ['offsetWidth', 'offsetHeight'].map(
      (k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const,
    );
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, value: 600 });
    Object.defineProperty(proto, 'offsetHeight', { configurable: true, value: 160 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1440,
      height: 844,
    } as DOMRect);
    start('cn_a');
    press('Enter');
    // claim out at (260, 48), evidence in at (600, 248): midpoint (430, 148).
    const style = picker()!.style;
    expect([style.insetInlineStart, style.insetBlockStart]).toEqual(['130px', '68px']);
    vi.restoreAllMocks();
    for (const [k, d] of saved) {
      if (d === undefined) delete (proto as unknown as Record<string, unknown>)[k];
      else Object.defineProperty(proto, k, d);
    }
  });

  it('never reopens by itself: a thread deleted, then put back by Undo, stays closed', () => {
    const view = mount([A, B], [THREAD]);
    fireEvent.click(screen.getByRole('button', { name: 'Kind' }));
    expect(picker()).not.toBeNull();
    view.rerender([A, B], []); // Delete took the thread away
    expect(picker()).toBeNull();
    view.rerender([A, B], [THREAD]); // Undo put the same thread back
    expect(picker()).toBeNull();
  });

  it('drops a new thread whose card went away, and does not bring it back', () => {
    const view = mount([A, B, C]);
    view.start('cn_a');
    press('Enter');
    expect(picker()).not.toBeNull();
    view.rerender([A, C], []);
    expect(picker()).toBeNull();
    view.rerender([A, B, C], []);
    expect(picker()).toBeNull();
  });
});
