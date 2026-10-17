/**
 * How words fit a box or a gap on the plate (#217), without measuring text: the plate is laid out
 * the same on every render, before the fonts are known to be loaded, so a label is sized from an
 * average advance per character of the paper face, set a little generous so a wide word does not
 * run over. A label that does not fit is cut with "…"; the key beside the drawing keeps every word.
 */

/** Average advance of Libre Caslon Text (bold and italic), in em per character. */
const ADVANCE = 0.55;

/** The two sizes a box label may take (DESIGN.md §2: 13 px is the smallest text). */
const SIZES = [15, 13] as const;

/**
 * Text cut to a width.
 *
 * @param text The words.
 * @param room The width they may take, in SVG units.
 * @param size The type size.
 * @returns The words, or as many as fit followed by "…".
 */
export function cut(text: string, room: number, size: number): string {
  const max = Math.max(1, Math.floor(room / (size * ADVANCE)));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * A box label at 15 px when it fits on one line, else at 13 px on one line, else on two lines
 * broken at a space (the second cut if it is still too long).
 *
 * @param label The part's label.
 * @param room The box's inner width.
 * @param lines How many lines the box has room for (an inferred box keeps one for its caption).
 * @returns The size and the lines to draw.
 * @example
 * fitLabel('Queries and keys (dk)', 130, 2); // { size: 13, lines: ['Queries and keys', '(dk)'] }
 */
export function fitLabel(
  label: string,
  room: number,
  lines: 1 | 2,
): { size: number; lines: string[] } {
  for (const size of SIZES) {
    if (label.length * size * ADVANCE <= room) return { size, lines: [label] };
  }
  const max = Math.floor(room / (13 * ADVANCE));
  const words = label.split(' ');
  let first = '';
  while (words.length > 0 && `${first} ${words[0] ?? ''}`.trim().length <= max) {
    first = `${first} ${words.shift() ?? ''}`.trim();
  }
  if (lines === 1 || first === '' || words.length === 0) {
    return { size: 13, lines: [cut(label, room, 13)] };
  }
  return { size: 13, lines: [first, cut(words.join(' '), room, 13)] };
}
