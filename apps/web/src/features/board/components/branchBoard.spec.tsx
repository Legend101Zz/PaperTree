/**
 * The whole branching board in one render, `boardsApi` and `threadsApi` the only stubs: the tree
 * cards are drawn, the bar has Tidy, Fold and Outline, Outline opens the study doc, Export Markdown
 * its sheet, and Escape closes them one level at a time (the sheet first, then the Outline).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';
import { request } from '@/lib/api/client';

import { node, resetClock } from '../model/treeFixtures';
import { BoardView } from './BoardView';

import type { Board } from '@/lib/api/types';

vi.mock('@/lib/api/boards', () => ({
  boardsApi: { get: vi.fn(), patchBoard: vi.fn(), patchNode: vi.fn(), tidy: vi.fn() },
}));
vi.mock('@/lib/api/client', () => ({ request: vi.fn() }));
vi.mock('@/lib/api/threads', () => ({
  threadsApi: { list: vi.fn(() => Promise.resolve([])), get: vi.fn(), cancelRun: vi.fn() },
}));

const BOARD = {
  board_id: 'brd_1',
  paper_id: 'ppr_1',
  title: 'Residual nets',
  viewport: null,
} as Board;

beforeEach(() => {
  resetClock();
  vi.mocked(request).mockResolvedValue({ title: 'Deep Residual Learning' });
  vi.mocked(boardsApi.get).mockResolvedValue({
    board: BOARD,
    nodes: [
      node({ id: 'p', x: 0, y: 0, body: 'Residual learning.' }),
      node({
        id: 'a',
        parent: 'p',
        question: 'Why does adding x help?',
        finalText: '## TL;DR\nIt gives the block an easy default.',
      }),
    ],
    edges: [],
  });
});
afterEach(cleanup);

/** The board has loaded and drawn its cards (xyflow hides a card until it is measured). */
async function drawn() {
  await screen.findByTestId('rf__node-a');
}

describe('the branching board', () => {
  it('draws the passage and its answer, and the bar has Tidy, Fold and Outline', async () => {
    render(<BoardView paperId="ppr_1" />);
    await drawn();
    expect(screen.getByLabelText('AI answer to: Why does adding x help?')).not.toBeNull();
    const bar = screen.getByRole('toolbar', { name: 'Board tools' });
    for (const label of ['Tidy', 'Fold', 'Outline']) {
      expect(bar.textContent).toContain(label);
    }
    // Nothing is off its place yet, so Tidy says so rather than offering to do nothing.
    expect(screen.getByText('Tidy').closest('button')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('draws no thread legend and no brass pins on a tree, and the key under the stage only once there is a v0.2 thread', async () => {
    const { container } = render(<BoardView paperId="ppr_1" />);
    await drawn();
    expect(screen.queryByRole('region', { name: 'Legend' })).toBeNull();
    expect(container.querySelectorAll('.pt-pin:not(.pt-pin-fallback)')).toHaveLength(0);
    cleanup();

    vi.mocked(boardsApi.get).mockResolvedValue({
      board: BOARD,
      nodes: [
        node({ id: 'x', kind: 'note', x: 0, y: 0, body: 'one' }),
        node({ id: 'y', kind: 'note', x: 400, y: 0, body: 'two' }),
      ],
      edges: [
        {
          edge_id: 'ce_1',
          board_id: 'brd_1',
          from_node_id: 'x',
          to_node_id: 'y',
          kind: 'supports',
          label: null,
          from_port: 'claim_out',
          to_port: 'evidence_in',
          created_at: '',
        },
      ],
    });
    const threaded = render(<BoardView paperId="ppr_1" />);
    await screen.findByTestId('rf__node-x');
    const legend = screen.getByRole('region', { name: 'Legend' });
    // under the stage, in the flow, never inside it (so never over a card, the minimap or an ask box)
    expect(threaded.getByTestId('canvas-stage').contains(legend)).toBe(false);
    expect(legend.parentElement).toBe(threaded.getByTestId('canvas-stage').parentElement);
  });

  it('Outline opens the study doc; Export Markdown its sheet; Escape closes them in that order', async () => {
    render(<BoardView paperId="ppr_1" />);
    await drawn();
    fireEvent.click(screen.getByRole('button', { name: /^Outline/ }));
    expect(screen.getByTestId('outline')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Residual nets' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }));
    expect(screen.getByRole('dialog', { name: 'Export Markdown' })).not.toBeNull();

    const escape = () =>
      act(
        () =>
          void window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
          ),
      );
    escape();
    expect(screen.queryByRole('dialog', { name: 'Export Markdown' })).toBeNull();
    expect(screen.getByTestId('outline')).not.toBeNull();
    escape();
    await waitFor(() => expect(screen.queryByTestId('outline')).toBeNull());
  });

  it('an unnamed board ("Canvas", the default) exports under the paper’s title, not "# Canvas"', async () => {
    vi.mocked(boardsApi.get).mockResolvedValue({
      board: { ...BOARD, title: 'Canvas' },
      nodes: [
        node({ id: 'p', x: 0, y: 0, body: 'Residual learning.' }),
        node({ id: 'a', parent: 'p', question: 'Why?', finalText: '## TL;DR\nAn easy default.' }),
      ],
      edges: [],
    });
    render(<BoardView paperId="ppr_1" />);
    await drawn();
    fireEvent.click(screen.getByRole('button', { name: /^Outline/ }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Deep Residual Learning' }),
      ).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }));
    const md = screen.getByLabelText('The Markdown').textContent ?? '';
    expect(md.startsWith('# Deep Residual Learning\n')).toBe(true);
    expect(md).not.toContain('# Canvas');
  });

  it('a click on a card focuses its path: a breadcrumb, and Esc leaves it', async () => {
    render(<BoardView paperId="ppr_1" />);
    await drawn();
    fireEvent.click(screen.getByLabelText('AI answer to: Why does adding x help?'));
    const crumbs = screen.getByLabelText('Path');
    expect(crumbs.textContent).toContain('Passage');
    expect(crumbs.textContent).toContain('Why does adding x help?');
    // An answer with no next turn offers the one-line Follow up stub.
    expect(screen.getByLabelText('Follow up')).not.toBeNull();
    act(
      () =>
        void window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
        ),
    );
    await waitFor(() => expect(screen.queryByLabelText('Path')).toBeNull());
  });

  it('the Ask edge on a passage opens the ask box with the Uses line', async () => {
    render(<BoardView paperId="ppr_1" />);
    await drawn();
    const edges = screen.getAllByLabelText('Ask about this card');
    fireEvent.click(edges[0]!);
    const line = await screen.findByTestId('uses-line');
    expect(line.textContent).toMatch(
      /^Uses: this passage · the paper · Familiar · may draw a diagram$/,
    );
    expect(screen.getByLabelText('Your question').getAttribute('placeholder')).toBe(
      'Ask anything about it.',
    );
  });
});
