/**
 * Shared fixture loading for the anchoring suite.
 *
 * The three golden `Paper` documents are read from `packages/document-ir/fixtures/` by path rather
 * than through the package's exports map, which does not expose them. They are 199 hand-checked
 * blocks over 10 of 45 pages and they are the ONLY input this epic builds against — no live parser.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PaperSource } from '../src/document.js';

export const FIXTURE_SLUGS = [
  'attention-is-all-you-need',
  'neural-odes-mathheavy',
  'resnet-cvpr-2col',
] as const;

export type FixtureSlug = (typeof FIXTURE_SLUGS)[number];

const FIXTURE_DIR = fileURLToPath(
  new URL('../../document-ir/fixtures/', import.meta.url),
);

export function loadFixture(slug: FixtureSlug): PaperSource {
  return JSON.parse(
    readFileSync(`${FIXTURE_DIR}${slug}.paperir.json`, 'utf8'),
  ) as PaperSource;
}

export function loadAllFixtures(): { slug: FixtureSlug; paper: PaperSource }[] {
  return FIXTURE_SLUGS.map((slug) => ({ slug, paper: loadFixture(slug) }));
}
