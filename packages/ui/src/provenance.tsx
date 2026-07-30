/**
 * ui/provenance — the "our reading" register, and the only way to render derived content.
 *
 * THIS FILE DISCHARGES A PROMISE EPIC 0 MADE ON EPIC 2'S BEHALF.
 *
 * `packages/document-ir/DESIGN.md` §11.4 (residual risk 4) says, in full:
 *
 *   > **`EquationPayload.latex` / `mathml` and `TablePayload.html` accept arbitrary strings.**
 *   > Acceptable: each is a _declared interpretation_ with its own confidence, the required
 *   > `image` is the ground truth, and the UI is obliged to render them in the "our reading"
 *   > register. This holds **only if the UI actually does that** — Epic 2 owns that promise.
 *
 * Nothing validates those strings. The schema tolerates them *because of this file*. If the reader
 * renders `latex` as if it were the paper, the schema's whole interpretation-vs-source distinction
 * collapses and there is no other defence — which is exactly the failure `findings.md` §G records
 * in the current product ("AI output is indistinguishable from source").
 *
 * THE FOUR OBLIGATIONS, each mechanically enforced below rather than left to a convention:
 *
 *   1. **A distinct type register.** Different family, a left rule, a different ground. A reader
 *      must be able to tell at a glance, with no legend, that they are not looking at the paper.
 *   2. **The reserved `⊙` marker**, used NOWHERE ELSE in the product. It is exported as
 *      `DERIVED_MARKER` and `reader/provenance.spec` asserts no other component emits it.
 *   3. **`derived_from` block ids on every block.** Not "usually" — the component cannot be
 *      constructed without them, because the prop is required and empty arrays are rejected at
 *      runtime.
 *   4. **A working "show source".** Not a tooltip saying where it came from: an affordance that
 *      navigates to the exact region. `onShowSource` is required.
 *
 * `DerivedBlock` is the ONLY export that renders derived content, so "did we mark it?" reduces to
 * "did it go through here?", which is a question a test can answer.
 */

import type { ReactNode } from 'react';

/**
 * The AI-derived marker. Reserved: it appears nowhere else in the product, which is what makes it
 * mean something. `reader/provenance.spec` greps the built output to enforce that.
 */
export const DERIVED_MARKER = '⊙';

export interface DerivedBlockProps {
  /**
   * The PaperIR block ids this content was derived from. REQUIRED and non-empty — a derived block
   * that cannot say what it came from is exactly what this component exists to make impossible.
   */
  readonly derivedFrom: readonly string[];
  /** Navigate to the source region. REQUIRED: an inert "show source" is worse than none. */
  readonly onShowSource: (blockIds: readonly string[]) => void;
  /** What kind of reading this is, for the label. */
  readonly kind?: 'prose' | 'latex' | 'mathml' | 'table_html' | 'summary';
  readonly children: ReactNode;
  readonly className?: string;
}

const KIND_LABEL: Record<NonNullable<DerivedBlockProps['kind']>, string> = {
  prose: 'our reading',
  // Named precisely rather than "equation": the crop IS the equation, and this is a transcription
  // of it that may be wrong. `neural-odes`' five display equations carry no `latex` at all, which
  // is the honest reminder that this string is optional and fallible.
  latex: 'our transcription',
  mathml: 'our transcription',
  table_html: 'our reading of this table',
  summary: 'our summary',
};

/**
 * Wrap derived content in the derived register.
 *
 * Throws on an empty `derivedFrom` rather than rendering. A silent fallback would let a caller ship
 * unattributed derived content and only find out in review — and the entire point of §11.4 is that
 * review is not what is holding this line.
 */
export function DerivedBlock({
  derivedFrom,
  onShowSource,
  kind = 'prose',
  children,
  className,
}: DerivedBlockProps): ReactNode {
  if (derivedFrom.length === 0) {
    throw new Error(
      'DerivedBlock requires at least one derived_from block id. Derived content that cannot ' +
        'name its source must not render at all (DESIGN.md §11.4).',
    );
  }

  return (
    <div
      className={`pt-derived${className === undefined ? '' : ` ${className}`}`}
      data-derived="true"
      data-derived-from={derivedFrom.join(' ')}
      // Obligation from the epic brief: "Every AI-derived region is announced as AI-derived."
      // A visual register alone fails `reader/a11y.spec` — a screen-reader user gets no left rule.
      role="note"
      aria-label={`AI-derived: ${KIND_LABEL[kind]}, derived from ${String(derivedFrom.length)} source block${derivedFrom.length === 1 ? '' : 's'}`}
    >
      <div className="pt-derived__header">
        <span className="pt-derived__marker" aria-hidden="true">
          {DERIVED_MARKER}
        </span>
        <span className="pt-derived__label">{KIND_LABEL[kind]}</span>
        <button
          type="button"
          className="pt-derived__source"
          onPointerUp={() => onShowSource(derivedFrom)}
          // Pointer Events throughout (F2.7), but a button must still be operable from the
          // keyboard: `onPointerUp` never fires for Enter/Space, so the click handler stays.
          onClick={(event) => {
            if (event.detail === 0) onShowSource(derivedFrom);
          }}
        >
          show source
        </button>
      </div>
      <div className="pt-derived__body">{children}</div>
    </div>
  );
}

