/**
 * lib/api/crops — a rectangle of a page as a picture (v0.3 #348; contracts.md "Region crops").
 *
 * `crop-url` returns a signed URL an `<img>` can load without a Bearer header, and the size the
 * image will have (so a card can hold its place before the bytes arrive). The box is in PDF points,
 * origin top-left, the space of an IR bbox and of an image anchor's quad.
 */
import { request } from './client';

import type { ImageBox } from '../imageAnchor';

/** `GET /papers/{id}/crop-url`'s answer. */
export interface CropUrl {
  readonly url: string;
  /** ISO time the signature runs out (an hour or so ahead). */
  readonly expires_at: string;
  readonly dpi: number;
  readonly width: number;
  readonly height: number;
}

const seg = encodeURIComponent;

/** The query string for a crop; tenths of a point are plenty and keep the cache key short. */
export function cropQuery({ page, box }: ImageBox): string {
  const [x0, y0, x1, y1] = box.map((n) => n.toFixed(2));
  return `page=${String(page)}&x0=${x0 ?? ''}&y0=${y0 ?? ''}&x1=${x1 ?? ''}&y1=${y1 ?? ''}`;
}

export const cropsApi = {
  /** Signs a crop of one rectangle for use in an `<img>`. */
  url: (paperId: string, at: ImageBox) =>
    request<CropUrl>(`/papers/${seg(paperId)}/crop-url?${cropQuery(at)}`),
};
