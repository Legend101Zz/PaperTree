/**
 * The Mermaid figure's size in the room it has (v0.3 W6): fitted to the room but never below 0.7,
 * scrolling sideways when wider, with a fade cue that goes at the end, and "larger" for the natural
 * size. `renderMermaid` is replaced by a stand-in drawing of a known natural width.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MermaidDiagram } from './MermaidDiagram';

const draw = vi.hoisted(() => ({ width: 3290 }));

vi.mock('../mermaid/render', () => ({
  renderMermaid: () =>
    Promise.resolve({
      ok: true as const,
      svg: '<svg viewBox="0 0 3290 300"></svg>',
      width: draw.width,
      height: 300,
    }),
}));

const ROOM = 496;

beforeEach(() => {
  // A test DOM has no layout: the scroll box is 496 px wide, as the 520 px panel's is.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(ROOM);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BODY = 'timeline\n  title History\n  2014 : Bahdanau';

async function drawn(): Promise<HTMLElement> {
  render(<MermaidDiagram body={BODY} closed />);
  return waitFor(() => {
    const figure = document.querySelector<HTMLElement>('figure[data-mermaid]');
    if (figure === null) throw new Error('not drawn yet');
    return figure;
  });
}

describe('MermaidDiagram size', () => {
  it('a very wide drawing is held at 0.7 of its natural size and scrolls, with the fade showing', async () => {
    draw.width = 3290;
    const figure = await drawn();
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe(`${String(Math.round(3290 * 0.7))}px`);
    expect(figure.getAttribute('data-scrolls')).toBe('true');
    expect(figure.querySelector('.pt-mmd__scroll')).not.toBeNull();
    expect(figure.querySelector('.pt-mmd__fade')).not.toBeNull();
  });

  it('the fade goes once the reader has scrolled to the far end', async () => {
    draw.width = 3290;
    const figure = await drawn();
    const scroller = figure.querySelector<HTMLElement>('.pt-mmd__scroll') as HTMLElement;
    vi.spyOn(scroller, 'scrollWidth', 'get').mockReturnValue(2303);
    scroller.scrollLeft = 2303 - ROOM;
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(figure.getAttribute('data-scrolls')).toBe('false');
  });

  it('a drawing a little wider than the room shrinks to fit it and does not scroll', async () => {
    draw.width = 600;
    const figure = await drawn();
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe(`${String(ROOM)}px`);
    expect(figure.getAttribute('data-scrolls')).toBe('false');
  });

  it('a drawing that fits stays at its natural size', async () => {
    draw.width = 300;
    const figure = await drawn();
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe('300px');
    expect(figure.getAttribute('data-scrolls')).toBe('false');
  });

  it('"larger" shows the natural size, still scrolling; clicking again returns to the fitted size', async () => {
    draw.width = 3290;
    const figure = await drawn();
    fireEvent.click(screen.getByRole('button', { name: 'Show the diagram larger' }));
    expect(figure.getAttribute('data-large')).toBe('true');
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe('3290px');
    expect(figure.getAttribute('data-scrolls')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Show the diagram smaller' }));
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe(`${String(Math.round(3290 * 0.7))}px`);
  });
});
