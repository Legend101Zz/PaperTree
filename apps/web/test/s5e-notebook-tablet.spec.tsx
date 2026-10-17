/**
 * s5e-notebook-tablet.spec — the notebook's tablet layout and Dive in's arrival (#210, frames 05b
 * and 11): at 1180 the tools stand in a vertical rail in the frame's order, the nibs and colours
 * sit in flyouts that a choice or Escape closes (Escape never puts the tool down), the bar names
 * the page and the panel follows the page down the desk; at 1440 the desktop bar stays. A page that
 * a Dive in opened waits unseen, then slides in for the rest of --pt-dur-open, or with reduced
 * motion fades in for --pt-dur-quick; a page opened from a link just appears. `fetch` plays the
 * API (s5c-notebook-fixtures); happy-dom has no Web Animations, so `animate` is a spy.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotebookView } from '@/features/notebook';
import { diveHandoff } from '@/features/notebook/hooks/useDiveIn';

import { PAGE, PAPER, THREAD, pageView, stubApi } from './s5c-notebook-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/paper/x/notebook/y',
  useSearchParams: () => new URLSearchParams(),
}));

interface HappyWindow {
  readonly happyDOM: { setViewport: (size: { width: number; height: number }) => void };
}

function viewport(width: number, height: number): void {
  (window as unknown as HappyWindow).happyDOM.setViewport({ width, height });
}

afterEach(() => {
  cleanup();
  viewport(1440, 900);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).animate;
  document.documentElement.style.removeProperty('--pt-dur-quick');
  document.documentElement.style.removeProperty('--pt-dur-open');
});

async function mount(): Promise<HTMLElement> {
  stubApi(pageView());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotebookView paperId={PAPER} pageId={PAGE} />
    </QueryClientProvider>,
  );
  return screen.findByRole('toolbar', { name: 'Notebook tools' });
}

const named = (el: Element): string => el.getAttribute('aria-label') ?? el.textContent ?? '';

describe('the tablet (05b, 1180 × 820)', () => {
  it('stands the tools in a left rail, in the frame’s order', async () => {
    viewport(1180, 820);
    const rail = await mount();
    expect(rail.getAttribute('aria-orientation')).toBe('vertical');
    expect(rail.classList.contains('pt-nb-tools--rail')).toBe(true);
    expect(within(rail).getAllByRole('button').map(named)).toEqual([
      'Pen',
      'Highlighter',
      'Stroke eraser',
      'Lasso',
      'Shapes',
      'Text',
      'Sticky note',
      'Nib: F',
      'Colour: Blue-black ink',
      'Undo',
      'Redo',
    ]);
  });

  it('keeps the nibs in a flyout: a choice closes it, picks the pen up and says what it holds', async () => {
    viewport(1180, 820);
    await mount();
    const nib = screen.getByRole('button', { name: 'Nib: F' });
    fireEvent.click(nib);
    expect(nib.getAttribute('aria-expanded')).toBe('true');
    const flyout = screen.getByRole('group', { name: 'Nib: F' });
    fireEvent.click(within(flyout).getByRole('button', { name: 'M, medium nib' }));
    expect(screen.queryByRole('group', { name: 'Nib: F' })).toBeNull();
    const after = screen.getByRole('button', { name: 'Nib: M' });
    expect(document.activeElement).toBe(after);
    expect(screen.getByRole('button', { name: 'Pen' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('closes the colour flyout on Escape and leaves the pen in the hand', async () => {
    viewport(1180, 820);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Colour: Blue-black ink' }));
    const green = within(screen.getByRole('group', { name: 'Ink colour' })).getByRole('button', {
      name: 'Green',
    });
    fireEvent.keyDown(green, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Ink colour' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pen' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('moves along the rail with Up and Down, wrapping, never into a flyout', async () => {
    viewport(1180, 820);
    const rail = await mount();
    const pen = within(rail).getByRole('button', { name: 'Pen' });
    pen.focus();
    fireEvent.keyDown(pen, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(within(rail).getByRole('button', { name: 'Highlighter' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(within(rail).getByRole('button', { name: 'Redo' }));
    fireEvent.click(within(rail).getByRole('button', { name: 'Nib: F' }));
    const fine = within(screen.getByRole('group', { name: 'Nib: F' })).getByRole('button', {
      name: 'F, fine nib',
    });
    fine.focus();
    fireEvent.keyDown(fine, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(fine);
  });

  it('closes a flyout when the keyboard leaves it', async () => {
    viewport(1180, 820);
    const rail = await mount();
    fireEvent.click(within(rail).getByRole('button', { name: 'Nib: F' }));
    const fine = within(screen.getByRole('group', { name: 'Nib: F' })).getByRole('button', {
      name: 'F, fine nib',
    });
    fireEvent.focusOut(fine, { relatedTarget: within(rail).getByRole('button', { name: 'Undo' }) });
    expect(screen.queryByRole('group', { name: 'Nib: F' })).toBeNull();
  });

  it('names the page in the bar, and runs the panel under the page on the desk', async () => {
    viewport(1180, 820);
    await mount();
    expect(document.querySelector('.pt-nb__bar .pt-nb__title')?.textContent).toBe(
      'Dive in: the Transformer’s central proposal',
    );
    const desk = screen.getByRole('main', { name: 'Notebook page' });
    const panel = await screen.findByRole('region', { name: 'Page' });
    expect(desk.contains(panel)).toBe(true);
    expect(screen.queryByRole('complementary', { name: 'Page' })).toBeNull();
  });
});

describe('the desktop (05, 1440)', () => {
  it('keeps the floating bar with the nibs and colours on it, and the panel beside the page', async () => {
    const bar = await mount();
    expect(bar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(within(bar).getByRole('button', { name: 'M, medium nib' })).toBeTruthy();
    expect(within(bar).queryByRole('button', { name: 'Nib: F' })).toBeNull();
    const panel = await screen.findByRole('complementary', { name: 'Page' });
    expect(screen.getByRole('main', { name: 'Notebook page' }).contains(panel)).toBe(false);
    expect(document.querySelector('.pt-nb__bar .pt-nb__title')).toBeNull();
  });

  it('goes back to the paper with the explain panel on the dived thread', async () => {
    await mount();
    const back = screen.getByRole('link', { name: /Back to the paper/ });
    expect(new URL(back.getAttribute('href') ?? '', 'http://x').searchParams.get('thread')).toBe(
      THREAD,
    );
  });
});

describe('Dive in arrives', () => {
  const animate = vi.fn();
  const arrive = (): void => {
    animate.mockReset();
    Element.prototype.animate = animate as unknown as Element['animate'];
    diveHandoff.put({ pageId: PAGE, cards: [], at: Date.now() });
  };
  const root = (): HTMLElement => document.querySelector<HTMLElement>('.pt-nb')!;

  it('waits unseen, then slides the page in for the rest of --pt-dur-open, on the lift curve', async () => {
    document.documentElement.style.setProperty('--pt-dur-quick', '100ms');
    document.documentElement.style.setProperty('--pt-dur-open', '400ms');
    arrive();
    await mount();
    expect(root().getAttribute('data-dive')).toBe('arriving');
    await waitFor(() => expect(root().hasAttribute('data-dive')).toBe(false));
    const slide = animate.mock.contexts.findIndex((el) =>
      (el as Element).hasAttribute('data-dive-page'),
    );
    expect(slide).toBeGreaterThanOrEqual(0);
    const [keyframes, timing] = animate.mock.calls[slide] as [Keyframe[], KeyframeAnimationOptions];
    expect(keyframes[0]?.transform).toMatch(/^translateX\(\d+(\.\d+)?px\)$/);
    expect(keyframes[1]).toEqual({ transform: 'none' });
    expect(timing.duration).toBe(300);
  });

  it('with reduced motion fades the desk in for --pt-dur-quick and moves nothing', async () => {
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) =>
      q === '(prefers-reduced-motion: reduce)'
        ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as never)
        : real(q),
    );
    arrive();
    await mount();
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1));
    // The desk fades in; the bar, never hidden, is not animated (it would blink).
    expect(animate.mock.contexts[0]).toBe(document.querySelector('.pt-nb__desk'));
    expect(animate.mock.calls[0]).toEqual([
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 120, easing: 'linear' },
    ]);
  });

  it('lets a page opened from a link just appear', async () => {
    animate.mockReset();
    Element.prototype.animate = animate as unknown as Element['animate'];
    await mount();
    expect(root().hasAttribute('data-dive')).toBe(false);
    await new Promise((done) => setTimeout(done, 60));
    expect(animate).not.toHaveBeenCalled();
  });
});
