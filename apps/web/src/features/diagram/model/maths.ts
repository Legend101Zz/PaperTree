/**
 * Maths in a diagram label. The agent is asked to write maths as `$…$`, but a model still writes
 * "Scale by √d_k" or "score_i = q·k_i" now and then; drawn as text that is a raw underscore. So a
 * label with no `$` at all has its bare TeX-ish words (an underscore, a caret, a backslash command,
 * a root sign) wrapped in `$…$` before it goes to the one maths renderer (`lib/MathText`). A label
 * that already holds a `$` is the model's own and is left exactly as written.
 */

/** A word that is TeX rather than prose. */
const TEXISH = /[_^\\√]/;

/** `√x`, `√d_k` as `\sqrt{x}`, `\sqrt{d_k}`; any other `√` is left to KaTeX's own glyph. */
const ROOT = /√([A-Za-z0-9α-ωΑ-Ω]+(?:_[A-Za-z0-9{}]+)?)/g;

/**
 * The label with its bare maths marked as `$…$`.
 *
 * @param text A label or a note, as the model wrote it.
 * @returns The same words, bare maths wrapped; the text itself when it holds a `$` or no maths.
 * @example
 * withBareMaths('Scale by √d_k'); // 'Scale by $\\sqrt{d_k}$'
 */
export function withBareMaths(text: string): string {
  if (text.includes('$') || !TEXISH.test(text)) return text;
  return text
    .split(' ')
    .map((word) => {
      if (!TEXISH.test(word)) return word;
      // Keep the punctuation around a word outside the maths: "(d_k)," -> "($d_k$),".
      const m = /^([([]*)(.*?)([)\],.;:]*)$/.exec(word);
      const core = m?.[2] ?? word;
      if (core === '') return word;
      const tex = core.replace(ROOT, (_all, body: string) => `\\sqrt{${body}}`);
      return `${m?.[1] ?? ''}$${tex}$${m?.[3] ?? ''}`;
    })
    .join(' ');
}
