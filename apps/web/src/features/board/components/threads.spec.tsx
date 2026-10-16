import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react';
import {
  Position,
  ReactFlowProvider,
  useStoreApi,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useThreadDrawing } from '../hooks/useThreadDrawing';
import { EDGE_KINDS, toFlowEdge, toFlowNode, type PtEdge, type PtNode } from '../model/flow';
import { cardRow } from '../model/test-data';
import {
  CanvasActionsProvider,
  LinkingProvider,
  type CanvasActions,
  type LinkStart,
} from './BoardContext';
import { PassageCard } from './cards/PassageCard';
import { ThreadEdge } from './ThreadEdge';
import { ThreadLegend } from './ThreadLegend';

import type { CanvasEdge, EdgeKind } from '@/lib/api/types';
import type { ReactNode } from 'react';

// The tag is portalled into xyflow's label layer, which only a mounted <ReactFlow> has.
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  EdgeLabelRenderer: ({ children }: { children: unknown }) => children,
}));

afterEach(cleanup);

function wire(kind: EdgeKind, label: string | null = null): CanvasEdge {
  return {
    edge_id: `ce_${kind}`,
    board_id: 'brd_1',
    from_node_id: 'cn_a',
    to_node_id: 'cn_b',
    kind,
    label,
    from_port: 'claim_out',
    to_port: 'evidence_in',
    created_at: '',
  };
}

