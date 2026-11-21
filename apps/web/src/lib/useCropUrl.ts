'use client';

/**
 * lib/useCropUrl — the signed picture of an image anchor, for the explain panel and the board card.
 *
 * A signed URL lasts about an hour and is stable for ten minutes, so each (paper, page, box) is
 * asked for once and kept until a minute before it runs out; every card of one figure shares it.
 * A failure is a state, never a thrown error: the caller draws its caption without the picture.
 */
import { useEffect, useState } from 'react';

import { cropQuery, cropsApi, type CropUrl } from './api/crops';

import type { ImageBox } from './imageAnchor';

const SPARE_MS = 60_000;
const cache = new Map<string, { readonly value: CropUrl; readonly until: number }>();
const pending = new Map<string, Promise<CropUrl>>();

/** What the hook answers: the picture, where it is on the way, or that it could not be made. */
type CropState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly crop: CropUrl }
  | { readonly status: 'failed' };

/**
 * The signed crop of one rectangle, from the cache while it is fresh.
 *
 * @param paperId The paper.
 * @param at The page and rectangle.
 * @param now The clock (tests pin it).
 * @returns The signed crop.
 */
function signedCrop(paperId: string, at: ImageBox, now: () => number = Date.now): Promise<CropUrl> {
  const key = `${paperId}|${cropQuery(at)}`;
  const hit = cache.get(key);
  if (hit !== undefined && hit.until > now()) return Promise.resolve(hit.value);
  const inflight = pending.get(key);
  if (inflight !== undefined) return inflight;
  const made = cropsApi
    .url(paperId, at)
    .then((value) => {
      cache.set(key, { value, until: Date.parse(value.expires_at) - SPARE_MS });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, made);
  return made;
}

/** Forgets every signed crop (tests). */
export function clearCropCache(): void {
  cache.clear();
  pending.clear();
}

/**
 * The picture of an image anchor.
 *
 * @param paperId The paper, or null for a sample paper (which has no server to crop).
 * @param at The page and rectangle, or null.
 * @returns `loading`, then `ready` with the URL and size, or `failed`.
 */
export function useCropUrl(paperId: string | null, at: ImageBox | null): CropState {
  const key = paperId === null || at === null ? null : `${paperId}|${cropQuery(at)}`;
  const [state, setState] = useState<{ key: string | null; value: CropState }>({
    key: null,
    value: { status: 'loading' },
  });
  useEffect(() => {
    if (key === null || paperId === null || at === null) return undefined;
    let live = true;
    signedCrop(paperId, at)
      .then((crop) => live && setState({ key, value: { status: 'ready', crop } }))
      .catch(() => live && setState({ key, value: { status: 'failed' } }));
    return () => {
      live = false;
    };
    // `key` stands for (paperId, at): `at` is a fresh object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null) return { status: 'failed' };
  return state.key === key ? state.value : { status: 'loading' };
}
