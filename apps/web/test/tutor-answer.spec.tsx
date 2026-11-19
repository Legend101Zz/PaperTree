/**
 * v0.3 tutor answer on the web (#339, #349): the section labels and the lead, the inline diagram
 * fence (placeholder, invalid -> nothing), Check yourself, the level switch (cached levels cost no
 * request; the request fields), the go-deeper chips, the foot, and the small card that draws none
 * of the panel's extras. `fetch` is the only stub; the hook, the SSE reader and the panel are real.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasActionsProvider } from '@/features/board/components/BoardContext';
import { ExplanationCard } from '@/features/board/components/cards/ExplanationCard';
import { toFlowNode, type PtNode } from '@/features/board/model/flow';
import { cardRow } from '@/features/board/model/test-data';

import { focusAnchor, Harness, stubDesktop } from './s6-harness';
import {
  citation,
  done,
  frame,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
  text,
  usage,
  type SseHandle,
} from './s6-support';

beforeEach(() => {
  stubDesktop();
  focusAnchor.mockReset();
  window.localStorage.setItem('papertree.session', 'test-token');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const THREADS = `POST /papers/${PAPER}/threads`;
const MESSAGES = `POST /papers/${PAPER}/threads/thr_1/messages`;

const PART = (label: string, after: string[] = [], kind = 'step'): string =>
  JSON.stringify({ t: 'part', label, kind, after, cite: null });

const DIAGRAM = [
  '```diagram',
  PART('Input x', [], 'input'),
  PART('Two layers', ['A']),
  PART('Add', ['B', 'A'], 'output'),
  '```',
].join('\n');

const CHECK = [
  '```check',
  'prompt: If $F(x) = 0$, the block outputs ___.',
  'accept: x | the input | input',
  'right: Right. The block hands its input straight on.',
  'hint: Put 0 in place of the layers and see what is left.',
  '```',
].join('\n');

const FAMILIAR = [
  '## TL;DR',
  'A shortcut adds the input back.',
  '',
  '## In plain words',
  'Think of an editor, not an author [b1].',
  '',
  '## How it works',
  'The layers compute a correction.',
  DIAGRAM,
  '$$y = F(x) + x$$',
  'Here $x$ is the input.',
  '',
  '## In the paper',
  'The paper notes there are no extra parameters [b2].',
].join('\n');

const EXPERT =
  '## TL;DR\nThe expert version.\n\n## The trade-off\nIt buys depth, it costs a projection.';

const answer = (body: string, id = 'msg_a1'): string[] => [
  run({ message_id: id }),
  text(body),
  frame('citations', { items: [citation('b1'), citation('b2')] }),
  usage({ model: 'MiniMax-M3.1-Flash' }),
  done('complete', null, id),
];

const ask = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'ask one' }));
};

describe('the tutor answer in the Explain panel', () => {
  it('draws the labels, the lead, maths, the inline diagram and the foot; nothing raw', async () => {
    installFetch({ [THREADS]: (_c, signal) => sseResponse(answer(FAMILIAR), { signal }) });
    render(<Harness />);
    ask();
    await waitFor(() => expect(document.querySelector('[data-diagram-inline]')).not.toBeNull());
    await waitFor(() =>
      expect(document.querySelector('.pt-answer-foot')?.textContent).toBe('M3.1 Flash'),
    );

    const panel = screen.getByRole('complementary', { name: 'Explain' });
    expect(
      [...panel.querySelectorAll('.pt-ai-slip h3.pt-ai-label')].map((h) => h.textContent),
    ).toEqual(['tl;dr', 'in plain words', 'how it works', 'in the paper']);
    // The TL;DR paragraph is the lead, with no source line of its own.
    const lead = panel.querySelector('.pt-ai-lead') as HTMLElement;
    expect(lead.textContent).toBe('A shortcut adds the input back.');
    expect(lead.closest('.pt-ai-slip__row')?.querySelector('.pt-source')).toBeNull();
    // Maths is typeset (inline and display), never a raw dollar.
    expect(panel.querySelector('.katex-display')).not.toBeNull();
    expect(panel.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    // The diagram is a figure with its parts named for assistive tech.
    const figure = panel.querySelector('[data-diagram-inline]') as HTMLElement;
    expect(figure.getAttribute('data-diagram-inline')).toBe('3');
    expect(figure.textContent).toContain('Two layers');
    // No raw fence, NDJSON, handle or heading mark.
    const slip = panel.querySelector('.pt-ai-slip__grid') as HTMLElement;
    expect(slip.textContent).not.toMatch(/```|\{"t"|\[b\d\]|## |\$/);
    // The paragraph that cites the paper keeps its one quiet source line.
    expect(document.querySelector('.pt-source')?.textContent).toMatch(/^From the paper: p\. 4/);
    // The level shows, Familiar by default.
    expect(
      within(panel).getByRole('button', { name: 'Familiar' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('an older answer with no headings still renders as plain paragraphs', async () => {
    installFetch({
      [THREADS]: (_c, signal) =>
        sseResponse(answer('First paragraph [b1].\n\nSecond paragraph.'), { signal }),
    });
    render(<Harness />);
    ask();
    await screen.findByText(/Second paragraph/);
    expect(document.querySelector('h3.pt-ai-label')).toBeNull();
    expect(document.querySelector('.pt-ai-lead')).toBeNull();
  });

  it('while the diagram fence is open a quiet placeholder stands; the figure lands when it closes', async () => {
    let handle: SseHandle | undefined;
    installFetch({
      [THREADS]: (_c, signal) =>
        sseResponse(
          [
            run(),
            text(
              `## TL;DR\nShort.\n\n## How it works\nSee:\n\`\`\`diagram\n${PART('Input x', [], 'input')}\n{"t":"par`,
            ),
          ],
          { hold: true, signal, onHandle: (h) => (handle = h) },
        ),
    });
    render(<Harness />);
    ask();
    await waitFor(() => expect(document.querySelector('[data-diagram-pending]')).not.toBeNull());
    expect(document.querySelector('[data-diagram-inline]')).toBeNull();
    // Raw lines never show, and the placeholder says nothing to assistive tech.
    expect(document.body.textContent).not.toMatch(/\{"t"/);
    expect(document.querySelector('[data-diagram-pending]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    handle?.push(text('t":"end"}\n```\nAfter.'));
    await waitFor(() => expect(document.querySelector('[data-diagram-inline]')).not.toBeNull());
    expect(document.querySelector('[data-diagram-pending]')).toBeNull();
    handle?.push(done());
    handle?.close();
  });

  it('a diagram fence that holds nothing drawable draws nothing, not its raw lines', async () => {
    installFetch({
      [THREADS]: (_c, signal) =>
        sseResponse(
          answer(
            '## How it works\nSee:\n```diagram\n{"t":"plate","title":"x"}\nnot json\n```\nAfter the figure.',
          ),
          { signal },
        ),
    });
    render(<Harness />);
    ask();
    await screen.findByText(/After the figure/);
    expect(document.querySelector('[data-diagram-inline], [data-diagram-pending]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\{"t"|not json|```/);
  });

  it('the foot says writing… with Stop while it streams, and stopped after Stop (the text stays)', async () => {
    installFetch({
      [THREADS]: (_c, signal) =>
        sseResponse([run(), text('## TL;DR\nHalf an answer')], { hold: true, signal }),
      'POST /runs/run_1/cancel': () => jsonResponse(202, {}),
    });
    render(<Harness />);
    ask();
    await screen.findByText(/Half an answer/);
    const foot = document.querySelector('.pt-answer-foot') as HTMLElement;
    expect(foot.textContent).toContain('writing…');
    fireEvent.click(within(foot).getByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(document.querySelector('.pt-answer-foot')?.textContent).toMatch(/stopped$/),
    );
    expect(screen.getByText(/Half an answer/)).toBeTruthy();
  });
});

describe('Check yourself', () => {
  async function open(): Promise<HTMLElement> {
    installFetch({
      [THREADS]: (_c, signal) => sseResponse(answer(`${FAMILIAR}\n\n${CHECK}`), { signal }),
    });
    render(<Harness />);
    ask();
    return (await waitFor(() => {
      const block = document.querySelector<HTMLElement>('.pt-check');
      expect(block).not.toBeNull();
      return block as HTMLElement;
    })) as HTMLElement;
  }

  const blank = (): HTMLInputElement => screen.getByLabelText('Fill the blank');
  const type = (value: string): void => {
    fireEvent.change(blank(), { target: { value } });
  };
  const enter = (): void => {
    fireEvent.keyDown(blank(), { key: 'Enter' });
  };

  it('is drawn in the panel: a labelled blank, Enter to check, Show me, Skip', async () => {
    const block = await open();
    expect(block.textContent).toContain('check yourself');
    expect(block.textContent).toContain('optional');
    expect(block.querySelector('.katex')).not.toBeNull();
    expect(within(block).getByText('Enter')).toBeTruthy();
    expect(within(block).getByRole('button', { name: 'Show me' })).toBeTruthy();
    expect(within(block).getByRole('button', { name: 'Skip' })).toBeTruthy();
    // The raw fence never reaches the screen.
    expect(document.body.textContent).not.toMatch(/accept:|prompt:|hint:/);
  });

  it('a right fill (normalised) shows the right line and closes the blank', async () => {
    const block = await open();
    type('  The INPUT. ');
    enter();
    expect(block.textContent).toContain('Right. The block hands its input straight on.');
    expect(blank().readOnly).toBe(true);
    expect(within(block).queryByRole('button', { name: 'Show me' })).toBeNull();
  });

  it('a wrong fill shows the hint once and keeps the blank open; then the right one passes', async () => {
    const block = await open();
    type('zero');
    enter();
    expect(block.textContent).toContain('Not quite.');
    expect(block.textContent).toContain('Put 0 in place of the layers');
    expect(blank().readOnly).toBe(false);
    enter();
    expect(block.textContent?.match(/Put 0 in place/g)).toHaveLength(1);
    type('x');
    enter();
    expect(block.textContent).toContain('Right.');
  });

  it('Show me fills the first accepted fill and says why it is right', async () => {
    const block = await open();
    fireEvent.click(within(block).getByRole('button', { name: 'Show me' }));
    expect(blank().value).toBe('x');
    expect(block.textContent).toContain('Right.');
  });

  it('Skip folds it to "Skipped. Bring it back", and Bring it back reopens it with what was typed', async () => {
    const block = await open();
    type('zer');
    fireEvent.click(within(block).getByRole('button', { name: 'Skip' }));
    expect(block.textContent).toContain('Skipped.');
    expect(screen.queryByLabelText('Fill the blank')).toBeNull();
    fireEvent.click(within(block).getByRole('button', { name: 'Bring it back' }));
    expect(blank().value).toBe('zer');
  });

  it('Esc leaves the block for the panel; a second Esc closes the panel', async () => {
    await open();
    blank().focus();
    fireEvent.keyDown(blank(), { key: 'Escape' });
    const panel = screen.getByRole('complementary', { name: 'Explain' });
    expect(document.activeElement).toBe(panel);
    expect(screen.queryByRole('complementary', { name: 'Explain' })).not.toBeNull();
    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull(),
    );
  });
});

describe('the level switch (#349)', () => {
  const posts = (calls: { method: string; path: string; body: unknown }[]) =>
    calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages'));

  async function opened() {
    const routes = installFetch({
      [THREADS]: (_c, signal) => sseResponse(answer(FAMILIAR), { signal }),
      [MESSAGES]: (_c, signal) => sseResponse(answer(EXPERT, 'msg_a2'), { signal }),
    });
    render(<Harness />);
    ask();
    await waitFor(() => expect(document.querySelector('[data-level-switch]')).not.toBeNull());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Expert' })).toHaveProperty('disabled', false),
    );
    return routes;
  }

  it('asks the same question again at the new level (relevel_of, level), not a new turn', async () => {
    const { calls } = await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    await screen.findByText('The expert version.');
    expect(posts(calls)).toHaveLength(1);
    // No `question`: the server re-asks the stored one.
    expect(posts(calls)[0]?.body).toEqual({ level: 'expert', relevel_of: 'msg_a1' });
    // The expert answer's second section is "the trade-off", and the switch shows Expert.
    expect([...document.querySelectorAll('h3.pt-ai-label')].map((h) => h.textContent)).toEqual([
      'tl;dr',
      'the trade-off',
    ]);
    expect(screen.getByRole('button', { name: 'Expert' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // It is the same exchange: one ask on the screen, not two.
    expect(document.querySelectorAll('.pt-exchange')).toHaveLength(1);
  });

  it('switching back to a level already fetched shows it again with no request', async () => {
    const { calls } = await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    await screen.findByText('The expert version.');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Familiar' })).toHaveProperty('disabled', false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Familiar' }));
    await screen.findByText('A shortcut adds the input back.');
    expect(screen.queryByText('The expert version.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    await screen.findByText('The expert version.');
    // One request in all: the first visit to Expert.
    expect(posts(calls)).toHaveLength(1);
    // The cached level comes back with a one-off fade, never typed out again.
    expect(document.querySelector('[data-fade]')).not.toBeNull();
    expect(document.querySelector('.pt-exchange__caret')).toBeNull();
  });

  it('a failed level is retried as the same level of the same question, never with retry_of', async () => {
    let tries = 0;
    const { calls } = installFetch({
      [THREADS]: (_c, signal) => sseResponse(answer(FAMILIAR), { signal }),
      [MESSAGES]: (_c, signal) => {
        tries += 1;
        return sseResponse(
          tries === 1
            ? [
                run({ message_id: 'msg_a2' }),
                text('Half of it'),
                done('error', { code: 'internal', retryable: true }, 'msg_a2'),
              ]
            : answer(EXPERT, 'msg_a3'),
          { signal },
        );
      },
    });
    render(<Harness />);
    ask();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Expert' })).toHaveProperty('disabled', false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await screen.findByText('The expert version.');
    const bodies = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages'));
    expect(bodies.map((c) => c.body)).toEqual([
      { level: 'expert', relevel_of: 'msg_a1' },
      { level: 'expert', relevel_of: 'msg_a1' },
    ]);
  });

  it('later asks are made at the chosen level', async () => {
    const { calls } = await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    await screen.findByText('The expert version.');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'An example' })).toHaveProperty('disabled', false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'An example' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(2));
    expect(posts(calls)[1]?.body).toEqual({
      question: 'Give me a concrete example of this.',
      level: 'expert',
    });
  });
});

describe('go deeper (§3)', () => {
  const CASES: readonly [string, Record<string, unknown>][] = [
    ['An example', { question: 'Give me a concrete example of this.', level: 'familiar' }],
    ['Show the math', { question: 'Show the maths step by step.', level: 'familiar' }],
    [
      'Why it matters',
      { question: "Why does this matter for the paper's results?", level: 'familiar' },
    ],
    [
      'Where else in the paper',
      { question: 'Where else in the paper does this idea come up?', level: 'familiar' },
    ],
    ['Simpler', { level: 'new', relevel_of: 'msg_a1' }],
  ];

  it.each(CASES)('the %s chip sends its fixed follow-up', async (label, expected) => {
    const { calls } = installFetch({
      [THREADS]: (_c, signal) => sseResponse(answer(FAMILIAR), { signal }),
      [MESSAGES]: (_c, signal) => sseResponse(answer('Quick answer.', 'msg_a2'), { signal }),
    });
    render(<Harness />);
    ask();
    const chip = await screen.findByRole('button', { name: label });
    await waitFor(() => expect((chip as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(chip);
    await screen.findByText('Quick answer.');
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/messages'));
    expect(post?.body).toEqual(expected);
  });

  it('a quick ask shows no thinking placeholder while it waits for its first word', async () => {
    let handle: SseHandle | undefined;
    installFetch({
      [THREADS]: (_c, signal) => sseResponse(answer(FAMILIAR), { signal }),
      [MESSAGES]: (_c, signal) =>
        sseResponse([run({ message_id: 'msg_a2' })], {
          hold: true,
          signal,
          onHandle: (h) => (handle = h),
        }),
    });
    render(<Harness />);
    ask();
    const chip = await screen.findByRole('button', { name: 'An example' });
    await waitFor(() => expect((chip as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(chip);
    await waitFor(() => expect(document.querySelectorAll('.pt-exchange')).toHaveLength(2));
    // The long ask shows grey placeholder lines; a quick one shows only its foot.
    expect(document.querySelectorAll('.pt-explain__skeleton')).toHaveLength(0);
    handle?.close();
  });
});

describe('the small board card', () => {
  it('draws the labels, maths and diagram but no check block and no level switch', () => {
    const node = toFlowNode(cardRow('explanation', { body: `${FAMILIAR}\n\n${CHECK}` }), 'ppr_1');
    const props = { ...node, selected: false, dragging: false } as unknown as NodeProps<PtNode>;
    const { container } = render(
      <ReactFlowProvider>
        <CanvasActionsProvider
          value={{
            editingId: null,
            setEditingId: vi.fn(),
            commitBody: vi.fn(),
            commitTitle: vi.fn(),
            commitSize: vi.fn(),
            openCitation: vi.fn(),
          }}
        >
          <ExplanationCard {...props} />
        </CanvasActionsProvider>
      </ReactFlowProvider>,
    );
    expect([...container.querySelectorAll('h3.pt-ai-label')].map((h) => h.textContent)).toEqual([
      'tl;dr',
      'in plain words',
      'how it works',
      'in the paper',
    ]);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('[data-diagram-inline]')).not.toBeNull();
    expect(container.querySelector('.pt-check, [data-level-switch], [data-go-deeper]')).toBeNull();
    expect(container.textContent).not.toMatch(/accept:|prompt:|```|\{"t"/);
  });
});
