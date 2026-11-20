/**
 * lib/imageAnchor — an IMAGE anchor: a figure, a table, an equation or any rectangle of a page
 * (v0.3 #348, `v03-IMAGE-SPEC.md` "Image anchor").
 *
 * The wire shape is fixed by the API, and anything else is a 422: Anchor v1 with `targetKind`
 * `figure` (a whole float, optionally naming its block) or `figure_region` (a free rectangle), one
 * PageSelector, ONE ShapeSelector with exactly one quad `[x0, y0, x1, y1]` in PDF points (origin
 * top-left, page 0-based), and NO TextQuoteSelector. Pure: the reader, the explain panel, the board
 * and the send-to-board action all read and write it here, so the shape is stated once.
 */
import type { Anchor, IndexedBlock, IndexedDocument } from '@papertree/anchoring';
import type { BBox } from '@papertree/document-ir';

/** The two target kinds an image anchor may carry. */
export type ImageKind = 'figure' | 'figure_region';

/** Where an image anchor points: a page and one rectangle on it, in PDF points. */
export interface ImageBox {
  readonly page: number;
  readonly box: BBox;
}

/**
 * What an image ask carries beside its anchor: how the picture is named (for the panel and the
 * card), its caption, and the words selected with it (the "figure + paragraph" ask).
 */
export interface ImageAsk {
  /** "Figure 2", "Table 1", "Region": what to call it. */
  readonly label: string;
  /** The caption as the paper has it, or null (a free region has none). */
  readonly caption: string | null;
  /** The paragraph or caption selected together with the figure, sent as `with_text_anchor`. */
  readonly withText?: { readonly anchor: Anchor; readonly quote: string };
}

/** What `buildImageAnchor` needs. */
interface ImageAnchorInput {
  readonly doc: IndexedDocument;
  readonly page: number;
  readonly box: BBox;
  readonly kind: ImageKind;
  /** The float's own block, for a whole-float anchor. */
  readonly block?: IndexedBlock;
  readonly id: string;
  /** ISO time of the capture. */
  readonly at: string;
  readonly client: string;
}

function isBox(quad: readonly number[] | undefined): quad is BBox {
  return (
    quad !== undefined &&
    quad.length === 4 &&
    quad.every((n) => Number.isFinite(n)) &&
    (quad[2] as number) > (quad[0] as number) &&
    (quad[3] as number) > (quad[1] as number)
  );
}

/**
 * Is this an image anchor: a figure or a free region with its rectangle and no quoted text?
 *
 * @param anchor The anchor, or null.
 * @returns True for the shape the image ask and a region-only highlight use.
 */
export function isImageAnchor(anchor: Anchor | null | undefined): boolean {
  if (anchor === null || anchor === undefined) return false;
  if (anchor.targetKind !== 'figure' && anchor.targetKind !== 'figure_region') return false;
  if (anchor.selectors.some((s) => s.type === 'TextQuoteSelector')) return false;
  return imageBoxOf(anchor) !== null;
}

/**
 * The page and rectangle of an image anchor.
 *
 * @param anchor The anchor.
 * @returns Its page (0-based) and its one quad, or null when it has no usable rectangle.
 */
export function imageBoxOf(anchor: Anchor): ImageBox | null {
  for (const selector of anchor.selectors) {
    if (selector.type !== 'ShapeSelector' || selector.quads.length !== 1) continue;
    const quad = selector.quads[0];
    if (isBox(quad)) return { page: selector.pageIndex, box: [quad[0], quad[1], quad[2], quad[3]] };
  }
  return null;
}

/**
 * Builds the image anchor the API accepts.
 *
 * @param input The parse, the page, the rectangle (PDF points, origin top-left) and what it is.
 * @returns An Anchor v1 with a PageSelector and one ShapeSelector quad, and the float's
 *   BlockSelector when it is a whole float.
 */
