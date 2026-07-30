/**
 * anchoring/perturb — synthesise the "next parser version" that `reparse.spec` measures against.
 *
 * WHAT A RE-PARSE ACTUALLY DOES, and therefore what this must model.
 *
 * A new parser version does not rewrite the PDF. The glyphs are in the same places; the bytes are
 * immutable. What changes is the parser's OPINION about them:
 *
 *   • where a paragraph ends (merge / split) — the dominant effect, and the one measured at 42.2 %
 *     of ids retired corpus-wide, per-paper 14.9 % (`attention`) to 66.1 % (`a3c`);
 *   • the exact box it reports for a region (jitter of a few tenths of a point);
 *   • occasionally what a block IS (`paragraph` reclassified as `caption`).
 *
 * Every one of those changes `block_id`, because the formula hashes
 * `source_hash | page_index | q(x0) | q(y0) | block_type | normalise(text)[:8]`.
 *
 * IDS ARE RE-MINTED HERE, NOT INVENTED. Each perturbed block's id is recomputed with the REAL
 * `blockId()` from `@papertree/document-ir`, and its `content_hash` with the real
 * `contentHash()`. A harness that made up plausible-looking ids would measure its own imagination:
 * the whole question is whether the ID FORMULA's behaviour under perturbation is survivable, so the
 * formula has to be the one under test.
 *
 * THIS MODULE IS NODE-ONLY, deliberately. It imports the identity functions, which import
 * `node:crypto`. It is test and tooling support — Epic 1 can reuse it to score a real parser
 * upgrade — and it is exported from a separate entry point so that importing the RESOLVER into a
 * browser bundle does not drag a hash implementation in with it.
 *
 * DETERMINISM. Every choice is driven by a seeded PRNG, so a reported re-anchor rate is
 * reproducible and a regression is attributable. `Math.random()` would make the gate criterion a
 * different number on every run, which is not a criterion.
 */

import { blockId, contentHash, normaliseText } from '@papertree/document-ir';

import type { IndexedBlockSource, PaperSource } from './document.js';

/** A small, fast, seeded PRNG (mulberry32). Reproducibility is the whole requirement. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PerturbationKind =
  | 'merge_paragraphs'
  | 'split_paragraphs'
  | 'jitter_geometry'
  | 'retype_blocks'
  | 'text_noise'
  | 'all'
  | 'worst_case';

export interface PerturbOptions {
  readonly kind: PerturbationKind;
  readonly seed: number;
  /** Fraction of eligible sites perturbed, 0..1. */
  readonly rate?: number;
  /** Geometry jitter amplitude in points. The grid is 1.0 pt, so 0.6 pt flips buckets sometimes. */
  readonly jitterPt?: number;
}

export interface PerturbResult {
  readonly paper: PaperSource;
  readonly idsBefore: number;
  readonly idsRetired: number;
  readonly sites: number;
}

function reMint(block: IndexedBlockSource, sourceHash: string): IndexedBlockSource {
  const text = block.text ?? '';
  // `Paper.source_hash` is stored `"sha256:"`-prefixed and `blockId` REJECTS the prefixed form
  // rather than hashing it — passing it through would produce a complete, plausible, wrong id space.
  const bare = sourceHash.startsWith('sha256:') ? sourceHash.slice('sha256:'.length) : sourceHash;
  const bbox = block.bbox ?? [0, 0, 0, 0];
  const id = blockId({
    source_hash: bare,
    page_index: block.page_index,
    x0: bbox[0] as number,
    y0: bbox[1] as number,
    block_type: block.type,
    text,
  });
  return {
    ...block,
    block_id: id,
    ...(block.text === undefined
      ? {}
      : {
          text,
          text_normalised: normaliseText(text),
          content_hash: contentHash(text),
        }),
  };
}

/** Re-point every `parent_id` and every flow / section / relation id after a re-mint. */
function rewriteReferences(paper: PaperSource, rename: ReadonlyMap<string, string>): PaperSource {
  const map = (id: string): string => rename.get(id) ?? id;
  return {
    ...paper,
    pages: paper.pages.map((page) => ({
      ...page,
      ...(page.flows === undefined
        ? {}
        : {
            flows: Object.fromEntries(
              Object.entries(page.flows).map(([name, ids]) => [
                name,
                (ids as readonly string[]).map(map).filter((id, i, a) => a.indexOf(id) === i),
              ]),
            ),
          }),
    })),
    blocks: paper.blocks.map((block) => ({
      ...block,
      ...(block.parent_id === undefined || block.parent_id === null
        ? {}
        : { parent_id: map(block.parent_id) }),
    })),
    ...(paper.sections === undefined
      ? {}
      : {
          sections: paper.sections.map((s) => ({
            ...s,
            heading_block_id: map(s.heading_block_id),
            block_ids: s.block_ids.map(map).filter((id, i, a) => a.indexOf(id) === i),
            ...(s.parent_heading_block_id === undefined
              ? {}
              : { parent_heading_block_id: map(s.parent_heading_block_id) }),
          })),
        }),
  };
}

