/**
 * Builds `test/cases/*.json` — the SHARED corpus the three validators are judged against.
 *
 * Every case already asserted in `test/schema.spec.ts` (the F0.2 acceptance test) is seeded here,
 * so ajv, Zod and Pydantic are tested against the same body of evidence as the schema itself
 * rather than against a fresh, weaker set of examples someone invented for the bindings. A second
 * group of cases is added for the three constructs F0.3 had to encode by hand (open vocabularies,
 * conditional payloads, `additionalProperties: false`) and for the nullable-vs-optional rule
 * (DESIGN.md D11), because those are where a binding can diverge from the schema.
 *
 * Each case file is `{name, schema, expect, reason, origin, document}`. `expect` is the RECORDED
 * verdict; `test/equivalence.spec.ts` additionally asserts that ajv agrees with it, so a wrong
 * recording is caught rather than propagated.
 *
 * Rebuild with: pnpm exec tsx codegen/build-corpus.ts
 * The corpus is committed; it is data, not a generated binding, so `codegen-drift.spec` does not
 * cover it.
 */
/* oxlint-disable typescript/no-explicit-any -- the corpus is deliberately untyped JSON: the whole
   point is to feed the validators shapes the generated types forbid. */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES = join(PKG, 'test/cases');

/**
 * `1e400` parses to Infinity, satisfies `exclusiveMinimum: 0`, and re-serialises as `null`. It
 * cannot survive `JSON.stringify`, so it is written into the case files as raw JSON text via this
 * sentinel. Both `JSON.parse` (JS) and `json.loads` (Python) read it back as infinity.
 */
const RAW_INFINITY = '__RAW_1e400__';

/**
 * `JSON.stringify` cannot write the literals this corpus needs to feed the validators: it turns
 * `1.0` into `1` and `9007199254740993` into `9007199254740992`, which is exactly the difference
 * the case exists to test. `raw()` reserves a sentinel that is substituted with verbatim JSON text
 * at write time, so the file on disk carries the literal and BOTH parsers read the same bytes.
 */
const RAW_LITERALS: string[] = [];
function raw(jsonText: string): string {
  RAW_LITERALS.push(jsonText);
  return `__RAW_LITERAL_${RAW_LITERALS.length - 1}__`;
}

// ---------------------------------------------------------------------------------------------
// The worked example, extracted from DESIGN.md exactly as test/schema.spec.ts extracts it.
// ---------------------------------------------------------------------------------------------

function workedExample(): any {
  const md = readFileSync(join(PKG, 'DESIGN.md'), 'utf8');
  const start = md.indexOf('<!-- BEGIN worked-example -->');
  const end = md.indexOf('<!-- END worked-example -->');
  if (start < 0 || end < 0) throw new Error('worked-example markers missing from DESIGN.md');
  const fenced = md.slice(start, end);
  return JSON.parse(fenced.slice(fenced.indexOf('```json') + 7, fenced.lastIndexOf('```')));
}

const EXAMPLE = workedExample();

const ID = {
  title: 'blk_7k2m4qx3tz5b6d7f',
  para: 'blk_a3c5e7g2j4m6p7r2',
  inline: 'blk_f2h4k6n2q4s6u2w4',
  figure: 'blk_b4d6f2h4k6n2q4s6',
  caption: 'blk_c5e7g3j5m7p3r5t7',
  equation: 'blk_d6f2h4k6n2q4s6u2',
  unknown: 'blk_e7g3j5m7p3r5t7v3',
} as const;

const DERIVATION = {
  derivation_id: 'drv_01JQ8ZD7Y5V3WCP7S4MFXZ8JBG',
  paper_id: 'ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE',
  kind: 'guided_section',
  author: {
    kind: 'model',
    model_id: 'anthropic/claude-haiku-4.5',
    prompt_hash: 'sha256:1f2e3d4c5b6a7988',
  },
  content: 'Residual learning reframes each block as learning a correction to the identity.',
  derived_from: [ID.para, ID.equation],
  created_at: '2026-07-30T09:20:00Z',
};

function paper(mutate?: (p: any) => void): any {
  const p = structuredClone(EXAMPLE);
  mutate?.(p);
  return p;
}

function blockOf(p: any, id: string): any {
  const b = p.blocks.find((x: any) => x.block_id === id);
  if (!b) throw new Error(`no such block in the worked example: ${id}`);
  return b;
}

function plainBlock(over: Record<string, unknown> = {}): any {
  return {
    block_id: 'blk_z2z3z4z5z6z7z2z3',
    type: 'paragraph',
    page_index: 1,
    polygon: [
      [54, 600],
      [292, 600],
      [292, 640],
      [54, 640],
    ],
    bbox: [54, 600, 292, 640],
    flow: 'body',
    order: 2,
    doc_order: 5,
    text: 'A perfectly ordinary sentence read out of the text layer.',
    source: 'pdf_text_layer',
    confidence: 0.9,
    provenance: { parser: 'pdfium-deterministic', stage: 'layout+text' },
    ...over,
  };
}

function withExtraBlock(b: any): any {
  return paper((p) => {
    p.blocks.push(b);
    p.pages[1].block_ids.push(b.block_id);
    p.pages[1].flows.body.push(b.block_id);
  });
}

const modelRepair = (over: Record<string, unknown> = {}) => ({
  kind: 'vlm_substitution',
  applied: false,
  at: 0,
  from: 'We explicitly',
  to: 'We formally',
  model_id: 'anthropic/claude-opus-4',
  prompt_hash: 'sha256:0a1b2c3d4e5f6071',
  confidence: 0.8,
  ...over,
});

const setRepair = (r: unknown) =>
  paper((p) => {
    blockOf(p, ID.para).repairs = [r];
  });

const setAlts = (alts: unknown[]) =>
  paper((p) => {
    blockOf(p, ID.para).alternatives = alts;
  });

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

