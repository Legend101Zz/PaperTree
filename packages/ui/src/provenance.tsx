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
 *
 * THE THREE TEXT REGISTERS (ADR-002 §3.6, added in S0). The brief says the UI must distinguish
 * paper content from AI interpretation, and Guided taught the lesson the hard way: it reflows the
 * paper's OWN words, rendered them under ⊙ "our reading", and so dressed the paper up as AI
 * (proposal B §655: 181 verbatim text cards labelled as derived). So there are three registers,
 * and the ⊙ belongs to exactly one of them:
 *
 *   `PaperText`     the paper's words, quoted (the explain panel's passage, an excerpt card).
 *   `ReflowedText`  the paper's words re-laid out by Guided: the paper register plus a
 *                   "Reflowed from the PDF" marker. Verbatim text never wears ⊙.
 *   `AiText`        what a model wrote: the derived register and the reserved ⊙.
 *
 * `registers.spec` asserts they differ in the DOM and in the stylesheet, in both themes.
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
  readonly rows: readonly {
    readonly id: string;
    readonly cells: readonly {
      readonly id: string;
      readonly text: string;
      readonly isHeader?: boolean;
    }[];
  }[];
  readonly caption?: string;
  readonly html?: string;
  readonly onShowSource: (blockIds: readonly string[]) => void;
}

export function TableView({
  blockId,
  rows,
  caption,
  html,
  onShowSource,
}: TableViewProps): ReactNode {
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
      {caption === undefined ? null : (
        <figcaption className="pt-figure__caption">{caption}</figcaption>
      )}
    </figure>
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The three text registers — ADR-002 §3.6.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

function classes(base: string, extra: string | undefined): string {
  return extra === undefined ? base : `${base} ${extra}`;
}

export interface PaperTextProps {
  /** The paper's words, verbatim. Never a paraphrase: a paraphrase is `AiText`. */
  readonly children: ReactNode;
  /** `blockquote` for a quoted passage; `span` for an inline quote. Default `p`. */
  readonly as?: 'p' | 'div' | 'span' | 'blockquote';
  /** Where the words are, e.g. `"p. 4"` — attribution, rendered AFTER the words as a `<cite>`. */
  readonly pageLabel?: string;
  readonly className?: string;
}

/** The paper's own words, in the paper's register: the serif, the ink, no marker, no tint. */
export function PaperText({
  children,
  as: Element = 'p',
  pageLabel,
  className,
}: PaperTextProps): ReactNode {
  return (
    <Element className={classes('pt-paper', className)} data-register="paper">
      <span className="pt-paper__text">{children}</span>
      {pageLabel === undefined ? null : <cite className="pt-paper__cite">{pageLabel}</cite>}
    </Element>
  );
}

/** The marker `ReflowedText` carries. Exported so a test or a legend can name it exactly. */
export const REFLOWED_LABEL = 'Reflowed from the PDF';

export interface ReflowedTextProps {
  /** The PaperIR blocks whose text this is, published as `data-block-ids`. */
  readonly blockIds: readonly string[];
  /**
   * Navigate to the blocks in Source. OPTIONAL, unlike `DerivedBlock`'s: this is the paper's own
   * text, so it needs no proof of origin — but when given, the affordance must work, and when not
   * given there is no button at all rather than an inert one.
   */
  readonly onShowSource?: (blockIds: readonly string[]) => void;
  /**
   * What the source button says, e.g. `"p. 4"`: Guided puts it in the margin as the paragraph's
   * page. Default `"show in PDF"`. The accessible name always says what the button does.
   */
  readonly sourceLabel?: string;
  readonly children: ReactNode;
  readonly as?: 'div' | 'section' | 'article';
  readonly className?: string;
  /** Extra attributes for the root, e.g. `data-block-id` so Split and the flash can find it. */
  readonly dataBlockId?: string;
}

/**
 * The paper's words re-laid out (Guided). The paper register, plus a marker saying so.
 *
 * It says "reflowed", not "our reading": the TEXT is the paper's, and only the LAYOUT is ours. The
 * ⊙ is withheld on purpose — it means "a model wrote this", and here nobody did.
 */
export function ReflowedText({
  blockIds,
  onShowSource,
  sourceLabel,
  children,
  as: Element = 'div',
  className,
  dataBlockId,
}: ReflowedTextProps): ReactNode {
  const canShow = onShowSource !== undefined && blockIds.length > 0;
  return (
    <Element
      className={classes('pt-paper pt-reflowed', className)}
      data-register="reflowed"
      data-block-ids={blockIds.join(' ')}
      {...(dataBlockId === undefined ? {} : { 'data-block-id': dataBlockId })}
    >
      <div className="pt-reflowed__marker">
        <span className="pt-reflowed__label">{REFLOWED_LABEL}</span>
        {canShow ? (
          <button
            type="button"
            className="pt-reflowed__source"
            {...(sourceLabel === undefined
              ? {}
              : { 'aria-label': `Show in the PDF (${sourceLabel})` })}
            onPointerUp={() => onShowSource(blockIds)}
            // Pointer Events throughout (F2.7); the click handler is the keyboard path, and
            // `detail === 0` keeps a real tap (pointerup + click) from firing twice.
            onClick={(event) => {
              if (event.detail === 0) onShowSource(blockIds);
            }}
          >
            {sourceLabel ?? 'show in PDF'}
          </button>
        ) : null}
      </div>
      <div className="pt-reflowed__text">{children}</div>
    </Element>
  );
}

export interface AiTextProps {
  /** What the model wrote. Citation chips go inside, next to the claims they support. */
  readonly children: ReactNode;
  /** The model that wrote it, e.g. `"MiniMax-M3"`, named in the label. */
  readonly model?: string;
  readonly as?: 'div' | 'section';
  readonly className?: string;
}

/**
 * Model output, in the derived register, with the reserved ⊙ — the ONLY text register that has it.
 *
 * Announced as AI-generated to assistive technology too: the ⊙ and the left rule are both
 * invisible to a screen reader.
 */
export function AiText({
  children,
  model,
  as: Element = 'div',
  className,
}: AiTextProps): ReactNode {
  return (
    <Element
      className={classes('pt-ai', className)}
      data-register="ai"
      role="note"
      aria-label={`AI-generated${model === undefined ? '' : ` by ${model}`}, not the paper's words`}
    >
      <div className="pt-ai__header">
        <span className="pt-ai__marker" aria-hidden="true">
          {DERIVED_MARKER}
        </span>
        <span className="pt-ai__label">
          {model === undefined ? 'AI interpretation' : `AI · ${model}`}
        </span>
      </div>
      <div className="pt-ai__body">{children}</div>
    </Element>
  );
}