/**
 * Merge adjacent same-page, same-flow paragraphs.
 *
 * The merged block takes the FIRST paragraph's top-left anchor, which is exactly why merges are the
 * hard case for tier 1: the survivor keeps a valid-looking id whose text has changed underneath it.
 * That is the 11.73 % measured in `EPIC-00-RESULT` §4, and reproducing it faithfully is the point
 * of the harness — a merge that also moved the anchor would retire the id honestly and never
 * exercise the `content_hash` check at all.
 */
function mergeParagraphs(paper: PaperSource, rng: () => number, rate: number): PerturbResult {
  const blocks = [...paper.blocks];
  const rename = new Map<string, string>();
  const removed = new Set<string>();
  let sites = 0;

  for (let i = 0; i + 1 < blocks.length; i += 1) {
    const a = blocks[i] as IndexedBlockSource;
    const b = blocks[i + 1] as IndexedBlockSource;
    if (removed.has(a.block_id) || removed.has(b.block_id)) continue;
    if (a.type !== 'paragraph' || b.type !== 'paragraph') continue;
    if (a.page_index !== b.page_index) continue;
    if (a.text === undefined || b.text === undefined) continue;
    if (rng() > rate) continue;

    sites += 1;
    const abox = a.bbox ?? [0, 0, 0, 0];
    const bbox2 = b.bbox ?? [0, 0, 0, 0];
    // Hoisted out of the closure below: the `a.text === undefined` guard above narrows the property
    // access, but that narrowing does not survive into the arrow function that shifts the spans.
    const aText = a.text;
    const merged: IndexedBlockSource = {
      ...a,
      text: `${aText}\n${b.text}`,
      bbox: [
        Math.min(abox[0] as number, bbox2[0] as number),
        Math.min(abox[1] as number, bbox2[1] as number),
        Math.max(abox[2] as number, bbox2[2] as number),
        Math.max(abox[3] as number, bbox2[3] as number),
      ],
      // Concatenated spans, with the second block's offsets shifted past the first's text and the
      // joining newline. Without the shift every span past the seam points at the wrong characters
      // and the geometry tier would be measuring a bug in the harness.
      spans: [
        ...(a.spans ?? []),
        ...(b.spans ?? []).map((s) => ({
          ...s,
          start: s.start + aText.length + 1,
          end: s.end + aText.length + 1,
        })),
      ],
    };
    const minted = reMint(merged, paper.source_hash);
    blocks[i] = minted;
    rename.set(a.block_id, minted.block_id);
    rename.set(b.block_id, minted.block_id);
    removed.add(b.block_id);
    blocks.splice(i + 1, 1);
  }

  const kept = blocks.filter((b) => !removed.has(b.block_id));
  const next = rewriteReferences({ ...paper, blocks: kept }, rename);
  return {
    paper: next,
    idsBefore: paper.blocks.length,
    idsRetired: countRetired(paper, next),
    sites,
  };
}

/** Split a paragraph at a line break. The second half gets a NEW anchor and so a new id. */
function splitParagraphs(paper: PaperSource, rng: () => number, rate: number): PerturbResult {
  const out: IndexedBlockSource[] = [];
  const rename = new Map<string, string>();
  let sites = 0;

  for (const block of paper.blocks) {
    const text = block.text;
    const spans = block.spans ?? [];
    if (block.type !== 'paragraph' || text === undefined || spans.length < 4 || rng() > rate) {
      out.push(block);
      continue;
    }
    const at = Math.floor(spans.length / 2);
    const seam = spans[at];
    if (seam === undefined) {
      out.push(block);
      continue;
    }
    sites += 1;
    const cut = seam.start;
    const bbox = block.bbox ?? [0, 0, 0, 0];
    const seamBox = seam.bbox;

    const first = reMint(
      {
        ...block,
        text: text.slice(0, cut),
        bbox: [bbox[0] as number, bbox[1] as number, bbox[2] as number, seamBox[1] as number],
        spans: spans.slice(0, at),
      },
      paper.source_hash,
    );
    const second = reMint(
      {
        ...block,
        text: text.slice(cut),
        bbox: [bbox[0] as number, seamBox[1] as number, bbox[2] as number, bbox[3] as number],
        spans: spans.slice(at).map((s) => ({ ...s, start: s.start - cut, end: s.end - cut })),
      },
      paper.source_hash,
    );
    out.push(first, second);
    rename.set(block.block_id, first.block_id);
  }

  const next = rewriteReferences({ ...paper, blocks: out }, rename);
  return { paper: next, idsBefore: paper.blocks.length, idsRetired: countRetired(paper, next), sites };
}

