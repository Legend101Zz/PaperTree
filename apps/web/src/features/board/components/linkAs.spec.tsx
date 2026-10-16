import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLinkAs } from '../hooks/useLinkAs';
import { useThreadDrawing } from '../hooks/useThreadDrawing';
import { toFlowNode } from '../model/flow';
import { kindChoices } from '../model/linkAs';
import { cardRow, citation } from '../model/test-data';
import { LinkAsLayer } from './LinkAsLayer';
import { LinkAsPicker } from './LinkAsPicker';

import type { BoardController } from '../hooks/useBoardController';
import type { PtNode } from '../model/flow';

// The board's geometry, as xyflow would have measured it: each card at its row's x/y, its claim-out
// pin on the right edge and its evidence-in pin on the left, 48 px down; the stage at the origin.
const flow = vi.hoisted(() => ({
  nodes: [] as { id: string; x: number; y: number; w: number }[],
  api: null as unknown,
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
    }),
}));

afterEach(cleanup);

const OK = kindChoices(
  { kind: 'diagram', port: 'claim_out' },
  { kind: 'excerpt', port: 'evidence_in' },
);
const REFUSED = kindChoices(
  { kind: 'question', port: 'claim_out' },
  { kind: 'excerpt', port: 'evidence_in' },
);

function picker(extra: Partial<Parameters<typeof LinkAsPicker>[0]> = {}) {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  render(
    <LinkAsPicker
      from="Diagram ‘Scaled dot-product attention’"
      to="Passage p. 1"
      choices={OK}
      mode="new"
      at={{ x: 64, y: 696 }}
      onChoose={onChoose}
      onCancel={onCancel}
      {...extra}
    />,
  );
  const group = screen.getByRole('group', { name: /link as/i });
  return { onChoose, onCancel, group };
}
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

