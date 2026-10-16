import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { explanationSource } from '../../model/cards';
import { toFlowNode, type PtNode } from '../../model/flow';
import { THREAD, cardRow, citation } from '../../model/test-data';
import { CanvasActionsProvider, type CanvasActions } from '../BoardContext';
import { ExplanationCard } from './ExplanationCard';
import { DiagramCard, NotebookCard } from './NotebookCard';
import { NoteCard, QuestionCard } from './NoteCard';
import { PassageCard } from './PassageCard';
import storedPlate from '../../../../../test/fixtures/diagram-thread.json';

import type { CanvasNode, MessageDiagram } from '@/lib/api/types';
import type { ComponentType } from 'react';

afterEach(cleanup);

function actions(extra: Partial<CanvasActions> = {}): CanvasActions {
  return {
    editingId: null,
    setEditingId: vi.fn(),
    commitBody: vi.fn(),
    commitTitle: vi.fn(),
    commitSize: vi.fn(),
    openCitation: vi.fn(),
    ...extra,
  };
}

function mount(
  Card: ComponentType<NodeProps<PtNode>>,
  row: CanvasNode,
  ctx: CanvasActions = actions(),
) {
  const node = toFlowNode(row, 'ppr_1');
  const props = { ...node, selected: false, dragging: false } as unknown as NodeProps<PtNode>;
  return render(
    <ReactFlowProvider>
      <CanvasActionsProvider value={ctx}>
        <Card {...props} />
      </CanvasActionsProvider>
    </ReactFlowProvider>,
  );
}

const sources = (explanations = new Map(), pages = new Map(), diagrams = new Map()) => ({
  explanations,
  pages,
  diagrams,
});

describe('passage card', () => {
  it("shows the paper's words in the paper voice, its page tab and Open source", () => {
    const { container } = mount(
      PassageCard,
      cardRow('excerpt', {
        body: 'In this work we propose\nthe Transformer.',
        source_anchor: citation('b8', 1, 4).anchor,
      }),
    );
    const quote = container.querySelector('blockquote[data-voice="paper"]');
    expect(quote?.textContent).toBe('“In this work we propose the Transformer.”');
    expect(screen.getByText('p. 2')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open source' }).getAttribute('href')).toBe(
      '/paper/ppr_1/read?focus=cn_excerpt',
    );
  });
});