/**
 * Nudge every block's geometry.
 *
 * The grid is 1.0 pt and `q(v) = floor(v / 1.0 + 0.5)`, so a jitter below 0.5 pt only sometimes
 * crosses a bucket boundary — which is the realistic case, and it is why the RESULT doc calls the
 * grid the weakest part of the id answer. Text is untouched, so this isolates the geometric half of
 * the formula.
 */
function jitterGeometry(paper: PaperSource, rng: () => number, amplitude: number): PerturbResult {
  const rename = new Map<string, string>();
  const blocks = paper.blocks.map((block) => {
    const bbox = block.bbox;
    if (bbox === undefined) return block;
    const dx = (rng() - 0.5) * 2 * amplitude;
    const dy = (rng() - 0.5) * 2 * amplitude;
    const moved: IndexedBlockSource = {
      ...block,
      bbox: [
        (bbox[0] as number) + dx,
        (bbox[1] as number) + dy,
        (bbox[2] as number) + dx,
        (bbox[3] as number) + dy,
      ],
      ...(block.polygon === undefined
        ? {}
        : { polygon: block.polygon.map((p) => [(p[0] as number) + dx, (p[1] as number) + dy]) }),
      ...(block.spans === undefined
        ? {}
        : {
            spans: block.spans.map((s) => ({
              ...s,
              bbox: [
                (s.bbox[0] as number) + dx,
                (s.bbox[1] as number) + dy,
                (s.bbox[2] as number) + dx,
                (s.bbox[3] as number) + dy,
              ],
            })),
          }),
    };
    const minted = reMint(moved, paper.source_hash);
    rename.set(block.block_id, minted.block_id);
    return minted;
  });
  const next = rewriteReferences({ ...paper, blocks }, rename);
  return { paper: next, idsBefore: paper.blocks.length, idsRetired: countRetired(paper, next), sites: blocks.length };
}

/** Reclassify blocks. `block_type` is in the id payload, so every reclassification retires an id. */
function retypeBlocks(paper: PaperSource, rng: () => number, rate: number): PerturbResult {
  const rename = new Map<string, string>();
  let sites = 0;
  const blocks = paper.blocks.map((block) => {
    if (block.type !== 'paragraph' || rng() > rate) return block;
    sites += 1;
    const minted = reMint({ ...block, type: 'caption' }, paper.source_hash);
    rename.set(block.block_id, minted.block_id);
    return minted;
  });
  const next = rewriteReferences({ ...paper, blocks }, rename);
  return { paper: next, idsBefore: paper.blocks.length, idsRetired: countRetired(paper, next), sites };
}

/**
 * Change the CHARACTERS, not just the boundaries.
 *
 * Every other perturbation here moves block edges and leaves the glyph stream alone, which makes T3
 * far easier than reality: the quote is guaranteed to still be present verbatim. A real extractor
 * upgrade does not offer that. Hypothesis's PDF path strips all whitespace before matching, with a
 * source comment saying text extracted from a PDF "by different PDF viewers, **including different
 * versions of PDF.js**, can often differ in the whitespace between characters and words" — and the
 * IR's own `text` is never de-hyphenated (61 line-break hyphens in `resnet` alone), so a parser
 * that STARTS de-hyphenating is a realistic and much harder upgrade.
 *
 * Four edits, each modelling a real extractor difference:
 *
 *   1. **de-hyphenation** — `transduc-\ntion` becomes `transduction`. The quote captured under the
 *      old parser contains the hyphen and the newline; the new document does not.
 *   2. **whitespace variation** — a run of spaces becomes one, or a space becomes a newline. This
 *      is the single most commonly reported extractor difference.
 *   3. **ligature re-expansion** — `ﬁ` becomes `fi`. Different font-mapping tables disagree.
 *   4. **quotation-mark folding** — curly quotes become straight ones.
 *
 * Note that `quotenorm.normaliseForMatch` already neutralises 1, 3 and 4 BY DESIGN, which is the
 * point of it: the harness proves that the design does what it claims rather than asserting it. 2
 * is the one that genuinely bites, because it changes offsets without changing appearance.
 */
