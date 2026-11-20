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

async function drawn(compact = false): Promise<HTMLElement> {
  render(<MermaidDiagram body={BODY} closed compact={compact} />);
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

  it('the "larger" control sits in a caption row under the drawing, outside the scroll box', async () => {
    draw.width = 3290;
    const figure = await drawn();
    const scroller = figure.querySelector<HTMLElement>('.pt-mmd__scroll') as HTMLElement;
    const button = screen.getByRole('button', { name: 'Show the diagram larger' });
    expect(scroller.contains(button)).toBe(false);
    expect(button.closest('.pt-mmd__caption')).not.toBeNull();
    expect(scroller.contains(button.closest('.pt-mmd__caption'))).toBe(false);
    // The row follows the drawing in the document: under it, never over it.
    expect(
      scroller.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(button.textContent).toBe('larger');
  });

  it('Esc on the control puts a large figure back', async () => {
    draw.width = 3290;
    const figure = await drawn();
    const button = screen.getByRole('button', { name: 'Show the diagram larger' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toBe('smaller');
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(figure.getAttribute('data-large')).toBe('false');
  });
});

describe('MermaidDiagram in a board card', () => {
  const CARD = 290;
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(CARD);
  });

  it('shows the whole drawing fitted to the width: no minimum scale, no sideways scroll', async () => {
    draw.width = 700;
    const figure = await drawn(true);
    // 290 / 700 = 0.41, well under the panel's 0.7 floor.
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe(`${String(CARD)}px`);
    expect(figure.getAttribute('data-scrolls')).toBe('false');
    expect(figure.getAttribute('data-preview')).toBe('true');
  });

  it('a very wide drawing is still fitted whole', async () => {
    draw.width = 3290;
    const figure = await drawn(true);
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe(`${String(CARD)}px`);
    expect(figure.getAttribute('data-scrolls')).toBe('false');
  });

  it('the preview is a nodrag button that opens the larger view, and does not bubble', async () => {
    draw.width = 700;
    const onClick = vi.fn();
    render(<MermaidDiagram body={BODY} closed compact />);
    document.body.addEventListener('click', onClick);
    const figure = await waitFor(() => {
      const f = document.querySelector<HTMLElement>('figure[data-mermaid]');
      if (f === null) throw new Error('not drawn yet');
      return f;
    });
    const preview = figure.querySelector<HTMLElement>('.pt-mmd__preview') as HTMLElement;
    expect(preview.tagName).toBe('BUTTON');
    expect(preview.classList.contains('nodrag')).toBe(true);
    expect(preview.getAttribute('aria-label')).toBe('Show the diagram larger');
    fireEvent.click(preview);
    document.body.removeEventListener('click', onClick);
    expect(onClick).not.toHaveBeenCalled();
    expect(figure.getAttribute('data-large')).toBe('true');
    expect(figure.getAttribute('data-preview')).toBe('false');
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe('700px');
    expect(figure.querySelector('.pt-mmd__preview')).toBeNull();
  });

  it('keeps the caption-row "larger" control too', async () => {
    draw.width = 700;
    const figure = await drawn(true);
    const caption = figure.querySelector<HTMLElement>('.pt-mmd__caption button') as HTMLElement;
    expect(caption.textContent).toBe('larger');
    fireEvent.click(caption);
    expect(figure.getAttribute('data-large')).toBe('true');
  });

  it('any container narrower than 380 px does the same without being told', async () => {
    draw.width = 700;
    const figure = await drawn(false);
    expect(figure.getAttribute('data-preview')).toBe('true');
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe(`${String(CARD)}px`);
  });
});

describe('MermaidDiagram in the panel', () => {
  it('is unchanged: min scale 0.7, scrolls, no preview button', async () => {
    draw.width = 3290;
    const figure = await drawn(false);
    expect(figure.getAttribute('data-preview')).toBe('false');
    expect(figure.querySelector('.pt-mmd__preview')).toBeNull();
    expect(figure.style.getPropertyValue('--pt-mmd-w')).toBe(`${String(Math.round(3290 * 0.7))}px`);
    expect(figure.getAttribute('data-scrolls')).toBe('true');
  });
});
