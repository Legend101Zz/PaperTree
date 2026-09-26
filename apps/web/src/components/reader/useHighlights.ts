'use client';

/**
 * reader/useHighlights — the reader's highlights, persisted (#138, contracts.md §2.4).
 *
 * THE BASELINE STORED NOTHING. Highlights lived in a component's state: no request ever reached
 * `/papers/{id}/highlights`, a reload started empty, and the tables held 0 rows (journey-baseline
 * §B). This hook is the one owner of the reader's highlights, and every change goes to the API:
 *
 *   load     GET  /papers/{id}/highlights?gen=<the document's generation>
 *   create   POST /papers/{id}/highlights         one highlight, ALL its anchors, one transaction
 *   colour   PATCH /papers/{id}/highlights/{hid}  {color} / {note}
 *   delete   DELETE /papers/{id}/highlights/{hid}
 *   links    PUT  /papers/{id}/highlights/resolutions   what the ladder concluded on THIS generation
 *
 * RESOLUTION ON LOAD. Each anchor is resolved against the loaded document. When the server holds a
 * cache entry for this generation written by this resolver version, it becomes the anchor's T0
 * cache (`Anchor.resolution`), so an unchanged parse is a map lookup per anchor. Whatever the ladder
 * concluded that the server does not already have is PUT back — which is how a re-parse's gen-2
 * rows appear (`anchor_resolutions` gains them on the first open after the promotion). None of this
 * changes where a highlight PAINTS in Source: that is its stored quads (`paint.ts`).
 *
 * LEGACY ROWS. 0005 converted the one 0001-shaped highlight into an Anchor without a quote
 * (`textStreamId: legacy-0001`). When such an anchor resolves exactly to one block on this parse,
 * the reader captures a full record for the same block range and sends it as `upgraded_anchor`
 * (ADR-002 §6.3) — so the row gains a quote and glyph quads, once.
 *
 * WRITES ARE OPTIMISTIC AND HONEST. A new highlight paints at once, marked "saving"; if the POST
 * fails it stays on the page marked "not saved", never silently dropped and never shown as saved.
 * A failure that can clear (the network, a 5xx, "still being read") offers Retry, which resends the
 * EXACT first body — the id is client-minted and §2.4 answers a repeat of the same body with the
 * stored row, so a retry after a POST whose answer was lost is safe; a colour or note changed
 * meanwhile is PATCHed once the create lands. A refusal that cannot clear (a 422) says so and offers
 * no Retry. Every sentence is designed here: the server's `detail` is never shown. A failed colour
 * change or delete is rolled back and says so.
 *
 * ONE HIGHLIGHT HOLDS AT MOST 64 ANCHORS (§2.4). A longer selection is refused before anything is
 * painted or sent (`create` returns null and says why); the toolbar says so first (`SourcePane`).
 *
 * A FIXTURE PAPER HAS NO SERVER (`NEXT_PUBLIC_PAPERTREE_FIXTURES=on` only), so its highlights are
 * kept for the session and labelled as such.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  captureAnchor,
  RESOLVER_VERSION,
  resolveAnchor,
  Tier,
  type Anchor,
  type BlockSelector,
  type IndexedDocument,
  type Resolution,
  type ResolutionCache,
} from '@papertree/anchoring';

import { NetworkError } from '@/lib/api/client';
import {
  highlightsApi,
  MAX_ANCHORS_PER_HIGHLIGHT,
  type CreateHighlightBody,
  type ResolutionItem,
} from '@/lib/api/highlights';
import { ApiError, type Highlight, type HighlightColor, type ResolutionWire } from '@/lib/api/types';
import { documentGeneration, type PaperRef } from '@/lib/paperSource';

export type HighlightStatus = 'saved' | 'saving' | 'unsaved' | 'session';

export interface ResolvedAnchor {
  readonly anchor: Anchor;
  readonly resolution: Resolution;
}

export interface ReaderHighlight {
  readonly highlightId: string;
  readonly color: HighlightColor;
  readonly note: string | null;
  readonly createdAt: string;
  readonly anchors: readonly ResolvedAnchor[];
  readonly status: HighlightStatus;
  /** A designed sentence, set when `status === 'unsaved'`. */
  readonly error?: string;
  /** With `status === 'unsaved'`: false when resending cannot succeed (a 422), so no Retry is offered. */
  readonly retryable?: boolean;
}

