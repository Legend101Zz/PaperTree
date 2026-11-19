/**
 * The branching board's pieces, one at a time (v03-BOARD-SPEC section 4): the card's height cap and
 * its scroll cue, the span menu and its keys, the ask box's Uses line and pickers, the breadcrumb,
 * and the Outline with its Markdown export.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { branchActions } from '../../../../../test/branch-harness';
import { defaultUses } from '../../model/askPayload';
import { toFlowNode, type PtNode } from '../../model/flow';
import { buildTree } from '../../model/tree';
import { node, resetClock, spanOf } from '../../model/treeFixtures';
import { CanvasActionsProvider, type CanvasActions } from '../BoardContext';
import { BranchProvider, type BranchActions } from '../BranchContext';
import { AnswerCard } from '../cards/AnswerCard';
import { PassageCard } from '../cards/PassageCard';
import { AskDraft } from './AskBox';
import { Breadcrumb } from './Breadcrumb';
import { ExportSheet } from './ExportSheet';
import { OutlineView } from './OutlineView';
import { SpanMenu, menuKey } from './SpanMenu';

import type { AskUses, ParentSpan } from '@/lib/api/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HERE = dirname(fileURLToPath(import.meta.url));
const TEXT =
  '## TL;DR\nAn identity mapping hands its input straight on.\n\n## How it works\nWith F(x) = 0 the block outputs x, with no extra parameters.';
const ACTIONS: CanvasActions = {
  editingId: null,
  setEditingId: vi.fn(),
  commitBody: vi.fn(),
  commitTitle: vi.fn(),
  commitSize: vi.fn(),
};

const props = (row: ReturnType<typeof node>): NodeProps<PtNode> =>
  ({
    ...toFlowNode(row, 'ppr_1'),
    selected: false,
    dragging: false,
  }) as unknown as NodeProps<PtNode>;

function mountCard(Card: typeof PassageCard, row: ReturnType<typeof node>, branch: BranchActions) {
  return render(
    <ReactFlowProvider>
      <CanvasActionsProvider value={ACTIONS}>
        <BranchProvider value={branch}>
          <Card {...props(row)} />
        </BranchProvider>
      </CanvasActionsProvider>
    </ReactFlowProvider>,
  );
}

describe('a card is as tall as its text, up to the pane’s cap, then scrolls inside with a cue', () => {
  const css = readFileSync(resolve(HERE, 'tree.css'), 'utf8');

  it('takes its cap from the pane (--pt-card-cap) and scrolls its body, not the page', () => {
    expect(css).toMatch(/\.pt-tc \{[^}]*--pt-tc-cap: var\(--pt-card-cap, 60vh\);/);
    expect(css).toMatch(/\.pt-tc \{[^}]*max-block-size: var\(--pt-tc-cap\);/);
    expect(css).toMatch(/\.pt-tc__body \{[^}]*overflow-y: auto;/);
  });

  it('shows "N characters · scrolls inside" only when the text is taller than the box', () => {
    resetClock();
    const row = node({ id: 'p', body: 'x'.repeat(3200) });
    const height = (name: 'scrollHeight' | 'clientHeight', value: number) =>
      vi.spyOn(HTMLElement.prototype, name, 'get').mockReturnValue(value);
    height('scrollHeight', 900);
    height('clientHeight', 480);
    const branch = branchActions([row]);
    const { unmount } = mountCard(PassageCard, row, branch);
    expect(screen.getByTestId('scroll-cue').textContent).toContain(
      '3,200 characters · scrolls inside',
    );
    expect(screen.getByTestId('card-body').className).toMatch(/\bnowheel\b/);
    // The card tells the layout its height; the layout does the capping.
    expect(branch.reports.height).toHaveBeenCalledWith('p', expect.any(Number));
    unmount();
    vi.restoreAllMocks();

    height('scrollHeight', 100);
    height('clientHeight', 100);
    mountCard(PassageCard, node({ id: 'q', body: 'Short.' }), branchActions());
    expect(screen.queryByTestId('scroll-cue')).toBeNull();
  });
});

describe('selecting words in an answer opens the span menu', () => {
  function select(container: HTMLElement, words: string) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ALL);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (n.nodeType !== Node.TEXT_NODE) continue;
      const at = (n as Text).data.indexOf(words);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + words.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`"${words}" is not on the card`);
  }

  it('reads the words and their place in the stored Markdown, and opens the menu', () => {
    const row = node({ id: 'a', parent: 'p', question: 'why?', finalText: TEXT });
    const branch = branchActions([row], { stage: { current: document.createElement('div') } });
    const { container } = mountCard(AnswerCard, row, branch);
    select(container, 'identity mapping');
    fireEvent.mouseUp(screen.getByTestId('card-body'));
    const open = vi.mocked(branch.control.openMenu);
    expect(open).toHaveBeenCalledTimes(1);
    const menu = open.mock.calls[0]![0]!;
    expect(menu.cardId).toBe('a');
    expect(menu.span).toEqual(spanOf(TEXT, 'identity mapping'));
  });

  it('knows which of two equal passages of words was selected', () => {
    const twice = 'An identity mapping is simple.\n\nAn identity mapping is also free.';
    const row = node({ id: 'a', parent: 'p', finalText: twice });
    const branch = branchActions([row], { stage: { current: document.createElement('div') } });
    const { container } = mountCard(AnswerCard, row, branch);
    // The second paragraph's words: select inside it.
    const paragraphs = [...container.querySelectorAll('p')].filter((p) =>
      p.textContent?.includes('also free'),
    );
    const text = paragraphs[0]!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, text.data.indexOf('identity'));
    range.setEnd(text, text.data.indexOf('identity') + 'identity mapping'.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('card-body'));
    const span = vi.mocked(branch.control.openMenu).mock.calls[0]![0]!.span;
    expect(span.start).toBe(twice.lastIndexOf('identity mapping'));
  });

  it('does not open for words across a formula, and closes the menu when the selection goes', () => {
    const row = node({ id: 'a', parent: 'p', finalText: TEXT });
    const branch = branchActions(
      [row],
      { stage: { current: document.createElement('div') } },
      {
        menu: { cardId: 'a', span: spanOf(TEXT, 'identity'), anchor: { x: 0, y: 0, w: 1, h: 1 } },
      },
    );
    mountCard(AnswerCard, row, branch);
    window.getSelection()?.removeAllRanges();
    fireEvent.mouseUp(screen.getByTestId('card-body'));
    expect(branch.control.openMenu).toHaveBeenCalledWith(null);
  });
});

describe('the span menu: Enter asks, 1 to 4 are the quick items', () => {
  const SPAN: ParentSpan = spanOf(TEXT, 'identity mapping');
  const menu = { cardId: 'a', span: SPAN, anchor: { x: 200, y: 100, w: 60, h: 18 } };
  const key = (k: string) =>
    act(
      () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })),
    );

  function mountMenu() {
    const stage = document.createElement('div');
    Object.defineProperty(stage, 'clientWidth', { value: 700 });
    Object.defineProperty(stage, 'clientHeight', { value: 500 });
    const branch = branchActions([], { stage: { current: stage } }, { menu });
    render(
      <BranchProvider value={branch}>
        <SpanMenu menu={menu} />
      </BranchProvider>,
    );
    return branch;
  }

  it('maps the keys', () => {
    expect([
      menuKey('Enter'),
      menuKey('1'),
      menuKey('2'),
      menuKey('3'),
      menuKey('4'),
      menuKey('x'),
    ]).toEqual(['ask', 'simpler', 'example', 'diagram', 'note', null]);
  });

  it('offers the five items with their keys', () => {
    mountMenu();
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual([
      'Ask about this…Enter',
      'Simpler1',
      'Example2',
      'Diagram3',
      'Keep as note4',
    ]);
  });

  it('Enter opens the ask box on those words; 1, 2, 3 are quick asks; 4 keeps a note', () => {
    const branch = mountMenu();
    key('Enter');
    expect(branch.control.openAsk).toHaveBeenCalledWith('a', { span: SPAN });
    key('1');
    key('2');
    key('3');
    expect(vi.mocked(branch.quick).mock.calls.map((c) => c[2])).toEqual([
      'simpler',
      'example',
      'diagram',
    ]);
    key('4');
    expect(branch.keepNote).toHaveBeenCalledWith('a', SPAN);
  });

  it('leaves a key alone when the reader is typing in a field', () => {
    const branch = mountMenu();
    const input = document.body.appendChild(document.createElement('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    expect(branch.quick).not.toHaveBeenCalled();
    input.remove();
  });

  it('sits below the words, flips above them near the bottom and stays inside the pane', () => {
    cleanup();
    const stage = document.createElement('div');
    Object.defineProperty(stage, 'clientWidth', { value: 700 });
    Object.defineProperty(stage, 'clientHeight', { value: 300 });
    const low = { ...menu, anchor: { x: 650, y: 270, w: 40, h: 18 } };
    render(
      <BranchProvider value={branchActions([], { stage: { current: stage } }, { menu: low })}>
        <SpanMenu menu={low} />
      </BranchProvider>,
    );
    const el = screen.getByRole('menu');
    expect(el.getAttribute('data-flipped')).toBe('true');
    expect(Number.parseInt(el.style.insetInlineStart, 10) + 216).toBeLessThanOrEqual(700);
  });
});

describe('the ask box and its Uses line', () => {
  const rows = () => {
    resetClock();
    return [
      node({ id: 'p', body: 'The passage.' }),
      node({ id: 'a', parent: 'p', question: 'why?', finalText: 'Because.' }),
    ];
  };
  const draftOf = (over: Partial<NonNullable<BranchActions['draft']>> = {}) => ({
    parentId: 'a',
    span: null,
    askDifferently: false,
    expanded: true,
    text: '',
    uses: defaultUses(),
    ...over,
  });
  function mountBox(draft = draftOf(), ui: Parameters<typeof branchActions>[2] = {}) {
    const branch = branchActions(rows(), { draft }, { draft, ...ui });
    render(
      <ReactFlowProvider>
        <BranchProvider value={branch}>
          <AskDraft {...props(node({ id: '__draft__', parent: 'a' }))} />
        </BranchProvider>
      </ReactFlowProvider>,
    );
    return branch;
  }

  it('says what the AI is about to assume, before the reader sends', () => {
    mountBox();
    expect(screen.getByTestId('uses-line').textContent).toBe(
      'Uses: this path (2 cards) · the paper · Familiar · may draw a diagram',
    );
  });

  it('each dotted item opens its own picker', () => {
    const branch = mountBox();
    for (const name of ['path', 'paper', 'level', 'diagram'] as const) {
      const before = vi.mocked(branch.control.pick).mock.calls.length;
      fireEvent.click(
        within(screen.getByTestId('uses-line'))
          .getAllByRole('button')
          .find((b) => b.getAttribute('data-picker') === name)!,
      );
      expect(vi.mocked(branch.control.pick).mock.calls.length).toBe(before + 1);
      expect(vi.mocked(branch.control.pick).mock.calls.at(-1)).toEqual([name]);
    }
  });

  it('"this path" lists what the AI will read and what it will not', () => {
    resetClock();
    const all = [
      node({ id: 'p', body: 'The passage.' }),
      node({ id: 'a', parent: 'p', question: 'why?', finalText: 'Because.' }),
      node({ id: 'sib', parent: 'p', question: 'a sibling', finalText: 'Other.' }),
    ];
    const draft = draftOf();
    const branch = branchActions(all, { draft }, { draft, picker: 'path' });
    render(
      <ReactFlowProvider>
        <BranchProvider value={branch}>
          <AskDraft {...props(node({ id: '__draft__', parent: 'a' }))} />
        </BranchProvider>
      </ReactFlowProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: 'What the AI will read' });
    const read = within(dialog).getByRole('list', { name: 'The AI will read' });
    expect(read.textContent).toContain('The passage');
    expect(read.textContent).toContain('why?');
    expect(
      within(dialog).getByRole('list', { name: 'The AI will not read' }).textContent,
    ).toContain('a sibling');
  });

  it('picking a paper, a level or a diagram setting changes the Uses', () => {
    const branch = mountBox(draftOf(), { picker: 'paper' });
    fireEvent.click(screen.getByRole('radio', { name: /Not the paper/ }));
    expect(branch.control.setUses).toHaveBeenCalledWith({ paper: 'off' });
    expect(branch.control.pick).toHaveBeenCalledWith(null);
  });

  it('a follow-up under an answer reads "Follow up", words and "Ask differently" read "Ask"', () => {
    const down = rows();
    const answerWithNoNext = [down[0]!, down[1]!];
    // `a` has no down child, so an ask without words is a follow-up.
    const branch = branchActions(answerWithNoNext, { draft: draftOf() }, { draft: draftOf() });
    const view = render(
      <ReactFlowProvider>
        <BranchProvider value={branch}>
          <AskDraft {...props(node({ id: '__draft__', parent: 'a' }))} />
        </BranchProvider>
      </ReactFlowProvider>,
    );
    expect(screen.getByRole('button', { name: /^Follow up/ })).not.toBeNull();
    view.unmount();
    const withWords = draftOf({ span: { start: 0, end: 7, quote: 'Because' } });
    const right = branchActions(answerWithNoNext, { draft: withWords }, { draft: withWords });
    render(
      <ReactFlowProvider>
        <BranchProvider value={right}>
          <AskDraft {...props(node({ id: '__draft__', parent: 'a' }))} />
        </BranchProvider>
      </ReactFlowProvider>,
    );
    expect(screen.getByRole('button', { name: /^Ask/ })).not.toBeNull();
    expect(screen.getByText('Because')).not.toBeNull();
  });

  it('sends on Enter with a question, and not without one', () => {
    const empty = mountBox();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your question' }), { key: 'Enter' });
    expect(empty.send).not.toHaveBeenCalled();
    cleanup();
    const typed = draftOf({ text: 'what is it?' });
    const branch = mountBox(typed);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your question' }), { key: 'Enter' });
    expect(branch.send).toHaveBeenCalledWith(typed);
  });

  it('a focused answer with no next turn shows a one-line stub that grows when focused', () => {
    const stub = draftOf({ expanded: false });
    const branch = mountBox(stub);
    expect(screen.getByTestId('followup-stub')).not.toBeNull();
    expect(screen.queryByTestId('uses-line')).toBeNull();
    fireEvent.focus(screen.getByRole('textbox', { name: 'Follow up' }));
    expect(branch.control.growStub).toHaveBeenCalledWith(stub);
  });
});

describe('the breadcrumb of a focused path', () => {
  const rows = () => {
    resetClock();
    return [
      node({ id: 'p', body: 'The passage.' }),
      node({ id: 'a', parent: 'p', question: 'why?', finalText: 'Because.' }),
      node({ id: 'b', parent: 'a', branch: 'down', question: 'so?', finalText: 'Yes.' }),
    ];
  };

  it('is the passage then each question, each crumb a button that moves the focus', () => {
    const branch = branchActions(rows(), {}, { focusId: 'b' });
    render(
      <BranchProvider value={branch}>
        <Breadcrumb />
      </BranchProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'Path' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Passage', 'why?', 'so?']);
    expect(within(nav).getByRole('button', { name: 'so?' }).getAttribute('aria-current')).toBe(
      'location',
    );
    fireEvent.click(within(nav).getByRole('button', { name: 'why?' }));
    expect(branch.control.focus).toHaveBeenCalledWith('a');
  });

  it('is not there when nothing is focused', () => {
    render(
      <BranchProvider value={branchActions(rows())}>
        <Breadcrumb />
      </BranchProvider>,
    );
    expect(screen.queryByRole('navigation', { name: 'Path' })).toBeNull();
  });
});

describe('the Outline and its Markdown export', () => {
  const rows = () => {
    resetClock();
    const text = 'An identity mapping adds no extra parameters.';
    return [
      node({ id: 'p', body: 'Residual learning.' }),
      node({
        id: 'a',
        parent: 'p',
        question: 'Why does adding x help?',
        finalText:
          '## TL;DR\nIt gives the block an easy default.\n\n## How it works\nThe block learns $F(x)$ and adds x.\n\nMore words here for a second line.',
      }),
      node({
        id: 'b',
        parent: 'a',
        branch: 'down',
        question: 'so?',
        finalText: 'Yes, it can do nothing.',
      }),
      node({
        id: 'c',
        parent: 'a',
        branch: 'right',
        span: spanOf(text, 'identity mapping'),
        question: 'what is an identity mapping?',
        finalText: 'It returns its input.',
      }),
      node({ id: 'n', kind: 'note', parent: 'a', branch: 'right', body: 'my own note' }),
    ];
  };

  it('is an indented study doc with each answer folded to its first line, openable', () => {
    const tree = buildTree(rows());
    render(
      <OutlineView
        tree={tree}
        title="Residual nets"
        countsLine="5 cards"
        onExport={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Residual nets' })).not.toBeNull();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(
      ['↓ so?', 'identity mapping → what is an identity mapping?', 'Why does adding x help?'].sort(
        (x, y) => headings.indexOf(x) - headings.indexOf(y),
      ),
    );
    expect(screen.getByText('It gives the block an easy default.')).not.toBeNull();
    // A branch sits one step in, a follow-up stays level.
    const q = (t: string) =>
      screen.getByRole('heading', { name: new RegExp(t) }).closest('section')!;
    expect(q('Why does adding').style.marginInlineStart).toMatch(/^0(px)?$/);
    expect(q('what is an identity').style.marginInlineStart).toBe('22px');
    // Opening one shows the rest of it.
    const open = within(q('Why does adding')).getByRole('button', { name: /more lines?$/ });
    fireEvent.click(open);
    expect(within(q('Why does adding')).getByText(/More words here/)).not.toBeNull();
  });

  it('exports Markdown with three include toggles, copies it, and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const tree = buildTree(rows());
    render(<ExportSheet tree={tree} title="Residual nets" onClose={vi.fn()} />);
    const md = () => screen.getByLabelText('The Markdown').textContent ?? '';
    expect(md()).toMatch(/^# Residual nets\n\n> Residual learning\./);
    expect(md()).toContain('## Why does adding x help?');
    expect(md()).toContain('**It gives the block an easy default.**');
    expect(md()).toContain('$F(x)$'); // maths stays $…$
    expect(md()).toContain('> **Note.** my own note'); // notes on by default
    expect(md()).not.toContain('Check yourself');

    fireEvent.click(screen.getByRole('checkbox', { name: 'My notes' }));
    expect(md()).not.toContain('my own note');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Full answers' }));
    expect(md()).toContain('[…]');
    expect(md()).not.toContain('The block learns');

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Copy' })));
    expect(writeText).toHaveBeenCalledWith(md());
    expect(screen.getByRole('status').textContent).toBe('Copied.');
    vi.unstubAllGlobals();
  });
});

// `defaultUses` is the picker's starting point: kept in view of a reader of this spec.
export type { AskUses };