/**
 * A KNOWN, DELIBERATE disagreement between ajv and the two generated bindings.
 *
 * `expect` is always the ajv (i.e. the schema's) verdict. When the generated bindings are
 * deliberately stricter — because the schema's answer is a crash, or because it blesses a document
 * that cannot be serialised — the case records what each binding says instead. The equivalence
 * suites ASSERT these values; they do not skip the case. If a divergence is ever closed the
 * assertion goes red and the annotation has to be deleted, which is the point: a documented
 * divergence is acceptable, a stale one is not.
 *
 * Every `class` here must appear in DESIGN.md §12.
 */
interface Divergence {
  class: string;
  zod: 'valid' | 'invalid';
  pydantic: 'valid' | 'invalid';
  why: string;
}

interface Case {
  name: string;
  schema: 'paperir' | 'derivation';
  expect: 'valid' | 'invalid';
  reason: string;
  origin: string;
  document: unknown;
  divergence?: Divergence;
}

const cases: Case[] = [];
const SPEC = 'test/schema.spec.ts';
const F03 = 'F0.3 codegen — construct coverage';
const ATTACK = 'F0.3 differential attack — three-validator divergence';

function add(
  name: string,
  expect: 'valid' | 'invalid',
  reason: string,
  document: unknown,
  origin = SPEC,
  schema: 'paperir' | 'derivation' = 'paperir',
): void {
  cases.push({ name, schema, expect, reason, origin, document });
}

/** A hostile case from the differential attack whose three verdicts agree. */
function attack(
  name: string,
  expect: 'valid' | 'invalid',
  reason: string,
  document: unknown,
  schema: 'paperir' | 'derivation' = 'paperir',
): void {
  cases.push({ name, schema, expect, reason, origin: ATTACK, document });
}

/** A hostile case whose three verdicts do NOT agree, and are pinned one by one. */
function diverging(
  name: string,
  ajv: 'valid' | 'invalid',
  reason: string,
  document: unknown,
  divergence: Divergence,
): void {
  cases.push({
    name,
    schema: 'paperir',
    expect: ajv,
    reason,
    origin: ATTACK,
    document,
    divergence,
  });
}

const addDerivation = (
  name: string,
  expect: 'valid' | 'invalid',
  reason: string,
  document: unknown,
  origin = SPEC,
): void => add(name, expect, reason, document, origin, 'derivation');

// --- the worked example ------------------------------------------------------------------------
add('worked-example', 'valid', 'DESIGN.md §8 — the documented example must not drift', EXAMPLE);
addDerivation('worked-example-derivation', 'valid', 'the matching Derivation', DERIVATION);

// --- forward compatibility: unknown TYPES validate ----------------------------------------------
add(
  'unknown-block-type',
  'valid',
  'a block type this version has never seen validates (D2, named acceptance criterion)',
  withExtraBlock(plainBlock({ type: 'totally_new_type_v2' })),
);
add(
  'unknown-relation-type',
  'valid',
  'a relation type this version has never seen validates (D2)',
  paper((p) => {
    p.relations.push({
      type: 'brand_new_relation_v9',
      from: ID.para,
      to: ID.equation,
      confidence: 0.5,
      provenance: 'experimental',
    });
  }),
);
add(
  'unknown-type-carries-payload',
  'valid',
  'an unknown block type may carry its own payload data',
  withExtraBlock(plainBlock({ type: 'marginal_gloss_v2', payload: { column: 3, is_boxed: true } })),
);
addDerivation('unknown-derivation-kind', 'valid', 'a Derivation of an unknown kind validates', {
  ...DERIVATION,
  kind: 'brand_new_kind_v9',
});
add(
  'ir-version-1-4-0',
  'valid',
  'any 1.x validates (D10)',
  paper((p) => (p.ir_version = '1.4.0')),
);
add(
  'ir-version-2-0-0',
  'invalid',
  'a 2.x document must not validate (D10)',
  paper((p) => (p.ir_version = '2.0.0')),
);
add(
  'block-type-capitalised',
  'invalid',
  "type strings are identifiers, so 'Equation' cannot evade the payload rules (D2)",
  withExtraBlock(plainBlock({ type: 'Equation' })),
);
add(
  'block-type-trailing-space',
  'invalid',
  "'equation ' is a near-miss that would evade the required crop (D2)",
  withExtraBlock(plainBlock({ type: 'equation ' })),
);
add(
  'block-type-non-ascii',
  'invalid',
  'non-ASCII type strings are rejected (D2)',
  withExtraBlock(plainBlock({ type: '某_new_type' })),
);

// --- geometry is never discarded -----------------------------------------------------------------
add(
  'block-missing-polygon',
  'invalid',
  'a block missing polygon fails (named acceptance criterion)',
  paper((p) => {
    delete blockOf(p, ID.para).polygon;
  }),
);
for (const [label, bad] of [
  ['null', null],
  ['empty', []],
  ['one-vertex', [[0, 0]]],
  [
    'two-vertices',
    [
      [0, 0],
      [1, 1],
    ],
  ],
] as const) {
  add(
    `polygon-${label}`,
    'invalid',
    'a polygon needs at least 3 vertices and may not be null',
    paper((p) => {
      blockOf(p, ID.para).polygon = bad;
    }),
  );
}
add(
  'polygon-513-vertices',
  'invalid',
  'vertex count is bounded at 512 (D22)',
  paper((p) => {
    blockOf(p, ID.para).polygon = Array.from({ length: 513 }, (_, i) => [i % 600, 700]);
  }),
);
add(
  'point-three-numbers',
  'invalid',
  'a point is exactly two numbers',
  paper((p) => {
    blockOf(p, ID.para).polygon[0] = [1, 2, 3];
  }),
);
add(
  'point-strings',
  'invalid',
  'coordinates are numbers — the case that catches lax Pydantic coercion of "1" to 1.0',
  paper((p) => {
    blockOf(p, ID.para).polygon[0] = ['1', '2'];
  }),
);
add(
  'bbox-five-numbers',
  'invalid',
  'a bbox is exactly four numbers',
  paper((p) => {
    blockOf(p, ID.para).bbox = [1, 2, 3, 4, 5];
  }),
);
add(
  'polygon-infinity',
  'invalid',
  '1e400 parses to Infinity and re-serialises as null; bounds reject it (D22)',
  paper((p) => {
    blockOf(p, ID.para).polygon[0][0] = RAW_INFINITY;
  }),
);
add(
  'page-width-infinity',
  'invalid',
  '1e400 as a page width is rejected (D22)',
  paper((p) => (p.pages[0].width = RAW_INFINITY)),
);
add(
  'page-user-unit-infinity',
  'invalid',
  '1e400 as user_unit is rejected (D22)',
  paper((p) => (p.pages[0].user_unit = RAW_INFINITY)),
);
for (const r of [45, -90, 360]) {
  add(
    `page-rotation-${r}`,
    'invalid',
    'rotation is one of 0/90/180/270',
    paper((p) => (p.pages[0].rotation = r)),
  );
}
for (const [label, u] of [
  ['zero', 0],
  ['negative', -1],
  ['denormal', 1e-9],
] as const) {
  add(
    `page-user-unit-${label}`,
    'invalid',
    'user_unit is bounded to [0.001, 1000]',
    paper((p) => (p.pages[0].user_unit = u)),
  );
}
for (const [label, w] of [
  ['zero', 0],
  ['negative', -612],
  ['huge', 1e6],
] as const) {
  add(
    `page-width-${label}`,
    'invalid',
    'page width is bounded > 0 and <= 20000',
    paper((p) => (p.pages[0].width = w)),
  );
}
add(
  'coordinate-space-viewport',
  'invalid',
  'coordinate_space is the one permitted constant (D5)',
  paper((p) => (p.coordinate_space = 'viewport_pixels')),
);

