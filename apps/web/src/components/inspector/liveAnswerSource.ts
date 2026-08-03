/**
 * The live `AnswerSource` — #76, and the sentence it deletes from four other files.
 *
 * `fixtureAnswerSource`'s header, `Inspector`'s header, `types.ts`'s `AnswerSource` docstring and
 * `ReaderWorkspace`'s Inspector slot all said the same thing: *"nothing in this repository serves
 * PaperIR over HTTP, so the only implementation is `fixtureAnswerSource`"*. `services/api` now
 * serves `POST /papers/{id}/ask`, so this is the second implementation those comments predicted,
 * and it satisfies the same interface with no change to it.
 *
 * THE FIXTURE SOURCE STAYS, and not out of sentiment. It is the offline path: a fixture paper has
 * no `paper_id` on any server, so there is nothing for `/ask` to be asked ABOUT. `ReaderWorkspace`
 * picks by `PaperRef.kind` for that reason — `api` gets this, `fixture` gets the fixture — which is
 * a property of the document rather than a new flag. (`NEXT_PUBLIC_PAPERTREE_FIXTURES` gates
 * DOCUMENTS, not answers; it is not consulted here, and nothing new is added to it.)
 *
 * WHY THE ANCHOR IS MINTED HERE AND NOT SENT
 *
 * `@papertree/anchoring` is TypeScript-only. Python can describe a citable region — block id, page,
 * bbox, label — but cannot mint the six selectors an `Anchor` carries, which is issue #72 and is
 * measured: a citation stored as a bare `block_id` survives a re-parse **3.3 %** of the time and an
 * `Anchor` **100 %**. So the server sends the ADDRESS and `captureCitation` mints the anchor here,
 * against the very `IndexedDocument` the reader is looking at. That is not a workaround for the
 * missing package; it is the only place the anchor CAN be correct, because an anchor minted against
 * a different parse than the one on screen is an anchor that resolves to the wrong place.
 *
 * WHY IT DOES NOT REALLY STREAM, SAID PLAINLY RATHER THAN FAKED
 *
 * `AnswerSource.ask` requires `onPartial` to be called at least once before resolving, so that a
 * consumer cannot ship a streaming UI it never exercised. `/ask` is a single JSON response — the
 * tool loop runs server-side and there is no SSE — so the obligation is honoured once, with the
 * finished `states` text, immediately before resolving. Splitting that text into artificial
 * fragments would make the panel look like it was streaming from a model when it was not, which is
 * the same class of lie as a progress bar that is not measuring anything.
 */

import type { IndexedDocument } from '@papertree/anchoring';

import { papersApi, type WireAnswer } from '@/lib/papertree';

import { captureCitation } from './citations';
import { contextBlockIds } from './fixtureAnswerSource';
import type { AnswerSource, Citation, GroundedAnswer } from './types';

export interface LiveAnswerSourceOptions {
  /** The parse on screen. Citations are minted against THIS document, never against another. */
  readonly doc: IndexedDocument;
  /**
   * The clock an `Anchor`'s `created.at` is stamped from. Injectable so a test is deterministic
   * without freezing global time; a wall clock is the right default for a real answer.
   */
  readonly at?: () => string;
  readonly client?: string;
}

/**
 * Build an `AnswerSource` that asks `services/api` for a grounded answer.
 *
 * Throws — rather than returning a degraded answer — when the server refuses. `Inspector` catches
 * it and renders `status: 'error'` with the message, which for this endpoint is a real sentence:
 * "no model credential is configured: set PAPERTREE_LLM_API_KEY", "the model's answer violates the
 * answer contract and was NOT patched into shape", and so on. EPIC-03 §4's rule has a reader-facing
 * half: a failed generation is never persisted as content AND never silently dropped.
 */
export function createLiveAnswerSource(options: LiveAnswerSourceOptions): AnswerSource {
  const { doc, at = () => new Date().toISOString(), client = 'papertree-web/inspector' } = options;

  return {
    async ask(request, onPartial, signal): Promise<GroundedAnswer> {
      const blockIds = contextBlockIds(request);
      if (blockIds.length === 0) {
        // Not a network failure and not worth a round trip: `/ask` requires at least one seed
        // block, and an ask with none cannot be grounded in anything.
        throw new Error(
          'Nothing is selected to ask about. An answer that cannot name a source block must not render.',
        );
      }

      const { answer } = await papersApi.ask(
        request.paperId,
        { question: request.question, block_ids: [...blockIds] },
        signal,
      );

      // The streaming obligation, honoured once. See the header on why it is not fragmented.
      onPartial(answer.states);
      if (signal.aborted) throw new Error('aborted');

      return { ...toGroundedAnswer(answer, doc, at, client) };
    },
  };
}

/**
 * Wire answer -> `GroundedAnswer`. The one conversion, so nobody casts across the gap.
 *
 * A region whose block is absent from THIS parse is dropped rather than rendered as a dead chip:
 * `captureAnchor` throws for a block it cannot find, and that would take the whole panel down for
 * one stale id. The claim citing it is still present and still carries the verifier's reason, so
 * the reader is told — the information is not lost, only the unclickable chip is.
 */
function toGroundedAnswer(
  answer: WireAnswer,
  doc: IndexedDocument,
  at: () => string,
  client: string,
): GroundedAnswer {
  const citations: Citation[] = answer.sourceRegions
    .filter((region) => doc.byId.has(region.blockId))
    .map((region, index) =>
      captureCitation({
        doc,
        blockId: region.blockId,
        label: region.label.length > 0 ? region.label : String(index + 1),
        id: `ask-citation-${String(index + 1)}`,
        at: at(),
        client,
      }),
    );

  return {
    states: answer.states,
    interpretation: answer.interpretation,
    supportingBlockIds: answer.supportingBlockIds,
    sourcePages: answer.sourcePages,
    sourceRegions: citations,
    confidence: answer.confidence,
    unresolvedAmbiguities: answer.unresolvedAmbiguities,
    // Passed through unfiltered. `AnswerView` renders an unsupported claim differently and says
    // why; dropping one here would be the "verifier that filters" `test_grounding_verifier.py`
    // exists to catch, moved one language across the wire.
    claims: answer.claims,
  };
}
