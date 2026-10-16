/**
 * What the Contents outline shows (#177): headings by their display text, never the parser's block
 * types, and front matter as the paper's title (plus any heading the parse left outside the section
 * tree, such as an "Abstract" heading). Pure; `components/reader/Navigator` renders it.
 */

/**
 * A leading section number: "1", "3.2.1", "1." or "IV." followed by a space. The same rule as the
 * explain panel's section names (`services/api` `evidence.section_display_title`, #201), so a
 * section reads the same in Contents and in a trace row.
 */
const NUMBER_PREFIX = /^\s*(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+/;

/**
 * A heading as a reader would say it: the leading number dropped ("3.2.1 Scaled Dot-Product
 * Attention" → "Scaled Dot-Product Attention"). A heading that is only a number keeps it.
 *
 * @param text - The heading block's text, on one line.
 * @returns The display title.
 * @example
 * headingDisplayTitle('1. Introduction') // "Introduction"
 */
export function headingDisplayTitle(text: string): string {
  const stripped = text.replace(NUMBER_PREFIX, '').trim();
  return stripped.length > 0 ? stripped : text.trim();
}

/**
 * Is this "heading" a sentence fragment the parser mistook for one (it ends with a full stop or
 * starts in lowercase, like the "scholarly works." that closes Attention's attribution banner)? The
 * same rule as `evidence.section_display_title`; Contents lists such a section's children in its
 * place rather than the fragment.
 *
 * @param title - The heading's display title.
 * @returns True for a fragment.
 */
export function isFragmentHeading(title: string): boolean {
  return title.endsWith('.') || /^\p{Ll}/u.test(title);
}

/** A front-matter block as the outline sees it. */
export interface FrontMatterLeaf {
  readonly blockId: string;
  readonly type: string;
  readonly label: string;
}

/**
 * The front matter's rows: the paper's title (wherever the parse put it: the real Attention parse
 * files it under a misparsed heading) and any heading before the first section, by their text. The
 * authors, affiliations and the rest stay on the page and out of Contents. Without a title, the first
 * block stands in, so "Front matter" still goes somewhere.
 *
 * @param leaves - The labelled blocks before the first section, in reading order.
 * @param title - The document's title block, or null when the parse found none.
 * @returns The rows to list, labelled for a reader.
 */
export function frontMatterRows(
  leaves: readonly FrontMatterLeaf[],
  title: FrontMatterLeaf | null = null,
): FrontMatterLeaf[] {
  const headings = leaves
    .filter((leaf) => leaf.type === 'heading')
    .map((leaf) => ({ ...leaf, label: headingDisplayTitle(leaf.label) }));
  const kept = [
    ...(title === null ? leaves.filter((leaf) => leaf.type === 'title').slice(0, 1) : [title]),
    ...headings,
  ];
  if (kept.length > 0) return kept;
  const first = leaves[0];
  return first === undefined ? [] : [first];
}
