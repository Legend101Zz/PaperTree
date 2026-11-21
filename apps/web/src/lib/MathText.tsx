/**
 * lib/MathText — a plain string (a diagram note, a key label) with its `$…$` / `$$…$$` typeset
 * (#338). Not Markdown: only maths is interpreted, through the same scanner and the same `Maths`
 * renderer as every answer.
 */
import { Fragment, type ReactNode } from 'react';

import { Maths } from './math';
import { splitMath } from './markdown';

/** Props for `MathText`. */
interface MathTextProps {
  readonly text: string;
}

/** The string, its maths typeset. */
export function MathText({ text }: MathTextProps): ReactNode {
  return splitMath(text).map((seg, i) =>
    seg.t === 'text' ? (
      <Fragment key={i}>{seg.v}</Fragment>
    ) : (
      <Maths key={i} tex={seg.tex} display={seg.display} />
    ),
  );
}
