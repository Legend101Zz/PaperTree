/**
 * The Inspector's contract types — F3.5's answer schema as the reader sees it, and F3.6's
 * navigation target.
 *
 * WHY THE ANSWER SHAPE LOOKS LIKE THIS
 *
 * `findings.md` C4 records what v1 shipped: a response schema with no block ids at all, built from
 * ±200 raw characters of context. Nothing in it could be checked, so nothing in it was. Every
 * field below exists to make one specific unfalsifiable thing falsifiable:
 *
 *   `states` / `interpretation`  — the epic's hard rule is "interpretation is separated from what
 *       the paper states — in the schema *and* in the UI". Two fields, not one string with a
 *       convention about paragraph two. A single field cannot be rendered in two registers, and
 *       §11.4 requires that derived content never share a register with the paper.
 *
 *   `claims`  — the grounding verifier's per-claim verdict. The rule is "when grounding
 *       verification fails, the claim is FLAGGED, not deleted and not silently emitted". A
 *       `boolean` on each claim is the only shape that can express all three outcomes; a filtered
 *       list can express exactly one of them, and it is the wrong one.
 *
 *   `supportingBlockIds`  — non-empty by construction at the point of rendering, because
 *       `DerivedBlock` throws on an empty `derivedFrom`. That is deliberate: an ungrounded answer
 *       must not render at all rather than render unattributed.
 *
 *   `unresolvedAmbiguities`  — the epic asks for it explicitly. An answer that hides what it was
 *       unsure about is the failure mode that makes a confident wrong answer indistinguishable
 *       from a confident right one.
 *
 * NOTE ON `sourceRegions`. A region is carried as a resolved `Anchor`, never as a bare `block_id`.
 * The epic is unambiguous about why: "store an `Anchor`, never a bare `block_id` — that is
 * precisely what makes a citation survive a re-parse". A bare id is retired by any repair that
 * changes the block's content hash; the anchor's six selectors are what let T1b/T2/T3 find it
 * anyway.
 */

import type { Anchor, Resolution } from '@papertree/anchoring';

/**
 * One claim in an answer, with the verifier's verdict attached.
 *
 * `supported: false` is NOT a reason to drop the claim. It is a reason to render it differently
 * and say so — see `AnswerView`.
 */
export interface VerifiedClaim {
  readonly text: string;
  /** Block ids the verifier could actually match this claim against. May be empty. */
  readonly supportedBy: readonly string[];
  /** False means FLAGGED. The claim is still rendered; it is rendered as unsupported. */
  readonly supported: boolean;
  /** Why the verifier reached that verdict. Shown to the reader, not swallowed. */
  readonly reason: string | null;
}

/**
 * A citation the reader can click, carried as an anchor plus the verdict of resolving it.
 *
 * `resolution` is stored alongside rather than recomputed on click, because a chip that resolves
 * lazily can render as available and then fail — and "the citation chip did nothing" is precisely
 * the trust failure this epic exists to prevent. Resolve once, render the outcome.
 */
export interface Citation {
  /** Stable within one answer; used as the chip's key and its accessible name suffix. */
  readonly label: string;
  readonly anchor: Anchor;
  readonly resolution: Resolution;
  /**
   * What kind of thing is being cited. Reported separately in the measurement because Epic 1's
   * equation extents (#55) and figure regions (#51) are known-bad, so a blended accuracy number
   * would hide which half is broken.
   */
  readonly targetType: CitationTargetType;
}

/**
 * Deliberately NOT `Block['type']`. The IR's block type vocabulary is OPEN — any
 * `^[a-z][a-z0-9_]{0,63}$` string is valid — so a closed union over it would be wrong. These are
 * the buckets the citation-navigation metric is reported in, and `other` is a real bucket rather
 * than a fallback for something forgotten.
 */
export type CitationTargetType = 'text' | 'heading' | 'equation' | 'figure' | 'table' | 'other';

/** A grounded answer, as produced by F3.5's contract and consumed by the reader. */
export interface GroundedAnswer {
  /** What the paper states. Rendered in the source register's voice, attributed to blocks. */
  readonly states: string;
  /**
   * Our reading of it. Rendered in the derived register, separately labelled. `null` when the
   * answer is purely extractive — which is the honest common case and must not be faked.
   */
  readonly interpretation: string | null;
  /** Non-empty for any answer that renders. `DerivedBlock` enforces this at runtime. */
  readonly supportingBlockIds: readonly string[];
  readonly sourcePages: readonly number[];
  readonly sourceRegions: readonly Citation[];
  readonly confidence: number;
  readonly unresolvedAmbiguities: readonly string[];
  readonly claims: readonly VerifiedClaim[];
}

/**
 * The six contextual variants of F3.6.
 *
 * A discriminated union rather than a `kind` string plus optional fields, so that "an equation
 * variant with no equation block" is not representable. Epic 2's post-mortem is four instances of
 * an optional thing being absent at runtime; this is the cheapest place to not repeat it.
 */
export type InspectorContext =
  | { readonly kind: 'selection'; readonly blockIds: readonly string[]; readonly quote: string }
  | { readonly kind: 'equation'; readonly blockId: string }
  | { readonly kind: 'figure'; readonly blockId: string }
  | { readonly kind: 'table'; readonly blockId: string }
  | { readonly kind: 'citation'; readonly blockId: string }
  | { readonly kind: 'answer'; readonly answer: GroundedAnswer };

/** Progressive states of one ask. `error` carries a message the reader can act on. */
export type AskState =
  | { readonly status: 'idle' }
  | { readonly status: 'streaming'; readonly partial: string }
  | { readonly status: 'done'; readonly answer: GroundedAnswer }
  | { readonly status: 'error'; readonly message: string };

/**
 * Where answers come from.
 *
 * REQUIRED wherever it appears, never optional. This interface is the whole of #62's gap as the
 * reader sees it: nothing serves PaperIR over HTTP, so today the only implementation is
 * `fixtureAnswerSource`. When an endpoint lands, a second implementation satisfies this type and
 * the compiler names every call site that has to move — which is the property an optional prop
 * with a silent default would destroy.
 */
export interface AnswerSource {
  /**
   * Stream an answer. Implementations MUST call `onPartial` at least once before resolving, so a
   * consumer cannot accidentally test only the terminal state.
   */
  ask(
    request: AskRequest,
    onPartial: (text: string) => void,
    signal: AbortSignal,
  ): Promise<GroundedAnswer>;
}

export interface AskRequest {
  readonly question: string;
  readonly context: InspectorContext;
  readonly paperId: string;
}
