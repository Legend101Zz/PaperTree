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

/**
 * A label for a box in the layered figure (inline diagrams): wrapped at word breaks, 14 px on up to
 * two lines, else 13 px on up to three, the last line cut with "…" when even that is not enough.
 *
 * @param label The label as plain words (maths already read as text).
 * @param room The box's inner width.
 * @returns The size and the lines to draw.
 * @example
 * wrapLabel('Bidirectional encoder', 130); // { size: 14, lines: ['Bidirectional', 'encoder'] }
 */
export function wrapLabel(label: string, room: number): { size: number; lines: string[] } {
  const wrap = (size: number): string[] => {
    const max = Math.max(1, Math.floor(room / (size * ADVANCE)));
    const lines: string[] = [];
    let line = '';
    for (const word of label.split(/\s+/).filter((w) => w !== '')) {
      const next = line === '' ? word : `${line} ${word}`;
      if (next.length <= max || line === '') {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line !== '') lines.push(line);
    return lines;
  };
  const fits = (size: number, lines: string[], most: number): boolean => {
    const max = Math.max(1, Math.floor(room / (size * ADVANCE)));
    return lines.length <= most && lines.every((l) => l.length <= max);
  };
  const big = wrap(14);
  if (fits(14, big, 2)) return { size: 14, lines: big };
  const small = wrap(13);
  if (fits(13, small, 3)) return { size: 13, lines: small };
  // Still too much: three lines, the third holding the rest, every line cut to the room.
  const lines = small.length > 3 ? [...small.slice(0, 2), small.slice(2).join(' ')] : small;
  return { size: 13, lines: lines.map((l) => cut(l, room, 13)) };
}
