'use client';

/**
 * reader/GuidedView — F2.5. The reflowed reading, and the place DESIGN.md §11.4 is either kept or
 * broken.
 *
 * GUIDED IS NOT "THE BOOK". It never replaces the paper (§18.3), and every line of prose it shows
 * is an interpretation: a two-column PDF reflowed to one column, line breaks removed, hyphens
 * repaired by a rule that is knowingly wrong about `high-level`. All of that is *fine* — as long as
 * the reader can tell. So:
 *
 *   - every text block goes through `DerivedBlock`, which is the only component in the product that
 *     can render derived content, and which cannot be constructed without `derived_from` ids and a
 *     working `onShowSource`;
 *   - a persistent header states the register, so a reader who scrolls into the middle still knows
 *     what they are looking at;
 *   - equations, figures and tables DO NOT go through `DerivedBlock`, and that is not an exemption:
 *     see EQUATIONS below.
 *
 * EQUATIONS, FIGURES, TABLES — THE CROP IS THE PAPER.
 * `EquationView` renders the rendered crop first, unmarked, because the crop IS the equation; the
 * `latex`/`mathml` string is a decoder's guess and it renders below, inside `DerivedBlock`, as "our
 * transcription". Wrapping the whole `EquationView` in another `DerivedBlock` would mark the crop
 * as derived — the same register error as rendering LaTeX as the paper, just pointing the other
 * way. The rule is "the reader can always tell which is which", not "everything wears a badge".
 *
 * WHY THIS ITERATES `doc.blocks` AND NOT `doc.sections`.
 * Front matter belongs to no section in ALL THREE fixtures — 24 blocks in `attention`, 43 in
 * `neural-odes`, 13 in `resnet`. Rebuilding the document by concatenating `sections[].block_ids`
 * silently drops the title, the authors, and (in `neural-odes`) the entire abstract. `doc.blocks` is
 * already in reading order and contains everything, which is why `indexDocument` computes that
 * order instead of trusting `doc_order` — 64 of the set's 199 blocks do not carry `doc_order` at
 * all.
 *
 * NO MERMAID, EVER. A derived section that wants to show the paper's structure shows the paper's
 * own figure crop. A diagram a model drew of what it thinks the architecture is, rendered in the
 * same register as the paper, is the single most expensive thing this file could do.
 */

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { DerivedBlock, EquationView, FigureView, TableView } from '@papertree/ui';
import type { IndexedBlock, IndexedDocument } from '@papertree/anchoring';

import { assetSrc } from './assetSrc';
import { joinContinuedBlocks, reflow, reflowPreservingLines } from './reflow';

export { joinContinuedBlocks, reflow, reflowPreservingLines };

export interface GuidedViewProps {
  readonly doc: IndexedDocument;
  /**
   * Navigate Source to these blocks. REQUIRED, and required to actually work — `DerivedBlock`
   * refuses to render without it, and §18.6's rule is that no view is a dead end.
   */
  readonly onShowSource: (blockIds: readonly string[]) => void;
  /**
   * Resolve a PaperIR `image.uri` to something an `<img>` can load. Defaults to `assetSrc`, which
   * handles the `fixture://` scheme and passes real URLs through untouched. Override it to point at
   * a CDN.
   */
  readonly resolveAssetSrc?: (uri: string) => string;
  /** Scroll-link target, set by `SplitView`. Highlighted, never scrolled to from inside here. */
  readonly activeBlockId?: string;
  readonly className?: string;
}

/**
 * Page furniture. Present in the IR, absent from the reading.
 *
 * A page number, a running footer and the arXiv stamp down the margin are artefacts of the page,
 * not of the argument — and Guided has no pages. `annotation` is the arXiv stamp in `neural-odes`
 * ("arXiv:1806.07366v5 [cs.LG] 14 Dec 2019"); `margin_note` is the same thing in `attention` and
 * `resnet`. `unknown` blocks are hairline rules 0.4–4pt tall carrying confidence 0.3 and no text at
 * all: there is nothing to render and drawing a box for one would be inventing a paragraph.
 *
 * They are COUNTED and reported at the foot of the reading rather than dropped in silence — "we
 * left something out" is a claim the reader is entitled to check.
 */
const FURNITURE_TYPES: ReadonlySet<string> = new Set([
  'page_number',
  'footer',
  'header',
  'margin_note',
  'annotation',
  'unknown',
]);