export type HighlightsLoad = 'idle' | 'loading' | 'ready' | 'error';

export interface UseHighlights {
  readonly highlights: readonly ReaderHighlight[];
  readonly load: HighlightsLoad;
  readonly loadError: string | null;
  /** Why Highlight cannot be used on this document, or null when it can. */
  readonly unavailableReason: string | null;
  readonly reload: () => void;
  readonly create: (anchors: readonly Anchor[], color: HighlightColor) => Promise<ReaderHighlight | null>;
  readonly update: (highlightId: string, patch: { color?: HighlightColor; note?: string | null }) => Promise<void>;
  readonly remove: (highlightId: string) => Promise<void>;
  readonly retry: (highlightId: string) => Promise<void>;
}

export interface UseHighlightsOptions {
  readonly paper: PaperRef;
  readonly doc: IndexedDocument | null;
  /** A short sentence for the reader when a write fails (the toast). */
  readonly onNotice?: (message: string) => void;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `hl_` + 26 Crockford characters (contracts.md §0): 10 of time, 16 of randomness, like a ULID. */
export function newHighlightId(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (b) => CROCKFORD[b % 32]).join('');
  return `hl_${time}${random}`;
}

/** What went wrong, as the reader is told it, and whether trying again can help. */
interface WriteFailure {
  readonly sentence: string;
  readonly retryable: boolean;
}

/**
 * A designed sentence for a failed call — NEVER the server's `detail`, which is a validator's or a
 * developer's text ("anchors: List should have at most 64 items…", s4-review.md F2). `refused` is
 * the next action when the server refused the request itself (a 4xx that resending cannot change).
 */
function failureFor(error: unknown, action: string, refused: string): WriteFailure {
  if (error instanceof NetworkError) {
    return { sentence: `Couldn't ${action}: PaperTree is not reachable. Check the connection and try again.`, retryable: true };
  }
  if (error instanceof ApiError) {
    if (error.code === 'not_parsed') {
      return { sentence: `Couldn't ${action}: this paper is still being read. Try again in a moment.`, retryable: true };
    }
    if (error.status >= 500 || error.retryable) {
      return { sentence: `Couldn't ${action}: the server had a problem. Try again.`, retryable: true };
    }
    if (error.status === 404) {
      return { sentence: `Couldn't ${action}: it is no longer in your library. Reload the paper.`, retryable: false };
    }
    return { sentence: `Couldn't ${action}: PaperTree refused it. ${refused}`, retryable: false };
  }
  return { sentence: `Couldn't ${action}. Try again.`, retryable: true };
}

function sentenceFor(error: unknown, action: string): string {
  return failureFor(error, action, 'Reload the paper and try again.').sentence;
}

/** Said when a selection needs more anchors than one highlight may hold. */
export function tooLongSentence(count: number): string {
  return (
    `This selection covers ${String(count)} passages; one highlight holds up to ` +
    `${String(MAX_ANCHORS_PER_HIGHLIGHT)}. Select a shorter stretch, or highlight it in parts.`
  );
}

function resolutionWire(resolution: Resolution, generation: number): Omit<ResolutionItem, 'anchor_id'> & { generation: number } {
  return {
    generation,
    tier: resolution.tier as ResolutionWire['tier'],
    state: resolution.state,
    block_ids: [...resolution.blockIds],
    score: Number.isFinite(resolution.score) ? Math.min(1, Math.max(0, resolution.score)) : null,
    reason: resolution.reason ?? null,
    resolver_version: RESOLVER_VERSION,
  };
}

/**
 * Whether the server already holds what the ladder concluded, for THIS generation.
 *
 * A T0 answer IS the server's row: `withCache` made that row the anchor's cache, so the ladder
 * answering from it (`Tier.Cache`) is the same resolution, not a new one at tier 0. Comparing tiers
 * there re-PUT every anchor as tier 0 on the first reload and erased which tier had resolved it
 * (s4-review.md F3).
 */
