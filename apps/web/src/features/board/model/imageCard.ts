/**
 * board/imageCard — what an image card (an `excerpt` whose anchor is a figure or a region, v0.3
 * #348) says about itself, built from server data only: the picture's page and rectangle from its
 * anchor, its caption from its body (what Send to board wrote), its name from the caption's opening
 * words, and its alt text from the caption and the first answer's TL;DR. Pure.
 *
 * The card carries no crop URL: the web asks `crop-url` per card, so the stored node stays the
 * anchor and the words.
 */
import { imageAlt, imageBoxOf, pictureNameOf, type ImageBox } from '@/lib/imageAnchor';

import { firstLine } from './answerText';

import type { Anchor } from '@papertree/anchoring';

/** What an image card draws. */
export interface ImageCardView {
  /** The page and rectangle the picture is cropped from. */
  readonly at: ImageBox;
  /** The caption, or null when the picture has none (a free region). */
  readonly caption: string | null;
  /** "Figure 4", "Table 2", "Figure" (no number known), or "Selected area". */
  readonly label: string;
  /** The quiet source line: "Figure 4 · p. 6", "Figure · p. 6", or "Selected area · p. 6". */
  readonly source: string;
  /** The picture's alt text: the caption, then a short description when an answer gives one. */
  readonly alt: string;
}

/**
 * The first answer's TL;DR line: the short description the alt text takes.
 *
 * @param finalText The answer's stored text, or null.
 * @returns The line, clipped to a sentence or two, or null when there is none.
 */
export function describeFrom(finalText: string | null | undefined): string | null {
  if (finalText === null || finalText === undefined) return null;
  const line = firstLine(finalText);
  if (line === '') return null;
  return line.length > 240 ? `${line.slice(0, 239).trimEnd()}…` : line;
}

/**
 * The view of an image card.
 *
 * @param anchor The card's `source_anchor`.
 * @param body The card's body: the caption written when it was sent.
 * @param finalText The first answer's stored text, when the card has one.
 * @returns The view, or null when the anchor is not an image anchor.
 */
export function imageCardOf(
  anchor: Anchor | null,
  body: string,
  finalText?: string | null,
): ImageCardView | null {
  const name = pictureNameOf(anchor, body);
  if (name === null || anchor === null) return null;
  const at = imageBoxOf(anchor);
  if (at === null) return null;
  const words = body.replace(/\s+/g, ' ').trim();
  const { label } = name;
  // A body that is only the figure's name ("Figure 2", stored when the parser linked no caption)
  // names the card; it is not a caption to print under the picture.
  const caption = words === '' || words === label ? null : words;
  return {
    at,
    caption,
    label,
    source: `${label} · p. ${String(at.page + 1)}`,
    alt: imageAlt(label, caption, describeFrom(finalText)),
  };
}
