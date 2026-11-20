import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { explanationSource } from '../../model/cards';
import { toFlowNode, type PtNode } from '../../model/flow';
import { THREAD, cardRow, citation } from '../../model/test-data';
import { CanvasActionsProvider, type CanvasActions } from '../BoardContext';
import { AnswerCard } from './AnswerCard';
import { BranchProvider, type BranchActions } from '../BranchContext';
import { branchActions } from '../../../../../test/branch-harness';
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
  branch: BranchActions = branchActions([row]),
) {
  const node = toFlowNode(row, 'ppr_1');
  const props = { ...node, selected: false, dragging: false } as unknown as NodeProps<PtNode>;
  return render(
    <ReactFlowProvider>
      <CanvasActionsProvider value={ctx}>
        <BranchProvider value={branch}>
          <Card {...props} />
        </BranchProvider>
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
  it("shows the paper's words in the paper voice, its page and the way to the paper", () => {
    const branch = branchActions([]);
    const { container } = mount(
      PassageCard,
      cardRow('excerpt', {
        body: 'In this work we propose\nthe Transformer.',
        source_anchor: citation('b8', 1, 4).anchor,
      }),
      actions(),
      branch,
    );
    const quote = container.querySelector('blockquote[data-voice="paper"]');
    expect(quote?.textContent).toBe('“In this work we propose the Transformer.”');
    fireEvent.click(screen.getByRole('button', { name: 'Show p. 2 in the paper' }));
    expect(branch.openSource).toHaveBeenCalledWith('cn_excerpt');
  });

  it('is dragged by its top strip only, and has an Ask edge', () => {
    const branch = branchActions([]);
    const { container } = mount(
      PassageCard,
      cardRow('excerpt', { body: 'Words.' }),
      actions(),
      branch,
    );
    expect(container.querySelector('.pt-tc__strip')).not.toBeNull();
    expect(container.querySelector('.pt-tc__body')?.className).toMatch(/\bnodrag\b/);
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this card' }));
    expect(branch.control.openAsk).toHaveBeenCalledWith('cn_excerpt');
  });
});

describe('answer card', () => {
  const row = cardRow('explanation', {
    body: THREAD[1]!.content,
    final_text: THREAD[1]!.content,
    question: 'Explain this passage.',
    model: 'MiniMax-M3',
    source_message_id: 'msg_a1',
  });

  it('asks in your voice on its strip, answers in the AI voice, and names the pages in its foot', () => {
    const source = explanationSource('thr_1', THREAD, 'msg_a1')!;
    const ctx = actions({ sources: sources(new Map([['msg_a1', source]])) });
    const branch = branchActions([row]);
    const { container } = mount(AnswerCard, row, ctx, branch);
    expect(container.querySelector('.pt-tc__strip')?.textContent).toContain(
      'Explain this passage.',
    );
    expect(container.querySelector('[data-voice="ai"]')).not.toBeNull();
    const pages = screen.getAllByRole('button', { name: /^Show p\. \d in the paper$/ });
    expect(pages.map((m) => m.getAttribute('aria-label'))).toEqual([
      'Show p. 1 in the paper',
      'Show p. 2 in the paper',
    ]);
    expect(container.textContent).not.toMatch(/\[b\d|passages|citations/);
    expect(screen.getByText('MiniMax-M3')).not.toBeNull();
    fireEvent.click(pages[1]!);
    expect(branch.openSource).toHaveBeenCalledWith('cn_explanation', 'cit_b6_1', 'thr_1');
  });

  it('before its thread is read: the words only, no handles, no pages', () => {
    const { container } = mount(AnswerCard, row, actions({ sources: sources() }));
    expect(container.textContent).toContain('The Transformer drops recurrence.');
    expect(container.textContent).not.toMatch(/\[b\d|passages|estimate|General knowledge/);
    expect(container.querySelector('.pt-tc__src')).toBeNull();
  });

  it('never shows the unterminated handle run a stopped answer ends with (S9-4)', () => {
    const body =
      'The grid predicts boxes [b1]. Each cell predicts from fragments [b42, b43, b44, b4';
    const stopped = cardRow('explanation', { body, final_text: body, source_message_id: 'msg_a1' });
    const source = explanationSource('thr_1', THREAD, 'msg_a1')!;
    const branch = branchActions([stopped], {
      streams: new Map([
        [
          'cn_explanation',
          {
            text: body,
            status: 'stopped',
            citations: [],
            runId: null,
            thinking: false,
            failure: null,
          },
        ],
      ]),
    });
    const { container } = mount(
      AnswerCard,
      stopped,
      actions({ sources: sources(new Map([['msg_a1', source]])) }),
      branch,
    );
    expect(container.textContent).toContain('Each cell predicts from fragments');
    expect(container.textContent).not.toMatch(/\[|\bb\d{1,2}\b/);
    expect(screen.getByText('stopped')).not.toBeNull();
  });

  it('streams with "writing…" and Stop, and Stop stops it', () => {
    const live = cardRow('explanation', { body: '' });
    const branch = branchActions([live], {
      streams: new Map([
        [
          'cn_explanation',
          {
            text: 'The grid',
            status: 'writing',
            citations: [],
            runId: 'run_1',
            thinking: false,
            failure: null,
          },
        ],
      ]),
    });
    mount(AnswerCard, live, actions(), branch);
    expect(screen.getByText('writing…')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(branch.stop).toHaveBeenCalledWith('cn_explanation');
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
    expect(container.querySelector('[data-verdict]')).toBeNull();
    expect(screen.getByText('6 parts')).not.toBeNull();
  });

  it('a plate that did not finish says so on its card (review N8)', () => {
    const plate = storedPlate.messages[1]?.diagram as MessageDiagram;
    const stopped: MessageDiagram = { ...plate, status: 'stopped', parts: plate.parts.slice(0, 3) };
    mount(
      DiagramCard,
      cardRow('diagram', { title: 'Scaled dot-product attention', source_diagram_id: 'msg_a' }),
      actions({ sources: sources(new Map(), new Map(), new Map([['msg_a', stopped]])) }),
    );
    expect(screen.getByText('3 parts · stopped')).not.toBeNull();
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