// --- LLM-authored text in a source field fails ---------------------------------------------------
for (const s of ['llm', 'model', 'vlm']) {
  add(
    `block-source-${s}`,
    'invalid',
    `Block.source may not be '${s}' (named acceptance criterion, D3)`,
    paper((p) => {
      blockOf(p, ID.para).source = s;
    }),
  );
}
for (const s of ['pdf_text_layer', 'pdf_vector', 'pdf_raster', 'ocr']) {
  add(
    `block-source-${s}`,
    'valid',
    'all four transcription kinds are accepted',
    paper((p) => {
      blockOf(p, ID.para).source = s;
    }),
  );
}
add(
  'block-generated-by',
  'invalid',
  "a Block may not be stamped 'generated_by' (additionalProperties:false)",
  paper((p) => {
    blockOf(p, ID.para).generated_by = 'gpt-4';
  }),
);
add(
  'paper-extra-summary',
  'invalid',
  'a Paper may not carry an extra field',
  paper((p) => (p.summary = 'a model-written abstract')),
);
add(
  'relation-extra-field',
  'invalid',
  'a Relation may not carry an extra field',
  paper((p) => (p.relations[0].generated_by = 'gpt-4')),
);
add(
  'section-title-field',
  'invalid',
  'Section has no title, so an LLM-invented section title is unrepresentable',
  paper((p) => (p.sections[0].title = 'Introduction, explained')),
);
add(
  'metadata-missing-source-block',
  'invalid',
  'a metadata value cannot exist without the block it was read from (D6)',
  paper((p) => {
    delete p.metadata.title.source_block_id;
  }),
);
add(
  'metadata-bare-string',
  'invalid',
  'a metadata value cannot be a bare string (D6)',
  paper((p) => (p.metadata.title = 'Deep Residual Learning')),
);
add(
  'equation-symbol-gloss',
  'invalid',
  'an EquationSymbol cannot carry a model-written gloss (D9)',
  paper((p) => {
    blockOf(p, ID.equation).payload.symbols = [
      { symbol: '\\mathcal{F}', definition_block: ID.para, gloss: 'the residual mapping' },
    ];
  }),
);

// --- Block.payload is closed against derivation smuggling ----------------------------------------
add(
  'payload-generated-by',
  'invalid',
  "an unknown type's payload may not be stamped 'generated_by' (D22, ModelFreeSubtree)",
  withExtraBlock(plainBlock({ type: 'guided_paragraph', payload: { generated_by: 'gpt-4' } })),
);
add(
  'payload-whole-derivation',
  'invalid',
  'a whole Derivation does not fit inside a payload (D22)',
  withExtraBlock(plainBlock({ type: 'guided_paragraph', payload: { ...DERIVATION } })),
);
add(
  'payload-nested-derivation',
  'invalid',
  'a Derivation nested arbitrarily deep inside a payload does not fit either (recursive)',
  withExtraBlock(
    plainBlock({
      type: 'guided_paragraph',
      payload: { wrapper: { items: [{ derivations: [DERIVATION] }] } },
    }),
  ),
);
add(
  'payload-model-author',
  'invalid',
  'a model-authored block masquerading as a new type is rejected',
  withExtraBlock(
    plainBlock({
      type: 'guided_paragraph',
      payload: {
        author: { kind: 'model', model_id: 'anthropic/claude-opus-4', prompt_hash: 'sha256:beef' },
        content: '<model prose>',
        render_as: 'source',
      },
    }),
  ),
);
add(
  'payload-non-identifier-key',
  'invalid',
  'payload keys must be identifiers (propertyNames)',
  withExtraBlock(plainBlock({ type: 'marginal_gloss_v2', payload: { 'Not An Ident': 1 } })),
);
add(
  'figure-payload-smuggling',
  'invalid',
  "a figure block's payload must be a FigurePayload",
  paper((p) => {
    blockOf(p, ID.figure).payload = { generated_by: 'gpt-4' };
  }),
);

