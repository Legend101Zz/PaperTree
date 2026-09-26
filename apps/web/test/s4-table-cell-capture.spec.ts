// @vitest-environment node
/**
 * s4-table-cell-capture — a table cell the IR did not stamp is still capturable, from pdf.js's own
 * item geometry, and its quads sit inside that item's box (slice-plan §S4).
 *
 * THE GAP (ADR-002 §3.3, MEASURED by the judge's `stamp_by_type.py`): on live worker parses the text
 * layer's table-cell items are stamped with an IR offset 2.1 / 4.9 / 0.6 % of the time (YOLO /
 * ResNet / Attention) and figure text 0 %. The baseline's only answer for an unstamped item was
 * `locateByText`: search the page's blocks for the string and take the FIRST block containing it —
 * so "66.4" or "34.6" in a results table anchored to wherever that number first occurred.
 *
 * WHAT THIS DRIVES, all real: `parse_document` on the corpus ResNet PDF (the worker's parse, through
 * the workspace's Python), real pdf.js `getTextContent()` on the same PDF, the reader's own
 * `stampTextLayer`, and `capturePageTextAnchor` on every table-cell item left unstamped. Each capture
 * must carry Page + TextQuote + Shape and nothing IR-offset-shaped, quote the item's own text, be
 * `targetKind: table_cell`, and have its quad INSIDE the item's advance box.
 *
 * Corpus- and Python-gated, loudly (the same gate as `packages/anchoring`'s live-parse specs).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import {
  capturePageTextAnchor,
  frameForPdfPage,
  indexDocument,
  pageTextStreamId,
  pdfRectToIr,
  type ShapeSelector,
  type TextQuoteSelector,
} from '@papertree/anchoring';
import { beforeAll, describe, expect, it } from 'vitest';

import { alignedItems, stampTextLayer } from '@/components/reader/stampTextLayer';

import {
  announceSkip,
  corpusPdf,
  liveParse,
  liveParseUnavailable,
  REPO_ROOT,
} from '../../../packages/anchoring/test/support/liveParse';

const SLUG = 'resnet-cvpr-2col';
const unavailable = liveParseUnavailable([SLUG]);
announceSkip('web/s4-table-cell-capture', unavailable);

interface Item {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}
interface PdfjsLike {
  version: string;
  getDocument(args: { data: Uint8Array; verbosity?: number }): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<PageLike> }>;
  };
}
interface PageLike {
  view: number[];
  rotate: number;
  getTextContent(): Promise<{
    items: { str?: string }[];
    styles: Record<string, { ascent?: number; descent?: number }>;
  }>;
}

function fakeDiv(): HTMLElement {
  const attrs = new Map<string, string>();
  return {
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
  } as unknown as HTMLElement;
}

let pdfjs: PdfjsLike;
beforeAll(async () => {
  const require = createRequire(`${REPO_ROOT}apps/web/package.json`);
  pdfjs = (await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))) as unknown as PdfjsLike;
});

describe.skipIf(unavailable !== null)('s4: an unstamped table cell is captured from item geometry', () => {
  it('ResNet (live worker parse): every unstamped table-cell item yields quads inside its own box', async () => {
    const doc = indexDocument(liveParse(SLUG), `api/${'ppr_S4REPARSE00000000000000000'}/g1/1.0.0`);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(corpusPdf(SLUG))), verbosity: 0 })
      .promise;
    const stream = pageTextStreamId(pdfjs.version);

    let cellItems = 0;
    let stamped = 0;
    let captured = 0;
    let asCells = 0;
    const worst: number[] = [];
    for (const irPage of doc.pages) {
      const cells = (doc.byPage.get(irPage.index) ?? []).filter((b) => b.type === 'table_cell');
      if (cells.length === 0) continue;
      const page = await pdf.getPage(irPage.index + 1);
      const content = await page.getTextContent();
      const items = alignedItems(content.items) as unknown as Item[];
      const divs = items.map(() => fakeDiv());
      stampTextLayer({
        divs,
        items,
        page: { view: page.view as [number, number, number, number], rotate: page.rotate, userUnit: irPage.user_unit ?? 1 },
        blocks: doc.byPage.get(irPage.index) ?? [],
      });
      const frame = frameForPdfPage({ view: page.view as [number, number, number, number], rotate: page.rotate });
      const geometry = items.map((item) => {
        const style = item.fontName === undefined ? undefined : content.styles[item.fontName];
        return {
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
          ...(item.hasEOL === undefined ? {} : { hasEOL: item.hasEOL }),
          ...(style?.ascent === undefined ? {} : { ascent: style.ascent }),
          ...(style?.descent === undefined ? {} : { descent: style.descent }),
        };
      });

      items.forEach((item, index) => {
        if (item.str.trim() === '') return;
        const [, , , , e, f] = item.transform as [number, number, number, number, number, number];
        // The item's advance box in IR space, computed here independently of `bridge.ts`.
        const box = pdfRectToIr(frame, [e, f - item.height, e + item.width, f + item.height]);
        const cx = (box[0] + box[2]) / 2;
        const baseline = pdfRectToIr(frame, [e, f, e + 1, f + 0.001])[1];
        const inCell = cells.some((c) => cx >= c.bbox[0] && cx <= c.bbox[2] && baseline >= c.bbox[1] - 2 && baseline <= c.bbox[3] + 2);
        if (!inCell) return;
        cellItems += 1;
        if ((divs[index] as HTMLElement).getAttribute('data-cp-start') !== null) {
          stamped += 1;
          return;
        }
        const anchor = capturePageTextAnchor({
          doc,
          pageIndex: irPage.index,
          frame,
          items: geometry,
          start: { item: index, offset: 0 },
          end: { item: index, offset: Array.from(item.str).length },
          textStreamId: stream,
          id: '00000000-0000-4000-8000-00000000c311',
          at: '2026-09-26T00:00:00.000Z',
          client: 'test/s4-table-cell-capture',
        });
        expect(anchor, `item ${String(index)} "${item.str}" captured nothing`).not.toBeNull();
        if (anchor === null) return;
        captured += 1;
        expect(anchor.selectors.map((s) => s.type)).toEqual(['PageSelector', 'TextQuoteSelector', 'ShapeSelector']);
        expect(anchor.doc.textStreamId).toBe(stream);
        // `table_cell` exactly when the captured glyphs sit inside a table-cell block — a bracket
        // of the architecture table's matrix notation sits in the table and in no cell, and is text.
        const shapeOf = anchor.selectors.find((s): s is ShapeSelector => s.type === 'ShapeSelector') as ShapeSelector;
        const q = shapeOf.quads[0] as readonly number[];
        const qx = ((q[0] ?? 0) + (q[2] ?? 0)) / 2;
        const qy = ((q[1] ?? 0) + (q[3] ?? 0)) / 2;
        const insideCell = cells.some((c) => qx >= c.bbox[0] && qx <= c.bbox[2] && qy >= c.bbox[1] && qy <= c.bbox[3]);
        if (insideCell) expect(anchor.targetKind).toBe('table_cell');
        else expect(['text', 'figure_region']).toContain(anchor.targetKind);
        if (insideCell) asCells += 1;
        const quote = anchor.selectors.find((s): s is TextQuoteSelector => s.type === 'TextQuoteSelector');
        expect(quote?.exact).toBe(item.str);
        const shape = anchor.selectors.find((s): s is ShapeSelector => s.type === 'ShapeSelector') as ShapeSelector;
        for (const quad of shape.quads) {
          // Horizontally the item's own advance; vertically within one font height of its baseline.
          expect(quad[0]).toBeGreaterThanOrEqual(box[0] - 0.01);
          expect(quad[2]).toBeLessThanOrEqual(box[2] + 0.01);
          expect(quad[1]).toBeGreaterThanOrEqual(baseline - item.height - 0.01);
          expect(quad[3]).toBeLessThanOrEqual(baseline + item.height + 0.01);
          worst.push(Math.max(box[0] - quad[0], quad[2] - box[2], 0));
        }
      });
    }
    // eslint-disable-next-line no-console
    console.log(
      `[s4-table-cell-capture] ${SLUG}: ${String(cellItems)} table-cell items, ${String(stamped)} stamped by the IR, ` +
        `${String(captured)} captured from item geometry (${String(asCells)} as table_cell), worst horizontal ` +
        `overshoot ${Math.max(0, ...worst).toFixed(3)} pt`,
    );
    // Non-vacuous: the live parse has table cells, and most of their items are not stamped.
    expect(cellItems).toBeGreaterThan(20);
    expect(captured).toBeGreaterThan(cellItems / 2);
    expect(asCells).toBeGreaterThan(captured / 2);
  });
});
