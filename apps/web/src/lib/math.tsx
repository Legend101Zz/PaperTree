/**
 * lib/math — the ONE place a TeX string becomes something on screen (#338). Every renderer of
 * model text (explain, Ask, summary, board card, notebook, diagram notes) draws a `math` / `dm`
 * node of `lib/markdown` through `Maths`; there is no second path.
 *
 * KaTeX runs here, on the server too (`renderToString`), with `output: 'htmlAndMathml'` so a screen
 * reader gets the MathML and a copy keeps the TeX (KaTeX puts it in an `<annotation>`). The only
 * HTML injected is KaTeX's own markup for a string it parsed; `trust` is off, so `\href`,
 * `\includegraphics` and the like are refused. Its CSS and woff2 fonts come from the `katex` package
 * (imported once in `app/layout.tsx`, served by the build, no CDN).
 *
 * A string KaTeX cannot parse is never a crash and never a raw `$`: it is drawn as its TeX source
 * in the maths face, without delimiters, with the parser's complaint as a `title`.
 */
import katex from 'katex';

import type { ReactNode } from 'react';

/** The outcome of typesetting one TeX string. */
type Typeset =
  { readonly ok: true; readonly html: string } | { readonly ok: false; readonly message: string };

const CACHE = new Map<string, Typeset>();
const CACHE_MAX = 500;

/**
 * Typeset TeX with KaTeX.
 *
 * @param tex - The TeX source, without `$` delimiters.
 * @param display - A display equation (centred, on its own line) rather than inline.
 * @returns The markup, or the parser's message when the TeX is invalid. Never throws.
 */
export function typeset(tex: string, display: boolean): Typeset {
  const key = `${display ? 'd' : 'i'}:${tex}`;
  const hit = CACHE.get(key);
  if (hit !== undefined) return hit;
  let result: Typeset;
  try {
    result = {
      ok: true,
      html: katex.renderToString(tex, {
        displayMode: display,
        // `throwOnError` is ON here so an invalid string reaches the fallback below (the TeX source
        // in the maths face) instead of KaTeX's red error box.
        throwOnError: true,
        output: 'htmlAndMathml',
        strict: 'ignore',
        trust: false,
      }),
    };
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : 'Invalid maths' };
  }
  if (CACHE.size >= CACHE_MAX) CACHE.clear();
  CACHE.set(key, result);
  return result;
}

/** Props for `Maths`. */
interface MathsProps {
  readonly tex: string;
  readonly display: boolean;
}

/** One maths run, typeset; the TeX source as plain maths-face text when it does not parse. */
export function Maths({ tex, display }: MathsProps): ReactNode {
  const out = typeset(tex, display);
  const kind = display ? 'pt-math pt-math--display' : 'pt-math';
  if (!out.ok) {
    return (
      <span className={`${kind} pt-math--invalid`} title={out.message} data-math-invalid>
        {tex}
      </span>
    );
  }
  return <span className={kind} dangerouslySetInnerHTML={{ __html: out.html }} />;
}
