/**
 * image-pick: picking a picture on a Source page and what its menu does (v0.3 #348, items 1-4, 7-8),
 * through the real hooks and layer on the real ResNet parse, with the page's box at the origin so a
 * client pixel IS an IR point. Only the three reader actions and the highlight callbacks are spies.
 *
 * Float hit-testing from IR boxes (the caption is part of the float), the area tool (draw, move,
 * resize, nudge), Esc one level at a time, Tab and Enter through the floats, the Shift pairing with
 * words, and the menu's bodies: the anchor's exact shape, `with_text_anchor`, a region-only Note.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { indexDocument, type Anchor, type PaperSource } from '@papertree/anchoring';

import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';
import {
  ImageToolProvider,
  useImageSelection,
  useImageTool,
  type ImageSelection,
} from '@/features/reader';
import { draggedPassage, setDraggedPassage } from '@/features/split/model/passageDrag';
import { isImageAnchor } from '@/lib/imageAnchor';

import type { PendingSelection, SelectionCapture } from '@/components/reader/useSelectionCapture';

const doc = indexDocument(
  JSON.parse(
    readFileSync(`${process.cwd()}/test/fixtures/real-resnet-p1-2.ir.json`, 'utf8'),
  ) as PaperSource,
  'image-pick-spec',
);
/** Figure 1 and its caption, in PDF points: [309, 224, 545, 347]. */
const FIGURE = { x: 400, y: 260, caption: { x: 400, y: 330 }, outside: { x: 100, y: 450 } };

const spies = {
  openExplain: vi.fn(),
  askAbout: vi.fn(),
  sendToCanvas: vi.fn().mockResolvedValue('cn_new'),
  create: vi.fn(),
  note: vi.fn(),
  clearText: vi.fn(),
  openBoard: vi.fn(),
};
const WORDS = { id: 'words' } as unknown as Anchor;
const CAPTURE = {
  anchor: WORDS,
  anchors: [WORDS],
  selection: { text: 'The paragraph about it' },
} as unknown as SelectionCapture;

let image: ImageSelection;

function ToolButton(): ReactNode {
  const tool = useImageTool();
  return (
    <button type="button" onClick={(e) => tool?.toggle(e.detail === 0)}>
      area tool {tool?.armed === true ? 'on' : 'off'}
    </button>
  );
}

const READER: ReaderActions = {
  openExplain: spies.openExplain,
  askAbout: spies.askAbout,
  sendToCanvas: spies.sendToCanvas,
  focusAnchor: () => undefined,
};

function Harness(props: { readonly text?: boolean; readonly beside?: boolean }): ReactNode {
  return (
    <ReaderActionsProvider value={READER}>
      <Inner {...props} />
      <ToolButton />
    </ReaderActionsProvider>
  );
}

function Inner(props: { readonly text?: boolean; readonly beside?: boolean }): ReactNode {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const selection = props.text === true ? ({ text: 'x' } as PendingSelection) : null;
  image = useImageSelection({
    doc,
    root,
    zoom: 1,
    pageOf: () => ({ width: 612, height: 792, userUnit: 1 }),
    textSelection: selection,
    captureText: () => (props.text === true ? CAPTURE : null),
    clearText: spies.clearText,
    items: [],
    boardBeside: props.beside === true,
    currentPage: () => 0,
    onCreateAnchors: spies.create,
    onNoteAnchors: spies.note,
    onOpenBoard: spies.openBoard,
    highlightDisabledReason: undefined,
  });
  return (
    <div ref={setRoot} data-testid="root">
      <div className="papertree-page" data-page-index="0" data-testid="page">
        {image.layer(0, 1)}
      </div>
    </div>
  );
}

function mount(props: { text?: boolean; beside?: boolean } = {}): HTMLElement {
  render(
    <ImageToolProvider>
      <Harness {...props} />
    </ImageToolProvider>,
  );
  const page = screen.getByTestId('page');
  // happy-dom lays nothing out: the page's box is the origin at scale 1.
  page.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 612,
    bottom: 792,
    width: 612,
    height: 792,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return page;
}

