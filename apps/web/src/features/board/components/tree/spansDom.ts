/**
 * board/components/tree/spansDom — the DOM half of `model/spans`: reading a selection inside an
 * answer as words plus "which occurrence", and finding those words again to underline them and to
 * measure the height of their last line (so a branch's line can leave level with it, #349).
 *
 * The text read is the TEXT THE READER SEES: formulas, figures, section labels and source buttons
 * are skipped, as `plainOf` skips their sources, so the n-th occurrence means the same in both.
 */
import { normaliseWords, occurrencesBefore, nthIndexOf } from '../../model/spans';

const SKIP = '.katex, svg, button, .pt-source, .pt-ai-label, [data-math-invalid]';

interface Plain {
  readonly text: string;
  readonly at: readonly { readonly node: Text; readonly offset: number }[];
}

/**
 * The visible words of `root`, whitespace collapsed, each character remembering its text node.
 *
 * @param root The answer's body.
 * @returns The text and, for each character, where it sits in the DOM.
 */
function plainOfDom(root: HTMLElement): Plain {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const at: { node: Text; offset: number }[] = [];
  let text = '';
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const t = node as Text;
    if (t.parentElement?.closest(SKIP) != null) continue;
    for (let i = 0; i < t.data.length; i += 1) {
      const ch = t.data.charAt(i);
      if (/\s/.test(ch)) {
        if (text === '' || text.endsWith(' ')) continue;
        text += ' ';
      } else {
        text += ch;
      }
      at.push({ node: t, offset: i });
    }
  }
  return { text, at };
}

/** What a selection says: the words and which occurrence of them it is. */
export interface SelectedWords {
  readonly quote: string;
  readonly nth: number;
  /** The last line of the selection, in viewport px. */
  readonly last: DOMRect;
}

/**
 * The reader's selection inside `root`, if it is one.
 *
 * @param root The answer's body.
 * @returns The words, or null for no selection, one outside `root`, or one of a single character.
 */
export function selectedWords(root: HTMLElement): SelectedWords | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const quote = normaliseWords(selection.toString());
  if (quote.length < 2) return null;
  const plain = plainOfDom(root);
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = normaliseWords(before.toString()).length;
  const nth = occurrencesBefore(plain.text, quote, start);
  const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
  const last = rects !== null && rects.length > 0 ? rects[rects.length - 1] : undefined;
  return { quote, nth, last: last ?? range.getBoundingClientRect() };
}

/**
 * The DOM range of the n-th occurrence of some words.
 *
 * @param root The answer's body.
 * @param words The words (collapsed whitespace).
 * @param nth 0-based occurrence.
 * @returns The range, or null when the words are not on screen (the text changed).
 */
export function rangeFor(root: HTMLElement, words: string, nth: number): Range | null {
  const plain = plainOfDom(root);
  const from = nthIndexOf(plain.text, normaliseWords(words), nth);
  if (from === -1) return null;
  const first = plain.at[from];
  const last = plain.at[from + normaliseWords(words).length - 1];
  if (first === undefined || last === undefined) return null;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}