function drawThread(kind: EdgeKind, label: string | null = null) {
  const edge = toFlowEdge(wire(kind, label));
  const props = {
    ...edge,
    sourceX: 0,
    sourceY: 0,
    targetX: 240,
    targetY: 80,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    selected: false,
  } as unknown as EdgeProps<PtEdge>;
  return render(
    <ReactFlowProvider>
      <svg>
        <ThreadEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

/** What tells two threads apart without colour: the drawn shapes and their dash patterns. */
function cueSignature(root: Element): string {
  const line = root.querySelector('.pt-thread__line') as SVGElement;
  return JSON.stringify({
    dash: line.style.strokeDasharray,
    width: line.style.strokeWidth,
    mark: root.querySelector('.pt-thread__mark')?.getAttribute('d') ?? null,
    doubled: root.querySelector('.pt-thread__inner') !== null,
    arrow: root.querySelector('.pt-thread__head') !== null,
  });
}

describe('the seven threads', () => {
  it('each kind differs by colour AND by a second cue on the drawn SVG', () => {
    const drawn = EDGE_KINDS.map(({ kind }) => {
      const { container } = drawThread(kind);
      const g = container.querySelector('g.pt-thread')!;
      const out = {
        colour: (g as SVGGElement).style.color,
        cue: g.getAttribute('data-cue'),
        sig: cueSignature(g),
      };
      cleanup();
      return out;
    });
    expect(new Set(drawn.map((d) => d.colour)).size).toBe(7);
    expect(new Set(drawn.map((d) => d.cue)).size).toBe(7);
    expect(new Set(drawn.map((d) => d.sig)).size).toBe(7);
    expect(drawn[0]!.colour).toBe('var(--pt-wire-supports)');
  });

  it('draws contradicts dashed with crosses, compares doubled, answers with an arrowhead', () => {
    const contradicts = drawThread('contradicts').container;
    expect(
      (contradicts.querySelector('.pt-thread__line') as SVGElement).style.strokeDasharray,
    ).toBe('7 5');
    expect(contradicts.querySelectorAll('.pt-thread__mark').length).toBeGreaterThan(3);
    cleanup();
    expect(drawThread('compares').container.querySelector('.pt-thread__inner')).not.toBeNull();
    cleanup();
    expect(drawThread('answers').container.querySelector('.pt-thread__head')).not.toBeNull();
  });

  it('carries a paper tag with its glyph and its words, or the reader’s own label', () => {
    drawThread('derives_from');
    expect(screen.getByTestId('edge-label').textContent).toBe('derives from');
    expect(screen.getByText('»')).not.toBeNull();
    cleanup();
    drawThread('supports', 'because of §3');
    expect(screen.getByTestId('edge-label').textContent).toBe('because of §3');
  });
});

describe('the brass port pins', () => {
  const ctx: CanvasActions = {
    editingId: null,
    setEditingId: vi.fn(),
    commitBody: vi.fn(),
    commitTitle: vi.fn(),
    commitSize: vi.fn(),
  };
  const mountPassage = (linking: LinkStart | null = null) => {
    const node = toFlowNode(cardRow('excerpt', { body: 'A passage.' }), 'ppr_1');
    return render(
      <ReactFlowProvider>
        <CanvasActionsProvider value={ctx}>
          <LinkingProvider value={linking}>
            <PassageCard {...(node as unknown as NodeProps<PtNode>)} />
          </LinkingProvider>
        </CanvasActionsProvider>
      </ReactFlowProvider>,
    );
  };

  it('are named buttons with the pin ids the server knows', () => {
    const { container } = mountPassage();
    const out = screen.getByRole('button', { name: 'claim out' });
    const into = screen.getByRole('button', { name: 'evidence in' });
    expect(out.getAttribute('data-handleid')).toBe('claim_out');
    expect(into.getAttribute('data-handleid')).toBe('evidence_in');
    expect(out.getAttribute('tabindex')).toBe('0');
    expect(screen.queryByRole('button', { name: 'answer out' })).toBeNull();
    // The hidden fallback handles that keep a pinless stored thread drawn: never a control.
    const fallback = [...container.querySelectorAll('.pt-pin-fallback')];
    expect(fallback.map((h) => h.getAttribute('data-handleid'))).toEqual(['any_out', 'any_in']);
    for (const h of fallback) expect(h.getAttribute('aria-hidden')).toBe('true');
  });

  it('light the open pins a thread being drawn from another card can land on', () => {
    mountPassage({ nodeId: 'cn_other', kind: 'explanation', port: 'answer_out' });
    expect(screen.getByRole('button', { name: 'evidence in' }).getAttribute('data-lit')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'claim out' }).getAttribute('data-lit')).toBe(
      'false',
    );
  });

  it('do not light on the card the thread leaves from', () => {
    mountPassage({ nodeId: 'cn_excerpt', kind: 'excerpt', port: 'claim_out' });
    expect(screen.getByRole('button', { name: 'evidence in' }).getAttribute('data-lit')).toBe(
      'false',
    );
  });

  it('press like a click on Enter (xyflow’s click-to-connect)', () => {
    mountPassage();
    const pin = screen.getByRole('button', { name: 'claim out' });
    const click = vi.fn();
    pin.addEventListener('click', click);
    fireEvent.keyDown(pin, { key: 'Enter' });
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('drawing a thread', () => {
  const nodes = [
    toFlowNode(cardRow('excerpt', { node_id: 'cn_p' }), 'ppr_1'),
    toFlowNode(cardRow('question', { node_id: 'cn_q' }), 'ppr_1'),
  ];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ReactFlowProvider>{children}</ReactFlowProvider>
  );
  const drawing = () =>
    renderHook(() => ({ d: useThreadDrawing(nodes), store: useStoreApi() }), { wrapper });

  it('refuses a pin that does not take the thread, with the server’s sentence', () => {
    const { result: hook } = drawing();
    const result = {
      get current() {
        return hook.current.d;
      },
    };
    const bad = {
      source: 'cn_q',
      target: 'cn_p',
      sourceHandle: 'claim_out',
      targetHandle: 'evidence_in',
    };
    expect(result.current.flowProps.isValidConnection(bad)).toBe(false);
    act(() => {
      result.current.flowProps.onConnectStart(null, {
        nodeId: 'cn_p',
        handleId: 'claim_out',
        handleType: 'source',
      });
    });
    expect(result.current.linking).toEqual({ nodeId: 'cn_p', kind: 'excerpt', port: 'claim_out' });
    act(() => {
      result.current.flowProps.onConnectEnd(null, { toHandle: {}, isValid: false } as never);
    });
    expect(result.current.linking).toBeNull();
    expect(result.current.refusal).toBe('That pin does not take that thread.');
  });

  it('takes a good drop and remembers both pins for the save', () => {
    const { result: hook } = drawing();
    const result = {
      get current() {
        return hook.current.d;
      },
    };
    const good = {
      source: 'cn_p',
      target: 'cn_q',
      sourceHandle: 'claim_out',
      targetHandle: 'question_in',
    };
    expect(result.current.flowProps.isValidConnection(good)).toBe(true);
    act(() => result.current.flowProps.onConnect(good));
    expect(result.current.pending).toEqual({
      from: 'cn_p',
      to: 'cn_q',
      fromPort: 'claim_out',
      toPort: 'question_in',
    });
  });
});

describe('click-to-connect and the toolbar Link', () => {
  const nodes = [
    toFlowNode(cardRow('excerpt', { node_id: 'cn_p' }), 'ppr_1'),
    toFlowNode(cardRow('question', { node_id: 'cn_q' }), 'ppr_1'),
  ];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ReactFlowProvider>{children}</ReactFlowProvider>
  );
  const drawing = () =>
    renderHook(() => ({ d: useThreadDrawing(nodes), store: useStoreApi() }), { wrapper });
  const pin = (nodeId: string, port: string) => {
    const el = document.createElement('div');
    el.className = 'react-flow__handle';
    el.setAttribute('data-nodeid', nodeId);
    el.setAttribute('data-handleid', port);
    return { target: el };
  };
  const start = { nodeId: 'cn_p', handleId: 'claim_out', handleType: 'source' as const };

  it('Escape cancels a started click-to-connect and puts the pins out', () => {
    const { result } = drawing();
    act(() => {
      result.current.store.setState({
        connectionClickStartHandle: { nodeId: 'cn_p', type: 'source', id: 'claim_out' },
      });
      result.current.d.flowProps.onClickConnectStart(null, start);
    });
    expect(result.current.d.linking).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.d.linking).toBeNull();
    expect(result.current.store.getState().connectionClickStartHandle).toBeNull();
  });

  it('a click on the empty board cancels it too', () => {
    const { result } = drawing();
    act(() => result.current.d.flowProps.onClickConnectStart(null, start));
    act(() => result.current.d.flowProps.onPaneClick());
    expect(result.current.d.linking).toBeNull();
  });

  it('a refused keyboard link says so, a good one does not', () => {
    const { result } = drawing();
    act(() => result.current.d.flowProps.onClickConnectStart(null, start));
    act(() =>
      result.current.d.flowProps.onClickConnectEnd(pin('cn_p', 'evidence_in'), {} as never),
    );
    expect(result.current.d.refusal).toBe('That pin does not take that thread.');
    act(() => result.current.d.dismissRefusal());
    act(() => result.current.d.flowProps.onClickConnectStart(null, start));
    act(() =>
      result.current.d.flowProps.onClickConnectEnd(pin('cn_q', 'question_in'), {} as never),
    );
    expect(result.current.d.refusal).toBeNull();
  });

  it('Link takes its pins from the table, and refuses a card with no out-pin', () => {
    const { result } = drawing();
    act(() => result.current.d.link('cn_p', 'cn_q'));
    expect(result.current.d.pending).toEqual({
      from: 'cn_p',
      to: 'cn_q',
      fromPort: 'claim_out',
      toPort: 'evidence_in',
    });
    act(() => result.current.d.setPending(null));
    act(() => result.current.d.link('cn_q', 'cn_p'));
    expect(result.current.d.pending).toBeNull();
    expect(result.current.d.refusal).toBe('That pin does not take that thread.');
  });
});

describe('the legend', () => {
  it('lists the seven threads with their names and cues, the four pins and the hint', () => {
    render(<ThreadLegend />);
    const legend = screen.getByRole('region', { name: 'Legend' });
    const threads = within(legend).getAllByRole('img');
    expect(threads.map((t) => t.getAttribute('aria-label')?.split(':')[0])).toEqual([
      'supports',
      'contradicts',
      'derives from',
      'answers',
      'compares with',
      'references',
      'plain link',
    ]);
    for (const pin of ['evidence in', 'question in', 'claim out', 'answer out'])
      expect(within(legend).getByText(pin)).not.toBeNull();
    expect(within(legend).getByText('Drag from a brass pin to make a thread.')).not.toBeNull();
  });
});