// --- repairs: the LLM never overwrites source -----------------------------------------------------
add(
  'repair-vlm-applied',
  'invalid',
  'a vlm_substitution may not be applied (D4)',
  setRepair(modelRepair({ applied: true })),
);
add(
  'repair-ocr-applied',
  'invalid',
  'an ocr_correction may not be applied (D4)',
  setRepair(modelRepair({ kind: 'ocr_correction', applied: true })),
);
add(
  'repair-model-without-model-id',
  'invalid',
  'a model-authored repair must name its model (D4)',
  setRepair(modelRepair({ model_id: undefined })),
);
add(
  'repair-model-without-prompt-hash',
  'invalid',
  'a model-authored repair must name its prompt (D4)',
  setRepair(modelRepair({ prompt_hash: undefined })),
);
add(
  'repair-model-proposed',
  'valid',
  'an unapplied, fully attributed model repair is accepted',
  setRepair(modelRepair()),
);
add(
  'repair-deterministic-with-model-id',
  'invalid',
  'a DETERMINISTIC repair may not name a model (D4, review finding: FATAL)',
  setRepair({
    kind: 'dehyphenate',
    applied: true,
    at: 49,
    from: 'resid-\nual',
    to: 'residual',
    model_id: 'gpt-4o',
  }),
);
add(
  'repair-deterministic-with-prompt-hash',
  'invalid',
  'a DETERMINISTIC repair may not name a prompt (D4)',
  setRepair({
    kind: 'whitespace',
    applied: true,
    at: 0,
    from: 'We  explicitly',
    to: 'We explicitly',
    prompt_hash: 'sha256:0a1b2c3d4e5f6071',
  }),
);
add(
  'repair-deterministic-ok',
  'valid',
  'an ordinary deterministic repair is accepted',
  setRepair({ kind: 'ligature', applied: true, at: 0, from: 'reﬂ', to: 'refl' }),
);
add(
  'repair-missing-applied',
  'invalid',
  '`applied` is required',
  setRepair({ kind: 'ligature', from: 'a', to: 'b' }),
);
add(
  'repair-unknown-kind',
  'invalid',
  'RepairKind is a closed vocabulary — it is a safety enum',
  setRepair({ kind: 'llm_rewrite', applied: false, from: 'a', to: 'b' }),
);
add(
  'repair-kind-trailing-space',
  'invalid',
  "'vlm_substitution ' is not a RepairKind",
  setRepair({ kind: 'vlm_substitution ', applied: false, from: 'a', to: 'b' }),
);
add(
  'repair-missing-from',
  'invalid',
  '`from` is required, so the original always survives',
  setRepair({ kind: 'ligature', applied: true, to: 'refl' }),
);

// --- alternatives: a model may argue, never decide -------------------------------------------------
add(
  'alternative-model-selected',
  'invalid',
  'a model-authored alternative cannot be the selected reading (D8)',
  setAlts([
    {
      parser: 'openai/gpt-4o',
      authored_by: 'model',
      text: '<model prose>',
      confidence: 0.99,
      decision: 'selected',
      rule: 'prefer_llm_when_ocr_conf<0.9',
    },
  ]),
);
add(
  'alternative-model-not-selected',
  'valid',
  'a model-authored alternative that lost is legitimate evidence (D8)',
  setAlts([
    {
      parser: 'vlm-repair',
      authored_by: 'model',
      text: "<the model's reading>",
      confidence: 0.88,
      decision: 'not_selected',
    },
  ]),
);
add(
  'alternative-missing-authored-by',
  'invalid',
  'authored_by is required (D8)',
  setAlts([{ parser: 'docling', confidence: 0.7, decision: 'not_selected' }]),
);
add(
  'alternative-authored-by-human',
  'invalid',
  'authored_by is closed: parser | model',
  setAlts([{ parser: 'docling', authored_by: 'human', confidence: 0.7, decision: 'not_selected' }]),
);
add(
  'alternative-missing-decision',
  'invalid',
  'decision is required (D8)',
  setAlts([{ parser: 'docling', authored_by: 'parser', confidence: 0.7 }]),
);

// --- specialised payloads ---------------------------------------------------------------------------
add(
  'figure-missing-payload',
  'invalid',
  'a figure block must carry a payload (conditional payload)',
  paper((p) => {
    delete blockOf(p, ID.figure).payload;
  }),
);
add(
  'equation-payload-missing-image',
  'invalid',
  'an equation payload must state whether its crop exists (D16)',
  paper((p) => {
    delete blockOf(p, ID.equation).payload.image;
  }),
);
add(
  'figure-payload-image-null',
  'valid',
  'a crop that has not been rendered yet is explicitly null, never invented (D16)',
  paper((p) => {
    blockOf(p, ID.figure).payload.image = null;
  }),
);
add(
  'inline-equation-opaque-payload',
  'invalid',
  'inline_equation shares EquationPayload rather than falling through to the opaque branch (D19)',
  paper((p) => {
    blockOf(p, ID.inline).payload = { latex: 'x', not_a_field: true };
  }),
);
add(
  'image-uri-data-scheme',
  'invalid',
  'an image URI must name a non-inline scheme — PaperIR never embeds pixel bytes',
  paper((p) => {
    blockOf(p, ID.figure).payload.image.uri = 'data:image/webp;base64,AAAA';
  }),
);
add(
  'image-uri-bare-path',
  'invalid',
  'an image URI must carry an explicit scheme',
  paper((p) => {
    blockOf(p, ID.figure).payload.image.uri = '/local/path.webp';
  }),
);
add(
  'detected-label-missing-source',
  'invalid',
  'figure interior text carries the same provenance as any other transcription',
  paper((p) => {
    delete blockOf(p, ID.figure).payload.detected_labels[0].source;
  }),
);
add(
  'detected-label-missing-confidence',
  'invalid',
  'figure interior text carries a confidence',
  paper((p) => {
    delete blockOf(p, ID.figure).payload.detected_labels[0].confidence;
  }),
);
add(
  'figure-panel-missing-provenance',
  'invalid',
  'a FigurePanel carries a source and a confidence',
  paper((p) => {
    blockOf(p, ID.figure).payload.panels = [
      {
        label: '(a)',
        polygon: [
          [1, 1],
          [2, 1],
          [2, 2],
        ],
      },
    ];
  }),
);

// --- generation identity ------------------------------------------------------------------------------
add(
  'paper-missing-generation',
  'invalid',
  'a Paper must state which parse generation it is (D13)',
  paper((p) => {
    delete p.generation;
  }),
);
add(
  'generation-zero',
  'invalid',
  'generations are 1-based (D13)',
  paper((p) => (p.generation = 0)),
);
add(
  'generation-seven',
  'valid',
  'generation 7 is a legitimate re-parse',
  paper((p) => (p.generation = 7)),
);

