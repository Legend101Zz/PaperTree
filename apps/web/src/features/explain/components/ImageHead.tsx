'use client';

/**
 * explain/ImageHead — the crop at the top of an image thread (v0.3 #348, item 3): the picture the
 * answer is about, what it is called, its page and its caption, above the first exchange. It is
 * shown for as long as the thread is, so every follow-up is read beside the figure it is about.
 *
 * It is a thumbnail, at most `--pt-explain-crop-max` (240 px) tall with its own aspect kept, so the
 * answer under it is not pushed below the fold; one click shows it at the panel's full width, and
 * Esc (or another click) puts it back. Esc is used here first, so it does not close the panel.
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { CropImage } from '@/components/image/CropImage';
import { imageAlt, imageBoxOf } from '@/lib/imageAnchor';

import { selectorOf } from '../model/anchor';

import type { ExplainRequest } from '../model/state';
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
  const [large, setLarge] = useState(false);
  const image = request.image;
  const at = imageBoxOf(request.anchor);
  if (image === undefined || at === null) return null;
  const page = selectorOf(request.anchor, 'PageSelector')?.index ?? at.page;
  return (
    <figure className="pt-explain__crop" data-explain-crop="" data-large={large}>
      <button
        type="button"
        className="pt-explain__cropbtn"
        aria-expanded={large}
        aria-label={large ? 'Show the picture smaller' : 'Show the picture larger'}
        title={large ? 'Show smaller (Esc)' : 'Show larger'}
        onClick={() => setLarge((on) => !on)}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== 'Escape' || !large) return;
          // The picture goes back to a thumbnail first; the panel stays open.
          event.stopPropagation();
          setLarge(false);
        }}
      >
        <CropImage paperId={paperId} at={at} alt={imageAlt(image.label, image.caption)} />
      </button>
      <figcaption className="pt-explain__cropcap">
        <span className="pt-explain__croplabel">
          {image.label} · p. {page + 1}
        </span>
        {image.caption === null ? null : <span> {image.caption}</span>}
      </figcaption>
    </figure>
  );
}
