/**
 * A ```mermaid fence inside an answer, through the same body the panel, the board card and the
 * notebook draw (`AnswerBody`), with `mermaid` mocked: a quiet placeholder and no raw code while
 * the fence streams, the figure when it closes, nothing when it does not parse, and the older
 * ```diagram fence of a stored answer still on its own (layered) path.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetMermaid } from '@/features/diagram/mermaid/render';
import { answerModel } from '@/features/explain/model/answer';

import { Answer } from './answer-render';

const mock = vi.hoisted(() => ({
  parse: vi.fn(async (): Promise<unknown> => ({ diagramType: 'sequence' })),
  render: vi.fn(async (id: string) => ({
    svg: `<svg id="${id}" viewBox="0 0 400 200"><g><text>Reader</text></g></svg>`,
  })),
}));
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), parse: mock.parse, render: mock.render },
}));

const FENCE = 'sequenceDiagram\n  participant Reader\n  participant Tutor\n  Reader->>Tutor: Asks';
const answer = (fence: string): string =>
  `## TL;DR\nShort.\n\n## How it works\nSee:\n\`\`\`mermaid\n${fence}\n\`\`\`\nAfter the figure.`;

beforeEach(() => {
  resetMermaid();
  mock.parse.mockClear();
  mock.render.mockClear();
  mock.parse.mockImplementation(async () => ({ diagramType: 'sequence' }));
});
afterEach(cleanup);

describe('a mermaid fence in an answer', () => {
  it('stands as a placeholder, never raw code, while it streams; the figure lands on close', async () => {
    const open = `## TL;DR\nShort.\n\n## How it works\nSee:\n\`\`\`mermaid\n${FENCE}`;
    const view = render(<Answer text={open} status="streaming" />);
    expect(view.container.querySelector('[data-diagram-pending]')).not.toBeNull();
    expect(view.container.textContent).not.toMatch(/sequenceDiagram|participant|```/);
    expect(mock.render).not.toHaveBeenCalled();
    view.rerender(<Answer text={answer(FENCE)} status="streaming" />);
    await waitFor(() => expect(view.container.querySelector('[data-mermaid] svg')).not.toBeNull());
    expect(view.container.querySelector('[data-diagram-pending]')).toBeNull();
    expect(view.container.textContent).toContain('After the figure.');
    expect(view.container.textContent).not.toMatch(/participant|```/);
  });

  it('a half-typed fence marker is held back, not flashed as text', () => {
    const view = render(<Answer text={'## How it works\nSee:\n``'} status="streaming" />);
    expect(view.container.textContent).not.toContain('`');
  });

  it('draws nothing, and not the code, when Mermaid cannot parse it', async () => {
    mock.parse.mockImplementation(async () => false);
    const view = render(<Answer text={answer('flowchart LR\n  a[ -->')} />);
    await waitFor(() =>
      expect(view.container.querySelector('[data-mermaid-failed]')).not.toBeNull(),
    );
    expect(view.container.querySelector('svg')).toBeNull();
    expect(view.container.textContent).not.toMatch(/flowchart|-->|```/);
    expect(view.container.textContent).toContain('After the figure.');
  });

  it('a stopped answer with an unclosed fence shows no placeholder that waits for nothing', () => {
    const open = `## How it works\nSee:\n\`\`\`mermaid\n${FENCE}`;
    const model = answerModel(open, () => undefined, false);
    expect(model.blocks.some((b) => b.k === 'mermaid')).toBe(false);
    const live = answerModel(open, () => undefined, true);
    expect(live.blocks.find((b) => b.k === 'mermaid')).toMatchObject({ closed: false });
  });

  it('an older stored answer keeps its layered ```diagram figure, and loads no Mermaid', async () => {
    const plate = [
      '{"t":"plate","title":"Block"}',
      '{"t":"part","label":"Input x","kind":"input","after":[]}',
      '{"t":"part","label":"Layers","kind":"step","after":["A"]}',
    ].join('\n');
    const view = render(
      <Answer text={`## How it works\nSee:\n\`\`\`diagram\n${plate}\n\`\`\`\nAfter.`} />,
    );
    await waitFor(() =>
      expect(view.container.querySelector('[data-diagram-inline]')).not.toBeNull(),
    );
    expect(view.container.querySelector('[data-mermaid]')).toBeNull();
    expect(mock.parse).not.toHaveBeenCalled();
  });
});
