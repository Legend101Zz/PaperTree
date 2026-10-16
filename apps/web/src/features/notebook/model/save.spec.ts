/** save.spec — one request per touched item, carrying only what differs (#208). */
import { describe, expect, it } from 'vitest';

import { saveOp } from './save';

import type { Item } from './page';
import type { SavedItem } from './save';
import type { Anchor } from '@papertree/anchoring';

const NOTE: Item = {
  kind: 'text',
  id: 'ni_note0001',
  x: 48,
  y: 96,
  w: 288,
  h: 72,
  z: 3,
  text: 'Hi',
};
const SAVED: SavedItem = { version: 4, x: 48, y: 96, w: 288, h: 72, z: 3, body: 'Hi' };

describe('saveOp', () => {
  it('creates an item the server does not have, with its id, box and body', () => {
    expect(saveOp(undefined, NOTE, 'Hi')).toEqual({
      kind: 'create',
      body: { item_id: 'ni_note0001', kind: 'text', x: 48, y: 96, w: 288, h: 72, z: 3, body: 'Hi' },
    });
  });

  it('sends a quote with its full Anchor', () => {
    const anchor = { id: 'a1' } as unknown as Anchor;
    const op = saveOp(undefined, { ...NOTE, kind: 'quote', anchor, text: 'q' }, 'q');
    expect(op?.kind === 'create' && op.body.anchor).toBe(anchor);
  });

  it('patches only the changed fields, with the version it last saw', () => {
    expect(saveOp(SAVED, { ...NOTE, x: 56 }, 'Hi')).toEqual({
      kind: 'patch',
      body: { version: 4, x: 56 },
    });
    expect(saveOp(SAVED, NOTE, 'Hello')).toEqual({
      kind: 'patch',
      body: { version: 4, body: 'Hello' },
    });
  });

  it('deletes what was removed, and does nothing when the two agree', () => {
    expect(saveOp(SAVED, undefined, '')).toEqual({ kind: 'delete' });
    expect(saveOp(undefined, undefined, '')).toBeNull();
    expect(saveOp(SAVED, NOTE, 'Hi')).toBeNull();
  });
});