/** Line-preserving types: pseudocode is laid out on purpose and `reflow` would flatten it. */
const LINEWISE_TYPES: ReadonlySet<string> = new Set(['algorithm']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** `payload.image.uri` — the rendered crop. Rule 36 requires it for equations and figures. */
function payloadImageUri(block: IndexedBlock): string | undefined {
  const image = asRecord(block.payload?.['image']);
  return image === undefined ? undefined : asNonEmptyString(image['uri']);
}

/**
 * A block is nested INSIDE CONTENT when its parent is not a heading.
 *
 * `parent_id` carries two different relations in the fixtures and conflating them loses blocks. A
 * paragraph's parent is its section HEADING (that is sectioning, and the paragraph is still
 * top-level prose); a `table_cell`'s parent is a `table_row`, a `table_row`'s is a `table`, and an
 * `inline_equation`'s is the paragraph whose text already contains it — verified: the parent's text
 * includes the inline equation's text in all 5 occurrences across the three fixtures. Only the
 * second kind must be skipped, and rendering them top-level would print every table cell twice.
 */
function isNestedInContent(block: IndexedBlock, doc: IndexedDocument): boolean {
  if (block.parentId === null) return false;
  const parent = doc.byId.get(block.parentId);
  if (parent === undefined) return false;
  return parent.type !== 'heading';
}

/** Captions owned by a figure or table; rendered by their owner, not on their own. */
function captionsClaimedByFloats(doc: IndexedDocument): ReadonlySet<string> {
  const claimed = new Set<string>();
  for (const block of doc.blocks) {
    const captionBlock = asNonEmptyString(block.payload?.['caption_block']);
    if (captionBlock !== undefined) claimed.add(captionBlock);
  }
  return claimed;
}

interface RenderPlan {
  readonly rendered: readonly IndexedBlock[];
  readonly furnitureCount: number;
}

/** The relation types that mean "the SAME paragraph, continued in another block". */
const CONTINUATION_TYPES: ReadonlySet<string> = new Set([
  'continues_in_next_column',
  'continues_on_next_page',
]);

/**
 * `from → to` for every continuation relation, read from `doc.relations`.
 *
 * COMPATIBILITY SHIM, AND IT IS LOAD-BEARING TODAY. `doc.continuedBy` is the right source and this
 * should just use it, but `anchoring/document.ts` builds that map by reading `relation.from_block_id`
 * / `relation.to_block_id`, and the fixtures spell those fields `from` / `to`:
 *
 *     {"type":"continues_on_next_page","from":"blk_…","to":"blk_…","confidence":0.99,
 *      "provenance":"hyphen-continuity"}
 *
 * So every relation writes `undefined → undefined` and `doc.continuedBy` comes out as a ONE-entry
 * map keyed `undefined` — measured, on `resnet`, which has four continuation relations. Nothing
 * throws: `byId.has(undefined)` is false, so the merge below simply never fires and the reading
 * silently keeps "high- way networks". That is a defect in `packages/anchoring/src/document.ts`
 * (reported, not patched here — it is another group's file), and this function accepts BOTH
 * spellings so Guided is correct either way. DELETE IT once `continuedBy` is fixed.
 */
function continuationMap(doc: IndexedDocument): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const relation of doc.relations) {
    if (!CONTINUATION_TYPES.has(relation.type)) continue;
    const record = relation as unknown as Record<string, unknown>;
    const from = relation.from_block_id ?? record['from'];
    const to = relation.to_block_id ?? record['to'];
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    if (!doc.byId.has(from) || !doc.byId.has(to)) continue;
    map.set(from, to);
  }
  return map;
}

/**
 * Decide, once, what the reading contains. Exported so a spec can assert the front matter survives.
 */
export function planGuidedReading(doc: IndexedDocument): RenderPlan {
  const claimedCaptions = captionsClaimedByFloats(doc);
  const rendered: IndexedBlock[] = [];
  let furnitureCount = 0;

  // A CONTINUED PARAGRAPH IS ONE PARAGRAPH. `continues_in_next_column` and
  // `continues_on_next_page` say that a block's text runs on into another block, and Guided view is
  // the one place where that matters visibly: the source shows two columns, the reading shows one
  // paragraph. Rendering the fragments separately also breaks de-hyphenation across the seam —
  // `resnet`'s `blk_4hiq3kzukt6azk4x` ends with the characters `high-` and finishes as `way
  // networks` in the block it continues into, so two paragraphs read "high- way networks".
  //
  // Continuations are collected here and rendered by the FIRST fragment, which owns the merged
  // text; the tail fragments are dropped from the plan (but keep their own block ids in
  // `derivedFrom`, so "show source" still reaches whichever column the reader means).
  const continuationTails = new Set<string>();
  continuationMap(doc).forEach((to) => {
    continuationTails.add(to);
  });

  for (const block of doc.blocks) {
    if (continuationTails.has(block.id)) continue;
    if (isNestedInContent(block, doc)) continue;
    if (claimedCaptions.has(block.id)) continue;
    if (FURNITURE_TYPES.has(block.type)) {
      furnitureCount += 1;
      continue;
    }
    // A text block with nothing in it has nothing to reflow. Floats carry no text by design and
    // must survive this check — `figure`, `table` and `unknown` have no `text` key at all.
    const isFloat = block.type === 'figure' || block.type === 'table' || block.type === 'equation';
    if (!isFloat && block.text.trim().length === 0) {
      furnitureCount += 1;
      continue;
    }
    rendered.push(block);
  }

  return { rendered, furnitureCount };
}


