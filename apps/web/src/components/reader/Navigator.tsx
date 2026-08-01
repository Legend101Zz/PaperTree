'use client';

/**
 * reader/Navigator — F2.4. ONE panel, six tabs.
 *
 * This replaces `OutlinePanel` + `SmartOutlinePanel` + `HighlightsPanel` + `PDFMinimap`. §18.1's
 * count was twelve competing surfaces, of which three mounted their own `<Document>` instance of
 * the same PDF and one positioned itself with hardcoded viewport coordinates
 * (`HighlightsPanel.tsx:279`). The fix is not four better panels; it is one panel with a segmented
 * header, which is the single biggest simplification in §18.2.
 *
 * THE OUTLINE IS THE PaperIR SECTION TREE. NEVER A PAGE LIST.
 * A page list is what a PDF viewer shows when it does not know what the document says. PaperIR
 * knows: `sections` is `{heading_block_id, level, block_ids, parent_heading_block_id?}` and the tree
 * comes from `parent_heading_block_id`. There is NO `title` field — the display title is
 * `blocks[heading_block_id].text`, read through the sanctioned path (`IndexedBlock.text` IS
 * `resolvedText(block).text`; see the header of `anchoring/document.ts`). Modelling a `title` here
 * would render an outline of empty strings against all three fixtures.
 *
 * FRONT MATTER BELONGS TO NO SECTION — in all three fixtures, and by wildly different amounts: 24
 * unclaimed blocks in `attention`, 43 in `neural-odes`, 13 in `resnet`. The fixtures also DISAGREE
 * about whether the abstract is inside a section (`attention` and `resnet` make "Abstract" a
 * section; `neural-odes` leaves its abstract, its heading, its title and its authors outside the
 * tree entirely). So the outline shows an untitled leading group and never pretends the section tree
 * is the document. Concatenating `sections[].block_ids` to rebuild the paper would drop every one of
 * those blocks — which is exactly why `GuidedView` walks `doc.blocks` instead.
 *
 * THE RESERVED MARKER APPEARS NOWHERE IN THIS FILE — not even in a comment, so a source-level
 * grep stays clean. `DERIVED_MARKER` belongs to `DerivedBlock`, and nothing the Navigator shows is
 * derived: an outline read out of the IR is the paper's own structure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react';
import { Panel, Tabs } from '@papertree/ui';
import type { IndexedDocument } from '@papertree/anchoring';

import { assetSrc } from './assetSrc';

export type NavigatorTab = 'outline' | 'pages' | 'highlights' | 'notes' | 'questions' | 'chapters';

const TAB_ORDER: readonly NavigatorTab[] = [
  'outline',
  'pages',
  'highlights',
  'notes',
  'questions',
  'chapters',
];

const TAB_LABEL: Record<NavigatorTab, string> = {
  outline: 'Outline',
  pages: 'Pages',
  highlights: 'Highlights',
  notes: 'Notes',
  questions: 'Questions',
  chapters: 'Chapters',
};

function isNavigatorTab(value: string): value is NavigatorTab {
  return (TAB_ORDER as readonly string[]).includes(value);
}

/** What the Pages tab needs. `IndexedDocument.pages` drops `image`, so the caller supplies it. */
export interface NavigatorPage {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  /** `Page.image.uri` — a `fixture://` or storage URI, resolved by `resolveAssetSrc`. */
  readonly imageUri?: string;
}

/**
 * A stored highlight AFTER resolution. Shaped to match `Resolution` (`state`, `blockIds`,
 * `pageIndex`) plus the record's own id and quote, so the caller passes through what `resolveAnchor`
 * returned instead of this panel re-deriving it.
 */
export interface NavigatorHighlight {
  readonly id: string;
  readonly blockIds: readonly string[];
  readonly quote: string;
  readonly state: 'anchored' | 'approximate' | 'orphan';
  readonly pageIndex: number | null;
  readonly colour?: string;
}