/**
 * An equation, rendered honestly.
 *
 * **THE CROP IS THE PAPER. THE LATEX IS OUR READING.** `image` is required by the schema and is the
 * ground truth; `latex`/`mathml` are declared interpretations with their own confidence. So the
 * crop renders as source, at full size, first — and the transcription renders below it, inside
 * `DerivedBlock`, only when it exists.
 *
 * Rendering the LaTeX as the primary representation would be the exact inversion §11.4 forbids, and
 * it is a tempting one because typeset LaTeX looks *better* than a bitmap crop. It is nevertheless
 * a claim about the paper that nothing checked.
 */
export interface EquationViewProps {
  readonly blockId: string;
  /** `fixture://…` or `https://…`, resolved by the caller. The GROUND TRUTH. */
  readonly imageSrc: string;
  readonly imageAlt: string;
  readonly equationNumber?: string;
  /** The transcription, if the parser produced one. Frequently absent — and that is fine. */
  readonly latex?: string;
  readonly mathml?: string;
  readonly onShowSource: (blockIds: readonly string[]) => void;
}

export function EquationView({
  blockId,
  imageSrc,
  imageAlt,
  equationNumber,
  latex,
  mathml,
  onShowSource,
}: EquationViewProps): ReactNode {
  return (
    <figure className="pt-equation" data-block-id={blockId}>
      {/* Source. No marker, no rule, no register — this IS the paper. */}
      <img className="pt-equation__crop" src={imageSrc} alt={imageAlt} />
      {equationNumber === undefined ? null : (
        <span className="pt-equation__number" aria-hidden="true">
          ({equationNumber})
        </span>
      )}

      {latex === undefined && mathml === undefined ? null : (
        <DerivedBlock
          derivedFrom={[blockId]}
          onShowSource={onShowSource}
          kind={latex === undefined ? 'mathml' : 'latex'}
          className="pt-equation__reading"
        >
          <code className="pt-equation__latex">{latex ?? mathml}</code>
        </DerivedBlock>
      )}
    </figure>
  );
}

/**
 * A table, rendered honestly.
 *
 * `TablePayload.html` is arbitrary — nothing validates it, and it could contain anything. It is
 * therefore NEVER injected as markup: `dangerouslySetInnerHTML` here would be both a provenance
 * violation and an XSS sink in one line. The cells come from the IR's own `table_row` /
 * `table_cell` blocks, whose text is read from the PDF text layer rather than produced by a
 * decoder — so there is no hallucination surface for cell content.
 *
 * `html`, when present, is offered as a declared reading inside `DerivedBlock`, as escaped text.
 */
export interface TableViewProps {
  readonly blockId: string;
  readonly rows: readonly { readonly id: string; readonly cells: readonly { readonly id: string; readonly text: string; readonly isHeader?: boolean }[] }[];
  readonly caption?: string;
  readonly html?: string;
  readonly onShowSource: (blockIds: readonly string[]) => void;
}

export function TableView({ blockId, rows, caption, html, onShowSource }: TableViewProps): ReactNode {
  return (
    <figure className="pt-table" data-block-id={blockId}>
      <table className="pt-table__grid">
        {caption === undefined ? null : <caption>{caption}</caption>}
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-block-id={row.id}>
              {row.cells.map((cell) =>
                cell.isHeader === true ? (
                  <th key={cell.id} data-block-id={cell.id} scope="col">
                    {cell.text}
                  </th>
                ) : (
                  <td key={cell.id} data-block-id={cell.id}>
                    {cell.text}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {html === undefined ? null : (
        <DerivedBlock derivedFrom={[blockId]} onShowSource={onShowSource} kind="table_html">
          {/* Escaped text, never markup. See the note above. */}
          <code className="pt-table__html">{html}</code>
        </DerivedBlock>
      )}
    </figure>
  );
}

/**
 * A figure. Always the paper's own crop.
 *
 * "No fabricated diagrams" — Mermaid is deleted, not restyled. A derived section that wants to show
 * structure shows THIS, the paper's own figure, and not a diagram a model drew of what it thinks
 * the paper's structure is.
 */
export interface FigureViewProps {
  readonly blockId: string;
  readonly imageSrc: string;
  readonly imageAlt: string;
  readonly caption?: string;
}

export function FigureView({ blockId, imageSrc, imageAlt, caption }: FigureViewProps): ReactNode {
  return (
    <figure className="pt-figure" data-block-id={blockId}>
      <img className="pt-figure__crop" src={imageSrc} alt={imageAlt} />
      {caption === undefined ? null : <figcaption className="pt-figure__caption">{caption}</figcaption>}
    </figure>
  );
}
