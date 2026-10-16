/**
 * #215: a card below the low-zoom switch draws as a glance (kind and words, its pins drawn but not
 * targets), a note being
 * typed in stays full whatever the zoom, and a memoised card is not drawn again for the moves of its
 * own drag.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toFlowNode, type PtNode } from '../model/flow';
import { cardRow } from '../model/test-data';
import { CanvasActionsProvider, GlanceProvider, type CanvasActions } from './BoardContext';
import { nodeTypes, withGlance } from './cards';

import type { ReactNode } from 'react';

afterEach(cleanup);

const actions = (editingId: string | null = null): CanvasActions => ({
  editingId,
  setEditingId: vi.fn(),
  commitBody: vi.fn(),
  commitTitle: vi.fn(),
  commitSize: vi.fn(),
});
const NOTE = toFlowNode(cardRow('note', { node_id: 'cn_n', body: 'Read 3.2 next.' }), 'ppr_1');
const props = (extra: Partial<NodeProps<PtNode>> = {}) =>
  ({ ...NOTE, selected: false, dragging: false, ...extra }) as unknown as NodeProps<PtNode>;

function Board({
  glance,
  ctx,
  children,
}: {
  glance: boolean;
  ctx: CanvasActions;
  children: ReactNode;
}) {
  return (
    <ReactFlowProvider>
      <CanvasActionsProvider value={ctx}>
        <GlanceProvider value={glance}>{children}</GlanceProvider>
      </CanvasActionsProvider>
    </ReactFlowProvider>
  );
}

describe('cards at low zoom (#215)', () => {
  it('a glance shows the kind and the words in their voice, and keeps the pins', () => {
    const { container } = render(
      <Board glance ctx={actions()}>
        <nodeTypes.note {...props()} />
      </Board>,
    );
    const glance = container.querySelector('[data-glance="true"]');
    expect(glance?.textContent).toContain('Note');
    expect(container.querySelector('[data-voice="you"]')?.textContent).toBe('Read 3.2 next.');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    // Its pins are drawn (its threads stay attached) but are not targets at this zoom.
    const pin = container.querySelector('[data-port="claim_out"]');
    expect(pin).not.toBeNull();
    expect(pin?.getAttribute('aria-hidden')).toBe('true');
    expect(pin?.hasAttribute('tabindex')).toBe(false);
    expect(screen.queryByRole('button', { name: 'claim out' })).toBeNull();
  });

  it('a note being typed in keeps its field below the switch', () => {
    render(
      <Board glance ctx={actions('cn_n')}>
        <nodeTypes.note {...props()} />
      </Board>,
    );
    expect(screen.getByRole('textbox', { name: 'Note text' })).toBeTruthy();
  });

  it('above the switch the card is drawn in full', () => {
    const { container } = render(
      <Board glance={false} ctx={actions()}>
        <nodeTypes.note {...props()} />
      </Board>,
    );
    expect(container.querySelector('[data-glance]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('is not drawn again for the moves of its own drag, only for its row or selection', () => {
    let draws = 0;
    const Counted = withGlance(function Counted(): ReactNode {
      draws += 1;
      return null;
    });
    const ctx = actions();
    const view = render(
      <Board glance={false} ctx={ctx}>
        <Counted {...props()} />
      </Board>,
    );
    for (const x of [10, 20, 30])
      view.rerender(
        <Board glance={false} ctx={ctx}>
          <Counted {...props({ positionAbsoluteX: x, dragging: true })} />
        </Board>,
      );
    expect(draws).toBe(1);
    view.rerender(
      <Board glance={false} ctx={ctx}>
        <Counted {...props({ selected: true })} />
      </Board>,
    );
    expect(draws).toBe(2);
  });
});