// --- no field a real parser must fabricate -------------------------------------------------------------
for (const s of ['pending', 'parsing']) {
  add(
    `status-${s}`,
    'invalid',
    'pending/parsing are job states, not document states (D15)',
    paper((p) => (p.status = s)),
  );
}
for (const s of ['partial', 'complete', 'failed']) {
  add(
    `status-${s}`,
    'valid',
    'the three document states',
    paper((p) => (p.status = s)),
  );
}
add(
  'confidence-null-on-failed-parse',
  'valid',
  "'no calibrated estimate' is statable rather than faked as 0 (D21)",
  paper((p) => {
    p.status = 'failed';
    p.partial_reason = 'page tree unreadable';
    p.confidence.overall = null;
    p.confidence.by_page = [null, null];
  }),
);
add(
  'unknown-block-no-text',
  'valid',
  'an unclassified region with geometry and no text is as expressible as a title',
  withExtraBlock(plainBlock({ type: 'unknown', text: undefined })),
);

// --- one canonical encoding of 'none' -------------------------------------------------------------------
add(
  'empty-child-ids',
  'invalid',
  'an empty optional array is invalid — omit it instead (D11)',
  paper((p) => {
    blockOf(p, ID.title).child_ids = [];
  }),
);
add(
  'empty-repairs',
  'invalid',
  'an empty optional array is invalid — omit it instead (D11)',
  paper((p) => {
    blockOf(p, ID.para).repairs = [];
  }),
);
add(
  'missing-partial-reason',
  'invalid',
  'nullable fields are required, so absence is always stated (D11)',
  paper((p) => {
    delete p.partial_reason;
  }),
);
add(
  'missing-page-image',
  'invalid',
  'nullable fields are required, so absence is always stated (D11)',
  paper((p) => {
    delete p.pages[0].image;
  }),
);
add(
  'short-content-hash',
  'invalid',
  'a digest must be long enough to be a digest (D22)',
  paper((p) => {
    blockOf(p, ID.para).content_hash = 'x:0';
  }),
);

// --- spans ------------------------------------------------------------------------------------------------
add(
  'span-role-not-identifier',
  'invalid',
  'span roles are identifiers, like every other open vocabulary (D17)',
  paper((p) => {
    blockOf(p, ID.para).spans[2].role = 'Inline Equation';
  }),
);
add(
  'span-block-id-native',
  'invalid',
  'span.block_id must have the block-id shape, not an upstream positional pointer',
  paper((p) => {
    blockOf(p, ID.para).spans[2].block_id = '#/texts/47';
  }),
);

// --- source and derivation are different stores --------------------------------------------------------------
add(
  'derivation-in-blocks',
  'invalid',
  'a Derivation cannot be pushed into paper.blocks[] (Commitment 1)',
  paper((p) => p.blocks.push({ ...DERIVATION })),
);
addDerivation(
  'derivation-author-human',
  'invalid',
  'a Derivation must be model-authored — there is no human or source option',
  { ...DERIVATION, author: { ...DERIVATION.author, kind: 'human' } },
);
addDerivation(
  'derivation-empty-derived-from',
  'invalid',
  'a Derivation must point at at least one source block',
  {
    ...DERIVATION,
    derived_from: [],
  },
);
addDerivation('derivation-missing-derived-from', 'invalid', 'derived_from is required', {
  ...DERIVATION,
  derived_from: undefined,
});
addDerivation(
  'derivation-extra-field',
  'invalid',
  'a Derivation rejects unknown fields, like everything else',
  {
    ...DERIVATION,
    rendered_as: 'source',
  },
);
addDerivation(
  'block-in-derivation-store',
  'invalid',
  'a PaperIR Block cannot be smuggled into the derivation store either',
  structuredClone(EXAMPLE.blocks.find((b: any) => b.block_id === ID.para)),
);

// --- documented gaps: these validate ON PURPOSE ----------------------------------------------------------------
add(
  'gap-model-prose-as-ocr',
  'valid',
  "model prose in Block.text with source:'ocr' validates — DESIGN.md §11.1, owned by the Epic 1 lint",
  paper((p) => {
    const b = blockOf(p, ID.para);
    b.source = 'ocr';
    b.text = 'In this landmark contribution the authors demonstrate, with remarkable clarity.';
  }),
);
add(
  'gap-wrong-space-polygon',
  'valid',
  'a wrong-space polygon inside the CropBox validates — DESIGN.md §11.3, owned by F0.4',
  paper((p) => {
    blockOf(p, ID.para).polygon = [
      [54, 552],
      [292, 552],
      [292, 672],
      [54, 672],
    ];
    blockOf(p, ID.para).bbox = [54, 552, 292, 672];
  }),
);
add(
  'gap-enriched-reference',
  'valid',
  'an externally-enriched Reference validates — DESIGN.md §5.2 rule 35 owns it',
  paper((p) => {
    p.references.push({
      reference_entry_block_id: ID.unknown,
      title: 'Attention Is All You Need (supplied by Crossref, not printed here)',
      year: 2017,
      confidence: 1,
    });
  }),
);
add(
  'gap-bbox-contradicts-polygon',
  'valid',
  'a bbox contradicting its polygon validates — DESIGN.md §5.2 rule 1 owns it',
  paper((p) => {
    blockOf(p, ID.para).bbox = [0, 0, 1, 1];
  }),
);
add(
  'gap-new-figure-type-escapes-crop',
  'valid',
  'a new block type escapes the required crop — but not the authorship closure',
  withExtraBlock(plainBlock({ type: 'figure_v2', payload: { is_vector: false } })),
);

// --- the block-id tripwire (DESIGN.md §11.0) ---------------------------------------------------------------------
add(
  'tripwire-uppercase-block-id',
  'invalid',
  "ADR-001 Amendment 1's conformance vectors are uppercase and this schema's pattern is lowercase — DESIGN.md §11.0",
  withExtraBlock(plainBlock({ block_id: 'blk_7USUVPRFZ34OQA5T' })),
);

// ---------------------------------------------------------------------------------------------
// F0.3-specific cases: the three constructs, and nullable-vs-optional.
// ---------------------------------------------------------------------------------------------