/**
 * The full text of a block, following any `continues_in_next_column` / `continues_on_next_page`
 * chain, plus every block id that contributed.
 *
 * The ids matter as much as the text: "show source" on a merged paragraph must be able to reach
 * BOTH columns, so `derivedFrom` carries the whole chain rather than only the head.
 *
 * `joinContinuedBlocks` — not `reflow` on a concatenation — because the seam needs the hyphen rule
 * applied at a block boundary where there is no newline to trigger it.
 */
export function continuedText(
  block: IndexedBlock,
  doc: IndexedDocument,
): { readonly text: string; readonly sourceIds: readonly string[] } {
  const texts: string[] = [block.text];
  const sourceIds: string[] = [block.id];
  const seen = new Set<string>([block.id]);
  const continuedBy = continuationMap(doc);

  // `seen` is not defensive padding: a `continues_*` cycle would otherwise hang the render, and a
  // relation list is parser output, not something the schema proves acyclic.
  let cursor: string | undefined = continuedBy.get(block.id);
  while (cursor !== undefined && !seen.has(cursor)) {
    const next = doc.byId.get(cursor);
    if (next === undefined) break;
    seen.add(cursor);
    texts.push(next.text);
    sourceIds.push(next.id);
    cursor = continuedBy.get(cursor);
  }

  return { text: joinContinuedBlocks(texts), sourceIds };
}

/** Heading level for a block, so the reading has a real document outline for a screen reader. */
function headingTag(block: IndexedBlock): 'h1' | 'h2' | 'h3' | null {
  if (block.type === 'title') return 'h1';
  if (block.type === 'heading') return 'h2';
  return null;
}

function GuidedText({
  block,
  doc,
  onShowSource,
  active,
}: {
  readonly block: IndexedBlock;
  readonly doc: IndexedDocument;
  readonly onShowSource: (blockIds: readonly string[]) => void;
  readonly active: boolean;
}): ReactNode {
  const tag = headingTag(block);
  // Follows the continuation chain, so a paragraph split across two columns reads as one — and its
  // hyphen at the seam is repaired.
  const { text: fullText } = continuedText(block, doc);
  const lines = LINEWISE_TYPES.has(block.type) ? reflowPreservingLines(fullText) : null;

  const body: ReactNode =
    lines !== null ? (
      // Pseudocode. Monospaced and line-per-line, because the layout is the meaning. Still inside
      // `DerivedBlock`: the LINES are the paper's, the decision to typeset them this way is ours.
      <div className="font-mono text-[13px] leading-relaxed">
        {lines.map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key -- lines have no ids; order is the id
          <div key={index} className={line.length === 0 ? 'h-3' : undefined}>
            {line}
          </div>
        ))}
      </div>
    ) : tag === 'h1' ? (
      <h1 className="text-2xl font-semibold leading-snug">{fullText}</h1>
    ) : tag === 'h2' ? (
      <h2 className="text-lg font-semibold leading-snug">{fullText}</h2>
    ) : (
      <p
        className={
          block.type === 'abstract'
            ? 'text-[15px] leading-7 text-gray-700 dark:text-gray-300'
            : block.type === 'footnote' || block.type === 'caption'
              ? 'text-[13px] leading-6 text-gray-600 dark:text-gray-400'
              : 'text-[16px] leading-8'
        }
      >
        {fullText}
      </p>
    );

  return (
    <div
      // SplitView links panes by THIS attribute. It is the block id and nothing else — never a page,
      // never a scroll ratio.
      data-block-id={block.id}
      data-block-type={block.type}
      className={active ? 'rounded-sm ring-2 ring-amber-400/70' : undefined}
    >
      <DerivedBlock
        derivedFrom={[block.id]}
        onShowSource={onShowSource}
        kind={block.type === 'abstract' ? 'summary' : 'prose'}
      >
        {body}
      </DerivedBlock>
    </div>
  );
}