function press(page: HTMLElement, at: { x: number; y: number }, init: PointerEventInit = {}): void {
  fireEvent.pointerDown(page, { clientX: at.x, clientY: at.y, button: 0, ...init });
}
function move(page: HTMLElement, at: { x: number; y: number }): void {
  fireEvent.pointerMove(page, { clientX: at.x, clientY: at.y, buttons: 1 });
}
function release(page: HTMLElement, at: { x: number; y: number }): void {
  fireEvent.pointerUp(page, { clientX: at.x, clientY: at.y, button: 0 });
}
function click(page: HTMLElement, at: { x: number; y: number }, init: MouseEventInit = {}): void {
  press(page, at, init);
  release(page, at);
  fireEvent.click(page, { clientX: at.x, clientY: at.y, detail: 1, ...init });
}
const frame = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-pt-imgframe]');
const px = (el: HTMLElement, name: 'left' | 'top' | 'width' | 'height'): number =>
  Number.parseFloat(el.style[name]);

beforeEach(() => {
  vi.clearAllMocks();
  setDraggedPassage(null);
});
afterEach(cleanup);

describe('one click on a float (item 1)', () => {
  it('outlines the float under the pointer, and lets go when the pointer leaves it', () => {
    const page = mount();
    fireEvent.pointerMove(page, { clientX: FIGURE.x, clientY: FIGURE.y, buttons: 0 });
    expect(document.querySelector('.pt-imgfloat[data-hover]')).not.toBeNull();
    fireEvent.pointerMove(page, {
      clientX: FIGURE.outside.x,
      clientY: FIGURE.outside.y,
      buttons: 0,
    });
    expect(document.querySelector('.pt-imgfloat[data-hover]')).toBeNull();
  });

  it('a click on the figure selects it whole, caption included; so does a click on its caption', () => {
    const page = mount();
    click(page, FIGURE);
    const first = frame();
    expect(first?.getAttribute('data-origin')).toBe('float');
    expect([px(first!, 'left'), px(first!, 'top'), px(first!, 'width')].map(Math.round)).toEqual([
      309, 224, 236,
    ]);
    // 224 to 346.5: the figure and the caption under it.
    expect(Math.round(px(first!, 'height'))).toBe(122);
    cleanup();
    const again = mount();
    click(again, FIGURE.caption);
    expect(frame()).not.toBeNull();
  });

  it('a click elsewhere on the page lets the selection go', () => {
    const page = mount();
    click(page, FIGURE);
    expect(frame()).not.toBeNull();
    click(page, FIGURE.outside);
    expect(frame()).toBeNull();
  });

  it('keeps no float selected on a double click, which selects a word', () => {
    const page = mount();
    press(page, FIGURE);
    release(page, FIGURE);
    fireEvent.click(page, { clientX: FIGURE.x, clientY: FIGURE.y, detail: 2 });
    expect(frame()).toBeNull();
  });
});

