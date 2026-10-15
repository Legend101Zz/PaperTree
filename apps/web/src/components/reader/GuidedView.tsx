'use client';

/**
 * reader/GuidedView — F2.5. The paper's own words, re-laid out in one column.
 *
 * GUIDED IS THE PAPER'S REGISTER (ADR-002 §3.6, owner default §10.1). Every paragraph here is the
 * paper's verbatim text — a two-column PDF reflowed, line breaks removed, typesetter hyphens
 * repaired — so it renders in `ReflowedText`: the paper's serif, a persistent "Reflowed from the
 * PDF" marker, and NO ⊙. The baseline rendered all of it under ⊙ with the labels "OUR READING" and
 * "OUR SUMMARY" (four verbatim abstract paragraphs labelled a summary): the paper dressed up as AI.
 * The ⊙ is reserved for model output, which Guided contains none of.
 *
 * EQUATIONS, FIGURES, TABLES — THE CROP IS THE PAPER. A crop renders only from a URL a browser can
 * load (`assetSrc`: `fixture://` resolved, `http(s)://` as signed by `/ir`). An `asset://` storage
 * key is not one, and gets a designed placeholder instead of a broken image.
 *
 * HIGHLIGHTS APPEAR HERE TOO (slice-plan §S4 work item 5), through `resolveCrossMode`: a highlight
 * whose text is in a paragraph is marked on that text; one on a table cell or a figure marks the
 * element that renders it; one the reading leaves out (page furniture) is listed at the top with the
 * resolver's own "not available in this view" sentence. Nothing is dropped in silence.
 *
 * WHY THIS ITERATES THE PROJECTION AND NOT `doc.sections`. Front matter belongs to no section in all
 * three fixtures; `projectGuided` walks `doc.blocks`, which contains everything, in reading order.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';

import { EquationView, FigureView, REFLOWED_LABEL, ReflowedText, TableView } from '@papertree/ui';
import {
  guidedProjectionFor,
  resolveCrossMode,
  type GuidedProjection,
  type IndexedBlock,
  type IndexedDocument,
} from '@papertree/anchoring';

import type { HighlightColor } from '@/lib/api/types';

import { assetSrc } from './assetSrc';
import { planFigures } from './guidedFigures';
import { displayQuote } from './quote';
import { joinContinuedBlocks, reflow, reflowPreservingLines } from './reflow';
import type { ReaderHighlight } from './useHighlights';

export { joinContinuedBlocks, reflow, reflowPreservingLines };

export interface GuidedViewProps {
  readonly doc: IndexedDocument;
  /** Navigate Source to these blocks. Every paragraph's page link calls it. */
  readonly onShowSource: (blockIds: readonly string[]) => void;
  /** Resolve a PaperIR `image.uri` to a loadable URL, or null. Defaults to `assetSrc`. */
  readonly resolveAssetSrc?: (uri: string) => string | null;
  readonly highlights?: readonly ReaderHighlight[];
  /** Scroll here once, on mount — where the reader was in Source (contracts.md §5 `blockId`). */
  readonly initialBlockId?: string | null;
  /** Split: keep this block at the top as Source moves. */
  readonly followBlockId?: string | null;
  /** The topmost paragraph, reported when the READER scrolls (not when this view is driven). */
  readonly onTopBlockChange?: (blockId: string) => void;
  /** `focusAnchor` in Guided: outline this block for 1.2 s. */
  readonly flashBlockId?: string | null;
  readonly className?: string;
}

interface Mark {
  readonly start: number;
  readonly end: number;
  readonly color: HighlightColor;
  readonly highlightId: string;
}

interface GuidedMarks {
  readonly text: ReadonlyMap<string, readonly Mark[]>;
  /** Blocks marked as a whole (a cell, a figure, a claimed caption): element id → colour. */
  readonly elements: ReadonlyMap<string, HighlightColor>;
  readonly unavailable: readonly { readonly highlightId: string; readonly quote: string; readonly message: string }[];
}

function quoteOf(highlight: ReaderHighlight): string {
  return displayQuote(highlight.anchors.map((a) => a.anchor));
}

