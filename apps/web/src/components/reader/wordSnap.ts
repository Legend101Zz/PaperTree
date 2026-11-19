/**
 * reader/wordSnap — a settled selection starts and ends on whole words (P4 step 5).
 *
 * A drag lands its ends anywhere inside a word, so the selection began mid-"identity" and stopped
 * after "mapp". The prototype snaps both ends outward to the nearest space once the reader lets go,
 * and trims spaces off the edges; so does this, on the text layer's own DOM selection, so what is
 * painted, quoted, highlighted and anchored is the same whole-word passage.
 *
 * Only the text node an end sits in is searched: a text-layer item is one run of text, and a word
 * split across two items (a ligature break) keeps the end where the browser put it rather than
 * guessing across elements. Run it on pointer-up, never during a drag (it would fight the pointer).
 */

const LAYER = '.papertree-text-layer';

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);

/** The start offset moved back to the word's first letter (or forward off leading spaces). */
export function snapStart(text: string, offset: number): number {
  let at = offset;
  while (at < text.length && isSpace(text[at])) at += 1;
  if (at >= text.length) return offset;
  while (at > 0 && !isSpace(text[at - 1])) at -= 1;
  return at;
}

/** The end offset moved on to the word's last letter (or back off trailing spaces). */
export function snapEnd(text: string, offset: number): number {
  let at = offset;
  while (at > 0 && isSpace(text[at - 1])) at -= 1;
  if (at <= 0) return offset;
  while (at < text.length && !isSpace(text[at])) at += 1;
  return at;
}

const TEXT_NODE = 3;
const isText = (node: Node): node is Text => node.nodeType === TEXT_NODE;

function inLayer(node: Node): boolean {
  const el = isText(node) ? node.parentElement : (node as Element);
  return el?.closest(LAYER) != null;
}

/**
 * Snap the document selection's ends to whole words, when both ends are in a text layer. Keeps the
 * selection's direction. Does nothing for a collapsed selection or one that reaches outside a layer.
 *
 * @param selection - The selection to adjust (default: the window's).
 * @returns Whether an end moved.
 */
export function snapSelectionToWords(
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): boolean {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const { startContainer, endContainer } = range;
  if (!inLayer(startContainer) || !inLayer(endContainer)) return false;
  const start = isText(startContainer)
    ? snapStart(startContainer.data, range.startOffset)
    : range.startOffset;
  const end = isText(endContainer) ? snapEnd(endContainer.data, range.endOffset) : range.endOffset;
  if (start === range.startOffset && end === range.endOffset) return false;
  // Never let trimming collapse a one-word selection into nothing.
  if (startContainer === endContainer && end <= start) return false;
  const backwards =
    selection.anchorNode === endContainer &&
    selection.anchorOffset === range.endOffset &&
    !(startContainer === endContainer && range.startOffset === range.endOffset);
  try {
    if (backwards) selection.setBaseAndExtent(endContainer, end, startContainer, start);
    else selection.setBaseAndExtent(startContainer, start, endContainer, end);
  } catch {
    return false;
  }
  return true;
}
