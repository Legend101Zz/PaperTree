/** wire.spec — stored items and strokes into the S5b model and back (#208). */
import { describe, expect, it } from 'vitest';

import { encodeStroke } from './stroke';
import { bodyOf, itemFromWire, parseExchangeBody, strokeFromWire } from './wire';

import type { NotebookItemWire, NotebookStrokeWire } from '../api/notebookApi';
import type { Anchor } from '@papertree/anchoring';

function wire(
  kind: NotebookItemWire['kind'],
  body: string,
  anchor: Anchor | null = null,
): NotebookItemWire {
  return {
    item_id: 'ni_item0001',
    page_id: 'np_page0001',
    kind,
    x: 10,
    y: 20,
    w: 30,
    h: 40,
    z: 2,
    body,
    anchor,
    version: 1,
    created_at: '2026-10-16T00:00:00Z',
    updated_at: '2026-10-16T00:00:00Z',
  };
}

describe('items', () => {
  it('reads every kind and writes back the same body', () => {
    const anchor = { id: 'a1' } as unknown as Anchor;
    for (const w of [
      wire('text', 'typed'),
      wire('sticky', 'stuck'),
      wire('quote', 'quoted', anchor),
      wire('shape', '{"shape":"ellipse"}'),
    ]) {
      const item = itemFromWire(w);
      expect(item?.kind).toBe(w.kind);
      expect(item === null ? null : bodyOf(item, new Map())).toBe(w.body);
    }
  });

  it('drops a quote that lost its Anchor, and keeps an exchange body verbatim', () => {
    expect(itemFromWire(wire('quote', 'q'))).toBeNull();
    const exchange = itemFromWire(wire('exchange', '{"call":{}}'));
    expect(exchange === null ? null : bodyOf(exchange, new Map([['ni_item0001', '{"x":1}']]))).toBe(
      '{"x":1}',
    );
  });

  it('parses what Dive in stores, and refuses anything else', () => {
    const body = JSON.stringify({
      call: { text: 'Explain this passage.', origin_anchor: { id: 'o' } },
      ai: { message_id: 'msg_1', model: 'M', content: 'Answer [b1].' },
    });
    expect(parseExchangeBody(body)).toEqual({
      call: { text: 'Explain this passage.', originAnchor: { id: 'o' } },
      ai: { messageId: 'msg_1', model: 'M', content: 'Answer [b1].' },
    });
    expect(parseExchangeBody('not json')).toBeNull();
    expect(parseExchangeBody('{"call":1}')).toBeNull();
  });
});

describe('strokes', () => {
  const geometry = {
    hasPressure: true,
    points: [
      [1, 2, 0.5],
      [3, 4, 0.7],
    ] as const,
  };
  const bytes = encodeStroke(geometry);
  const b64 = btoa(String.fromCharCode(...bytes));
  const stored: NotebookStrokeWire = {
    stroke_id: 'ns_stroke001',
    page_id: 'np_page0001',
    tool: 'pen',
    nib: 'F',
    colour: 'pen',
    points_b64: b64,
    created_at: '2026-10-16T00:00:00Z',
  };

  it('decodes a stored blob into a stroke', () => {
    const stroke = strokeFromWire(stored);
    expect(stroke?.id).toBe('ns_stroke001');
    expect(stroke?.points[1]?.[0]).toBeCloseTo(3, 1);
  });

  it('drops a blob decodeStroke refuses instead of drawing it wrong', () => {
    expect(strokeFromWire({ ...stored, points_b64: btoa('\u0009\u0000') })).toBeNull();
  });
});