/** Where every highlight lands in the reading — or why it does not. */
export function guidedMarks(
  doc: IndexedDocument,
  projection: GuidedProjection,
  highlights: readonly ReaderHighlight[],
): GuidedMarks {
  const text = new Map<string, Mark[]>();
  const elements = new Map<string, HighlightColor>();
  const unavailable: { highlightId: string; quote: string; message: string }[] = [];
  for (const highlight of highlights) {
    let shown = false;
    let message: string | null = null;
    for (const { anchor } of highlight.anchors) {
      const cross = resolveCrossMode(anchor, doc, 'guided', projection);
      if (cross.state !== 'resolved') {
        message ??= cross.message;
        continue;
      }
      shown = true;
      if (
        cross.paragraphId !== undefined &&
        cross.startOffset !== undefined &&
        cross.endOffset !== undefined &&
        cross.endOffset > cross.startOffset
      ) {
        const bucket = text.get(cross.paragraphId) ?? [];
        bucket.push({
          start: cross.startOffset,
          end: cross.endOffset,
          color: highlight.color,
          highlightId: highlight.highlightId,
        });
        text.set(cross.paragraphId, bucket);
      } else {
        const target = cross.blockIds[0] ?? cross.ownerBlockId ?? cross.paragraphId;
        if (target !== undefined) elements.set(target, highlight.color);
      }
    }
    if (!shown && message !== null) {
      unavailable.push({ highlightId: highlight.highlightId, quote: quoteOf(highlight), message });
    }
  }
  return { text, elements, unavailable };
}

/** The paragraph text, with each mark wrapped — offsets are code points, as the resolver counts. */
function withMarks(text: string, marks: readonly Mark[] | undefined): ReactNode {
  if (marks === undefined || marks.length === 0) return text;
  const points = Array.from(text);
  const sorted = [...marks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((mark, index) => {
    const start = Math.max(cursor, Math.min(points.length, mark.start));
    const end = Math.max(start, Math.min(points.length, mark.end));
    if (start > cursor) out.push(points.slice(cursor, start).join(''));
    if (end > start) {
      out.push(
        <mark key={`m${String(index)}`} data-color={mark.color} data-highlight-id={mark.highlightId}>
          {points.slice(start, end).join('')}
        </mark>,
      );
    }
    cursor = Math.max(cursor, end);
  });
  if (cursor < points.length) out.push(points.slice(cursor).join(''));
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function payloadImageUri(block: IndexedBlock): string | undefined {
  const image = asRecord(block.payload?.['image']);
  return image === undefined ? undefined : asNonEmptyString(image['uri']);
}

/** Exported so a spec can assert the front matter survives: the reading's blocks, in order. */
export function planGuidedReading(doc: IndexedDocument): {
  readonly rendered: readonly IndexedBlock[];
  readonly furnitureCount: number;
  /** A panel of a figure that Guided shows as one crop: dropped id -> the card that carries it. */
  readonly redirect: ReadonlyMap<string, string>;
  /** The caption block each figure card shows (RFIX2 R9: one crop, one caption). */
  readonly captionOf: ReadonlyMap<string, string>;
} {
  const view = guidedProjectionFor(doc);
  const all: IndexedBlock[] = [];
  for (const paragraph of view.paragraphs) {
    const block = doc.byId.get(paragraph.id);
    if (block !== undefined) all.push(block);
  }
  const figures = planFigures(all);
  const rendered = all.filter((block) => !figures.redirect.has(block.id));
  return { rendered, furnitureCount: view.furnitureCount, redirect: figures.redirect, captionOf: figures.caption };
}

/** The full text of a block, following any continuation chain, plus every contributing id. */
export function continuedText(
  block: IndexedBlock,
  doc: IndexedDocument,
): { readonly text: string; readonly sourceIds: readonly string[] } {
  const paragraph = guidedProjectionFor(doc).byParagraphId.get(block.id);
  if (paragraph !== undefined) return { text: paragraph.text, sourceIds: paragraph.sourceIds };
  return { text: reflow(block.text), sourceIds: [block.id] };
}

function pageLabel(doc: IndexedDocument, block: IndexedBlock): string {
  const page = doc.pages.find((p) => p.index === block.pageIndex);
  return `p. ${page?.label ?? String(block.pageIndex + 1)}`;
}

function GuidedText({
  block,
  doc,
  onShowSource,
  marks,
}: {
  readonly block: IndexedBlock;
  readonly doc: IndexedDocument;
  readonly onShowSource: (blockIds: readonly string[]) => void;
  readonly marks: readonly Mark[] | undefined;
}): ReactNode {
  const { text, sourceIds } = continuedText(block, doc);
  const lines = block.type === 'algorithm' ? reflowPreservingLines(text) : null;
  const body: ReactNode =
    lines !== null ? (
      <div className="font-mono text-[13px] leading-relaxed">
        {lines.map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key -- lines have no ids; order is the id
          <div key={index} className={line.length === 0 ? 'h-3' : undefined}>
            {line}
          </div>
        ))}
      </div>
    ) : block.type === 'title' ? (
      <h1 className="text-[1.75rem] font-semibold leading-tight">{withMarks(text, marks)}</h1>
    ) : block.type === 'heading' ? (
      <h2 className="mt-4 text-[1.25rem] font-semibold leading-snug">{withMarks(text, marks)}</h2>
    ) : (
      <p
        className={
          block.type === 'footnote' || block.type === 'caption' || block.type === 'reference_entry'
            ? 'text-[0.9375rem] leading-relaxed opacity-80'
            : undefined
        }
      >
        {withMarks(text, marks)}
      </p>
    );
  return (
    <ReflowedText
      blockIds={sourceIds}
      onShowSource={onShowSource}
      sourceLabel={pageLabel(doc, block)}
      dataBlockId={block.id}
      className="pt-guided__para"
    >
      {body}
    </ReflowedText>
  );
}

