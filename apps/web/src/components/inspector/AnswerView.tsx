/**
 * An answer, rendered honestly.
 *
 * Three rules from the epic are enforced here, and each is enforced by structure rather than by
 * the author remembering:
 *
 * 1. **"Interpretation is separated from what the paper states — in the schema *and* in the UI."**
 *    `states` and `interpretation` are separate fields (see `types.ts`) and they render as separate
 *    regions with separate labels. There is no code path that concatenates them.
 *
 * 2. **"When grounding verification fails, the claim is FLAGGED, not deleted and not silently
 *    emitted."** Every claim renders. An unsupported one renders with `data-grounded="false"`, an
 *    explicit visible label, and the verifier's reason. Note what is NOT here: no `.filter()` over
 *    `claims`. Deleting an unsupported claim would satisfy "not silently emitted" while violating
 *    "not deleted", and it is the tempting implementation because the output looks cleaner.
 *
 * 3. **"Anything AI-derived carries the reserved marker, imported from `@papertree/ui` and never
 *    typed as a literal."** This file renders derived content only through `DerivedBlock`, which is
 *    the single component in the product allowed to emit `DERIVED_MARKER`. `provenance.spec` greps
 *    for exactly that, and a second copy in a second file is how a reserved mark quietly stops
 *    being reserved — so this file contains neither the glyph nor a re-implementation of the
 *    wrapper.
 *
 * WHY `DerivedBlock` AND NOT A LOCAL WRAPPER. `@papertree/ui`'s barrel docstring states the reason
 * plainly: `DerivedBlock` being the only route to the screen for derived content is what turns "is
 * every AI-derived region marked?" into a question a test can answer mechanically. Styling this
 * panel myself would have been easier and would have silently retired that property.
 *
 * `DerivedBlock` throws on an empty `derivedFrom`. That is relied upon rather than guarded around:
 * an answer that cannot name a source block must not render at all.
 */

import { DerivedBlock } from '@papertree/ui';
import type { ReactNode } from 'react';

import { CitationChip } from './CitationChip';
import type { Citation, GroundedAnswer } from './types';

export interface AnswerViewProps {
  readonly answer: GroundedAnswer;
  /** Navigate to a cited region. REQUIRED — see `CitationChip`. */
  readonly onNavigate: (citation: Citation) => void;
  /**
   * The return path every derived surface owes (IA §18.6: "no view is a dead end"). REQUIRED
   * because `DerivedBlock` requires it, and because an inert "show source" is worse than none.
   */
  readonly onShowSource: (blockIds: readonly string[]) => void;
}

export function AnswerView({ answer, onNavigate, onShowSource }: AnswerViewProps): ReactNode {
  const unsupported = answer.claims.filter((claim) => !claim.supported);

  return (
    <div className="pt-inspector__answer" data-inspector-variant="answer">
      {/*
        What the paper states. Inside DerivedBlock because even an extractive answer is a SELECTION
        made by a model — which blocks to quote is itself an interpretation, and presenting it in
        the source register would claim an authority the selection does not have.
      */}
      <DerivedBlock
        derivedFrom={answer.supportingBlockIds}
        onShowSource={onShowSource}
        kind="prose"
      >
        <p data-answer-states>{answer.states}</p>
      </DerivedBlock>

      {/*
        Our reading, separately. `kind="summary"` gives it a different label from the extractive
        part, so the two are distinguishable to a screen reader and not only visually. Rendered
        only when it exists — an absent interpretation is the honest common case and inventing a
        paragraph to fill the slot would be the exact failure this separation exists to prevent.
      */}
      {answer.interpretation === null ? null : (
        <DerivedBlock
          derivedFrom={answer.supportingBlockIds}
          onShowSource={onShowSource}
          kind="summary"
          className="pt-inspector__interpretation"
        >
          <p data-answer-interpretation>{answer.interpretation}</p>
        </DerivedBlock>
      )}

      {/*
        Flagged claims. Rendered as a region with role="note" so it is announced, not merely
        coloured. `reader/a11y.spec`'s standing complaint about visual-only state applies here more
        than anywhere else in the panel: "this sentence is not supported by the sources" is not
        decoration.
      */}
      {unsupported.length > 0 ? (
        <section
          className="pt-inspector__flagged"
          role="note"
          aria-label={`${String(unsupported.length)} claim${unsupported.length === 1 ? '' : 's'} not supported by the cited sources`}
          data-flagged-count={String(unsupported.length)}
        >
          <h3>Not supported by the cited sources</h3>
          <ul>
            {unsupported.map((claim, index) => (
              <li key={`${String(index)}:${claim.text.slice(0, 32)}`} data-grounded="false">
                <span data-claim-text>{claim.text}</span>
                {claim.reason === null ? null : <small data-claim-reason>{claim.reason}</small>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Citations. Every one, including the orphans — see CitationChip's header. */}
      <nav className="pt-inspector__citations" aria-label="Citations">
        {answer.sourceRegions.map((citation) => (
          <CitationChip key={citation.label} citation={citation} onNavigate={onNavigate} />
        ))}
      </nav>

      {/*
        What the answer was unsure about. The epic asks for `unresolved ambiguities` in the schema;
        a schema field that never reaches the screen is a field nobody reads.
      */}
      {answer.unresolvedAmbiguities.length > 0 ? (
        <section className="pt-inspector__ambiguities" aria-label="Unresolved ambiguities">
          <h3>Unresolved</h3>
          <ul>
            {answer.unresolvedAmbiguities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