function GuidedEquation({
  block,
  doc,
  onShowSource,
  resolveAssetSrc,
}: {
  readonly block: IndexedBlock;
  readonly doc: IndexedDocument;
  readonly onShowSource: (blockIds: readonly string[]) => void;
  readonly resolveAssetSrc: (uri: string) => string;
}): ReactNode {
  // ALWAYS from the payload, NEVER parsed out of the text. `attention` and `resnet` put "(1)" in
  // `Block.text`; `neural-odes` does not put it there at all, so a regex over the text produces
  // unnumbered equations on one of three fixtures and nobody notices until a citation says "eq 2".
  const equationNumber = asNonEmptyString(block.payload?.['equation_number']);
  const latex = asNonEmptyString(block.payload?.['latex']);
  const mathml = asNonEmptyString(block.payload?.['mathml']);
  const uri = payloadImageUri(block);

  if (uri === undefined) {
    // No crop. `Block.text` here came off the PDF's own text layer, so it is still the paper — it
    // renders as source, unmarked, with the absence stated rather than papered over with LaTeX.
    return (
      <figure data-block-id={block.id} data-block-type="equation" className="my-6 text-center">
        <pre className="inline-block whitespace-pre-wrap text-left font-mono text-sm">{block.text}</pre>
        {equationNumber === undefined ? null : (
          <span className="ml-3 align-middle text-sm text-gray-500">({equationNumber})</span>
        )}
        <figcaption className="mt-1 text-xs text-gray-500">
          No rendered crop for this equation; showing the extracted text layer.
        </figcaption>
      </figure>
    );
  }

  const page = doc.pages.find((candidate) => candidate.index === block.pageIndex);
  const alt =
    equationNumber === undefined
      ? `Equation on page ${String((page?.index ?? block.pageIndex) + 1)}`
      : `Equation (${equationNumber})`;

  return (
    <div className="my-6">
      <EquationView
        blockId={block.id}
        imageSrc={resolveAssetSrc(uri)}
        imageAlt={alt}
        onShowSource={onShowSource}
        // `exactOptionalPropertyTypes`: the key is OMITTED when absent, never set to undefined.
        {...(equationNumber === undefined ? {} : { equationNumber })}
        {...(latex === undefined ? {} : { latex })}
        {...(mathml === undefined ? {} : { mathml })}
      />
    </div>
  );
}

function GuidedFigure({
  block,
  doc,
  resolveAssetSrc,
}: {
  readonly block: IndexedBlock;
  readonly doc: IndexedDocument;
  readonly resolveAssetSrc: (uri: string) => string;
}): ReactNode {
  const uri = payloadImageUri(block);
  const captionId = asNonEmptyString(block.payload?.['caption_block']);
  const caption = captionId === undefined ? undefined : doc.byId.get(captionId)?.text;
  const figureNumber = asNonEmptyString(block.payload?.['figure_number']);
  const captionText = caption === undefined ? undefined : reflow(caption);

  if (uri === undefined) {
    return (
      <figure data-block-id={block.id} data-block-type="figure" className="my-6">
        <div className="flex min-h-[120px] items-center justify-center rounded border border-dashed border-gray-300 text-sm text-gray-500 dark:border-gray-700">
          {figureNumber === undefined ? 'Figure' : `Figure ${figureNumber}`} — no crop available
        </div>
        {captionText === undefined ? null : (
          <figcaption className="mt-2 text-[13px] leading-6 text-gray-600 dark:text-gray-400">
            {captionText}
          </figcaption>
        )}
      </figure>
    );
  }

  return (
    <div className="my-6">
      <FigureView
        blockId={block.id}
        imageSrc={resolveAssetSrc(uri)}
        imageAlt={
          captionText ?? (figureNumber === undefined ? 'Figure from the paper' : `Figure ${figureNumber}`)
        }
        {...(captionText === undefined ? {} : { caption: captionText })}
      />
    </div>
  );
}

interface TableCellSpec {
  readonly id: string;
  readonly text: string;
  readonly isHeader?: boolean;
}