add(
  'open-vocab-max-length-type',
  'valid',
  'the identifier pattern allows 64 characters',
  withExtraBlock(plainBlock({ type: `a${'b'.repeat(63)}` })),
  F03,
);
add(
  'open-vocab-too-long-type',
  'invalid',
  'the identifier pattern stops at 64 characters',
  withExtraBlock(plainBlock({ type: `a${'b'.repeat(64)}` })),
  F03,
);
add(
  'open-vocab-numeric-relation-type',
  'invalid',
  'a type must start with a letter',
  paper((p) => {
    p.relations.push({
      type: '9lives',
      from: ID.para,
      to: ID.equation,
      confidence: 0.5,
      provenance: 'x',
    });
  }),
  F03,
);
add(
  'conditional-table-payload',
  'valid',
  'a table block carries a TablePayload; its nested cells are ordinary blocks (D14)',
  withExtraBlock(
    plainBlock({
      type: 'table',
      block_id: 'blk_t2t3t4t5t6t7t2t3',
      payload: {
        table_number: '1',
        grid: {
          rows: 1,
          cols: 2,
          cells: [
            {
              cell_id: 'blk_c2c3c4c5c6c7c2c3',
              r: 0,
              c: 0,
              polygon: [
                [1, 1],
                [2, 1],
                [2, 2],
              ],
              text: 'a',
              is_header: true,
            },
            {
              cell_id: 'blk_c3c4c5c6c7c2c3c4',
              r: 0,
              c: 1,
              polygon: [
                [2, 1],
                [3, 1],
                [3, 2],
              ],
              text: 'b',
            },
          ],
        },
      },
    }),
  ),
  F03,
);
add(
  'conditional-table-payload-wrong-shape',
  'invalid',
  'a table block may not carry an equation payload — the branch is by type, not by best fit',
  withExtraBlock(
    plainBlock({
      type: 'table',
      block_id: 'blk_t2t3t4t5t6t7t2t3',
      payload: { display: true, image: null },
    }),
  ),
  F03,
);
add(
  'conditional-equation-payload-extra-field',
  'invalid',
  'additionalProperties:false holds inside a conditional payload too',
  paper((p) => {
    blockOf(p, ID.equation).payload.rendered_by = 'gpt-4o';
  }),
  F03,
);
add(
  'strict-nested-table-cell-extra-field',
  'invalid',
  'additionalProperties:false holds three levels down (Block > TablePayload > TableGrid > TableCell)',
  withExtraBlock(
    plainBlock({
      type: 'table',
      block_id: 'blk_t2t3t4t5t6t7t2t3',
      payload: {
        grid: {
          rows: 1,
          cols: 1,
          cells: [
            {
              cell_id: 'blk_c2c3c4c5c6c7c2c3',
              r: 0,
              c: 0,
              polygon: [
                [1, 1],
                [2, 1],
                [2, 2],
              ],
              generated_by: 'gpt-4',
            },
          ],
        },
      },
    }),
  ),
  F03,
);
add(
  'strict-span-extra-field',
  'invalid',
  'additionalProperties:false holds on Span',
  paper((p) => {
    blockOf(p, ID.para).spans[0].kerning = 1.2;
  }),
  F03,
);
add(
  'strict-provenance-extra-field',
  'invalid',
  'additionalProperties:false holds on Provenance',
  paper((p) => {
    blockOf(p, ID.para).provenance.prompt = 'summarise this';
  }),
  F03,
);
add(
  'strict-flows-extra-key',
  'invalid',
  'Flows is closed: a seventh flow is a major version, not an extra key',
  paper((p) => (p.pages[0].flows.float = [])),
  F03,
);
add(
  'nullable-optional-doc-order-null',
  'invalid',
  'optional scalars are NEVER nullable — omit doc_order instead (D11)',
  paper((p) => {
    blockOf(p, ID.para).doc_order = null;
  }),
  F03,
);
add(
  'nullable-optional-text-null',
  'invalid',
  'optional scalars are NEVER nullable — omit text instead (D11)',
  paper((p) => {
    blockOf(p, ID.para).text = null;
  }),
  F03,
);
add(
  'nullable-optional-payload-null',
  'invalid',
  'Block.payload is optional, so it is never null (D11)',
  withExtraBlock(plainBlock({ type: 'marginal_gloss_v2', payload: null })),
  F03,
);
add(
  'nullable-required-metadata-null',
  'valid',
  'a nullable field is required and explicitly null (D11)',
  paper((p) => (p.metadata.title = null)),
  F03,
);
add(
  'nullable-required-overall-null',
  'invalid',
  'confidence.overall is nullable but not optional (D11)',
  paper((p) => {
    delete p.confidence.overall;
  }),
  F03,
);
add(
  'format-date-time-space-separator',
  'valid',
  'ajv-formats accepts a space separator in date-time',
  paper((p) => (p.parser.parsed_at = '2026-07-30 09:14:22Z')),
  F03,
);
add(
  'format-date-time-offset',
  'valid',
  'a numeric UTC offset is a legal date-time',
  paper((p) => (p.parser.parsed_at = '2026-07-30T09:14:22.5+05:30')),
  F03,
);
add(
  'format-date-time-no-timezone',
  'invalid',
  'date-time requires a time zone',
  paper((p) => (p.parser.parsed_at = '2026-07-30T09:14:22')),
  F03,
);
add(
  'format-date-time-bad-day',
  'invalid',
  '2026-02-30 is not a date; formats must validate, not merely document',
  paper((p) => (p.parser.parsed_at = '2026-02-30T09:14:22Z')),
  F03,
);
add(
  'format-date-time-bad-hour',
  'invalid',
  '25:00:00 is not a time',
  paper((p) => (p.parser.parsed_at = '2026-07-30T25:00:00Z')),
  F03,
);
add(
  'format-date-time-leap-second',
  'valid',
  '23:59:60Z is a leap second and ajv-formats accepts it',
  paper((p) => (p.parser.parsed_at = '2026-06-30T23:59:60Z')),
  F03,
);
add(
  'format-date-time-not-a-date',
  'invalid',
  'an arbitrary string is not a date-time',
  paper((p) => (p.parser.parsed_at = 'yesterday')),
  F03,
);
addDerivation(
  'derivation-content-null',
  'valid',
  'Derivation.content is the empty schema: it accepts anything, including null',
  { ...DERIVATION, content: null },
  F03,
);
addDerivation(
  'derivation-content-missing',
  'invalid',
  "Derivation.content is required even though it accepts anything — the case Zod's z.unknown() would silently pass",
  (() => {
    const d: Record<string, unknown> = { ...DERIVATION };
    delete d.content;
    return d;
  })(),
  F03,
);
addDerivation(
  'derivation-content-object',
  'valid',
  'Derivation.content is unconstrained on purpose (R15)',
  { ...DERIVATION, content: { sections: [{ text: '…', derived_from: [ID.para] }] } },
  F03,
);
addDerivation(
  'derivation-bad-created-at',
  'invalid',
  'created_at is a date-time in the second schema file too',
  { ...DERIVATION, created_at: '2026-13-01T00:00:00Z' },
  F03,
);

