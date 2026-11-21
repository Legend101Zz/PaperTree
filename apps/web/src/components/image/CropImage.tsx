'use client';

/**
 * image/CropImage — the picture of an image anchor: a figure, a table or a region of a page (v0.3
 * #348). The explain panel shows it at the top of an image thread and the board shows it on an image
 * card; both reach the server the same way (`crop-url`, signed, one fetch per rectangle).
 *
 * Its size is known before the bytes arrive (`crop-url` says it), so the place is held and nothing
 * jumps when the picture lands. A crop that cannot be made is said in words, never an empty box.
 * The picture keeps its own colours on every page and room; only its edge is a token.
 */
import { useCropUrl } from '@/lib/useCropUrl';

import type { ImageBox } from '@/lib/imageAnchor';
import type { ReactNode } from 'react';
import './crop.css';

/** Props for `CropImage`. */
export interface CropImageProps {
  /** The paper, or null for a sample paper (which has no server to crop). */
  readonly paperId: string | null;
  readonly at: ImageBox | null;
  /** The picture's alt text: the caption and a short description. */
  readonly alt: string;
  readonly className?: string;
}

/**
 * The picture, its place held while it loads.
 *
 * @param props The paper, the rectangle and the alt text.
 * @returns An `<img>`, a placeholder or a sentence.
 */
export function CropImage({ paperId, at, alt, className }: CropImageProps): ReactNode {
  const crop = useCropUrl(paperId, at);
  const cls = `pt-crop${className === undefined ? '' : ` ${className}`}`;
  if (crop.status === 'failed') {
    return (
      <p className={`${cls} pt-crop--failed`} role="note">
        The picture could not be loaded. Its caption is below.
      </p>
    );
  }
  if (crop.status === 'loading') {
    return (
      <div
        className={`${cls} pt-crop--loading pt-skeleton`}
        role="img"
        aria-label={alt}
        aria-busy="true"
      />
    );
  }
  const { url, width, height } = crop.crop;
  return (
    // A signed, short-lived URL of a PNG the API cut: next/image's optimiser has nothing to add.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={cls}
      src={url}
      alt={alt}
      width={width}
      height={height}
      decoding="async"
      draggable={false}
      style={{ aspectRatio: `${String(width)} / ${String(height)}` }}
    />
  );
}
