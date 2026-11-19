'use client';

/**
 * explain/ImageHead — the crop at the top of an image thread (v0.3 #348, item 3): the picture the
 * answer is about, what it is called, its page and its caption, above the first exchange. It is
 * shown for as long as the thread is, so every follow-up is read beside the figure it is about.
 */
import { CropImage } from '@/components/image/CropImage';
import { imageAlt, imageBoxOf } from '@/lib/imageAnchor';

import { selectorOf } from '../model/anchor';

import type { ExplainRequest } from '../model/state';
import type { ReactNode } from 'react';
import './imageHead.css';

/** Props for `ImageHead`. */
export interface ImageHeadProps {
  readonly request: ExplainRequest;
  readonly paperId: string | null;
}

/**
 * The picture and its name.
 *
 * @param props What the panel is open on, and the paper.
 * @returns The figure, or null when the request is not a picture.
 */
export function ImageHead({ request, paperId }: ImageHeadProps): ReactNode {
  const image = request.image;
  const at = imageBoxOf(request.anchor);
  if (image === undefined || at === null) return null;
  const page = selectorOf(request.anchor, 'PageSelector')?.index ?? at.page;
  return (
    <figure className="pt-explain__crop" data-explain-crop="">
      <CropImage paperId={paperId} at={at} alt={imageAlt(image.label, image.caption)} />
      <figcaption className="pt-explain__cropcap">
        <span className="pt-explain__croplabel">
          {image.label} · p. {page + 1}
        </span>
        {image.caption === null ? null : <span> {image.caption}</span>}
      </figcaption>
    </figure>
  );
}
