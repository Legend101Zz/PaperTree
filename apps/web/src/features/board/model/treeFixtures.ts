/**
 * board/model/treeFixtures — node rows for the branching model's tests. Test-only.
 */
import type { BoardBranch, CanvasNode, ParentSpan } from '@/lib/api/types';

let clock = 0;

/** Restarts the creation clock so a test's `created_at` order is the order it calls `node` in. */
export function resetClock(): void {
  clock = 0;
}

/** What a test says about a node; everything else gets a plain default. */
export interface NodeSpec {
  readonly id: string;
  readonly kind?: CanvasNode['kind'];
  readonly parent?: string;
  readonly branch?: BoardBranch;
  readonly span?: ParentSpan;
  readonly body?: string;
  readonly question?: string;
  readonly finalText?: string;
  readonly x?: number;
  readonly y?: number;
  readonly offset?: { readonly x: number; readonly y: number };
  readonly folded?: boolean;
  /** Overrides the creation order (an ISO-like string that sorts). */
  readonly createdAt?: string;
}

/**
 * A node row.
 *
 * @param spec What the test cares about.
 * @returns A full `CanvasNode`.
 */
export function node(spec: NodeSpec): CanvasNode {
  clock += 1;
  const stamp = spec.createdAt ?? `2026-11-20T10:00:${String(clock).padStart(2, '0')}Z`;
  return {
    node_id: spec.id,
    board_id: 'brd_1',
    kind: spec.kind ?? (spec.parent === undefined ? 'excerpt' : 'explanation'),
    group_id: null,
    x: spec.x ?? 0,
    y: spec.y ?? 0,
    w: 300,
    h: 200,
    z: 0,
    title: null,
    body: spec.body ?? '',
    source_anchor: null,
    source_message_id: null,
    source_page_id: null,
    source_diagram_id: null,
    counts: null,
    parent_id: spec.parent ?? null,
    branch: spec.parent === undefined ? null : (spec.branch ?? 'right'),
    parent_span: spec.span ?? null,
    question: spec.question ?? null,
    uses: null,
    final_text: spec.finalText ?? null,
    level: null,
    model: null,
    answer_status: null,
    citations: null,
    offset_x: spec.offset?.x ?? 0,
    offset_y: spec.offset?.y ?? 0,
    folded: spec.folded ?? false,
    version: 1,
    created_at: stamp,
    updated_at: stamp,
  };
}

/**
 * A span over `quote` in `text`, as the board stores it.
 *
 * @param text The parent's stored answer.
 * @param quote The selected words (must occur in `text`).
 * @returns The span.
 */
export function spanOf(text: string, quote: string): ParentSpan {
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`"${quote}" is not in the text`);
  return { start, end: start + quote.length, quote };
}