export interface NavigatorProps {
  readonly doc: IndexedDocument;
  readonly pages: readonly NavigatorPage[];
  /** `Paper.status` — `"complete" | "partial" | …`. The fixtures deliberately disagree; do not assume. */
  readonly status?: string;
  /** `Paper.partial_reason` — free prose, shown VERBATIM. See `pagesNamedInPartialReason`. */
  readonly partialReason?: string | null;
  readonly highlights?: readonly NavigatorHighlight[];
  readonly activeBlockId?: string;
  readonly activePageIndex?: number;
  /** Controlled tab. Omit to let the panel remember its own (§18.2: "last-used tab remembered"). */
  readonly tab?: NavigatorTab;
  readonly onTabChange?: (tab: NavigatorTab) => void;
  readonly onNavigateToBlock: (blockId: string) => void;
  readonly onNavigateToPage: (pageIndex: number) => void;
  readonly onSelectHighlight?: (highlightId: string) => void;
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * `sheet` = a transient overlay ABOVE the document (iPad, §19.5: "the document never reflows when
   * it opens"). `push` = it takes width in the layout (desktop).
   */
  readonly layout?: 'sheet' | 'push';
  readonly resolveAssetSrc?: (uri: string) => string;
}

// ─── outline ────────────────────────────────────────────────────────────────────────────────────

export interface OutlineNode {
  readonly headingBlockId: string;
  readonly level: number;
  readonly title: string;
  readonly blockIds: readonly string[];
  readonly children: readonly OutlineNode[];
}

export interface OutlineLeaf {
  readonly blockId: string;
  readonly type: string;
  readonly label: string;
}

export interface OutlineGroup {
  readonly leaves: readonly OutlineLeaf[];
  /** Blocks with no text at all — hairline rules. Counted, never listed, never dropped. */
  readonly unlabelled: number;
}

export interface Outline {
  /** Everything before the first sectioned block: title, authors, affiliation, sometimes the abstract. */
  readonly frontMatter: OutlineGroup;
  readonly roots: readonly OutlineNode[];
  /** Unsectioned blocks that are NOT leading — footnotes and stamps the section tree never claimed. */
  readonly outside: OutlineGroup;
  /** Block id → the heading id of the section that claims it. Used by the Highlights tab. */
  readonly sectionOfBlock: ReadonlyMap<string, string>;
}

function firstLine(text: string, limit = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/**
 * Build the section tree, and account for every block the tree does not claim.
 *
 * Roots are sections with no `parent_heading_block_id` — and ALSO sections whose declared parent is
 * not itself a section, because a section that names a missing parent must still appear. Showing a
 * heading at the wrong depth is recoverable; losing it is not. The `visited` set makes a cyclic
 * `parent_heading_block_id` impossible to hang on: cycles should not happen, and "should not" is not
 * a rendering strategy.
 */
export function buildOutline(doc: IndexedDocument): Outline {
  const sections = doc.sections;
  const bySectionId = new Map(sections.map((section) => [section.heading_block_id, section]));

  const childrenOf = new Map<string, string[]>();
  const rootIds: string[] = [];
  for (const section of sections) {
    const parent = section.parent_heading_block_id;
    if (parent === undefined || !bySectionId.has(parent)) {
      rootIds.push(section.heading_block_id);
      continue;
    }
    const bucket = childrenOf.get(parent);
    if (bucket === undefined) childrenOf.set(parent, [section.heading_block_id]);
    else bucket.push(section.heading_block_id);
  }

  const sectionOfBlock = new Map<string, string>();
  for (const section of sections) {
    sectionOfBlock.set(section.heading_block_id, section.heading_block_id);
    for (const blockId of section.block_ids) sectionOfBlock.set(blockId, section.heading_block_id);
  }

  const visited = new Set<string>();
  const build = (headingId: string): OutlineNode | null => {
    if (visited.has(headingId)) return null;
    visited.add(headingId);
    const section = bySectionId.get(headingId);
    if (section === undefined) return null;
    const heading = doc.byId.get(headingId);
    const title = heading === undefined ? '' : firstLine(heading.text);
    return {
      headingBlockId: headingId,
      level: section.level,
      // The ONLY place a display title can come from. An empty one is a parse the reader should see
      // rather than a row that silently vanishes.
      title: title.length > 0 ? title : '(untitled section)',
      blockIds: section.block_ids,
      children: (childrenOf.get(headingId) ?? [])
        .map(build)
        .filter((child): child is OutlineNode => child !== null),
    };
  };

  const roots = rootIds.map(build).filter((node): node is OutlineNode => node !== null);

  // Where the section tree starts, in reading order. Unclaimed blocks before it are front matter;
  // unclaimed blocks after it are page furniture the tree never wanted.
  let firstSectionedIndex = Number.POSITIVE_INFINITY;
  // `Map.forEach`, not `for…of map.keys()`: `apps/web/tsconfig.json` sets no `target`, so `tsc`
  // compiles at ES5 and rejects iterating an iterator (TS2802). Same reason everywhere below.
  sectionOfBlock.forEach((_sectionId, blockId) => {
    const block = doc.byId.get(blockId);
    if (block !== undefined && block.readingIndex < firstSectionedIndex) {
      firstSectionedIndex = block.readingIndex;
    }
  });

  const frontLeaves: OutlineLeaf[] = [];
  const outsideLeaves: OutlineLeaf[] = [];
  let frontUnlabelled = 0;
  let outsideUnlabelled = 0;

  for (const block of doc.blocks) {
    if (sectionOfBlock.has(block.id)) continue;
    // Blocks nested INSIDE CONTENT belong to their container, not to the outline. `parent_id`
    // carries two relations: a paragraph's parent is its section HEADING, but a `table_cell`'s is a
    // `table_row`. Listing `neural-odes`' 24 cells here would bury the front matter beside them.
    if (block.parentId !== null && doc.byId.get(block.parentId)?.type !== 'heading') continue;

    const leading = block.readingIndex < firstSectionedIndex;
    const label = firstLine(block.text);
    if (label.length === 0) {
      if (leading) frontUnlabelled += 1;
      else outsideUnlabelled += 1;
      continue;
    }
    (leading ? frontLeaves : outsideLeaves).push({ blockId: block.id, type: block.type, label });
  }

  return {
    frontMatter: { leaves: frontLeaves, unlabelled: frontUnlabelled },
    roots,
    outside: { leaves: outsideLeaves, unlabelled: outsideUnlabelled },
    sectionOfBlock,
  };
}

// ─── partial parses ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull page numbers out of `Paper.partial_reason`.
 *
 * §19.8 wants the pages a partial parse talks about to carry "a subtle hatch in the Pages tab". THE
 * IR HAS NO FIELD FOR THEM. `partial_reason` is a free-text sentence written for a human —
 * `neural-odes` says "only pages 0-2 of the 18-page source PDF are parsed" — and it does not even
 * agree with the brief about polarity: that sentence names the pages that ARE parsed, whereas the
 * brief's example ("Pages 12–14 need a closer look") names the ones that are not.
 *
 * So this makes the weakest claim the data supports: these are the pages the note MENTIONS. The UI
 * labels the hatch exactly that way and prints the sentence verbatim above the grid, so the reader
 * gets the parser's own words rather than this regex's opinion of them. Numbers are read in
 * `Page.index` space (0-based, as `neural-odes` writes them) and only ever mark pages that exist.
 *
 * A field on `Paper` naming the affected pages deletes this function. That is the right fix and it
 * belongs to whoever owns the parser.
 */
export function pagesNamedInPartialReason(reason: string | null | undefined): ReadonlySet<number> {
  const named = new Set<number>();
  if (reason === null || reason === undefined) return named;

  // A digit must follow "page(s) " immediately, so "the 18-page source PDF" does not match.
  const pattern = /\bpages?\s+(\d[\d\s,–—-]*)/gi;
  let match = pattern.exec(reason);
  for (; match !== null; match = pattern.exec(reason)) {
    const run = match[1];
    if (run === undefined) continue;
    for (const token of run.split(/,|\band\b/)) {
      const range = token.match(/^\s*(\d+)\s*[–—-]\s*(\d+)\s*$/);
      if (range !== null) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        // A malformed or absurd range is ignored rather than expanded — an off-by-a-million loop in
        // a render path is a worse bug than a missing hatch.
        if (Number.isFinite(from) && Number.isFinite(to) && to >= from && to - from <= 512) {
          for (let page = from; page <= to; page += 1) named.add(page);
        }
        continue;
      }
      const single = token.match(/^\s*(\d+)\s*$/);
      if (single !== null) named.add(Number(single[1]));
    }
  }
  return named;
}

// ─── pressable rows ─────────────────────────────────────────────────────────────────────────────

const TAP: CSSProperties = { minHeight: 44, minWidth: 44, touchAction: 'manipulation' };

/**
 * DUPLICATION, and deliberately small: `usePress` in `@papertree/ui/primitives` is the real
 * implementation but is not exported — `IconButton`, `Segment` and `Tab` are the only things that
 * can use it. The Navigator's rows are text, not icons, so this mirrors the same three rules
 * (pointer id matched between down and up, `pointerleave` cancels, `onClick` only for
 * `detail === 0`) and should be deleted the moment that hook is exported.
 */
function usePressRow(onPress: () => void): {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
} {
  const active = useRef<number | null>(null);
  return {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      active.current = event.pointerId;
    },
    onPointerUp: (event) => {
      if (active.current !== event.pointerId) return;
      active.current = null;
      onPress();
    },
    onPointerCancel: () => {
      active.current = null;
    },
    onPointerLeave: () => {
      active.current = null;
    },
    onClick: (event) => {
      // A pointer-generated click was already handled at `pointerup`; firing here too doubles it.
      if (event.detail === 0) onPress();
    },
  };
}

