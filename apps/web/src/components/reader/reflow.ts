/**
 * reader/reflow — turning a PaperIR block's text into a paragraph, and the hyphen problem.
 *
 * `Block.text` IS NEVER DE-HYPHENATED. The extractor preserves the PDF's line breaks verbatim, so a
 * word the typesetter split across two lines arrives as `"transduc-\ntion"`. There are 6 such breaks
 * in `attention`, 13 in `neural-odes` and 61 in `resnet` — Guided view is a *reading* of the paper,
 * and a reading that says "transduc- tion" is not one.
 *
 * The rule, and it is a rule with a known false positive:
 *
 *   - `letter` + `-\n` + `lowercase letter`  →  join and DROP the hyphen. The typesetter's soft
 *     hyphen: `"transduc-\ntion"` → `"transduction"`.
 *   - every other `-\n`                      →  join and KEEP the hyphen. `"2015-\n2016"` stays a
 *     range; `"Kaiming-\nHe"` stays a name (the capital is the signal); a trailing `"-\n"` at the
 *     end of a block keeps its hyphen because there is no evidence either way.
 *   - every remaining newline                →  a single space.
 *
 * THE FALSE POSITIVE IS REAL AND KNOWINGLY ACCEPTED. `resnet` contains `"d/high-\nlevel"`, a genuine
 * compound that happens to have been broken AT its own hyphen; this function returns `"highlevel"`.
 * Telling the two apart needs a lexicon, and a lexicon that is wrong about a technical term is worse
 * than a rule that is wrong predictably: the paper itself is one click away in Source, which is the
 * whole reason Guided is allowed to be an interpretation at all.
 *
 * WHY A SCAN AND NOT `/(\p{L})-\n(?=\p{Ll})/gu`. Two reasons, one historical and one that stands.
 * The historical one: this was written while `apps/web/tsconfig.json` still set no `target`, so `tsc`
 * compiled at ES5 and rejected the `u` flag outright (TS1501); it is ES2022 now, so the regex would
 * compile. The one that stands: `toLowerCase() !== toUpperCase()` is a letter test for every cased
 * script at ANY target, and the scan makes the join-WITHOUT-A-SPACE rule explicit rather than
 * leaving it implicit in what a replacement pattern happens not to consume.
 *
 * Pure and side-effect-free so `test/reflow.spec.ts` can pin it against all three fixtures. It lives
 * in its own module rather than inside `GuidedView.tsx` so the test needs no JSX toolchain.
 */

/**
 * A cased letter, in any script. Caseless scripts (CJK, Arabic, Hebrew) answer `false`, which is the
 * conservative answer: they do not hyphenate at line breaks, so the hyphen is kept.
 */
function isLetter(ch: string): boolean {
  return ch.length > 0 && ch.toLowerCase() !== ch.toUpperCase();
}

/** A lowercase letter — the signal that the next line CONTINUES a word rather than starting one. */
function isLowercaseLetter(ch: string): boolean {
  return isLetter(ch) && ch === ch.toLowerCase();
}

/** Trailing spaces and tabs already written to the output, which a line break makes redundant. */
function trimEndInline(text: string): string {
  let end = text.length;
  while (end > 0) {
    const ch = text.charAt(end - 1);
    if (ch !== ' ' && ch !== '\t') break;
    end -= 1;
  }
  return text.slice(0, end);
}

function isWhitespace(ch: string): boolean {
  // U+00A0 is in the set: PDF text layers emit it, and beside a line break it is redundant
  // whitespace like any other. Written as an escape so it cannot be mistaken for a plain space.
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\n' ||
    ch === '\r' ||
    ch === '\f' ||
    ch === '\v' ||
    ch === '\u00a0'
  );
}

/**
 * Reflow one block's text into a single paragraph.
 *
 * Takes text the caller already read through the sanctioned path — `IndexedBlock.text`, which IS
 * `resolvedText(block).text` — and never reads `Block.text` itself.
 */
