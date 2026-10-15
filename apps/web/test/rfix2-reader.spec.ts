/**
 * rfix2 - the reader's second round of fixes, the parts that are pure logic.
 *
 *   R9   `planFigures`: a figure shows once - the outermost crop, one caption.
 *   R8   `topBlockAt`: the block a position names is one Guided has a card for.
 *   R2   `holdScroll`: a scroll nobody asked for, after a toolbar action, is put back.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { guidedProjectionFor, indexDocument, type IndexedBlock, type PaperSource } from '@papertree/anchoring';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { planFigures } from '../src/components/reader/guidedFigures';
import { HOLD_SCROLL_MS, holdScroll, releaseScrollHold } from '../src/components/reader/scrollHold';
import { initialBlockFor, topBlockAt } from '../src/app/paper/[id]/read/ReaderWorkspace';

function root(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('workspace root not found');
    dir = parent;
  }
}

function fig(
  id: string,
  bbox: [number, number, number, number],
  extra: { page?: number; caption?: string; index?: number } = {},
): IndexedBlock {
  return {
    id,
    type: 'figure',
    pageIndex: extra.page ?? 0,
    bbox,
    readingIndex: extra.index ?? 0,
    text: '',
    payload: extra.caption === undefined ? {} : { caption_block: extra.caption },
  } as unknown as IndexedBlock;
}

describe('R9 planFigures - one crop, one caption', () => {
  it('drops each panel of a figure and keeps the whole crop (DDPM p.2 shape)', () => {
    const blocks = [
      fig('whole', [158, 72, 476, 136], { index: 15 }),
      fig('xT', [162, 72, 204, 115], { index: 16, caption: 'cap' }),
      fig('xt1', [322, 72, 365, 115], { index: 17, caption: 'cap' }),
      fig('x0', [412, 72, 454, 115], { index: 18, caption: 'cap' }),
    ];
    const plan = planFigures(blocks);
    expect([...plan.redirect.keys()].sort()).toEqual(['x0', 'xT', 'xt1']);
    expect([...plan.redirect.values()].every((v) => v === 'whole')).toBe(true);
    // The whole crop names no caption; it takes the one its panels name - once.
    expect(plan.caption.get('whole')).toBe('cap');
    expect(plan.caption.size).toBe(1);
  });

  it('keeps the outer crop when the panel comes first in reading order (YOLO p.1 shape)', () => {
    const plan = planFigures([
      fig('panel', [471, 196, 545, 244], { index: 12 }),
      fig('outer', [309, 196, 545, 244], { index: 13, caption: 'cap1' }),
    ]);
    expect(plan.redirect.get('panel')).toBe('outer');
    expect(plan.redirect.has('outer')).toBe(false);
    expect(plan.caption.get('outer')).toBe('cap1');
  });

  it('resolves a panel of a panel to the outermost crop', () => {
    const plan = planFigures([
      fig('a', [0, 0, 400, 400], { index: 1 }),
      fig('b', [10, 10, 200, 200], { index: 2 }),
      fig('c', [20, 20, 60, 60], { index: 3 }),
    ]);
    expect(plan.redirect.get('b')).toBe('a');
    expect(plan.redirect.get('c')).toBe('a');
  });

  it('of two copies of one box, exactly one survives', () => {
    const plan = planFigures([
      fig('first', [0, 0, 100, 100], { index: 1, caption: 'c' }),
      fig('second', [0, 0, 100, 100], { index: 2, caption: 'c' }),
    ]);
    expect(plan.redirect.size).toBe(1);
    expect(plan.redirect.get('second')).toBe('first');
  });

  it('leaves separate figures, and figures on different pages, alone', () => {
    const plan = planFigures([
      fig('left', [0, 0, 100, 100], { index: 1, caption: 'c1' }),
      fig('right', [200, 0, 300, 100], { index: 2, caption: 'c2' }),
      fig('other-page', [0, 0, 100, 100], { index: 3, page: 1, caption: 'c3' }),
    ]);
    expect(plan.redirect.size).toBe(0);
    expect(plan.caption.size).toBe(3);
  });

  it('shows a caption claimed by two separate figures once', () => {
    const plan = planFigures([
      fig('left', [0, 0, 100, 100], { index: 1, caption: 'shared' }),
      fig('right', [200, 0, 300, 100], { index: 2, caption: 'shared' }),
    ]);
    expect(plan.caption.get('left')).toBe('shared');
    expect(plan.caption.has('right')).toBe(false);
  });
});

describe('R8 topBlockAt - a position names a block Guided can find', () => {
  const slug = 'resnet-cvpr-2col';
  const path = join(root(), 'packages/document-ir/fixtures', `${slug}.paperir.json`);
  const doc = indexDocument(JSON.parse(readFileSync(path, 'utf8')) as PaperSource, 'rfix2');
  const placement = guidedProjectionFor(doc).placement;

  it('never names page furniture, whatever the position', () => {
    let checked = 0;
    for (const page of doc.pages) {
      for (let yPt = 0; yPt < page.height; yPt += 20) {
        const id = topBlockAt(doc, { page: page.index, yPt });
        if (id === undefined) continue;
        checked += 1;
        expect(placement.get(id)?.kind, `${id} at page ${String(page.index)} y ${String(yPt)}`).not.toBe('absent');
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('skips a furniture block that would come first (a REAL absent block ahead of the text)', () => {
    // The arXiv stamp is a real margin_note the projection leaves out (placement 'absent'). Put it
    // first in reading order on its page: only the placement filter keeps topBlockAt off it.
    const stamp = (doc.byPage.get(0) ?? []).find((b) => placement.get(b.id)?.kind === 'absent' && b.text.trim() !== '');
    if (stamp === undefined) throw new Error('no absent block on page 0');
    const first = { ...stamp, readingIndex: -1 } as IndexedBlock;
    const rest = (doc.byPage.get(0) ?? []).filter((b) => b.id !== stamp.id);
    const withFurniture = { ...doc, byPage: new Map(doc.byPage).set(0, [first, ...rest]) } as unknown as typeof doc;
    const named = topBlockAt(withFurniture, { page: 0, yPt: 0 });
    expect(named).toBeDefined();
    expect(named).not.toBe(stamp.id);
    expect(placement.get(named as string)?.kind).not.toBe('absent');
  });

  it('a position in a page bottom margin names the first card of the NEXT page, never nothing', () => {
    const page = doc.pages[1];
    if (page === undefined) throw new Error('fixture has fewer than 2 pages');
    // Below every block of the page: 777 pt on a 792 pt page (FlashAttention, Mask R-CNN, Adam did this).
    const id = topBlockAt(doc, { page: page.index, yPt: page.height - 5 });
    expect(id).toBeDefined();
    expect(doc.byId.get(id as string)?.pageIndex).toBe(page.index + 1);
  });

  it('a position past the last block of the last page names the last card, never nothing', () => {
    const last = doc.pages[doc.pages.length - 1];
    if (last === undefined) throw new Error('no pages');
    const id = topBlockAt(doc, { page: last.index, yPt: last.height + 100 });
    expect(id).toBeDefined();
    expect(doc.byId.get(id as string)?.pageIndex).toBeLessThanOrEqual(last.index);
    expect(placement.get(id as string)?.kind).not.toBe('absent');
  });
});

describe('R8 initialBlockFor - no saved block does not mean the top of the paper', () => {
  const path = join(root(), 'packages/document-ir/fixtures', 'resnet-cvpr-2col.paperir.json');
  const doc = indexDocument(JSON.parse(readFileSync(path, 'utf8')) as PaperSource, 'rfix2-initial');
  const base = { v: 1 as const, mode: 'source' as const, zoomMode: { kind: 'scale' as const, scale: 1.25 } };

  it('uses the saved block when there is one', () => {
    expect(initialBlockFor(doc, { ...base, page: 2, yPt: 100, blockId: 'blk_saved' })).toBe('blk_saved');
  });

  it('derives the block from the page and offset when none was saved', () => {
    const id = initialBlockFor(doc, { ...base, page: 2, yPt: 100 });
    expect(id).not.toBeNull();
    expect(doc.byId.get(id as string)?.pageIndex).toBe(2);
  });

  it('says nothing without a position or a parse', () => {
    expect(initialBlockFor(doc, null)).toBeNull();
    expect(initialBlockFor(null, { ...base, page: 2, yPt: 100 })).toBeNull();
  });
});

describe('R2 holdScroll - a toolbar action must not move the page', () => {
  afterEach(() => vi.useRealTimers());

  function scroller(top: number): HTMLDivElement {
    const el = document.createElement('div');
    document.body.append(el);
    el.scrollTop = top;
    return el;
  }

  it('puts back a scroll nobody asked for, until the reader scrolls themselves', () => {
    const el = scroller(3908);
    const release = holdScroll(el);
    el.scrollTop = 4108; // the stray +200 px
    el.dispatchEvent(new Event('scroll'));
    expect(el.scrollTop).toBe(3908);
    // The reader's own wheel ends the hold; the scroll after it is theirs.
    window.dispatchEvent(new Event('wheel'));
    el.scrollTop = 4400;
    el.dispatchEvent(new Event('scroll'));
    expect(el.scrollTop).toBe(4400);
    release();
  });

  it('a scrollbar drag (mousedown without a pointerdown) ends the hold and is not put back', () => {
    const el = scroller(900);
    holdScroll(el);
    window.dispatchEvent(new Event('mousedown'));
    el.scrollTop = 1500;
    el.dispatchEvent(new Event('scroll'));
    expect(el.scrollTop).toBe(1500);
  });

  it('lets go when the page list moves the page itself', () => {
    const el = scroller(900);
    holdScroll(el);
    releaseScrollHold(el); // VirtualPageList: a zoom, a resize, a jump to a block
    el.scrollTop = 2500;
    el.dispatchEvent(new Event('scroll'));
    expect(el.scrollTop).toBe(2500);
  });

  it('a second hold replaces the first', () => {
    const el = scroller(100);
    holdScroll(el);
    el.scrollTop = 150;
    holdScroll(el); // holds 150 now
    el.scrollTop = 400;
    el.dispatchEvent(new Event('scroll'));
    expect(el.scrollTop).toBe(150);
  });

  it('lets go after its time', () => {
    vi.useFakeTimers();
    const el = scroller(100);
    holdScroll(el);
    vi.advanceTimersByTime(HOLD_SCROLL_MS + 1);
    el.scrollTop = 500;
    el.dispatchEvent(new Event('scroll'));
    expect(el.scrollTop).toBe(500);
  });
});