describe('explanation card', () => {
  const row = cardRow('explanation', {
    body: THREAD[1]!.content,
    source_message_id: 'msg_a1',
  });

  it('asks in your voice and answers in the AI voice, with numbered markers and its footer', () => {
    const source = explanationSource('thr_1', THREAD, 'msg_a1')!;
    const ctx = actions({ sources: sources(new Map([['msg_a1', source]])) });
    const { container } = mount(ExplanationCard, row, ctx);
    expect(container.querySelector('[data-voice="you"]')?.textContent).toBe(
      'Explain this passage.',
    );
    const slip = screen.getByRole('note', { name: "AI answer, not the paper's words" });
    expect(slip.getAttribute('data-voice')).toBe('ai');
    const markers = within(slip).getAllByRole('button', { name: /^Passage \d/ });
    expect(markers.map((m) => m.getAttribute('aria-label'))).toEqual([
      'Passage 1, p. 1 ¶1',
      'Passage 2, p. 2 ¶2',
      'Passage 3, p. 2 ¶3',
      'Passage 4, p. 2 ¶4',
    ]);
    expect(slip.textContent).not.toMatch(/\[b\d/);
    expect(within(slip).getByText('4 passages · 11 citations')).not.toBeNull();
    expect(within(slip).getByText('6,776 tokens · ≈ $0.0027 (estimate)')).not.toBeNull();
    fireEvent.click(markers[1]!);
    expect(ctx.openCitation).toHaveBeenCalledWith('cn_explanation', 'cit_b6_1', 'thr_1');
  });

  it('before its thread is read: the words only, no handles, no markers, no footer', () => {
    const { container } = mount(ExplanationCard, row, actions({ sources: sources() }));
    expect(container.querySelector('[data-voice="you"]')).toBeNull();
    const slip = screen.getByRole('note', { name: "AI answer, not the paper's words" });
    expect(slip.textContent).toContain('The Transformer drops recurrence.');
    expect(slip.textContent).not.toMatch(/\[b\d|passages|estimate/);
    expect(within(slip).queryAllByRole('button', { name: /^Passage/ })).toHaveLength(0);
  });

  it('never shows the unterminated handle run a stopped answer ends with (S9-4)', () => {
    const stopped = cardRow('explanation', {
      body: 'The grid predicts boxes [b1]. Each cell predicts from fragments [b42, b43, b44, b4',
      source_message_id: 'msg_a1',
    });
    const source = explanationSource('thr_1', THREAD, 'msg_a1')!;
    mount(ExplanationCard, stopped, actions({ sources: sources(new Map([['msg_a1', source]])) }));
    const slip = screen.getByRole('note', { name: "AI answer, not the paper's words" });
    expect(slip.textContent).toContain('Each cell predicts from fragments');
    expect(slip.textContent).not.toMatch(/\[|\bb\d{1,2}\b/);
  });

  it('unfolds when the keyboard reaches a marker below the fold', () => {
    const height = (name: 'scrollHeight' | 'clientHeight', value: number) =>
      vi.spyOn(HTMLElement.prototype, name, 'get').mockReturnValue(value);
    const spies = [height('scrollHeight', 480), height('clientHeight', 120)];
    const source = explanationSource('thr_1', THREAD, 'msg_a1')!;
    const { container } = mount(
      ExplanationCard,
      row,
      actions({ sources: sources(new Map([['msg_a1', source]])) }),
    );
    expect(container.querySelector('[data-expanded="false"]')).not.toBeNull();
    fireEvent.focus(screen.getAllByRole('button', { name: /^Passage 4/ })[0]!);
    expect(container.querySelector('[data-expanded="true"]')).not.toBeNull();
    spies.forEach((spy) => spy.mockRestore());
  });
});

describe('note and question cards', () => {
  it('a note is your words, edited in place', () => {
    const commitBody: Mock = vi.fn();
    const setEditingId: Mock = vi.fn();
    const row = cardRow('note', { body: 'I thought attention needed an RNN underneath.' });
    const { container, unmount } = mount(NoteCard, row, actions({ setEditingId }));
    expect(container.querySelector('[data-voice="you"]')?.textContent).toBe(row.body);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(setEditingId).toHaveBeenCalledWith('cn_note');
    unmount();
    mount(NoteCard, row, actions({ editingId: 'cn_note', commitBody, setEditingId }));
    const area = screen.getByRole('textbox', { name: 'Note text' });
    fireEvent.change(area, { target: { value: 'Next: read 3.2.' } });
    fireEvent.keyDown(area, { key: 'Enter' });
    fireEvent.blur(area);
    expect(commitBody).toHaveBeenCalledWith('cn_note', 'Next: read 3.2.');
  });

  it('a question is a call slip with its tag, in your voice', () => {
    const { container } = mount(
      QuestionCard,
      cardRow('question', { body: 'Why does dropping recurrence make training faster?' }),
    );
    expect(screen.getByText('question')).not.toBeNull();
    expect(container.querySelector('[data-voice="you"]')?.textContent).toBe(
      'Why does dropping recurrence make training faster?',
    );
  });
});

describe('notebook and diagram cards', () => {
  const zero = { quotes: 0, stickies: 0, text: 0, shapes: 0, strokes: 0 };

  it('a notebook page: miniature from its items, title, counts, Open page', () => {
    const page = {
      page: { page_id: 'nbp_1', title: 'Dive in: the central proposal' },
      items: [
        { item_id: 'i1', kind: 'exchange' as const, x: 48, y: 48, w: 864, h: 300, z: 0 },
        { item_id: 'i2', kind: 'sticky' as const, x: 760, y: 360, w: 140, h: 140, z: 1 },
      ],
    };
    const { container } = mount(
      NotebookCard,
      cardRow('notebook', { source_page_id: 'nbp_1', counts: { ...zero, quotes: 4, stickies: 1 } }),
      actions({ sources: sources(new Map(), new Map([['nbp_1', page]])) }),
    );
    expect(screen.getByText('Dive in: the central proposal')).not.toBeNull();
    expect(screen.getByText('4 quotes · 1 sticky')).not.toBeNull();
    expect(container.querySelectorAll('.pt-bc__mini-item')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Open page' }).getAttribute('href')).toBe(
      '/paper/ppr_1/notebook/nbp_1',
    );
  });

  it('a diagram: the AI slip with its title only, claiming no parts', () => {
    const { container } = mount(
      DiagramCard,
      cardRow('diagram', { title: 'Scaled dot-product attention', source_diagram_id: 'dg_1' }),
    );
    const slip = screen.getByRole('note', { name: "AI answer, not the paper's words" });
    expect(within(slip).getByText('Scaled dot-product attention')).not.toBeNull();
    expect(container.textContent).not.toMatch(/parts|cited/);
  });

  it('a diagram read back (#217): the plate drawn small from its stored parts, and its counts', () => {
    const plate = storedPlate.messages[1]?.diagram as MessageDiagram;
    const { container } = mount(
      DiagramCard,
      cardRow('diagram', { title: 'Scaled dot-product attention', source_diagram_id: 'msg_a' }),
      actions({ sources: sources(new Map(), new Map(), new Map([['msg_a', plate]])) }),
    );
    expect(container.querySelector('[data-plate-mini="6"]')).not.toBeNull();
    expect(container.querySelectorAll('.pt-plate-mini .pt-plate__box')).toHaveLength(6);
    expect(container.querySelector('[data-verdict="inferred"]')).not.toBeNull();
    expect(screen.getByText('6 parts · 5 cited')).not.toBeNull();
  });
});

describe('a long body clips with a fade and "more"', () => {
  it('offers more when the words overflow, and less once expanded', () => {
    const height = (name: 'scrollHeight' | 'clientHeight', value: number) =>
      vi.spyOn(HTMLElement.prototype, name, 'get').mockReturnValue(value);
    const spies = [height('scrollHeight', 480), height('clientHeight', 120)];
    const { container } = mount(NoteCard, cardRow('note', { body: 'long '.repeat(200) }));
    const more = screen.getByRole('button', { name: 'more' });
    expect(container.querySelector('[data-clipped="true"]')).not.toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'less' }).getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-expanded="true"]')).not.toBeNull();
    spies.forEach((spy) => spy.mockRestore());
  });

  it('shows no control when the words fit', () => {
    mount(NoteCard, cardRow('note', { body: 'short' }));
    expect(screen.queryByRole('button', { name: 'more' })).toBeNull();
  });
});
