/**
 * The only `AnswerSource` that exists today, and a deliberate statement of #62 rather than a
 * workaround for it.
 *
 * WHY THIS IS NOT A LIVE CLIENT. Nothing in this repository serves PaperIR over HTTP. Verified
 * independently while picking up this epic: `services/document-worker/**` has no HTTP surface at
 * all, and `apps/api` is the v1 MongoDB app that never imports `papertree_db` — its own
 * `papers/routes.py` docstring says so. So there is no endpoint for a live client to call, and
 * inventing one here would put a second copy of that gap in a package that does not own it. The
 * epic is explicit that `apps/web/src/lib/fixtures.ts` must not be widened for the same reason.
 *
 * WHY IT STILL STREAMS, AND WHY IT IS DETERMINISTIC. `AnswerSource.ask` requires at least one
 * `onPartial` call before resolving. That obligation exists so a consumer cannot accidentally test
 * only the terminal state and ship a streaming UI that was never exercised streaming — the
 * `useSelectionCapture` failure mode one layer up. This implementation honours it, and produces
 * byte-identical output for identical input so the Inspector's tests are not timing-dependent.
 *
 * WHAT IT DOES NOT DO. It does not call a model, so it measures nothing about grounding quality.
 * It exists so the Inspector is reachable, interactive and testable end-to-end within the reader,
 * which is a real property and the one Epic 2's post-mortem says gets skipped. `EPIC-03-RESULT.md`
 * records F3.6 as wired to a fixture source rather than a live agent; that is stated rather than
 * rounded up.
 */

import type { IndexedDocument } from '@papertree/anchoring';

import { captureCitation } from './citations';
import type { AnswerSource, AskRequest, Citation, GroundedAnswer } from './types';

/**
 * Block ids the context refers to, whatever variant it is.
 *
 * EXPORTED because `liveAnswerSource` needs exactly this and a second copy would drift the moment
 * `InspectorContext` gained a seventh variant — the switch is exhaustive, so TypeScript names the
 * one place to edit, and only if there IS one place.
 */
export function contextBlockIds(request: AskRequest): readonly string[] {
  const context = request.context;
  switch (context.kind) {
    case 'selection':
      return context.blockIds;
    case 'equation':
    case 'figure':
    case 'table':
    case 'citation':
      return [context.blockId];
    case 'answer':
      return context.answer.supportingBlockIds;
  }
}

export interface FixtureAnswerSourceOptions {
  readonly doc: IndexedDocument;
  /**
   * Fixed clock and id source. REQUIRED: an anchor carries `created.at`, so a wall-clock default
   * would make every captured anchor differ between runs and quietly make the tests that compare
   * them non-deterministic.
   */
  readonly at: string;
  readonly client: string;
}

/**
 * Build a deterministic fixture answer source over one indexed document.
 *
 * The answer it produces is extractive: `states` is the resolved text of the cited blocks, and
 * `interpretation` is `null`. That is not a placeholder for something better — it is the honest
 * output of a source that has no model, and rendering `null` is what keeps the
 * interpretation-vs-source separation truthful when there is no interpretation to show.
 */
export function createFixtureAnswerSource(options: FixtureAnswerSourceOptions): AnswerSource {
  const { doc, at, client } = options;

  return {
    async ask(request, onPartial, signal): Promise<GroundedAnswer> {
      const blockIds = contextBlockIds(request).filter((id) => doc.byId.has(id));
      if (blockIds.length === 0) {
        throw new Error(
          'No cited block in this parse. An answer that cannot name a source block must not render.',
        );
      }

      const citations: Citation[] = blockIds.map((blockId, index) =>
        captureCitation({
          doc,
          blockId,
          label: String(index + 1),
          id: `fixture-citation-${String(index + 1)}`,
          at,
          client,
        }),
      );

      const states = blockIds
        .map((id) => doc.byId.get(id)?.text ?? '')
        .filter((text) => text.length > 0)
        .join(' ');

      // The streaming obligation, honoured in one chunk. Splitting it into artificial fragments
      // would simulate latency the fixture does not have and make the tests slower without making
      // them stronger.
      onPartial(states);
      if (signal.aborted) throw new Error('aborted');

      const pages = [
        ...new Set(
          citations
            .map((citation) => citation.resolution.pageIndex)
            .filter((page): page is number => page !== null),
        ),
      ].sort((a, b) => a - b);

      return {
        states,
        // No model, therefore no interpretation. See the header.
        interpretation: null,
        supportingBlockIds: blockIds,
        sourcePages: pages,
        sourceRegions: citations,
        // Extractive quoting of blocks that exist is the one thing this source can be certain of.
        confidence: 1,
        unresolvedAmbiguities: [],
        claims: blockIds.map((id) => ({
          text: doc.byId.get(id)?.text ?? '',
          supportedBy: [id],
          supported: true,
          reason: null,
        })),
      };
    },
  };
}
