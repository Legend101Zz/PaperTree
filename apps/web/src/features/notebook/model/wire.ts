/**
 * Wire ↔ model for the notebook page (S5c, #208). The API stores every item as a rectangle plus a
 * `body` string; the S5b model (`page.ts`) wants the `Item` union. This file is the only place that
 * knows how one maps onto the other, in both directions, so a save writes back exactly what a read
 * would turn into the same item. Pure: no React, no fetch.
 */
import { decodeStroke } from './stroke';

import type { NotebookItemWire, NotebookStrokeWire } from '../api/notebookApi';
import type { Item, ShapeItem } from './page';
import type { Stroke } from './stroke';
import type { Anchor } from '@papertree/anchoring';

/** The sticky colour token every sticky uses until the API stores a colour per sticky. */
export const STICKY_COLOUR = 'sticky';

/** What "Dive in" seeded into an `exchange` item's body (`papertree_db.notebook._dive_in_seed`). */
export interface ExchangeBody {
  /** The person's question and the passage the thread started from. */
  readonly call: { readonly text: string; readonly originAnchor: Anchor | null };
  /** The answer the page was dived from, verbatim (markers included). */
  readonly ai: {
    readonly messageId: string;
    readonly model: string | null;
    readonly content: string;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads an exchange item's body.
 *
 * @param body - The stored JSON.
 * @returns The exchange, or null when the body is not the shape Dive in writes.
 */
export function parseExchangeBody(body: string): ExchangeBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const call = record(record(parsed)?.['call']);
  const ai = record(record(parsed)?.['ai']);
  if (call === null || ai === null) return null;
  const origin = record(call['origin_anchor']);
  return {
    call: { text: text(call['text']), originAnchor: origin as Anchor | null },
    ai: {
      messageId: text(ai['message_id']),
      model: typeof ai['model'] === 'string' ? ai['model'] : null,
      content: text(ai['content']),
    },
  };
}

const SHAPES: readonly ShapeItem['shape'][] = ['rect', 'ellipse', 'arrow'];

function shapeOf(body: string): ShapeItem['shape'] {
  try {
    const shape = record(JSON.parse(body))?.['shape'];
    return SHAPES.find((s) => s === shape) ?? 'rect';
  } catch {
    return 'rect';
  }
}

/**
 * The model item for a stored item.
 *
 * @param wire - The item as the API sent it.
 * @returns The `Item`, or null for a quote that lost its Anchor (it could not scroll anywhere).
 */
export function itemFromWire(wire: NotebookItemWire): Item | null {
  const box = { id: wire.item_id, x: wire.x, y: wire.y, w: wire.w, h: wire.h, z: wire.z };
  switch (wire.kind) {
    case 'exchange':
      return { ...box, kind: 'exchange', exchangeId: wire.item_id };
    case 'text':
      return { ...box, kind: 'text', text: wire.body };
    case 'sticky':
      return { ...box, kind: 'sticky', text: wire.body, color: STICKY_COLOUR };
    case 'quote':
      return wire.anchor === null
        ? null
        : { ...box, kind: 'quote', anchor: wire.anchor, text: wire.body };
    case 'shape':
      return { ...box, kind: 'shape', shape: shapeOf(wire.body) };
  }
}

/**
 * The `body` the API stores for an item: what `itemFromWire` reads back into the same item.
 *
 * @param item - A model item.
 * @param exchangeBodies - Exchange item id → its stored body (an exchange is never re-encoded).
 * @returns The body string.
 */
export function bodyOf(item: Item, exchangeBodies: ReadonlyMap<string, string>): string {
  switch (item.kind) {
    case 'text':
    case 'sticky':
    case 'quote':
      return item.text;
    case 'shape':
      return JSON.stringify({ shape: item.shape });
    case 'exchange':
      return exchangeBodies.get(item.id) ?? '{}';
  }
}

/**
 * Base64 → bytes without Node's Buffer (this runs in the browser).
 *
 * @param b64 - Standard base64.
 * @returns The bytes.
 */
export function bytesFromBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The model stroke for a stored one. A blob `decodeStroke` refuses is dropped, not drawn wrong.
 *
 * @param wire - The stroke as the API sent it.
 * @returns The stroke, or null when its blob cannot be decoded.
 */
export function strokeFromWire(wire: NotebookStrokeWire): Stroke | null {
  try {
    const geometry = decodeStroke(bytesFromBase64(wire.points_b64));
    return { ...geometry, id: wire.stroke_id, tool: wire.tool, nib: wire.nib, color: wire.colour };
  } catch {
    return null;
  }
}