describe('the area tool (item 2)', () => {
  it('Alt+drag draws a rectangle, which then has eight handles', () => {
    const page = mount();
    press(page, { x: 100, y: 450 }, { altKey: true });
    move(page, { x: 250, y: 560 });
    expect(document.querySelector('.pt-imgdraft')).not.toBeNull();
    release(page, { x: 250, y: 560 });
    const box = frame();
    expect(box?.getAttribute('data-origin')).toBe('area');
    expect([px(box!, 'left'), px(box!, 'top'), px(box!, 'width'), px(box!, 'height')]).toEqual([
      100, 450, 150, 110,
    ]);
    expect(box?.querySelectorAll('.pt-imghandle')).toHaveLength(8);
  });

  it('armed from the bar it draws without Alt, and a click with it armed draws nothing', () => {
    const page = mount();
    fireEvent.click(screen.getByRole('button', { name: /area tool off/ }), { detail: 1 });
    expect(screen.getByRole('button', { name: /area tool on/ })).toBeTruthy();
    click(page, FIGURE.outside);
    expect(frame()).toBeNull();
    press(page, { x: 60, y: 600 });
    move(page, { x: 160, y: 700 });
    release(page, { x: 160, y: 700 });
    expect(frame()?.getAttribute('data-origin')).toBe('area');
  });

  it('a drag a hand slipped (under the minimum side) selects nothing', () => {
    const page = mount();
    press(page, FIGURE.outside, { altKey: true });
    move(page, { x: FIGURE.outside.x + 3, y: FIGURE.outside.y + 3 });
    release(page, { x: FIGURE.outside.x + 3, y: FIGURE.outside.y + 3 });
    expect(frame()).toBeNull();
  });

  it('resizes by a handle and moves by its body, and keeps to the page', () => {
    const page = mount();
    press(page, { x: 100, y: 450 }, { altKey: true });
    move(page, { x: 250, y: 560 });
    release(page, { x: 250, y: 560 });
    const east = frame()!.querySelector<HTMLElement>('[data-handle="e"]')!;
    fireEvent.pointerDown(east, { clientX: 250, clientY: 500, button: 0 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 500, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 500 });
    expect(px(frame()!, 'width')).toBe(200);
    fireEvent.pointerDown(frame()!, { clientX: 150, clientY: 500, button: 0 });
    fireEvent.pointerMove(window, { clientX: 170, clientY: 490, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 170, clientY: 490 });
    expect([px(frame()!, 'left'), px(frame()!, 'top')]).toEqual([120, 440]);
    fireEvent.pointerDown(frame()!, { clientX: 150, clientY: 500, button: 0 });
    fireEvent.pointerMove(window, { clientX: 9000, clientY: 9000, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 9000, clientY: 9000 });
    expect(px(frame()!, 'left') + px(frame()!, 'width')).toBeLessThanOrEqual(612);
    expect(px(frame()!, 'top') + px(frame()!, 'height')).toBeLessThanOrEqual(792);
  });

  it('the arrow keys nudge it, Shift takes a bigger step, Alt resizes', () => {
    const page = mount();
    press(page, { x: 100, y: 450 }, { altKey: true });
    move(page, { x: 250, y: 560 });
    release(page, { x: 250, y: 560 });
    const key = (init: KeyboardEventInit): void => {
      fireEvent.keyDown(frame()!, init);
    };
    key({ key: 'ArrowRight' });
    expect(px(frame()!, 'left')).toBe(104);
    key({ key: 'ArrowDown', shiftKey: true });
    expect(px(frame()!, 'top')).toBe(474);
    key({ key: 'ArrowRight', altKey: true });
    expect(px(frame()!, 'width')).toBe(154);
    expect(px(frame()!, 'left')).toBe(104);
    key({ key: 'ArrowUp', altKey: true });
    expect(px(frame()!, 'height')).toBe(106);
  });

  it('a float selection is not adjustable: no handles, the arrows do nothing', () => {
    const page = mount();
    click(page, FIGURE);
    expect(frame()!.querySelectorAll('.pt-imghandle')).toHaveLength(0);
    const before = px(frame()!, 'left');
    fireEvent.keyDown(frame()!, { key: 'ArrowRight' });
    expect(px(frame()!, 'left')).toBe(before);
  });

  it('pressed from the keyboard the tool puts a rectangle on the page, and focus is on it', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /area tool off/ }), { detail: 0 });
    const box = frame();
    expect(box?.getAttribute('data-origin')).toBe('area');
    expect(document.activeElement).toBe(box);
  });
});