// ---------------------------------------------------------------------------------------------
// The differential attack (F0.3). 347 hostile documents were run through ajv, Zod and Pydantic
// side by side; these are the shapes on which the three did NOT agree, plus the near misses that
// were probed and found clean and are therefore worth keeping green. Appended rather than
// interleaved so the numbering of the cases above does not churn.
// ---------------------------------------------------------------------------------------------

// --- §12.1 `__proto__`: the key JSON.parse makes OWN and z.record silently deleted --------------

/**
 * A copy of `obj` carrying a real OWN `__proto__` key.
 *
 * `{ __proto__: v }` in an object literal SETS THE PROTOTYPE and creates no key at all, which is
 * precisely why this vector is easy to miss: only `JSON.parse` (and this) produce the own property
 * that `Object.keys` reports and `JSON.stringify` writes back out.
 */
function ownProto<T extends object>(obj: T, value: unknown): any {
  const out: any = { ...obj };
  Object.defineProperty(out, '__proto__', {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return out;
}

const payloadBlock = (payload: unknown, type = 'marginal_gloss_v2'): any =>
  withExtraBlock(plainBlock({ type, payload }));

attack(
  'proto-payload-model-authorship',
  'invalid',
  'a model-authorship declaration hidden under __proto__: propertyNames rejects the key and ModelFreeSubtree rejects the subtree',
  payloadBlock(ownProto({}, { generated_by: 'gpt-4', model_id: 'claude' })),
);
attack(
  'proto-payload-bare',
  'invalid',
  '__proto__ is not an identifier-shaped payload key, whatever it carries',
  payloadBlock(ownProto({ ok: 1 }, { a: 1 })),
);
attack(
  'proto-payload-whole-derivation',
  'invalid',
  'a complete Derivation under __proto__ — ADR-001 Commitment 1 must hold through EVERY binding, not only through ajv',
  payloadBlock(ownProto({}, { derivation_id: DERIVATION.derivation_id, derived_from: [ID.para] })),
);
attack(
  'proto-inside-equation-payload',
  'invalid',
  '__proto__ inside the CLOSED EquationPayload: additionalProperties:false must see the key JSON.parse actually created',
  paper((p) => {
    const b = blockOf(p, ID.equation);
    b.payload = ownProto(b.payload, { generated_by: 'gpt-4' });
  }),
);
attack(
  'proto-as-block-key',
  'invalid',
  '__proto__ as an extra key on a strict object — the .strict() path, which was already sound',
  withExtraBlock(ownProto(plainBlock(), { x: 1 })),
);
attack(
  'constructor-payload-key',
  'valid',
  '`constructor` matches the payload identifier pattern and is legitimately valid — the fix must not over-reject',
  withExtraBlock(plainBlock({ type: 'marginal_gloss_v2', payload: { constructor: 1 } })),
);

// --- §12.2 `\s` means three different things in three regex engines -----------------------------

const withUri = (jsonStringLiteral: string): any =>
  paper((p) => {
    p.pages[0].image.uri = raw(jsonStringLiteral);
  });

attack(
  'uri-whitespace-feff',
  'invalid',
  "U+FEFF is in ECMA-262 \\s but NOT in Unicode White_Space, so pydantic's Rust regex accepted it until codegen expanded the class",
  withUri('"r2://a\\ufeffb.webp"'),
);
attack(
  'uri-whitespace-nel',
  'valid',
  'U+0085 is in Unicode White_Space but NOT in ECMA-262 \\s — the same bug in the opposite direction; ajv and Zod accept it, so Pydantic must too',
  withUri('"r2://a\\u0085b.webp"'),
);
attack(
  'uri-whitespace-nbsp',
  'invalid',
  'U+00A0 is whitespace to every engine',
  withUri('"r2://a\\u00a0b.webp"'),
);
attack(
  'uri-whitespace-line-separator',
  'invalid',
  'U+2028 is whitespace to every engine',
  withUri('"r2://a\\u2028b.webp"'),
);
attack(
  'uri-whitespace-tab',
  'invalid',
  'a tab is whitespace to every engine',
  withUri('"r2://a\\tb.webp"'),
);
attack(
  'uri-whitespace-none',
  'valid',
  'the control: a clean URI must still validate after the class expansion',
  withUri('"r2://papers/ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE/pages/000@2x.webp"'),
);

// --- §12.3 JSON Schema "integer" is a NUMBER with no fractional part ----------------------------

attack(
  'integer-generation-float-literal',
  'valid',
  '`"generation": 1.0` is an integer to JSON Schema; strict Pydantic refused it until codegen added the JsonInt before-validator',
  paper((p) => (p.generation = raw('1.0'))),
);
attack(
  'integer-generation-exponent-literal',
  'valid',
  '`1e0` is the same integer written the way a Go or numpy producer writes it',
  paper((p) => (p.generation = raw('1e0'))),
);
attack(
  'integer-page-index-float-literal',
  'valid',
  '10e-1 is 1 — every integer field in the schema has this exposure, not just the root one',
  paper((p) => {
    p.pages[1].index = raw('10e-1');
    for (const b of p.blocks) if (b.page_index === 1) b.page_index = raw('1.0');
  }),
);
attack(
  'integer-rotation-float-literal',
  'valid',
  'an integer ENUM written as a float: the JsonInt conversion must happen before the _one_of membership test',
  paper((p) => (p.pages[0].rotation = raw('0.0'))),
);
attack(
  'integer-block-order-float-literal',
  'valid',
  'blocks[].order and doc_order as floats — the fields a re-ordering pipeline computes',
  paper((p) => {
    const b = blockOf(p, ID.para);
    b.order = raw(`${b.order}.0`);
    b.doc_order = raw(`${b.doc_order}.0`);
  }),
);
attack(
  'integer-generation-fractional',
  'invalid',
  '1.5 is NOT an integer: the before-validator converts, it does not truncate',
  paper((p) => (p.generation = raw('1.5'))),
);
attack(
  'integer-rotation-bool',
  'invalid',
  '`False == 0` in Python, so a bool must still be rejected after JsonInt is introduced',
  paper((p) => (p.pages[0].rotation = false)),
);
attack(
  'integer-generation-beyond-safe-range',
  'valid',
  '9007199254740993 validates in all three, but JS holds 9007199254740992 — a VALUE divergence, not a verdict one (DESIGN.md §12.8)',
  paper((p) => (p.generation = raw('9007199254740993'))),
);

// --- §12.5 lone surrogates: the bindings are deliberately stricter than ajv ---------------------

diverging(
  'lone-surrogate-constrained-string',
  'valid',
  'an unpaired surrogate in a patterned string: legal JSON, not encodable as UTF-8',
  paper((p) => (p.parser.name = raw('"a\\ud800b"'))),
  {
    class: 'lone-surrogate',
    zod: 'invalid',
    pydantic: 'invalid',
    why: 'both bindings reject unpaired surrogates in every string; ajv accepts them. DESIGN.md §12.5.',
  },
);
diverging(
  'lone-surrogate-unconstrained-string',
  'valid',
  'the same surrogate in an UNCONSTRAINED string, where pydantic-core used to accept it — the binding must not disagree with itself',
  paper((p) => (blockOf(p, ID.para).text = raw('"a\\udc00b"'))),
  {
    class: 'lone-surrogate',
    zod: 'invalid',
    pydantic: 'invalid',
    why: 'both bindings reject unpaired surrogates in every string; ajv accepts them. DESIGN.md §12.5.',
  },
);
attack(
  'astral-pair-string',
  'valid',
  'a WELL-formed surrogate pair is an ordinary character and must stay valid in all three',
  paper((p) => (blockOf(p, ID.para).text = raw('"a\\ud83d\\ude00b"'))),
);

// --- §12.6 payload nesting is bounded, because the alternative is a stack overflow ---------------

const nested = (depth: number): unknown => {
  let value: unknown = { leaf: 1 };
  for (let i = 0; i < depth; i += 1) value = { a: value };
  return value;
};

attack(
  'payload-depth-at-limit',
  'valid',
  '64 levels is exactly MAX_PAYLOAD_DEPTH and must validate in all three',
  withExtraBlock(plainBlock({ type: 'marginal_gloss_v2', payload: nested(64) })),
);
diverging(
  'payload-depth-over-limit',
  'valid',
  '65 levels: ajv still says valid here, but at ~1600 it stops answering at all and THROWS, so the bindings answer with a bound instead of a stack',
  withExtraBlock(plainBlock({ type: 'marginal_gloss_v2', payload: nested(65) })),
  {
    class: 'payload-depth',
    zod: 'invalid',
    pydantic: 'invalid',
    why: "the bindings bound opaque payload nesting at MAX_PAYLOAD_DEPTH=64; the schema states no bound and ajv's is its C stack. DESIGN.md §12.6.",
  },
);

// --- probed and CLEAN: seams that could have diverged and did not --------------------------------

attack(
  'opaque-payload-null-value',
  'valid',
  'a null inside an opaque payload is not an object and must not trip the model-free walk',
  withExtraBlock(plainBlock({ type: 'marginal_gloss_v2', payload: { a: null, b: [null] } })),
);
attack(
  'opaque-payload-array-root',
  'invalid',
  'Block.payload is `type: "object"`, so an array is not a payload — the openObject() replacement for z.record must keep rejecting it',
  withExtraBlock(plainBlock({ type: 'marginal_gloss_v2', payload: [1, 2] })),
);
attack(
  'block-type-trailing-newline-again',
  'invalid',
  "ECMA `$` does not match before a trailing newline and Python's `re` does — pinned here because the pattern expansion touched the same code path",
  withExtraBlock(plainBlock({ type: 'paragraph\n' })),
);

// ---------------------------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------------------------

const seen = new Set<string>();
for (const c of cases) {
  if (seen.has(c.name)) throw new Error(`duplicate case name: ${c.name}`);
  seen.add(c.name);
}

mkdirSync(CASES, { recursive: true });
for (const stale of readdirSync(CASES).filter((f) => f.endsWith('.json'))) {
  rmSync(join(CASES, stale));
}

cases.forEach((c, i) => {
  const id = String(i + 1).padStart(3, '0');
  let body = JSON.stringify(c, null, 2).replaceAll(`"${RAW_INFINITY}"`, '1e400');
  RAW_LITERALS.forEach((literal, n) => {
    body = body.replaceAll(`"__RAW_LITERAL_${n}__"`, literal);
  });
  if (body.includes('__RAW_LITERAL_')) throw new Error(`${c.name}: unsubstituted raw literal`);
  writeFileSync(join(CASES, `${id}-${c.name}.json`), `${body}\n`, 'utf8');
});

process.stdout.write(
  `corpus: wrote ${cases.length} cases to test/cases ` +
    `(${cases.filter((c) => c.expect === 'valid').length} valid, ` +
    `${cases.filter((c) => c.expect === 'invalid').length} invalid; ` +
    `${cases.filter((c) => c.origin === SPEC).length} seeded from ${SPEC})\n`,
);