describe('the "Link as" picker', () => {
  it('names both ends, lists the seven kinds 4 + 3 with keys 1–7, and focuses the first', () => {
    const { group } = picker();
    expect(group.textContent).toContain('Diagram ‘Scaled dot-product attention’ → Passage p. 1');
    expect(group.textContent).toContain('1–7 · Esc = plain link');
    const options = within(group).getAllByRole('option');
    expect(
      options.map((o) => [o.getAttribute('aria-label'), o.getAttribute('aria-keyshortcuts')]),
    ).toEqual([
      ['supports', '1'],
      ['contradicts', '2'],
      ['derives from', '3'],
      ['answers', '4'],
      ['compares with', '5'],
      ['references', '6'],
      ['plain link', '7'],
    ]);
    // Each option draws its thread with the second cue (ThreadSwatch), not a word alone.
    expect(within(options[1]!).getByRole('img').getAttribute('aria-label')).toBe(
      'contradicts: dashed with crosses',
    );
    expect(document.activeElement).toBe(options[0]);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull(); // not a modal
  });

  it('chooses a kind by its number key, by Enter on the focused option, or by a click', () => {
    const { onChoose, group } = picker();
    press('2');
    expect(onChoose).toHaveBeenLastCalledWith('contradicts', null);
    press('7');
    expect(onChoose).toHaveBeenLastCalledWith('relates', null);
    fireEvent.click(within(group).getByRole('option', { name: 'answers' }));
    expect(onChoose).toHaveBeenLastCalledWith('answers', null);
  });

  it('walks the grid with the arrows and keeps Tab inside the picker', () => {
    const { group } = picker();
    const options = within(group).getAllByRole('option');
    press('ArrowDown');
    expect(document.activeElement).toBe(options[4]);
    press('ArrowRight');
    expect(document.activeElement).toBe(options[5]);
    expect(options[5]!.getAttribute('aria-selected')).toBe('true');
    press('Tab');
    expect(document.activeElement).toBe(options[6]);
    press('Tab');
    expect(document.activeElement?.textContent).toBe('Add a label');
    press('Tab');
    expect(document.activeElement).toBe(options[0]);
    press('Tab', { shiftKey: true });
    expect(document.activeElement?.textContent).toBe('Add a label');
  });

  it('Escape keeps a plain link on a new thread (v0.1’s Escape saved nothing)', () => {
    const { onChoose, onCancel } = picker();
    press('Escape');
    expect(onChoose).toHaveBeenCalledWith('relates', null);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a press outside the picker counts as Escape', () => {
    const { onChoose } = picker();
    fireEvent.pointerDown(document.body);
    expect(onChoose).toHaveBeenCalledWith('relates', null);
  });

  it('changing a saved thread starts on its kind, and Escape changes nothing', () => {
    const { onChoose, onCancel, group } = picker({ mode: 'change', initial: 'derives_from' });
    expect(document.activeElement).toBe(
      within(group).getByRole('option', { name: 'derives from' }),
    );
    expect(group.textContent).toContain('Esc = no change');
    expect(screen.queryByText('Add a label')).toBeNull();
    press('Escape');
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('keeps the optional label reachable, and its digits are typed, not chosen', () => {
    const { onChoose } = picker();
    fireEvent.click(screen.getByRole('button', { name: 'Add a label' }));
    const field = screen.getByRole('textbox', { name: 'Label on the thread (optional)' });
    fireEvent.change(field, { target: { value: 'see §3 2017' } });
    fireEvent.keyDown(field, { key: '2' });
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith('supports', 'see §3 2017');
  });

  it('a kind the pins do not take is disabled, says why on focus, and its key does nothing', () => {
    const { onChoose, group } = picker({ choices: REFUSED });
    const supports = within(group).getByRole('option', { name: 'supports' });
    expect(supports.getAttribute('aria-disabled')).toBe('true');
    const why = document.getElementById(supports.getAttribute('aria-describedby')!);
    expect(why?.textContent).toBe('That pin does not take that thread.');
    expect(why?.hidden).toBe(false); // it is the focused option, so the reason shows
    press('1');
    fireEvent.click(supports);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('has no axe violations (layout-bound rules are a browser’s job)', async () => {
    const { group } = picker();
    const results = await axe.run(group, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

// ── on the board: the layer's placement and focus, and the keyboard path end to end ─────────────

const NODES: PtNode[] = [
  toFlowNode(cardRow('note', { node_id: 'cn_a', body: 'Depth is the question.', x: 0, y: 0 }), 'p'),
  toFlowNode(
    cardRow('excerpt', {
      node_id: 'cn_b',
      body: 'Deeper networks are harder to train.',
      source_anchor: citation('b1', 0, 1).anchor,
      x: 600,
      y: 200,
    }),
    'p',
  ),
];

function Board(props: { readonly ctl: BoardController; readonly nodes: PtNode[] }): ReactNode {
  const { ctl, nodes } = props;
  const drawing = useThreadDrawing(nodes);
  const link = useLinkAs(ctl, drawing, nodes);
  const stage = useRef<HTMLDivElement>(null);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the test's stage
    <div ref={stage} onKeyDown={link.keyboard.onKeyDown}>
      {nodes.map((n) => (
        // xyflow's own node wrapper: a focusable group named by the card
        <div
          key={n.id}
          className="react-flow__node"
          data-id={n.id}
          role="group"
          aria-label={n.ariaLabel}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- as xyflow renders it
          tabIndex={0}
        />
      ))}
      {link.request === null ? null : (
        <LinkAsLayer
          request={link.request}
          nodes={nodes}
          stage={stage}
          onChoose={link.choose}
          onCancel={link.cancel}
        />
      )}
      <p role="status">{link.said}</p>
    </div>
  );
}

describe('linking by keyboard, and the picker on the board', () => {
  beforeEach(() => {
    flow.nodes = [
      { id: 'cn_a', x: 0, y: 0, w: 260 },
      { id: 'cn_b', x: 600, y: 200, w: 260 },
    ];
  });

  function mount(nodes: PtNode[] = NODES) {
    const connect = vi.fn(async () => true);
    const ctl = { edges: [], connect, patchEdge: vi.fn() } as unknown as BoardController;
    render(
      <ReactFlowProvider>
        <Board ctl={ctl} nodes={nodes} />
      </ReactFlowProvider>,
    );
    return {
      connect,
      card: (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`)!,
    };
  }
  const status = () => screen.getByRole('status').textContent;

  it('L on a card, Enter on the highlighted target, 1: linked as supports, said, focus back', async () => {
    const { connect, card } = mount();
    card('cn_a').focus();
    fireEvent.keyDown(card('cn_a'), { key: 'l' });
    expect(status()).toMatch(
      /^Linking from Note ‘Depth is the question\.’\. Target: Passage p\. 1, 1 of 1\./,
    );
    expect(document.activeElement).toBe(card('cn_b')); // focus follows the highlight
    press('Tab');
    expect(status()).toBe('Target: Passage p. 1, 1 of 1.');
    press('Enter');
    const group = screen.getByRole('group', { name: /link as/i });
    expect(group.textContent).toContain('Note ‘Depth is the question.’ → Passage p. 1');
    await act(async () => {
      press('1');
    });
    expect(connect).toHaveBeenCalledWith('cn_a', 'cn_b', 'supports', null, {
      from_port: 'claim_out',
      to_port: 'evidence_in',
    });
    expect(status()).toBe('Linked as supports.');
    expect(document.activeElement).toBe(card('cn_a'));
    expect(screen.queryByRole('group', { name: /link as/i })).toBeNull();
  });

  it('opens the picker centred on the thread’s midpoint', () => {
    const { card } = mount();
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
    card('cn_a').focus();
    fireEvent.keyDown(card('cn_a'), { key: 'l' });
    press('Enter');
    // claim out at (260, 48), evidence in at (600, 248): midpoint (430, 148).
    const style = screen.getByRole('group', { name: /link as/i }).style;
    expect([style.insetInlineStart, style.insetBlockStart]).toEqual(['130px', '68px']);
    vi.restoreAllMocks();
    for (const [k, d] of saved) {
      if (d === undefined) delete (proto as unknown as Record<string, unknown>)[k];
      else Object.defineProperty(proto, k, d);
    }
  });

  it('Escape while choosing a target saves nothing and gives focus back', () => {
    const { connect, card } = mount();
    card('cn_a').focus();
    fireEvent.keyDown(card('cn_a'), { key: 'l' });
    press('Escape');
    expect(status()).toBe('Cancelled. Nothing was saved.');
    expect(document.activeElement).toBe(card('cn_a'));
    expect(screen.queryByRole('group', { name: /link as/i })).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it('Escape in the picker keeps a plain link', async () => {
    const { connect, card } = mount();
    card('cn_a').focus();
    fireEvent.keyDown(card('cn_a'), { key: 'L' });
    press('Enter');
    await act(async () => {
      press('Escape');
    });
    expect(connect).toHaveBeenCalledWith('cn_a', 'cn_b', 'relates', null, expect.anything());
    expect(status()).toBe('Linked as plain link.');
  });

  it('a card with no brass pin, or nothing to reach, says so and starts nothing', () => {
    const question = toFlowNode(cardRow('question', { node_id: 'cn_q', body: 'Why?' }), 'p');
    const { card, connect } = mount([NODES[0]!, question]);
    card('cn_q').focus();
    fireEvent.keyDown(card('cn_q'), { key: 'l' });
    expect(status()).toBe('Question ‘Why?’ has no brass pin to start a thread from.');
    cleanup();
    const alone = mount([NODES[0]!]);
    alone.card('cn_a').focus();
    fireEvent.keyDown(alone.card('cn_a'), { key: 'l' });
    expect(status()).toBe(
      'Nothing on this board can take a thread from Note ‘Depth is the question.’.',
    );
    expect(document.activeElement).toBe(alone.card('cn_a'));
    expect(connect).not.toHaveBeenCalled();
  });
});