describe('Esc backs out one level (item 7)', () => {
  const esc = (): void => {
    fireEvent.keyDown(document, { key: 'Escape' });
  };

  it('a rectangle being drawn, then the armed tool, then the selection', () => {
    const page = mount();
    fireEvent.click(screen.getByRole('button', { name: /area tool off/ }), { detail: 1 });
    press(page, { x: 60, y: 600 });
    move(page, { x: 160, y: 700 });
    esc();
    expect(document.querySelector('.pt-imgdraft')).toBeNull();
    expect(frame()).toBeNull();
    expect(screen.getByRole('button', { name: /area tool on/ })).toBeTruthy();
    press(page, { x: 60, y: 600 });
    move(page, { x: 160, y: 700 });
    release(page, { x: 160, y: 700 });
    expect(frame()).not.toBeNull();
    esc();
    // The tool is put away; the rectangle it drew stays, with its menu.
    expect(screen.getByRole('button', { name: /area tool off/ })).toBeTruthy();
    expect(frame()).not.toBeNull();
    expect(image.actions).not.toBeNull();
    esc();
    expect(frame()).toBeNull();
    expect(image.actions).toBeNull();
  });
});

describe('Tab and Enter through the floats (item 7)', () => {
  it('every float is a button in reading order, named, and Enter selects it and takes focus', () => {
    mount();
    const floats = screen.getAllByRole('button', { name: /page 1/ });
    expect(floats[0]?.getAttribute('aria-label')).toMatch(
      /^Figure 1, page 1: Figure 1\. Training error/,
    );
    expect(floats.every((f) => f.getAttribute('aria-pressed') === 'false')).toBe(true);
    // A keyboard Enter or Space on a button arrives as a click with no pointer press before it.
    fireEvent.click(floats[0]!, { detail: 0 });
    expect(frame()?.getAttribute('data-origin')).toBe('float');
    expect(document.activeElement).toBe(frame());
    expect(frame()?.getAttribute('aria-label')).toMatch(/Enter explains it; Escape lets go/);
  });

  it('Enter on the focused selection explains it', () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: /page 1/ })[0]!, { detail: 0 });
    fireEvent.keyDown(frame()!, { key: 'Enter' });
    expect(spies.openExplain).toHaveBeenCalledTimes(1);
  });
});

describe('Shift pairs a picture with words (item 4)', () => {
  it('Shift+click keeps the words selected; a plain click drops them', () => {
    const page = mount({ text: true });
    click(page, FIGURE, { shiftKey: true });
    expect(frame()).not.toBeNull();
    expect(spies.clearText).not.toHaveBeenCalled();
    cleanup();
    const plain = mount({ text: true });
    click(plain, FIGURE);
    expect(spies.clearText).toHaveBeenCalled();
  });
});

