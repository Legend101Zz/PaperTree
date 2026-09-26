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
 * fails it stays on the page marked "not saved" with a Retry (the id is client-minted, so a retry is
 * idempotent), never silently dropped and never shown as saved. A failed colour change or delete is
 * rolled back and says so.
 *
 * A FIXTURE PAPER HAS NO SERVER (`NEXT_PUBLIC_PAPERTREE_FIXTURES=on` only), so its highlights are
 * kept for the session and labelled as such.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  captureAnchor,
  RESOLVER_VERSION,
  resolveAnchor,
  type Anchor,
  type BlockSelector,
  type IndexedDocument,
  type Resolution,
  type ResolutionCache,
} from '@papertree/anchoring';

import { NetworkError } from '@/lib/api/client';
import { highlightsApi, type ResolutionItem } from '@/lib/api/highlights';
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

function sentenceFor(error: unknown, action: string): string {
  if (error instanceof NetworkError) return `Couldn't ${action}: PaperTree is not reachable. Check the connection and try again.`;
  if (error instanceof ApiError) {
    if (error.code === 'not_parsed') return `Couldn't ${action}: this paper is still being read.`;
    if (error.status >= 500) return `Couldn't ${action}: the server had a problem. Try again.`;
    return `Couldn't ${action}: ${error.detail}`;
  }
  return `Couldn't ${action}. Try again.`;
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

function sameResolution(wire: ResolutionWire | null, resolution: Resolution): boolean {
  if (wire === null) return false;
  return (
    wire.resolver_version === RESOLVER_VERSION &&
    wire.tier === resolution.tier &&
    wire.state === resolution.state &&
    wire.block_ids.join(' ') === resolution.blockIds.join(' ')
  );
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
  /** The exact bodies of creates not yet stored, so Retry resends the same id and anchors. */
  const pendingBodies = useRef(new Map<string, { anchors: readonly Anchor[]; color: HighlightColor }>());

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
            if (upgraded === null && sameResolution(wire?.resolution ?? null, resolution)) continue;
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
    async (highlightId: string, anchors: readonly Anchor[], color: HighlightColor): Promise<void> => {
      if (paperId === null || doc === null || generation === null) return;
      try {
        const stored = await highlightsApi.create(paperId, {
          highlight_id: highlightId,
          color,
          anchors: anchors.map((anchor) => ({ anchor: wireAnchor(anchor) })),
          resolutions: anchors.map((anchor) => ({
            anchor_id: anchor.id,
            ...resolutionWire(resolveAnchor(anchor, doc), generation),
          })),
        });
        pendingBodies.current.delete(highlightId);
        const current = stateRef.current.find((h) => h.highlightId === highlightId);
        replace(highlightId, {
          ...fromWire(stored, doc, generation),
          // A colour or note the reader chose while the POST was in flight wins; it is PATCHed below.
          ...(current === undefined ? {} : { color: current.color, note: current.note }),
        });
        if (current !== undefined && (current.color !== stored.color || current.note !== stored.note)) {
          await highlightsApi.update(paperId, highlightId, { color: current.color, note: current.note });
        }
      } catch (error) {
        const current = stateRef.current.find((h) => h.highlightId === highlightId);
        if (current !== undefined) {
          replace(highlightId, { ...current, status: 'unsaved', error: sentenceFor(error, 'save this highlight') });
        }
        noticeRef.current?.(sentenceFor(error, 'save this highlight'));
      }
    },
    [paperId, doc, generation, replace],
  );

  const create = useCallback(
    async (anchors: readonly Anchor[], color: HighlightColor): Promise<ReaderHighlight | null> => {
      if (doc === null || anchors.length === 0) return null;
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
      if (paperId !== null) {
        pendingBodies.current.set(highlightId, { anchors, color });
        void send(highlightId, anchors, color);
      }
      return record;
    },
    [doc, paperId, send],
  );

  const retry = useCallback(
    async (highlightId: string) => {
      const body = pendingBodies.current.get(highlightId);
      const current = stateRef.current.find((h) => h.highlightId === highlightId);
      if (body === undefined || current === undefined) return;
      replace(highlightId, { ...current, status: 'saving' });
      await send(highlightId, body.anchors, body.color);
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
      const pending = pendingBodies.current.get(highlightId);
      if (pending !== undefined) {
        // Not stored yet: the new colour rides on the create (and its retry); a note is PATCHed
        // once the create lands (see `send`).
        pendingBodies.current.set(highlightId, { ...pending, color: after.color });
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
      if (pendingBodies.current.has(highlightId) && target.status === 'unsaved') {
        pendingBodies.current.delete(highlightId);
        return;
      }
      try {
        await highlightsApi.remove(paperId, highlightId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return; // already gone
        setHighlights(before);
        noticeRef.current?.(sentenceFor(error, 'delete this highlight'));
      }
    },
    [paperId, replace],
  );

  return { highlights, load, loadError, unavailableReason, reload, create, update, remove, retry };
}
