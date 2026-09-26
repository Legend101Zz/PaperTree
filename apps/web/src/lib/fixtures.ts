/**
 * The reader's data layer, against the golden fixtures rather than the live parser.
 *
 * Epic 2 "builds entirely against `packages/document-ir/fixtures/` and never waits for the parser".
 * `scripts/copy-fixtures.mjs` stages the IR, the 29 rendered assets and the three real PDFs into
 * `public/fixtures/` on prebuild/predev/pretest, so everything below is a plain `fetch` of a
 * same-origin file.
 *
 * Loading lives in `lib/paperSource.ts::loadDocument`, the ONE loader for fixtures and API papers
 * alike; the duplicate `loadPaper` this file used to carry was removed in S4 (slice-plan §R, R8).
 * The fixtures are reachable only when `NEXT_PUBLIC_PAPERTREE_FIXTURES=on` (contracts.md §7).
 */

import type { PaperSource } from '@papertree/anchoring';

export const FIXTURE_SLUGS = [
  'attention-is-all-you-need',
  'neural-odes-mathheavy',
  'resnet-cvpr-2col',
] as const;

export type FixtureSlug = (typeof FIXTURE_SLUGS)[number];

/**
 * Human titles, for the library. Read from `Paper.metadata.title` at runtime rather than hardcoded
 * anywhere that matters; this map is only the pre-fetch placeholder the library shows while the IR
 * is still loading, so the cards do not pop.
 */
export const FIXTURE_TITLES: Record<FixtureSlug, string> = {
  'attention-is-all-you-need': 'Attention Is All You Need',
  'neural-odes-mathheavy': 'Neural Ordinary Differential Equations',
  'resnet-cvpr-2col': 'Deep Residual Learning for Image Recognition',
};

export function isFixtureSlug(value: string): value is FixtureSlug {
  return (FIXTURE_SLUGS as readonly string[]).includes(value);
}

export function pdfUrlFor(slug: FixtureSlug): string {
  return `/fixtures/${slug}.pdf`;
}

/**
 * The `text_stream_id` for a fixture-backed document.
 *
 * NOT a constant, and not omitted. It records WHICH extraction produced the offsets an anchor is
 * stored against — pdf.js alone yields two different text streams from one PDF depending on
 * `disableNormalization`. An anchor captured under one and resolved against the other is silently
 * wrong at T2, which is the tier that looks authoritative because it is cheap. Including the
 * fixture's own `ir_version` means a fixture rebuild invalidates the T0 caches rather than
 * silently reusing them.
 */
export function textStreamIdFor(paper: PaperSource & { ir_version?: string }): string {
  return `fixture/${paper.ir_version ?? 'unknown'}`;
}
