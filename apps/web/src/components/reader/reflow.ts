/**
 * reader/reflow — re-export. The implementation moved to `@papertree/anchoring`.
 *
 * WHY IT MOVED. `anchoring/cross-mode.spec` requires a highlight captured in Source to resolve in
 * Guided, and Guided text is not the block's text: `reflow` removes line breaks and repairs the
 * typesetter's hyphens, so code-point offset 40 in `Block.text` is not offset 40 in the paragraph
 * the reader sees. The resolver therefore needs the same transformation the view uses — and needs
 * the map back, which only the transformation itself can produce.
 *
 * Keeping a copy here and another in the resolver would be two answers to "what does this paragraph
 * say", and the day they disagree the symptom is a highlight drawn in the wrong place. So the
 * functions live in `packages/anchoring/src/guided.ts`, `GuidedView` renders from
 * `projectGuided(doc)`, and this file exists only so the existing import paths keep working.
 *
 * `reflow.spec.ts` still imports from here and still passes unchanged — which is the point: the
 * behaviour is identical, the offset map is new, and there is now exactly one implementation.
 *
 * The moved code also stopped using `String.charAt`, which counts UTF-16 code units. `Anchor
 * .offsetUnit` is `'unicode'` and every offset in this package is code points; the two agree on the
 * BMP and diverge the moment a paper contains an astral character, which a mathematics paper does.
 */

export {
  joinContinuedBlocks,
  joinContinuedBlocksWithMap,
  reflow,
  reflowPreservingLines,
  reflowWithMap,
} from '@papertree/anchoring';
export type { JoinResult, JoinedSegment, ReflowResult } from '@papertree/anchoring';
