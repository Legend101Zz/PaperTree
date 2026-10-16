import { describe, expect, it } from 'vitest';

import {
  ZOOM_RANGE,
  boardCounts,
  boardRedirectPath,
  countsLine,
  mapLabel,
  readerHref,
  threadTool,
  zoomReadout,
} from './chrome';

import type { CanvasNode } from '@/lib/api/types';

const rows = (...kinds: CanvasNode['kind'][]) => kinds.map((kind) => ({ kind }));

describe('the header’s counts (frame 06: “11 cards · 7 threads · 2 frames”)', () => {
  it('counts every card kind as a card and a frame as a frame', () => {
    const nodes = rows(
      'excerpt',
      'explanation',
      'note',
      'question',
      'notebook',
      'diagram',
      'group',
    );
    expect(boardCounts(nodes, 7)).toEqual({ cards: 6, threads: 7, frames: 1 });
  });

  it('says frame 06’s line from the data', () => {
    const nodes = [
      ...rows(...Array<CanvasNode['kind']>(11).fill('note')),
      ...rows('group', 'group'),
    ];
    expect(countsLine(boardCounts(nodes, 7))).toBe('11 cards · 7 threads · 2 frames');
  });

  it('always says the cards, and threads and frames only once there are some (06b: “0 cards”)', () => {
    expect(countsLine(boardCounts([], 0))).toBe('0 cards');
    expect(countsLine(boardCounts(rows('note', 'group'), 0))).toBe('1 card · 1 frame');
    expect(countsLine(boardCounts(rows('note', 'note'), 1))).toBe('2 cards · 1 thread');
  });
});

describe('the zoom readout and the minimap’s caption', () => {
  it('reads the zoom as a whole percentage', () => {
    expect(zoomReadout(1)).toBe('100%');
    expect(zoomReadout(0.454)).toBe('45%');
    expect(zoomReadout(ZOOM_RANGE.min)).toBe('20%');
    expect(zoomReadout(ZOOM_RANGE.max)).toBe('200%');
  });

  it('captions the map with the zoom, or “empty” on an empty board', () => {
    expect(mapLabel(1, false)).toBe('Map · 100%');
    expect(mapLabel(0.5, true)).toBe('Map · empty');
  });
});

describe('Back to the paper and Thread (L)', () => {
  it('goes back to the reader of the same paper', () => {
    expect(readerHref('ppr_1')).toBe('/paper/ppr_1/read');
  });

  it('starts a walk from one card, links two, puts a drawn thread away, says why it is off', () => {
    expect(threadTool(1, false).action).toBe('walk');
    expect(threadTool(2, false).action).toBe('link');
    expect(threadTool(2, true).action).toBe('cancel');
    const off = threadTool(0, false);
    expect(off.action).toBe('none');
    expect(off.hint).toMatch(/press L/);
    expect(threadTool(3, false).action).toBe('none');
  });
});

describe('a v0.1 /canvas link goes to the board (#214)', () => {
  it('keeps the paper and the whole query string, repeated keys included', () => {
    expect(boardRedirectPath('ppr_X', { focus: 'cn_1', cite: '2' })).toBe(
      '/paper/ppr_X/board?focus=cn_1&cite=2',
    );
    expect(boardRedirectPath('ppr_X', { a: ['1', '2'], b: 'x y&z', none: undefined })).toBe(
      '/paper/ppr_X/board?a=1&a=2&b=x+y%26z',
    );
    expect(boardRedirectPath('ppr_X', {})).toBe('/paper/ppr_X/board');
  });

  it('never encodes an id twice: Next hands it over still encoded (review P2-N1)', () => {
    expect(boardRedirectPath('a%2Fb', { x: '1' })).toBe('/paper/a%2Fb/board?x=1');
    expect(boardRedirectPath('a/b', {})).toBe('/paper/a%2Fb/board');
    expect(boardRedirectPath('100%', {})).toBe('/paper/100%25/board'); // not a valid escape
  });
});