function CropMissing({ what }: { readonly what: string }): JSX.Element {
  return (
    <div className="pt-crop-missing" role="img" aria-label={`${what}: the image is not available yet`}>
      {what} — the image from the PDF is not available yet. It is on its page in Source.
    </div>
  );
}

function GuidedEquation({
  block,
  onShowSource,
  resolveAssetSrc,
}: {
  readonly block: IndexedBlock;
  readonly onShowSource: (blockIds: readonly string[]) => void;
  readonly resolveAssetSrc: (uri: string) => string | null;
}): ReactNode {
  const equationNumber = asNonEmptyString(block.payload?.['equation_number']);
  const latex = asNonEmptyString(block.payload?.['latex']);
  const mathml = asNonEmptyString(block.payload?.['mathml']);
  const uri = payloadImageUri(block);
  const src = uri === undefined ? null : resolveAssetSrc(uri);
  const label = equationNumber === undefined ? 'Equation' : `Equation (${equationNumber})`;

  if (src === null) {
    return (
      <figure data-block-id={block.id} data-block-type="equation" className="my-6">
        {block.text.trim().length > 0 ? (
          <pre className="whitespace-pre-wrap text-center font-mono text-sm">{block.text}</pre>
        ) : (
          <CropMissing what={label} />
        )}
      </figure>
    );
  }
  return (
    <div className="my-6">
      <EquationView
        blockId={block.id}
        imageSrc={src}
        imageAlt={label}
        onShowSource={onShowSource}
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
  captionId,
}: {
  readonly block: IndexedBlock;
  readonly doc: IndexedDocument;
  readonly resolveAssetSrc: (uri: string) => string | null;
  /** The one caption this card shows (`planGuidedReading`): its own, or a panel's, or none. */
  readonly captionId: string | undefined;
}): ReactNode {
  const uri = payloadImageUri(block);
  const src = uri === undefined ? null : resolveAssetSrc(uri);
  const caption = captionId === undefined ? undefined : doc.byId.get(captionId)?.text;
  const figureNumber = asNonEmptyString(block.payload?.['figure_number']);
  const captionText = caption === undefined ? undefined : reflow(caption);
  const name = figureNumber === undefined ? 'Figure' : `Figure ${figureNumber}`;

  if (src === null) {
    return (
      <figure data-block-id={block.id} data-block-type="figure" className="pt-figure my-6">
        <CropMissing what={name} />
        {captionText === undefined ? null : (
          <figcaption className="pt-figure__caption" data-block-id={captionId}>
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
        imageSrc={src}
        imageAlt={captionText ?? name}
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
  const grid = asRecord(block.payload?.['grid']);
  const rawCells = useMemo(
    () => (Array.isArray(grid?.['cells']) ? (grid['cells'] as readonly unknown[]) : []),
    [grid],
  );

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

/** The element that renders `blockId` in the reading: itself, its paragraph head, or its owner. */
function elementFor(
  root: HTMLElement,
  projection: GuidedProjection,
  blockId: string,
  redirect?: ReadonlyMap<string, string>,
): HTMLElement | null {
  const seen = new Set<string>();
  let cursor: string | undefined = blockId;
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(cursor) : cursor;
    const direct = root.querySelector<HTMLElement>(`[data-block-id="${escaped}"]`);
    if (direct !== null) return direct;
    // A panel of a figure is carried by the whole crop's card (RFIX2 R9).
    const carrier: string | undefined = redirect?.get(cursor);
    if (carrier !== undefined && !seen.has(carrier)) {
      cursor = carrier;
      continue;
    }
    const placement = projection.placement.get(cursor);
    if (placement === undefined || placement.kind === 'absent') return null;
    cursor = placement.kind === 'paragraph' ? placement.paragraphId : placement.ownerId;
    if (cursor === blockId) return null;
  }
  return null;
}

/**
 * The element to scroll to for `blockId`: the card that renders it, or - when the block is not in
 * the reading at all (page furniture, a block the reading leaves out) - the nearest card before it
 * in reading order, then the nearest after (RFIX2 R8: Source -> Guided must never fall back to the
 * top of the paper because the block Source was on has no card).
 */
function landingFor(
  root: HTMLElement,
  doc: IndexedDocument,
  projection: GuidedProjection,
  redirect: ReadonlyMap<string, string>,
  blockId: string,
): HTMLElement | null {
  const direct = elementFor(root, projection, blockId, redirect);
  if (direct !== null) return direct;
  const start = doc.byId.get(blockId)?.readingIndex;
  if (start === undefined) return null;
  const blocks = doc.blocks;
  for (let i = Math.min(start, blocks.length) - 1; i >= 0; i -= 1) {
    const candidate = blocks[i];
    if (candidate === undefined) continue;
    const found = elementFor(root, projection, candidate.id, redirect);
    if (found !== null) return found;
  }
  for (let i = start + 1; i < blocks.length; i += 1) {
    const candidate = blocks[i];
    if (candidate === undefined) continue;
    const found = elementFor(root, projection, candidate.id, redirect);
    if (found !== null) return found;
  }
  return null;
}

/** How long after a programmatic scroll its scroll events are still ours, not the reader's. */
const DRIVEN_MS = 400;

/** How long the arrival position is re-asserted while figure crops load. */
const SETTLE_MS = 2500;

export function GuidedView({
  doc,
  onShowSource,
  resolveAssetSrc = assetSrc,
  highlights = [],
  initialBlockId = null,
  followBlockId = null,
  onTopBlockChange,
  flashBlockId = null,
  className,
}: GuidedViewProps) {
  const projection = useMemo(() => guidedProjectionFor(doc), [doc]);
  const plan = useMemo(() => planGuidedReading(doc), [doc]);
  const marks = useMemo(() => guidedMarks(doc, projection, highlights), [doc, projection, highlights]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const drivenUntil = useRef(0);
  const lastTop = useRef<string | null>(null);
  const onTopRef = useRef(onTopBlockChange);
  onTopRef.current = onTopBlockChange;

  const scrollToBlock = useCallback(
    (blockId: string) => {
      const root = scrollerRef.current;
      if (root === null) return;
      const target = landingFor(root, doc, projection, plan.redirect, blockId);
      if (target === null) return;
      drivenUntil.current = Date.now() + DRIVEN_MS;
      const offset =
        target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      root.scrollTop = Math.max(0, offset - 16);
    },
    [doc, projection, plan],
  );

  useLayoutEffect(() => {
    if (initialBlockId !== null) scrollToBlock(initialBlockId);
    // Once, on mount: the position the reader arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A figure crop loads after the first paint and pushes everything below it down; the position the
  // reader arrived with is kept until they take over (RFIX2 R8). Ends at the first wheel, touch,
  // key or press, or after SETTLE_MS.
  useEffect(() => {
    const root = scrollerRef.current;
    if (root === null || initialBlockId === null) return undefined;
    let settled = false;
    const stop = (): void => {
      settled = true;
    };
    const reassert = (): void => {
      if (!settled) scrollToBlock(initialBlockId);
    };
    const timer = setTimeout(stop, SETTLE_MS);
    root.addEventListener('load', reassert, true);
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) {
      root.addEventListener(type, stop, { capture: true, passive: true });
    }
    return () => {
      clearTimeout(timer);
      root.removeEventListener('load', reassert, true);
      for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) {
        root.removeEventListener(type, stop, true);
      }
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (followBlockId === null || followBlockId === lastTop.current) return;
    scrollToBlock(followBlockId);
  }, [followBlockId, scrollToBlock]);

  // Whole-element marks (a table cell, a figure) are attributes on what the view already rendered.
  useEffect(() => {
    const root = scrollerRef.current;
    if (root === null) return undefined;
    const marked: HTMLElement[] = [];
    marks.elements.forEach((color, blockId) => {
      const element = elementFor(root, projection, blockId, plan.redirect);
      if (element === null) return;
      element.setAttribute('data-guided-mark', color);
      marked.push(element);
    });
    return () => marked.forEach((element) => element.removeAttribute('data-guided-mark'));
  }, [marks, projection, plan]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (root === null || flashBlockId === null) return undefined;
    const element = elementFor(root, projection, flashBlockId, plan.redirect);
    if (element === null) return undefined;
    scrollToBlock(flashBlockId);
    element.setAttribute('data-guided-flash', 'true');
    const timer = setTimeout(() => element.removeAttribute('data-guided-flash'), 1200);
    return () => {
      clearTimeout(timer);
      element.removeAttribute('data-guided-flash');
    };
  }, [flashBlockId, projection, plan, scrollToBlock]);

  const frame = useRef<number | null>(null);
  const onScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const root = scrollerRef.current;
      if (root === null) return;
      const top = root.getBoundingClientRect().top + 24;
      const paragraphs = root.querySelectorAll<HTMLElement>('[data-guided-para]');
      for (let i = 0; i < paragraphs.length; i += 1) {
        const element = paragraphs[i] as HTMLElement;
        if (element.getBoundingClientRect().bottom <= top) continue;
        const id = element.getAttribute('data-guided-para');
        if (id === null || id === lastTop.current) return;
        lastTop.current = id;
        if (Date.now() >= drivenUntil.current) onTopRef.current?.(id);
        return;
      }
    });
  }, []);

  return (
    <section
      aria-label="Guided reading"
      className={`pt-guided flex h-full min-h-0 flex-col ${className ?? ''}`}
      data-guided-root="true"
    >
      <header className="pt-guided__head">
        <span className="font-medium text-[--pt-ink]">{REFLOWED_LABEL}</span>
        <span>The paper&apos;s own words in one column. Each paragraph links to its page.</span>
      </header>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ touchAction: 'pan-y' }}
        onScroll={onScroll}
        data-guided-scroller=""
      >
        <article className="pt-guided__sheet">
          {marks.unavailable.length === 0 ? null : (
            <aside className="pt-banner mb-6 mt-0 flex-col items-start" aria-label="Highlights not shown here">
              {marks.unavailable.map((item) => (
                <p key={item.highlightId} className="m-0 text-[0.8125rem]">
                  {item.quote === '' ? (
                    'A highlight without a quote: '
                  ) : (
                    <span className="font-serif">
                      “{item.quote.slice(0, 80)}
                      {item.quote.length > 80 ? '…' : ''}”{' '}
                    </span>
                  )}
                  {item.message}
                </p>
              ))}
            </aside>
          )}
          {plan.rendered.map((block) => {
            let body: ReactNode;
            if (block.type === 'equation') {
              body = (
                <GuidedEquation block={block} onShowSource={onShowSource} resolveAssetSrc={resolveAssetSrc} />
              );
            } else if (block.type === 'figure') {
              body = (
                <GuidedFigure
                  block={block}
                  doc={doc}
                  resolveAssetSrc={resolveAssetSrc}
                  captionId={plan.captionOf.get(block.id)}
                />
              );
            } else if (block.type === 'table') {
              body = <GuidedTable block={block} doc={doc} onShowSource={onShowSource} />;
            } else {
              body = (
                <GuidedText
                  block={block}
                  doc={doc}
                  onShowSource={onShowSource}
                  marks={marks.text.get(block.id)}
                />
              );
            }
            return (
              <div key={block.id} data-guided-para={block.id}>
                {body}
              </div>
            );
          })}

          {plan.furnitureCount === 0 ? null : (
            <p className="mt-8 border-t border-[--pt-rule] pt-3 text-[0.8125rem] text-[--pt-ink-muted]">
              {plan.furnitureCount} page-furniture block{plan.furnitureCount === 1 ? '' : 's'} (page
              numbers, running footers, the arXiv stamp, hairline rules) {plan.furnitureCount === 1 ? 'is' : 'are'}{' '}
              left out of this reading. {plan.furnitureCount === 1 ? 'It is' : 'They are'} still in Source.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