interface RowProps {
  readonly onPress: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly current?: boolean;
  readonly expanded?: boolean;
  readonly label?: string;
}

function Row({ onPress, children, className, style, current, expanded, label }: RowProps): ReactNode {
  const press = usePressRow(onPress);
  return (
    <button
      type="button"
      {...press}
      {...(current === true ? { 'aria-current': true as const } : {})}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      {...(label === undefined ? {} : { 'aria-label': label })}
      style={{ ...TAP, ...style }}
      className={[
        'flex w-full items-center gap-2 rounded-md px-2 text-left text-sm',
        'hover:bg-gray-100 focus-visible:bg-gray-100 dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800',
        current === true ? 'bg-amber-50 font-medium dark:bg-amber-500/10' : '',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ─── the panel ──────────────────────────────────────────────────────────────────────────────────

export function Navigator({
  doc,
  pages,
  status,
  partialReason,
  highlights = [],
  activeBlockId,
  activePageIndex,
  tab,
  onTabChange,
  onNavigateToBlock,
  onNavigateToPage,
  onSelectHighlight,
  open,
  onClose,
  layout = 'sheet',
  resolveAssetSrc = assetSrc,
}: NavigatorProps) {
  const [uncontrolledTab, setUncontrolledTab] = useState<NavigatorTab>('outline');
  const activeTab = tab ?? uncontrolledTab;

  const select = useCallback(
    (id: string) => {
      if (!isNavigatorTab(id)) return;
      if (tab === undefined) setUncontrolledTab(id);
      onTabChange?.(id);
    },
    [tab, onTabChange],
  );

  // Transient means dismissible (§18.2). Escape closes; so does the scrim, below.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const outline = useMemo(() => buildOutline(doc), [doc]);

  const tabs = useMemo(
    () =>
      TAB_ORDER.map((id) => ({
        id,
        label: TAB_LABEL[id],
        content:
          id === 'outline' ? (
            <OutlineTab
              outline={outline}
              doc={doc}
              activeBlockId={activeBlockId}
              onNavigateToBlock={onNavigateToBlock}
            />
          ) : id === 'pages' ? (
            <PagesTab
              pages={pages}
              status={status}
              partialReason={partialReason}
              activePageIndex={activePageIndex}
              onNavigateToPage={onNavigateToPage}
              resolveAssetSrc={resolveAssetSrc}
            />
          ) : id === 'highlights' ? (
            <HighlightsTab
              highlights={highlights}
              outline={outline}
              doc={doc}
              onSelectHighlight={onSelectHighlight}
              onNavigateToBlock={onNavigateToBlock}
            />
          ) : id === 'notes' ? (
            <EmptyState
              title="No notes yet"
              body="A note you write on a selection collects here, next to the passage it came from."
            />
          ) : id === 'questions' ? (
            <EmptyState
              title="Nothing asked yet"
              body="Questions you ask about a passage collect here with their answers and the blocks those answers are grounded in."
            />
          ) : (
            <EmptyState
              title="No chapters yet"
              body="Chapters appear once this paper has been prepared for listening. They follow the section tree, not the page breaks."
            />
          ),
      })),
    [
      outline,
      doc,
      activeBlockId,
      onNavigateToBlock,
      pages,
      status,
      partialReason,
      activePageIndex,
      onNavigateToPage,
      resolveAssetSrc,
      highlights,
      onSelectHighlight,
    ],
  );

  if (!open) return null;

  const panel = (
    <Panel title="Navigator" onClose={onClose} className="h-full w-[min(360px,86vw)]">
      {/* `Tabs` from `@papertree/ui`: roving tabindex, arrow/Home/End, one mounted panel. Written
          for exactly these six tabs — reimplementing it here is the duplication §18.1 is about. */}
      <Tabs
        label="Navigator sections"
        tabs={tabs}
        value={activeTab}
        onChange={select}
        activation="automatic"
      />
    </Panel>
  );

  if (layout === 'push') return <div className="h-full">{panel}</div>;

  // SHEET. Fixed, above the document, so opening it CANNOT reflow the paper (§19.5). A push panel on
  // a 1194pt iPad re-lays-out the PDF, which moves the line the user was reading — the exact failure
  // the overlay exists to avoid. `Sheet` from `@papertree/ui` is not the right primitive: it is the
  // bottom sheet with peek/half/full detents from §19.6, and the Navigator is edge-anchored.
  return (
    <div className="fixed inset-0 z-40 flex" role="presentation">
      <div
        // Tap-away dismissal. `aria-hidden` because the Panel's close button is the accessible route
        // out; a scrim announced as a button is noise in the tab order.
        aria-hidden="true"
        className="absolute inset-0 bg-black/20"
        onPointerUp={onClose}
        style={{ touchAction: 'none' }}
      />
      <div className="relative h-full">{panel}</div>
    </div>
  );
}

// ─── tabs ───────────────────────────────────────────────────────────────────────────────────────

function EmptyState({ title, body }: { readonly title: string; readonly body: string }): ReactNode {
  // A DESIGNED empty state, not a spinner and not a lie. §19.8 makes every one of these a screen.
  // Epic 3 and Epic 4 fill these tabs; until they do, faking a row here would be the "AI output is
  // indistinguishable from source" failure wearing a different hat.
  return (
    <div className="px-3 py-10 text-center">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</p>
      <p className="mx-auto mt-2 max-w-[34ch] text-[13px] leading-6 text-gray-400">{body}</p>
    </div>
  );
}

function OutlineTab({
  outline,
  doc,
  activeBlockId,
  onNavigateToBlock,
}: {
  readonly outline: Outline;
  readonly doc: IndexedDocument;
  readonly activeBlockId: string | undefined;
  readonly onNavigateToBlock: (blockId: string) => void;
}): ReactNode {
  const activeSection =
    activeBlockId === undefined ? undefined : outline.sectionOfBlock.get(activeBlockId);

  if (outline.roots.length === 0 && outline.frontMatter.leaves.length === 0) {
    return (
      <EmptyState
        title="No structure yet"
        body="This parse produced no sections. Source mode still shows the paper; the outline fills in when parsing completes."
      />
    );
  }

  return (
    <nav aria-label="Document outline">
      <OutlineGroupRows
        heading="Front matter"
        note="Belongs to no section — the title, the authors and often the abstract sit outside the section tree."
        group={outline.frontMatter}
        activeBlockId={activeBlockId}
        onNavigateToBlock={onNavigateToBlock}
      />

      <ul className="mt-1">
        {outline.roots.map((node) => (
          <OutlineRow
            key={node.headingBlockId}
            node={node}
            depth={0}
            doc={doc}
            activeSection={activeSection}
            onNavigateToBlock={onNavigateToBlock}
          />
        ))}
      </ul>

      <OutlineGroupRows
        heading="Outside the section tree"
        note="Footnotes, page numbers and margin stamps the parse never assigned to a section. Listed so nothing is lost."
        group={outline.outside}
        activeBlockId={activeBlockId}
        onNavigateToBlock={onNavigateToBlock}
        collapsedByDefault
      />
    </nav>
  );
}

function OutlineGroupRows({
  heading,
  note,
  group,
  activeBlockId,
  onNavigateToBlock,
  collapsedByDefault = false,
}: {
  readonly heading: string;
  readonly note: string;
  readonly group: OutlineGroup;
  readonly activeBlockId: string | undefined;
  readonly onNavigateToBlock: (blockId: string) => void;
  readonly collapsedByDefault?: boolean;
}): ReactNode {
  const [expanded, setExpanded] = useState(!collapsedByDefault);
  const toggle = useCallback(() => {
    setExpanded((value) => !value);
  }, []);
  if (group.leaves.length === 0 && group.unlabelled === 0) return null;

  return (
    <section className="mb-1">
      <Row
        onPress={toggle}
        expanded={expanded}
        className="text-[11px] font-semibold uppercase tracking-wide text-gray-400"
      >
        <span aria-hidden="true" className="w-3">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="flex-1">{heading}</span>
        <span className="text-[11px] font-normal normal-case text-gray-400">
          {group.leaves.length + group.unlabelled}
        </span>
      </Row>
      {/* The explanation is TEXT, not a `title` attribute: a native tooltip is reachable by neither
          a finger nor a screen reader. */}
      <p className="px-2 pb-1 text-[11px] leading-4 text-gray-400">{note}</p>
      {expanded ? (
        <ul>
          {group.leaves.map((leaf) => (
            <li key={leaf.blockId}>
              <Row
                onPress={() => {
                  onNavigateToBlock(leaf.blockId);
                }}
                current={leaf.blockId === activeBlockId}
                className="pl-7"
              >
                <span className="w-[72px] shrink-0 text-[11px] uppercase tracking-wide text-gray-400">
                  {leaf.type}
                </span>
                <span className="min-w-0 flex-1 truncate">{leaf.label}</span>
              </Row>
            </li>
          ))}
          {group.unlabelled === 0 ? null : (
            // `unknown` blocks: hairline rules 0.4–4pt tall, confidence 0.3, no text. There is
            // nothing to label and nothing to draw — but "we found N regions we could not read" is
            // information, so it is counted rather than deleted.
            <li className="px-2 py-2 pl-7 text-[12px] text-gray-400">
              + {group.unlabelled} region{group.unlabelled === 1 ? '' : 's'} with no readable text
            </li>
          )}
        </ul>
      ) : null}
    </section>
  );
}

function OutlineRow({
  node,
  depth,
  doc,
  activeSection,
  onNavigateToBlock,
}: {
  readonly node: OutlineNode;
  readonly depth: number;
  readonly doc: IndexedDocument;
  readonly activeSection: string | undefined;
  readonly onNavigateToBlock: (blockId: string) => void;
}): ReactNode {
  const [expanded, setExpanded] = useState(true);
  const toggle = useCallback(() => {
    setExpanded((value) => !value);
  }, []);
  const navigate = useCallback(() => {
    onNavigateToBlock(node.headingBlockId);
  }, [onNavigateToBlock, node.headingBlockId]);

  const hasChildren = node.children.length > 0;
  const isActive = node.headingBlockId === activeSection;
  const page = doc.byId.get(node.headingBlockId)?.pageIndex;

  return (
    <li>
      <div className="flex items-stretch">
        {hasChildren ? (
          <Row
            onPress={toggle}
            expanded={expanded}
            label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
            className="w-11 shrink-0 justify-center text-gray-400"
            style={{ marginLeft: depth * 12 }}
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </Row>
        ) : (
          <span aria-hidden="true" className="w-11 shrink-0" style={{ marginLeft: depth * 12 }} />
        )}
        <Row onPress={navigate} current={isActive}>
          <span className="min-w-0 flex-1 truncate">{node.title}</span>
          {/* The page is a FOOTNOTE to the section, never the organising fact. §19.2: "not 'page 4'
              but '§3.1 Residual Learning · p.4'". */}
          {page === undefined ? null : (
            <span className="shrink-0 text-[11px] text-gray-400">p.{page + 1}</span>
          )}
        </Row>
      </div>
      {hasChildren && expanded ? (
        <ul>
          {node.children.map((child) => (
            <OutlineRow
              key={child.headingBlockId}
              node={child}
              depth={depth + 1}
              doc={doc}
              activeSection={activeSection}
              onNavigateToBlock={onNavigateToBlock}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function PagesTab({
  pages,
  status,
  partialReason,
  activePageIndex,
  onNavigateToPage,
  resolveAssetSrc,
}: {
  readonly pages: readonly NavigatorPage[];
  readonly status: string | undefined;
  readonly partialReason: string | null | undefined;
  readonly activePageIndex: number | undefined;
  readonly onNavigateToPage: (pageIndex: number) => void;
  readonly resolveAssetSrc: (uri: string) => string;
}): ReactNode {
  const named = useMemo(() => pagesNamedInPartialReason(partialReason), [partialReason]);
  const isPartial = status === 'partial' || (partialReason !== null && partialReason !== undefined);

  return (
    <div>
      {isPartial ? (
        <div
          role="status"
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <p className="font-semibold">This parse is partial.</p>
          {/* VERBATIM. The parser's sentence is the primary artefact; the hatch below is a pointer
              into it. A regex must never be allowed to paraphrase the reason a parse failed. */}
          <p className="mt-1">{partialReason ?? 'The parser did not record a reason.'}</p>
        </div>
      ) : null}

      <ul className="grid grid-cols-2 gap-2">
        {pages.map((page) => (
          <PageThumb
            key={page.index}
            page={page}
            named={named.has(page.index)}
            active={page.index === activePageIndex}
            onNavigateToPage={onNavigateToPage}
            resolveAssetSrc={resolveAssetSrc}
          />
        ))}
      </ul>
    </div>
  );
}

function PageThumb({
  page,
  named,
  active,
  onNavigateToPage,
  resolveAssetSrc,
}: {
  readonly page: NavigatorPage;
  readonly named: boolean;
  readonly active: boolean;
  readonly onNavigateToPage: (pageIndex: number) => void;
  readonly resolveAssetSrc: (uri: string) => string;
}): ReactNode {
  const navigate = useCallback(() => {
    onNavigateToPage(page.index);
  }, [onNavigateToPage, page.index]);

  const src = page.imageUri === undefined ? undefined : resolveAssetSrc(page.imageUri);
  // The aspect ratio comes from `Page.width`/`Page.height` — IR space, already `/Rotate`-applied.
  // Nothing here measures the DOM; a thumbnail that sized itself from `offsetWidth` would be wrong
  // on the first paint and wrong again at every zoom.
  const aspect = page.width > 0 ? (page.height / page.width) * 100 : 129.4;

  return (
    <li>
      <Row
        onPress={navigate}
        current={active}
        label={named ? `Page ${String(page.index + 1)}, named in the parse note` : undefined}
        className={`flex-col items-stretch border p-1 ${
          active ? 'border-gray-900 dark:border-gray-100' : 'border-gray-200 dark:border-gray-800'
        }`}
      >
        <span
          className="relative block w-full overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-900"
          style={{ paddingTop: `${String(aspect)}%` }}
        >
          {src === undefined ? (
            // §19.8 "Parsing": thumbnails fill in progressively. An empty frame is the DESIGNED
            // state, not a broken image.
            <span className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-400">
              rendering…
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a fixture:// or storage URI
            // resolved by the caller; next/image cannot be configured for either here.
            <img
              src={src}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
              loading="lazy"
            />
          )}
          {named ? (
            <span
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, rgba(217,119,6,0.16) 0 6px, transparent 6px 12px)',
              }}
            />
          ) : null}
        </span>
        <span className="mt-1 flex min-h-[20px] items-center justify-between text-[11px] text-gray-400">
          <span>p.{page.index + 1}</span>
          {/* "the note mentions this page" is the WEAKEST claim the data supports. `neural-odes`
              names its GOOD pages; the brief's example names the bad ones. Asserting either
              polarity would be a guess printed as a fact. */}
          {named ? <span className="text-amber-700 dark:text-amber-400">in note</span> : null}
        </span>
      </Row>
    </li>
  );
}

function HighlightsTab({
  highlights,
  outline,
  doc,
  onSelectHighlight,
  onNavigateToBlock,
}: {
  readonly highlights: readonly NavigatorHighlight[];
  readonly outline: Outline;
  readonly doc: IndexedDocument;
  readonly onSelectHighlight: ((highlightId: string) => void) | undefined;
  readonly onNavigateToBlock: (blockId: string) => void;
}): ReactNode {
  const { orphans, groups } = useMemo(() => {
    const orphaned: NavigatorHighlight[] = [];
    const bySection = new Map<string, NavigatorHighlight[]>();
    const unsectioned: NavigatorHighlight[] = [];

    for (const highlight of highlights) {
      if (highlight.state === 'orphan' || highlight.blockIds.length === 0) {
        orphaned.push(highlight);
        continue;
      }
      const sectionId = highlight.blockIds
        .map((blockId) => outline.sectionOfBlock.get(blockId))
        .find((value): value is string => value !== undefined);
      if (sectionId === undefined) {
        unsectioned.push(highlight);
        continue;
      }
      const bucket = bySection.get(sectionId);
      if (bucket === undefined) bySection.set(sectionId, [highlight]);
      else bucket.push(highlight);
    }

    const sections = Array.from(bySection.entries())
      .sort(
        (a, b) => (doc.byId.get(a[0])?.readingIndex ?? 0) - (doc.byId.get(b[0])?.readingIndex ?? 0),
      )
      .map(([sectionId, items]) => ({
        key: sectionId,
        title: firstLine(doc.byId.get(sectionId)?.text ?? '') || '(untitled section)',
        items,
      }));

    if (unsectioned.length > 0) {
      // Front matter again: in `neural-odes` a highlight on the title or the abstract belongs to no
      // section, and dropping it because the tree has no home for it is not an option.
      sections.unshift({ key: '__front__', title: 'Front matter (no section)', items: unsectioned });
    }
    return { orphans: orphaned, groups: sections };
  }, [highlights, outline, doc]);

  if (highlights.length === 0) {
    return (
      <EmptyState
        title="No highlights yet"
        body="Select text in Source and choose Highlight. Highlights collect here, grouped by the section they live in."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {orphans.length === 0 ? null : (
        <section aria-label="Orphaned highlights">
          <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
            Orphaned · {orphans.length}
          </h3>
          {/* SURFACED, NEVER DELETED. An orphan means the ladder reached T6 — the text this was
              attached to is not in this parse. That is the user's information to act on, and a
              re-parse that silently drops annotations is the failure Epic 2 exists to prevent. */}
          <p className="px-2 pb-1 text-[12px] leading-5 text-gray-400">
            The passage these were attached to is not in this parse. They are kept with their quote
            so they can be re-placed by hand.
          </p>
          <ul>
            {orphans.map((highlight) => (
              <HighlightRow
                key={highlight.id}
                highlight={highlight}
                onSelectHighlight={onSelectHighlight}
                onNavigateToBlock={onNavigateToBlock}
              />
            ))}
          </ul>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.key} aria-label={group.title}>
          <h3 className="truncate px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {group.title} · {group.items.length}
          </h3>
          <ul>
            {group.items.map((highlight) => (
              <HighlightRow
                key={highlight.id}
                highlight={highlight}
                onSelectHighlight={onSelectHighlight}
                onNavigateToBlock={onNavigateToBlock}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function HighlightRow({
  highlight,
  onSelectHighlight,
  onNavigateToBlock,
}: {
  readonly highlight: NavigatorHighlight;
  readonly onSelectHighlight: ((highlightId: string) => void) | undefined;
  readonly onNavigateToBlock: (blockId: string) => void;
}): ReactNode {
  const target = highlight.blockIds[0];
  const act = useCallback((): void => {
    if (onSelectHighlight !== undefined) onSelectHighlight(highlight.id);
    else if (target !== undefined) onNavigateToBlock(target);
  }, [onSelectHighlight, onNavigateToBlock, highlight.id, target]);

  return (
    <li>
      <Row onPress={act} className="items-start py-2">
        <span
          aria-hidden="true"
          className="mt-1 h-4 w-1 shrink-0 rounded-full"
          style={{ background: highlight.colour ?? '#f59e0b' }}
        />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-3 block text-[13px] leading-5">{highlight.quote}</span>
          <span className="mt-0.5 block text-[11px] text-gray-400">
            {highlight.pageIndex === null ? 'page unknown' : `p.${highlight.pageIndex + 1}`}
            {/* "approximate" is a DIFFERENT CLAIM from "anchored" and the two must never look the
                same — the resolver's tier says how it was found and the UI is obliged to repeat it. */}
            {highlight.state === 'approximate' ? ' · approximate' : ''}
          </span>
        </span>
      </Row>
    </li>
  );
}
