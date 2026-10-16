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

/** Block types that are running text: a section "headed" by one is the parser's mistake. */
const BODY_TEXT_TYPES = new Set(['paragraph', 'list_item', 'caption', 'footnote']);

/**
 * Is this section heading really a scrap of body text? Two signs, and only these (review S3):
 * the parser typed its block as body text, or it reads as the tail of a sentence: it ends with a
 * full stop, has fewer than three words and starts in lowercase, like the "scholarly works." that
 * ends Attention's attribution banner. Real headings that start in lowercase ("t-SNE background",
 * "word2vec embeddings") or end with a full stop ("Background.", a run-in heading) stay.
 *
 * @param title - The heading's display title.
 * @param blockType - The heading block's type in the parse.
 * @returns True when Contents should not list it (its subsections take its place).
 * @example
 * isFragmentHeading('scholarly works.', 'heading') // true
 * isFragmentHeading('t-SNE background', 'heading') // false
 */
export function isFragmentHeading(title: string, blockType = 'heading'): boolean {
  if (BODY_TEXT_TYPES.has(blockType)) return true;
  const text = title.trim();
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return text.endsWith('.') && words < 3 && /^\p{Ll}/u.test(text);
}

/** What an unsectioned block is, in a reader's words (never the parser's type name, #177). */
const OUTSIDE_PREFIX: Readonly<Record<string, string>> = {
  page_number: 'Page number',
  footnote: 'Footnote:',
  margin_note: 'Margin note:',
  header: 'Running head:',
  footer: 'Footer:',
};

/**
 * The label of a block outside the section tree: its text, with what it is in plain words when
 * the text alone would not say ("Page number 7", not a bare "7").
 *
 * @param type - The block's type in the parse.
 * @param text - The block's first line.
 * @returns The row's label.
 */
export function outsideLabel(type: string, text: string): string {
  const prefix = OUTSIDE_PREFIX[type];
  return prefix === undefined ? text : `${prefix} ${text}`;
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
 * authors, affiliations and the rest stay on the page and out of Contents; without a title or a
 * heading there are no rows, never an author or the arXiv banner in the title's place (review N8).
 *
 * @param leaves - The labelled blocks before the first section, in reading order.
 * @param title - The document's title block, or null when the parse found none or Contents lists
 *   it as a section already.
 * @returns The rows to list, labelled for a reader.
 */
export function frontMatterRows(
  leaves: readonly FrontMatterLeaf[],
  title: FrontMatterLeaf | null = null,
): FrontMatterLeaf[] {
  const headings = leaves
    .filter((leaf) => leaf.type === 'heading')
    .map((leaf) => ({ ...leaf, label: headingDisplayTitle(leaf.label) }));
  const titles =
    title === null ? leaves.filter((leaf) => leaf.type === 'title').slice(0, 1) : [title];
  return [...titles, ...headings];
}
