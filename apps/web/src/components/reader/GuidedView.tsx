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
import { guidedProjectionFor } from '@papertree/anchoring';
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
 * Page furniture (`page_number`, `footer`, `header`, `margin_note`, `annotation`, `unknown`) and
 * the nested/claimed-caption rules that used to be duplicated here now live in
 * `@papertree/anchoring`'s `projectGuided`, as `GUIDED_FURNITURE_TYPES`. They are COUNTED and
 * reported at the foot of the reading rather than dropped in silence — "we left something out" is
 * a claim the reader is entitled to check — and `cross-mode.spec` asserts that a highlight on one
 * of them reports "not available in this view" instead of vanishing.
 */

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

interface RenderPlan {
  readonly rendered: readonly IndexedBlock[];
  readonly furnitureCount: number;
}

/**
 * The compatibility shim that used to live here is GONE, and that is the point.
 *
 * It existed because `doc.continuedBy` was a one-entry map keyed `undefined`: `document.ts` read
 * `relation.from_block_id` while the schema and all three fixtures spell the field `from`. This
 * file worked around it by re-deriving the map from `doc.relations` under both spellings, and noted
 * the defect as "another group's file" — which was the wrong call twice over. `packages/anchoring`
 * is the SAME epic's package, and a view that quietly re-implements its index is a second source of
 * truth that will drift from the first.
 *
 * `document.ts` now reads both spellings and validates both endpoints, so `doc.continuedBy` is
 * correct (resnet: 4 entries, was 1 keyed `undefined`) and `cross-mode.spec` can rely on the view
 * and the resolver agreeing about what a paragraph IS.
 */

/**
 * Decide, once, what the reading contains. Exported so a spec can assert the front matter survives.
 *
 * DELEGATES to `guidedProjectionFor(doc)`. This function used to own the logic, and
 * `resolveCrossMode` had to re-derive it to answer "which paragraph does this Source highlight land
 * in?". Two implementations of "what counts as a paragraph" drift, and the symptom when they do is a
 * highlight drawn in the wrong place — the one bug this epic exists to make impossible. So the
 * projection is computed once, in the package, and the view and the resolver read the same answer.
 */
export function planGuidedReading(doc: IndexedDocument): RenderPlan {
  const view = guidedProjectionFor(doc);
  const rendered: IndexedBlock[] = [];
  for (const paragraph of view.paragraphs) {
    const block = doc.byId.get(paragraph.id);
    if (block !== undefined) rendered.push(block);
  }
  return { rendered, furnitureCount: view.furnitureCount };
}

/**
 * The full text of a block, following any `continues_in_next_column` / `continues_on_next_page`
 * chain, plus every block id that contributed.
 *
 * The ids matter as much as the text: "show source" on a merged paragraph must be able to reach
 * BOTH columns, so `sourceIds` carries the whole chain rather than only the head.
 *
 * Also delegates, for the reason above. A block that is not a paragraph head in the projection (a
 * continuation tail, or furniture) has no reading of its own, and falls back to reflowing itself so
 * that a caller outside the plan still gets sensible text rather than an empty string.
 */
export function continuedText(
  block: IndexedBlock,
  doc: IndexedDocument,
): { readonly text: string; readonly sourceIds: readonly string[] } {
  const paragraph = guidedProjectionFor(doc).byParagraphId.get(block.id);
  if (paragraph !== undefined) {
    return { text: paragraph.text, sourceIds: paragraph.sourceIds };
  }
  return { text: reflow(block.text), sourceIds: [block.id] };
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