describe('the menu on a picked picture (items 3, 4, 8)', () => {
  /** The anchor the API takes: exactly one PageSelector and one ShapeSelector quad, no quote. */
  function expectImageAnchor(anchor: Anchor, kind: 'figure' | 'figure_region'): void {
    expect(anchor.targetKind).toBe(kind);
    expect(isImageAnchor(anchor)).toBe(true);
    const types = anchor.selectors.map((s) => s.type);
    expect(types.filter((t) => t === 'PageSelector')).toHaveLength(1);
    expect(types.filter((t) => t === 'ShapeSelector')).toHaveLength(1);
    expect(types).not.toContain('TextQuoteSelector');
    const shape = anchor.selectors.find((s) => s.type === 'ShapeSelector');
    expect(shape && 'quads' in shape ? shape.quads : []).toHaveLength(1);
  }

  it('Explain on a float opens the panel on an image: its anchor, its caption, no words', () => {
    const page = mount();
    click(page, FIGURE);
    act(() => image.actions?.onExplain?.());
    expect(spies.openExplain).toHaveBeenCalledTimes(1);
    const input = spies.openExplain.mock.calls[0]?.[0] as {
      anchor: Anchor;
      quote: string;
      image: { label: string; caption: string; withText?: unknown };
    };
    expectImageAnchor(input.anchor, 'figure');
    expect(input.anchor.selectors[0]).toMatchObject({
      type: 'BlockSelector',
      blockId: 'blk_3pzzcn4luvb5qmpc',
    });
    expect(input.quote).toBe('');
    expect(input.image.label).toBe('Figure 1');
    expect(input.image.caption.startsWith('Figure 1. Training error')).toBe(true);
    expect(input.image.withText).toBeUndefined();
    // The selection is let go, as it is for words.
    expect(frame()).toBeNull();
  });

  it('Ask… on a drawn area opens the panel on a figure_region, waiting for the question', () => {
    const page = mount();
    press(page, { x: 100, y: 450 }, { altKey: true });
    move(page, { x: 250, y: 560 });
    release(page, { x: 250, y: 560 });
    act(() => image.actions?.onAsk?.());
    const input = spies.askAbout.mock.calls[0]?.[0] as { anchor: Anchor; image: { label: string } };
    expectImageAnchor(input.anchor, 'figure_region');
    expect(input.anchor.selectors.map((s) => s.type)).not.toContain('BlockSelector');
    expect(input.image.label).toBe('Selected area');
  });

  it('a figure picked with Shift beside selected words carries them as withText', () => {
    const page = mount({ text: true });
    click(page, FIGURE, { shiftKey: true });
    act(() => image.actions?.onExplain?.());
    const input = spies.openExplain.mock.calls[0]?.[0] as {
      quote: string;
      image: { withText: { anchor: Anchor; quote: string } };
    };
    expect(input.image.withText.anchor).toBe(WORDS);
    expect(input.image.withText.quote).toBe('The paragraph about it');
    expect(input.quote).toBe('The paragraph about it');
  });

  it('Send to board sends an excerpt with the image anchor and the caption as its body', async () => {
    const page = mount();
    click(page, FIGURE);
    await act(async () => image.actions?.onSendToBoard?.('just-send'));
    const sent = spies.sendToCanvas.mock.calls[0]?.[0] as {
      kind: string;
      anchor: Anchor;
      body: string;
      toast: string;
    };
    expect(sent.kind).toBe('excerpt');
    expectImageAnchor(sent.anchor, 'figure');
    expect(sent.body.startsWith('Figure 1. Training error')).toBe(true);
    expect(sent.toast).toBe('added');
    expect(spies.openBoard).not.toHaveBeenCalled();
  });

  it('Board beside opens the board on the new card', async () => {
    const page = mount();
    click(page, FIGURE);
    await act(async () => image.actions?.onSendToBoard?.('beside'));
    expect(spies.openBoard).toHaveBeenCalledWith('cn_new');
  });

  it('Note is a highlight over the region alone, with its card opened on the note', () => {
    const page = mount();
    click(page, FIGURE);
    act(() => image.actions?.onNote?.());
    const anchors = spies.note.mock.calls[0]?.[0] as Anchor[];
    expect(anchors).toHaveLength(1);
    expectImageAnchor(anchors[0]!, 'figure');
    expect(spies.create).not.toHaveBeenCalled();
  });

  it('a colour keeps the highlight, and the words selected with the picture join it', () => {
    const page = mount({ text: true });
    click(page, FIGURE, { shiftKey: true });
    act(() => image.actions?.onHighlight('green'));
    const [anchors, color] = spies.create.mock.calls[0] as [Anchor[], string];
    expect(color).toBe('green');
    expect(anchors).toHaveLength(2);
    expectImageAnchor(anchors[0]!, 'figure');
    expect(anchors[1]).toBe(WORDS);
  });
});

describe('dragging a picked picture to the board (item 5)', () => {
  it('beside the board its chip is draggable and carries an image with its caption', () => {
    const page = mount({ beside: true });
    click(page, FIGURE);
    const chip = frame()!.querySelector<HTMLElement>('.pt-imgchip')!;
    expect(chip.getAttribute('draggable')).toBe('true');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(chip, { dataTransfer });
    const dragged = draggedPassage();
    expect(dragged?.image).toBe(true);
    expect(isImageAnchor(dragged?.anchor)).toBe(true);
    expect(dragged?.text.startsWith('Figure 1. Training error')).toBe(true);
    fireEvent.dragEnd(chip);
    expect(draggedPassage()).toBeNull();
  });

  it('with no board beside, the chip only names the selection', () => {
    const page = mount();
    click(page, FIGURE);
    expect(frame()!.querySelector('.pt-imgchip')?.getAttribute('draggable')).toBe('false');
  });
});