export function buildImageAnchor(input: ImageAnchorInput): Anchor {
  const { doc, page, box, kind, block } = input;
  const source = doc.pages.find((p) => p.index === page);
  const width = source?.width ?? 0;
  const height = source?.height ?? 0;
  const [x0, y0, x1, y1] = box;
  return {
    anchorVersion: 1,
    offsetUnit: 'unicode',
    id: input.id,
    doc: {
      paperId: doc.paperId,
      pdfSha256: doc.sourceHash,
      parserVersion: doc.parserVersion,
      textStreamId: doc.textStreamId,
    },
    targetKind: kind,
    provenanceClass: 'source',
    selectors: [
      ...(block === undefined
        ? []
        : [
            {
              type: 'BlockSelector' as const,
              blockId: block.id,
              blockTextHash: block.contentHash,
            },
          ]),
      {
        type: 'PageSelector',
        index: page,
        ...(source?.label === undefined ? {} : { label: source.label }),
      },
      {
        type: 'ShapeSelector',
        pageIndex: page,
        quads: [[x0, y0, x1, y1]],
        polygons: [
          [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
          ],
        ],
        pageWidth: width,
        pageHeight: height,
        rotation: (source?.rotation ?? 0) as 0 | 90 | 180 | 270,
        userUnit: source?.user_unit ?? 1,
        cropBox: (source?.crop_box as unknown as BBox | undefined) ?? [0, 0, width, height],
      },
    ],
    created: { mode: 'source', at: input.at, client: input.client },
  };
}

const LABEL = /^\s*(Figure|Fig\.?|Table|Algorithm|Alg\.?)\s*(\d+[A-Za-z]?)/i;

/**
 * "Fig. 4": a short name from a caption's opening words, for the card's quiet source line.
 *
 * @param caption The caption, or null.
 * @returns "Fig. 4", "Table 2", "Alg. 1", or null when the caption does not open with one.
 */
export function shortLabel(caption: string | null): string | null {
  const found = caption === null ? null : LABEL.exec(caption);
  if (found === null) return null;
  const word = (found[1] ?? '').toLowerCase();
  const name = word.startsWith('fig') ? 'Fig.' : word.startsWith('alg') ? 'Alg.' : 'Table';
  return `${name} ${found[2] ?? ''}`;
}

/**
 * The full name from a caption's opening words: "Figure 4".
 *
 * @param caption The caption, or null.
 * @returns "Figure 4", "Table 2", "Algorithm 1", or null.
 */
export function longLabel(caption: string | null): string | null {
  const short = shortLabel(caption);
  if (short === null) return null;
  return short.replace(/^Fig\./, 'Figure').replace(/^Alg\./, 'Algorithm');
}

/** What a picked picture is, said in a word: a figure (a whole float) or an area (a drawn rectangle). */
export interface PictureName {
  readonly thing: 'figure' | 'area';
  /** "Figure 2", "Table 1", "Figure" (the number is not known), or "Selected area". */
  readonly label: string;
}

/**
 * What a picture is called, from its anchor and the words stored with it. A whole float is a
 * figure, named by the number its caption (or label) opens with ("Figure 2"), or plain "Figure"
 * when none is known; a drawn rectangle is a "Selected area", whatever words came with it.
 *
 * @param anchor The anchor, or null.
 * @param body The words stored with the picture: its caption, or the bare label ("Figure 2").
 * @returns The name, or null when the anchor is not an image anchor.
 */
export function pictureNameOf(
  anchor: Anchor | null | undefined,
  body: string | null | undefined,
): PictureName | null {
  if (!isImageAnchor(anchor) || anchor === null || anchor === undefined) return null;
  if (anchor.targetKind === 'figure_region') return { thing: 'area', label: 'Selected area' };
  return { thing: 'figure', label: longLabel(body?.trim() ?? null) ?? 'Figure' };
}

/**
 * What a whole float stores as the body of its board card: its caption, else its bare name when
 * the name carries a number ("Figure 2"), so the card can say which figure it is when the parser
 * linked no caption; else nothing.
 *
 * @param caption The caption the parser linked, or null.
 * @param label The float's label ("Figure 2", or "Figure" when no number was read).
 * @returns The body.
 */
export function floatCardBody(caption: string | null, label: string): string {
  if (caption !== null && caption !== '') return caption;
  return longLabel(label) === null ? '' : label;
}

/**
 * The picture's alt text: the caption and, when there is one, a short description (the first
 * answer's TL;DR line).
 *
 * @param label What it is called ("Figure 4"), or what stands in for a name.
 * @param caption The caption or null.
 * @param description The first answer's TL;DR, or null.
 * @returns One sentence-ish string.
 */
export function imageAlt(
  label: string,
  caption: string | null,
  description: string | null = null,
): string {
  const named = caption !== null && caption.trim() !== '' ? caption.trim() : label;
  return description === null || description.trim() === ''
    ? named
    : `${named} ${description.trim()}`;
}