function GuidedTable({
  block,
  doc,
  onShowSource,
}: {
  readonly block: IndexedBlock;
  readonly doc: IndexedDocument;
  readonly onShowSource: (blockIds: readonly string[]) => void;
}): ReactNode {
  const captionId = asNonEmptyString(block.payload?.['caption_block']);
  const caption = captionId === undefined ? undefined : doc.byId.get(captionId)?.text;

  // Cells come from the IR's OWN `table_row` / `table_cell` blocks, whose text was read off the PDF
  // text layer. `payload.grid` supplies only the (r, c) placement. `payload.html`, when a parser
  // produces one, is never injected — `TableView` shows it as escaped text inside `DerivedBlock`.
  const grid = asRecord(block.payload?.['grid']);
  const rawCells = Array.isArray(grid?.['cells']) ? (grid['cells'] as readonly unknown[]) : [];

  const rows = useMemo(() => {
    const byRow = new Map<number, { id: string; cells: (TableCellSpec & { col: number })[] }>();
    for (const raw of rawCells) {
      const cell = asRecord(raw);
      if (cell === undefined) continue;
      const cellId = asNonEmptyString(cell['cell_id']);
      const rowIndex = typeof cell['r'] === 'number' ? cell['r'] : null;
      if (cellId === undefined || rowIndex === null) continue;

      const indexed = doc.byId.get(cellId);
      const rowId = indexed?.parentId ?? `${block.id}#row-${String(rowIndex)}`;
      const bucket = byRow.get(rowIndex) ?? { id: rowId, cells: [] };
      bucket.cells.push({
        id: cellId,
        col: typeof cell['c'] === 'number' ? cell['c'] : 0,
        text: indexed === undefined ? '' : reflow(indexed.text),
        ...(cell['is_header'] === true ? { isHeader: true } : {}),
      });
      byRow.set(rowIndex, bucket);
    }
    // Placement is the parser's; keep it and do not pad. `neural-odes`' header row starts at c=1
    // (the corner cell simply does not exist), so the rows are RAGGED — filling the gap with an
    // empty cell would invent a cell the paper does not have.
    return Array.from(byRow.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => ({
        id: row.id,
        cells: row.cells
          .sort((a, b) => a.col - b.col)
          .map((cell): TableCellSpec => ({
            id: cell.id,
            text: cell.text,
            ...(cell.isHeader === true ? { isHeader: true } : {}),
          })),
      }));
  }, [block.id, doc, rawCells]);

  return (
    <div className="my-6 overflow-x-auto">
      <TableView
        blockId={block.id}
        rows={rows}
        onShowSource={onShowSource}
        {...(caption === undefined ? {} : { caption: reflow(caption) })}
      />
    </div>
  );
}

export function GuidedView({
  doc,
  onShowSource,
  resolveAssetSrc = assetSrc,
  activeBlockId,
  className,
}: GuidedViewProps) {
  const plan = useMemo(() => planGuidedReading(doc), [doc]);

  return (
    <section
      aria-label="Guided reading"
      className={`flex h-full min-h-0 flex-col ${className ?? ''}`}
      data-guided-root="true"
    >
      {/*
        PERSISTENT, not a one-time banner. A reader who scrolls three screens in and looks up must
        still be told this is not the paper. It carries no DERIVED_MARKER: that mark is reserved to
        `DerivedBlock` and appears NOWHERE else in the product, which is exactly what makes it
        readable as a mark rather than as decoration.
      */}
      <header className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-gray-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Guided</span>
        <span className="text-xs text-gray-500">
          a derived reading of this paper — the paper itself is in Source
        </span>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
        // Vertical panning only; horizontal gestures belong to the pane, not the browser.
        style={{ touchAction: 'pan-y' }}
      >
        <div className="mx-auto flex max-w-[68ch] flex-col gap-4">
          {plan.rendered.map((block) => {
            if (block.type === 'equation') {
              return (
                <GuidedEquation
                  key={block.id}
                  block={block}
                  doc={doc}
                  onShowSource={onShowSource}
                  resolveAssetSrc={resolveAssetSrc}
                />
              );
            }
            if (block.type === 'figure') {
              return (
                <GuidedFigure key={block.id} block={block} doc={doc} resolveAssetSrc={resolveAssetSrc} />
              );
            }
            if (block.type === 'table') {
              return <GuidedTable key={block.id} block={block} doc={doc} onShowSource={onShowSource} />;
            }
            return (
              <GuidedText
                key={block.id}
                block={block}
                doc={doc}
                onShowSource={onShowSource}
                active={block.id === activeBlockId}
              />
            );
          })}

          {plan.furnitureCount === 0 ? null : (
            <p className="mt-6 border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-800">
              {plan.furnitureCount} page-furniture block
              {plan.furnitureCount === 1 ? '' : 's'} (page numbers, running footers, the arXiv stamp,
              hairline rules) are not part of this reading. They are still in Source.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
