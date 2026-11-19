/**
 * board/model/imageFixtures — an image anchor for the board's tests. Test-only.
 */
import type { Anchor } from '@papertree/anchoring';

/**
 * A client-shaped image anchor on 0-based `page`, `[100, 120, 400, 300]`, no quote.
 *
 * @param page 0-based page.
 * @returns The anchor.
 */
export function askAnchorFixture(page: number): Anchor {
  return {
    anchorVersion: 1,
    offsetUnit: 'unicode',
    id: `image-${String(page)}`,
    doc: { paperId: 'ppr_1', pdfSha256: 'sha256:x', parserVersion: 'v1', textStreamId: 't' },
    targetKind: 'figure',
    provenanceClass: 'source',
    selectors: [
      { type: 'BlockSelector', blockId: 'blk_fig', blockTextHash: 'h' },
      { type: 'PageSelector', index: page },
      {
        type: 'ShapeSelector',
        pageIndex: page,
        quads: [[100, 120, 400, 300]],
        polygons: [],
        pageWidth: 612,
        pageHeight: 792,
        rotation: 0,
        userUnit: 1,
        cropBox: [0, 0, 612, 792],
      },
    ],
    created: { mode: 'source', at: '2026-11-20T10:00:00.000Z', client: 'test' },
  } as unknown as Anchor;
}
