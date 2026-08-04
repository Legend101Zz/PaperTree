/**
 * The Inspector — EPIC 3 F3.6.
 *
 * A barrel with a purpose beyond tidiness: `test/reachable.spec.ts` walks the import graph from
 * `src/app/**` and requires every file under `src/components/**` to be in the transitive closure.
 * This file is itself one of those files, so it must be reached too — `ReaderWorkspace.tsx` imports
 * from here, and everything below is reachable through it.
 *
 * The ledger route was available and is not taken. `ORPHAN_LEDGER` is for components another epic
 * owns (all nine current entries are Epic 5's canvas, #43); adding `components/inspector/**` to it
 * to go green would be using a debt register to record a feature that simply was not wired, which
 * is the failure #58 and #59 already were.
 */

export { Inspector, isRenderable } from './Inspector';
export type { InspectorProps } from './Inspector';

export { AnswerView } from './AnswerView';
export type { AnswerViewProps } from './AnswerView';

export { CitationChip } from './CitationChip';
export type { CitationChipProps } from './CitationChip';

export { captureCitation, classifyTarget, isNavigable } from './citations';
export type { CaptureCitationInput } from './citations';

export { contextBlockIds, createFixtureAnswerSource } from './fixtureAnswerSource';
export type { FixtureAnswerSourceOptions } from './fixtureAnswerSource';

export { createLiveAnswerSource } from './liveAnswerSource';
export type { LiveAnswerSourceOptions } from './liveAnswerSource';

export type {
  AnswerSource,
  AskRequest,
  AskState,
  Citation,
  CitationTargetType,
  GroundedAnswer,
  InspectorContext,
  VerifiedClaim,
} from './types';
