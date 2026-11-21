/**
 * The Mermaid figure inside an answer (features/diagram MermaidDiagram), with `mermaid` mocked: a
 * placeholder and no library load until the fence closes, parse first, nothing drawn when it does
 * not parse, the theme handed to Mermaid from the figure's tokens and again when the room changes,
 * the accessible name, and the larger / smaller click.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MermaidDiagram } from '@/features/diagram';
import { resetMermaid } from '@/features/diagram/mermaid/render';

const mock = vi.hoisted(() => ({
  loaded: vi.fn(),
  initialize: vi.fn(),
  parse: vi.fn(async (): Promise<unknown> => ({ diagramType: 'flowchart-v2' })),
  render: vi.fn(async (id: string) => ({
    svg: `<svg id="${id}" viewBox="0 0 640 300" width="100%" style="max-width: 640px;"><style>#${id} .node{fill:red}</style><g class="node"><text>Query</text></g></svg>`,
  })),
}));

vi.mock('mermaid', () => {
  mock.loaded();
  return {
    default: { initialize: mock.initialize, parse: mock.parse, render: mock.render },
  };
});

const BODY =
  'flowchart LR\n  query["User query"] --> merge["Merge"]\n  merge --> results["Results"]';

beforeEach(() => {
  resetMermaid();
  mock.loaded.mockClear();
  mock.initialize.mockClear();
  mock.parse.mockClear();
  mock.render.mockClear();
  mock.parse.mockImplementation(async () => ({ diagramType: 'flowchart-v2' }));
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-pt-theme');
  document.documentElement.removeAttribute('data-pt-page');
});

describe('MermaidDiagram', () => {
  it('holds a quiet placeholder and does not even load Mermaid until the fence closes', async () => {
    const view = render(<MermaidDiagram body="flowchart LR\n  a --> b" closed={false} />);
    expect(view.container.querySelector('[data-diagram-pending]')).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mock.loaded).not.toHaveBeenCalled();
    expect(mock.render).not.toHaveBeenCalled();
    view.rerender(<MermaidDiagram body={BODY} closed />);
    await waitFor(() => expect(view.container.querySelector('[data-mermaid] svg')).not.toBeNull());
    expect(mock.loaded).toHaveBeenCalledTimes(1);
  });

  it('draws the svg, parsing first and initialising strictly with the app theme', async () => {
    const view = render(<MermaidDiagram body={BODY} closed />);
    await waitFor(() => expect(view.container.querySelector('[data-mermaid] svg')).not.toBeNull());
    expect(mock.parse).toHaveBeenCalledWith(BODY, { suppressErrors: true });
    expect(mock.parse.mock.invocationCallOrder[0]).toBeLessThan(
      mock.render.mock.invocationCallOrder[0] as number,
    );
    const config = mock.initialize.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config).toMatchObject({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      suppressErrorRendering: true,
    });
    const vars = config['themeVariables'] as Record<string, unknown>;
    expect(vars['primaryTextColor']).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['fontFamily']).toBeTruthy();
    // The drawing is hidden from assistive tech; the figure carries the name.
    const figure = view.container.querySelector('[data-mermaid]') as HTMLElement;
    expect(figure.getAttribute('aria-label')).toBe(
      'Diagram, flowchart: User query, Merge, Results',
    );
    expect(figure.querySelector('.pt-mmd__svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe('640px');
  });

  it('draws nothing, and never the code, when the fence does not parse', async () => {
    mock.parse.mockImplementation(async () => false);
    const view = render(<MermaidDiagram body={BODY} closed />);
    await waitFor(() =>
      expect(view.container.querySelector('[data-mermaid-failed]')).not.toBeNull(),
    );
    expect(mock.render).not.toHaveBeenCalled();
    expect(view.container.querySelector('svg')).toBeNull();
    expect(view.container.textContent).toBe('');
    expect((view.container.firstChild as HTMLElement).hidden).toBe(true);
  });

  it('draws nothing when Mermaid throws while drawing, and leaves no stray node behind', async () => {
    mock.render.mockImplementationOnce(async () => {
      throw new Error('Parse error on line 2');
    });
    const view = render(<MermaidDiagram body={BODY} closed />);
    await waitFor(() =>
      expect(view.container.querySelector('[data-mermaid-failed]')).not.toBeNull(),
    );
    expect(document.querySelector('[id^="dpt-mmd"]')).toBeNull();
    expect(view.container.textContent).toBe('');
  });

  it('draws again, with the new theme, when the room or the page changes', async () => {
    // happy-dom does not inherit custom properties, so the computed tokens are stood in for.
    const rooms: Record<string, Record<string, string>> = {
      light: { '--pt-page': '#faf8f3', '--pt-ink': '#2a2521' },
      dark: { '--pt-page': '#2c251f', '--pt-ink': '#ede4d3' },
    };
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          getPropertyValue: (name: string) =>
            rooms[document.documentElement.dataset['ptTheme'] ?? 'light']?.[name] ?? '',
        }) as unknown as CSSStyleDeclaration,
    );
    try {
      const view = render(<MermaidDiagram body={BODY} closed />);
      await waitFor(() => expect(mock.render).toHaveBeenCalledTimes(1));
      await act(async () => {
        document.documentElement.setAttribute('data-pt-theme', 'dark');
        await Promise.resolve();
      });
      await waitFor(() => expect(mock.render).toHaveBeenCalledTimes(2));
      const themes = mock.initialize.mock.calls.map(
        (call) => (call[0] as { themeVariables: Record<string, unknown> }).themeVariables,
      );
      expect(themes[0]).toMatchObject({
        darkMode: false,
        background: '#faf8f3',
        textColor: '#2a2521',
      });
      expect(themes[1]).toMatchObject({
        darkMode: true,
        background: '#2c251f',
        textColor: '#ede4d3',
      });
      expect(view.container.querySelector('[data-mermaid] svg')).not.toBeNull();
      // A change that leaves the tokens alone draws nothing again.
      await act(async () => {
        document.documentElement.setAttribute('data-pt-page', 'dark');
        await Promise.resolve();
      });
      expect(mock.render).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('shows larger on click, smaller on click or Escape, keyboard-reachable as a button', async () => {
    const view = render(<MermaidDiagram body={BODY} closed />);
    await waitFor(() => expect(view.container.querySelector('[data-mermaid] svg')).not.toBeNull());
    const figure = view.container.querySelector('[data-mermaid]') as HTMLElement;
    const button = figure.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Show the diagram larger');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(figure.getAttribute('data-large')).toBe('false');
    fireEvent.click(button);
    expect(figure.getAttribute('data-large')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Show the diagram smaller');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(figure.getAttribute('data-large')).toBe('false');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(figure.getAttribute('data-large')).toBe('false');
  });

  it('keeps a drawing for the same text and theme: a remount does not draw again', async () => {
    const one = render(<MermaidDiagram body={BODY} closed />);
    await waitFor(() => expect(one.container.querySelector('[data-mermaid] svg')).not.toBeNull());
    one.unmount();
    const two = render(<MermaidDiagram body={BODY} closed />);
    await waitFor(() => expect(two.container.querySelector('[data-mermaid] svg')).not.toBeNull());
    expect(mock.render).toHaveBeenCalledTimes(1);
  });
});