function textNoise(paper: PaperSource, rng: () => number, rate: number): PerturbResult {
  const rename = new Map<string, string>();
  let sites = 0;
  const blocks = paper.blocks.map((block) => {
    const text = block.text;
    if (text === undefined || text.length === 0 || rng() > rate) return block;
    sites += 1;
    let next = text;
    next = next.replace(/([a-z])[-‐]\n([a-z])/g, '$1$2'); // 1. de-hyphenate
    next = next.replace(/ {2,}/g, ' '); // 2a. collapse space runs
    if (rng() < 0.3) next = next.replace(/ /g, (m) => (rng() < 0.05 ? '\n' : m)); // 2b. space -> newline
    next = next.replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff'); // 3
    next = next.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'); // 4
    if (next === text) return block;
    // Spans are dropped rather than re-derived: the harness cannot know where the new glyph runs
    // begin, and inventing offsets would make the geometry tier measure the harness. A block with
    // no spans still carries its polygon, which is what T4 uses.
    const { spans: _dropped, ...rest } = block;
    const minted = reMint({ ...rest, text: next }, paper.source_hash);
    rename.set(block.block_id, minted.block_id);
    return minted;
  });
  const next = rewriteReferences({ ...paper, blocks }, rename);
  return { paper: next, idsBefore: paper.blocks.length, idsRetired: countRetired(paper, next), sites };
}

function countRetired(before: PaperSource, after: PaperSource): number {
  const survivors = new Set(after.blocks.map((b) => b.block_id));
  return before.blocks.filter((b) => !survivors.has(b.block_id)).length;
}

/** Apply a perturbation. `'all'` composes every kind, which is the realistic parser upgrade. */
export function perturb(paper: PaperSource, options: PerturbOptions): PerturbResult {
  const rng = seededRandom(options.seed);
  const rate = options.rate ?? 0.5;
  const jitter = options.jitterPt ?? 0.6;
  switch (options.kind) {
    case 'merge_paragraphs':
      return mergeParagraphs(paper, rng, rate);
    case 'split_paragraphs':
      return splitParagraphs(paper, rng, rate);
    case 'jitter_geometry':
      return jitterGeometry(paper, rng, jitter);
    case 'retype_blocks':
      return retypeBlocks(paper, rng, rate);
    case 'text_noise':
      return textNoise(paper, rng, rate);
    case 'worst_case': {
      // Everything at once, at full rate, plus repeated merging so paragraph boundaries move far
      // more than one pass can move them. This is deliberately HARDER than any measured parser
      // upgrade — the corpus figure is 42.2 % of ids retired and this exceeds it — because the
      // useful question is not "does it pass the bar" but "where does it break".
      let current = paper;
      let sites = 0;
      for (let round = 0; round < 3; round += 1) {
        const merged = mergeParagraphs(current, rng, 0.9);
        sites += merged.sites;
        current = merged.paper;
      }
      const split = splitParagraphs(current, rng, 0.9);
      const noise = textNoise(split.paper, rng, 0.9);
      const jittered = jitterGeometry(noise.paper, rng, 1.4);
      const retyped = retypeBlocks(jittered.paper, rng, 0.5);
      return {
        paper: retyped.paper,
        idsBefore: paper.blocks.length,
        idsRetired: countRetired(paper, retyped.paper),
        sites: sites + split.sites + noise.sites + jittered.sites + retyped.sites,
      };
    }
    default: {
      const a = mergeParagraphs(paper, rng, rate);
      const b = splitParagraphs(a.paper, rng, rate);
      const c = textNoise(b.paper, rng, rate);
      const d = jitterGeometry(c.paper, rng, jitter);
      const e = retypeBlocks(d.paper, rng, rate * 0.3);
      return {
        paper: e.paper,
        idsBefore: paper.blocks.length,
        idsRetired: countRetired(paper, e.paper),
        sites: a.sites + b.sites + c.sites + d.sites + e.sites,
      };
    }
  }
}