export function reflow(text: string): string {
  const source = text.replace(/\r\n?/g, '\n');
  let out = '';
  let i = 0;

  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch !== '\n') {
      out += ch;
      i += 1;
      continue;
    }

    // A line break. Consume it together with the whitespace on both sides, so a blank line or a
    // trailing space never becomes a double space in the reading.
    out = trimEndInline(out);
    let j = i;
    while (j < source.length && isWhitespace(source.charAt(j))) j += 1;
    const next = j < source.length ? source.charAt(j) : '';
    i = j;

    if (out.charAt(out.length - 1) === '-') {
      const beforeHyphen = out.charAt(out.length - 2);
      if (isLetter(beforeHyphen) && isLowercaseLetter(next)) {
        // The typesetter's hyphen. It exists only because of the line break that is going away.
        out = out.slice(0, -1);
      }
      // Either way the two halves are joined with NO space: a kept hyphen is part of the word
      // ("2015-2016", "Kaiming-He"), and a space would break it as surely as the newline did.
      continue;
    }

    if (out.length > 0) out += ' ';
  }

  return out.trim();
}

/**
 * Join consecutive blocks of ONE continued paragraph, repairing a hyphen that straddles the seam.
 *
 * `reflow` cannot fix this on its own, and the fixture set contains the exact case that proves it.
 * `resnet`'s block `blk_4hiq3kzukt6azk4x` ENDS with the four characters `high-` — no newline, the
 * block simply stops — and the word finishes as `way networks` at the start of the next block,
 * because the paragraph continues into the next column. That is the set's single
 * `continues_in_next_column` relation.
 *
 * Reflowing each block separately and joining the results with a space produces `high- way
 * networks`, which is not what the page says. So de-hyphenation is a DOCUMENT-level operation, not
 * a block-level one, wherever a paragraph is continued.
 *
 * Same rule as `reflow`'s, applied at the seam instead of at a newline: drop the hyphen only when
 * the character before it is a letter and the first character of the next fragment is a LOWERCASE
 * letter, so `2015-` + `2016` and `Kaiming-` + `He` keep theirs. Fragments that do not end in a
 * hyphen are joined with a single space.
 */
export function joinContinuedBlocks(texts: readonly string[]): string {
  let out = '';
  for (const text of texts) {
    const fragment = reflow(text);
    if (fragment === '') continue;
    if (out === '') {
      out = fragment;
      continue;
    }
    if (out.charAt(out.length - 1) === '-') {
      const beforeHyphen = out.charAt(out.length - 2);
      if (isLetter(beforeHyphen) && isLowercaseLetter(fragment.charAt(0))) {
        out = `${out.slice(0, -1)}${fragment}`;
        continue;
      }
      // A hyphen that is part of the word: join with no space, exactly as `reflow` does.
      out += fragment;
      continue;
    }
    out += ` ${fragment}`;
  }
  return out;
}

/**
 * Reflow text that is laid out on purpose — an `algorithm` block's pseudocode, an address block.
 *
 * The SOFT hyphen repair still applies (a word broken across two lines is broken for the same
 * reason), but the newlines survive, because in pseudocode a line break carries meaning that a space
 * does not — `reflow` would silently turn twelve numbered steps into one sentence. A hyphen this
 * cannot prove is a typesetter's stays put, line break and all: at that point it is the paper's own
 * line, and the paper's own lines are what this variant exists to keep.
 */
export function reflowPreservingLines(text: string): readonly string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());

  const out: string[] = [];
  for (const line of lines) {
    const previous = out.length > 0 ? out[out.length - 1] : undefined;
    if (
      previous !== undefined &&
      previous.charAt(previous.length - 1) === '-' &&
      isLetter(previous.charAt(previous.length - 2)) &&
      isLowercaseLetter(line.charAt(0))
    ) {
      out[out.length - 1] = previous.slice(0, -1) + line;
      continue;
    }
    out.push(line);
  }
  return out;
}