function sameResolution(wire: ResolutionWire | null, resolution: Resolution, generation: number): boolean {
  if (wire === null || wire.generation !== generation || wire.resolver_version !== RESOLVER_VERSION) return false;
  const sameLink = wire.state === resolution.state && wire.block_ids.join(' ') === resolution.blockIds.join(' ');
  if (resolution.tier === Tier.Cache) return sameLink;
  return sameLink && wire.tier === resolution.tier;
}

/** The server's cache entry as the ladder's T0 input, when it is for THIS parse and resolver. */
function withCache(anchor: Anchor, wire: ResolutionWire | null, doc: IndexedDocument, generation: number): Anchor {
  if (wire === null || wire.generation !== generation || wire.resolver_version !== RESOLVER_VERSION) {
    return anchor;
  }
  const cache: ResolutionCache = {
    tier: wire.tier,
    score: wire.score ?? 1,
    resolvedBlockIds: wire.block_ids,
    resolvedAt: '',
    parserVersion: doc.parserVersion,
    textStreamId: doc.textStreamId,
    state: wire.state,
  };
  return { ...anchor, resolution: cache };
}

/** Strip the client-side T0 cache before an anchor goes over the wire (§2.4 strips it anyway). */
function wireAnchor(anchor: Anchor): Anchor {
  if (anchor.resolution === undefined) return anchor;
  const { resolution: _cache, ...rest } = anchor;
  return rest;
}

/** A full record for a legacy row that resolved exactly, or null (ADR-002 §6.3). */
function upgradeOf(anchor: Anchor, resolution: Resolution, doc: IndexedDocument): Anchor | null {
  if (anchor.doc.textStreamId !== 'legacy-0001') return null;
  if (resolution.state !== 'anchored' || resolution.blockIds.length !== 1) return null;
  const blockId = resolution.blockIds[0] as string;
  if (!doc.byId.has(blockId)) return null;
  const selector = anchor.selectors.find((s): s is BlockSelector => s.type === 'BlockSelector');
  const sameBlock = selector !== undefined && selector.blockId === blockId;
  try {
    return captureAnchor({
      doc,
      blockId,
      ...(sameBlock && selector.startOffset !== undefined ? { startOffset: selector.startOffset } : {}),
      ...(sameBlock && selector.endOffset !== undefined ? { endOffset: selector.endOffset } : {}),
      targetKind: 'text',
      provenanceClass: 'source',
      id: anchor.id,
      at: anchor.created.at,
      client: 'papertree-web/legacy-upgrade',
      mode: 'source',
    });
  } catch {
    return null;
  }
}

function fromWire(highlight: Highlight, doc: IndexedDocument, generation: number): ReaderHighlight {
  const anchors = [...highlight.anchors]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((wire) => {
      const anchor = withCache(wire.anchor, wire.resolution, doc, generation);
      return { anchor, resolution: resolveAnchor(anchor, doc) };
    });
  return {
    highlightId: highlight.highlight_id,
    color: isColor(highlight.color) ? highlight.color : 'amber',
    note: highlight.note,
    createdAt: highlight.created_at,
    anchors,
    status: 'saved',
  };
}

const COLORS: readonly HighlightColor[] = ['amber', 'green', 'blue', 'pink', 'purple'];
export function isColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && (COLORS as readonly string[]).includes(value);
}
export const HIGHLIGHT_COLORS = COLORS;

export function useHighlights({ paper, doc, onNotice }: UseHighlightsOptions): UseHighlights {
  const [highlights, setHighlights] = useState<readonly ReaderHighlight[]>([]);
  const [load, setLoad] = useState<HighlightsLoad>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const stateRef = useRef(highlights);
  stateRef.current = highlights;
  /**
   * The exact FIRST body of each create not yet stored. Retry resends it unchanged — §2.4's replay
   * rule answers the same body with the stored row, and a different one with a 422 (F11) — and a
   * colour or note changed meanwhile goes as a PATCH after the create lands.
   */
  const pendingBodies = useRef(new Map<string, CreateHighlightBody>());
  /** Deleted while its create was in flight: delete it again once the create answers. */
  const abandoned = useRef(new Set<string>());

  const paperId = paper.kind === 'api' ? paper.paperId : null;
  const generation = doc === null ? null : documentGeneration(doc);

  const unavailableReason = useMemo(() => {
    if (doc === null) return 'This paper is still being read. Highlights become available when it is ready.';
    if (paper.kind === 'api' && generation === null) {
      return 'This parse has no generation number, so a highlight could not be saved against it.';
    }
    return null;
  }, [doc, paper.kind, generation]);

  // ── load ──
  useEffect(() => {
    if (doc === null) return;
    if (paperId === null) {
      setLoad('ready');
      return;
    }
    if (generation === null) {
      setLoad('error');
      setLoadError('This parse has no generation number, so its highlights cannot be listed.');
      return;
    }
    let cancelled = false;
    setLoad('loading');
    setLoadError(null);
    void (async () => {
      try {
        const rows = await highlightsApi.list(paperId, generation);
        if (cancelled) return;
        const loaded = rows.map((row) => fromWire(row, doc, generation));
        // Keep a create the reader made while the list was in flight.
        setHighlights((current) => {
          const ids = new Set(loaded.map((h) => h.highlightId));
          return [...loaded, ...current.filter((h) => !ids.has(h.highlightId) && h.status !== 'saved')];
        });
        setLoad('ready');

        // What the ladder concluded that the server does not have yet, plus legacy upgrades.
        const items: ResolutionItem[] = [];
        rows.forEach((row, index) => {
          const reader = loaded[index];
          if (reader === undefined) return;
          const byId = new Map(row.anchors.map((wire) => [wire.anchor_id, wire]));
          for (const { anchor, resolution } of reader.anchors) {
            const wire = byId.get(anchor.id);
            const upgraded = upgradeOf(anchor, resolution, doc);
            if (upgraded === null && sameResolution(wire?.resolution ?? null, resolution, generation)) continue;
            const { generation: _g, ...fields } = resolutionWire(resolution, generation);
            items.push({
              anchor_id: anchor.id,
              ...fields,
              ...(upgraded === null ? {} : { upgraded_anchor: upgraded }),
            });
          }
        });
        for (let at = 0; at < items.length; at += 500) {
          if (cancelled) return;
          await highlightsApi.putResolutions(paperId, { generation, items: items.slice(at, at + 500) });
        }
      } catch (error) {
        if (cancelled) return;
        if (stateRef.current.length === 0) {
          setLoad('error');
          setLoadError(sentenceFor(error, 'load your highlights'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, paperId, generation, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const replace = useCallback((highlightId: string, next: ReaderHighlight | null) => {
    setHighlights((current) =>
      next === null
        ? current.filter((h) => h.highlightId !== highlightId)
        : current.map((h) => (h.highlightId === highlightId ? next : h)),
    );
  }, []);

  const send = useCallback(
    async (highlightId: string): Promise<void> => {
      const body = pendingBodies.current.get(highlightId);
      if (paperId === null || doc === null || generation === null || body === undefined) return;
      try {
        const stored = await highlightsApi.create(paperId, body);
        pendingBodies.current.delete(highlightId);
        if (abandoned.current.delete(highlightId)) {
          // Deleted while the create was in flight: the row exists now, so it goes now.
          await highlightsApi.remove(paperId, highlightId).catch(() => undefined);
          return;
        }
        const current = stateRef.current.find((h) => h.highlightId === highlightId);
        replace(highlightId, {
          ...fromWire(stored, doc, generation),
          // A colour or note the reader chose after the first POST wins; it is PATCHed below.
          ...(current === undefined ? {} : { color: current.color, note: current.note }),
        });
        if (current !== undefined && (current.color !== stored.color || current.note !== stored.note)) {
          await highlightsApi.update(paperId, highlightId, { color: current.color, note: current.note });
        }
      } catch (error) {
        const failure = failureFor(error, 'save this highlight', 'Delete it and select the passage again.');
        if (abandoned.current.delete(highlightId)) {
          pendingBodies.current.delete(highlightId);
          return;
        }
        const current = stateRef.current.find((h) => h.highlightId === highlightId);
        if (current !== undefined) {
          replace(highlightId, { ...current, status: 'unsaved', error: failure.sentence, retryable: failure.retryable });
        }
        noticeRef.current?.(failure.sentence);
      }
    },
    [paperId, doc, generation, replace],
  );

  const create = useCallback(
    async (anchors: readonly Anchor[], color: HighlightColor): Promise<ReaderHighlight | null> => {
      if (doc === null || anchors.length === 0) return null;
      if (anchors.length > MAX_ANCHORS_PER_HIGHLIGHT) {
        // Refused before anything is painted or sent: the API would answer 422 (§2.4 `1..64`), and
        // a highlight shown as "not saved" with a Retry that can never succeed is worse than none.
        noticeRef.current?.(tooLongSentence(anchors.length));
        return null;
      }
      const highlightId = newHighlightId();
      const record: ReaderHighlight = {
        highlightId,
        color,
        note: null,
        createdAt: new Date().toISOString(),
        anchors: anchors.map((anchor) => ({ anchor, resolution: resolveAnchor(anchor, doc) })),
        status: paperId === null ? 'session' : 'saving',
      };
      setHighlights((current) => [...current, record]);
      if (paperId !== null && generation !== null) {
        pendingBodies.current.set(highlightId, {
          highlight_id: highlightId,
          color,
          anchors: anchors.map((anchor) => ({ anchor: wireAnchor(anchor) })),
          resolutions: record.anchors.map(({ anchor, resolution }) => ({
            anchor_id: anchor.id,
            ...resolutionWire(resolution, generation),
          })),
        });
        void send(highlightId);
      }
      return record;
    },
    [doc, paperId, generation, send],
  );

  const retry = useCallback(
    async (highlightId: string) => {
      const current = stateRef.current.find((h) => h.highlightId === highlightId);
      if (!pendingBodies.current.has(highlightId) || current === undefined) return;
      // A refusal (a 422) is not cleared by sending the same body again.
      if (current.status === 'unsaved' && current.retryable === false) return;
      replace(highlightId, { ...current, status: 'saving' });
      await send(highlightId);
    },
    [replace, send],
  );

  const update = useCallback(
    async (highlightId: string, patch: { color?: HighlightColor; note?: string | null }) => {
      const before = stateRef.current.find((h) => h.highlightId === highlightId);
      if (before === undefined) return;
      const after: ReaderHighlight = {
        ...before,
        ...(patch.color === undefined ? {} : { color: patch.color }),
        ...(patch.note === undefined ? {} : { note: patch.note === '' ? null : patch.note }),
      };
      replace(highlightId, after);
      if (pendingBodies.current.has(highlightId)) {
        // Not stored yet: the change is kept on the page and PATCHed once the create lands
        // (`send`). The pending body itself is never edited — see `pendingBodies`.
        return;
      }
      if (paperId === null || before.status === 'session') return;
      try {
        await highlightsApi.update(paperId, highlightId, patch);
      } catch (error) {
        replace(highlightId, before);
        noticeRef.current?.(sentenceFor(error, patch.color === undefined ? 'save the note' : 'change the colour'));
      }
    },
    [paperId, replace],
  );

  const remove = useCallback(
    async (highlightId: string) => {
      const before = stateRef.current;
      const target = before.find((h) => h.highlightId === highlightId);
      if (target === undefined) return;
      replace(highlightId, null);
      if (paperId === null || target.status === 'session') return;
      if (pendingBodies.current.has(highlightId) && target.status === 'saving') {
        // Its create is in flight: deleting now could reach the server first. `send` deletes it
        // when the create answers.
        abandoned.current.add(highlightId);
        return;
      }
      // An UNSAVED highlight is still deleted on the server: a POST whose answer was lost may have
      // been stored, and it would come back on the next reload. A 404 means it never was.
      try {
        await highlightsApi.remove(paperId, highlightId);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          // Still on the page, and (if it was never stored) still retryable with its first body.
          setHighlights(before);
          noticeRef.current?.(sentenceFor(error, 'delete this highlight'));
          return;
        }
        // 404: already gone, or never stored.
      }
      pendingBodies.current.delete(highlightId);
    },
    [paperId, replace],
  );

  return { highlights, load, loadError, unavailableReason, reload, create, update, remove, retry };
}
