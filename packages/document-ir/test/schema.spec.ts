/**
 * document-ir/schema.spec — the named acceptance test of EPIC 0, F0.2.
 *
 * EPIC-00 requires this suite to assert, at minimum:
 *   - all 3 golden fixtures validate            <- see §"FIXTURES" at the bottom (TODO, another agent)
 *   - a block with an unknown `type` validates  (forward compatibility)
 *   - a block missing `polygon` fails
 *   - a block with LLM-authored text in a source field fails
 *
 * It also carries every case raised by the two adversarial reviews of the schema, so that a
 * regression on any of them is a red test rather than a rediscovered hole. Cases are grouped
 * by the property they defend; each test name states the property, not the mechanism.
 *
 * The worked example is EXTRACTED FROM DESIGN.md between its <!-- BEGIN worked-example -->
 * markers, so the documented example and the validated one cannot drift.
 */
// oxlint-disable typescript/no-explicit-any -- this suite deliberately manipulates untyped
// JSON documents: the whole point is to feed the validator shapes the generated types forbid.
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

const paperSchema = JSON.parse(
  readFileSync(join(PKG, "schema/paperir-1.0.0.schema.json"), "utf8"),
);
const derivationSchema = JSON.parse(
  readFileSync(join(PKG, "schema/derivation-1.0.0.schema.json"), "utf8"),
);

// ajv and ajv-formats are CJS; under NodeNext their default exports need an explicit cast
// to be callable/constructible from TypeScript.
const AjvCtor = Ajv2020 as unknown as new (opts: Record<string, unknown>) => any;
const applyFormats = addFormats as unknown as (ajv: unknown) => void;

function newAjv(): any {
  const ajv = new AjvCtor({ strict: true, allErrors: true });
  applyFormats(ajv);
  return ajv;
}

const ajv = newAjv();
const validatePaper = ajv.compile(paperSchema);
const validateDerivation = ajv.compile(derivationSchema);

/** Pull the worked example out of DESIGN.md so the doc and the test cannot disagree. */
function workedExample(): any {
  const md = readFileSync(join(PKG, "DESIGN.md"), "utf8");
  const start = md.indexOf("<!-- BEGIN worked-example -->");
  const end = md.indexOf("<!-- END worked-example -->");
  if (start < 0 || end < 0) throw new Error("worked-example markers missing from DESIGN.md");
  const fenced = md.slice(start, end);
  const json = fenced.slice(fenced.indexOf("```json") + 7, fenced.lastIndexOf("```"));
  return JSON.parse(json);
}

const EXAMPLE = workedExample();

const ID = {
  title: "blk_7k2m4qx3tz5b6d7f",
  para: "blk_a3c5e7g2j4m6p7r2",
  inline: "blk_f2h4k6n2q4s6u2w4",
  figure: "blk_b4d6f2h4k6n2q4s6",
  caption: "blk_c5e7g3j5m7p3r5t7",
  equation: "blk_d6f2h4k6n2q4s6u2",
  unknown: "blk_e7g3j5m7p3r5t7v3",
} as const;

const DERIVATION = {
  derivation_id: "drv_01JQ8ZD7Y5V3WCP7S4MFXZ8JBG",
  paper_id: "ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE",
  kind: "guided_section",
  author: {
    kind: "model",
    model_id: "anthropic/claude-haiku-4.5",
    prompt_hash: "sha256:1f2e3d4c5b6a7988",
  },
  content: "Residual learning reframes each block as learning a correction to the identity.",
  derived_from: [ID.para, ID.equation],
  created_at: "2026-07-30T09:20:00Z",
};

/** A fresh copy of the worked example with `mutate` applied. */
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

/** A block that satisfies every requirement, for use as a clean mutation base. */
function plainBlock(over: Record<string, unknown> = {}): any {
  return {
    block_id: "blk_z2z3z4z5z6z7z2z3",
    type: "paragraph",
    page_index: 1,
    polygon: [
      [54, 600],
      [292, 600],
      [292, 640],
      [54, 640],
    ],
    bbox: [54, 600, 292, 640],
    flow: "body",
    order: 2,
    doc_order: 5,
    text: "A perfectly ordinary sentence read out of the text layer.",
    source: "pdf_text_layer",
    confidence: 0.9,
    provenance: { parser: "pdfium-deterministic", stage: "layout+text" },
    ...over,
  };
}

/** Append `b` to the document and validate. */
function withExtraBlock(b: any): any {
  return paper((p) => {
    p.blocks.push(b);
    p.pages[1].block_ids.push(b.block_id);
    p.pages[1].flows.body.push(b.block_id);
  });
}

function assertValid(doc: unknown, validator: any = validatePaper): void {
  const ok = validator(doc);
  if (!ok) throw new Error(ajv.errorsText(validator.errors, { separator: "\n  " }));
  expect(ok).toBe(true);
}

function assertInvalid(doc: unknown, validator: any = validatePaper): string {
  const ok = validator(doc);
  expect(ok).toBe(false);
  return ajv.errorsText(validator.errors, { separator: "; " });
}

// ---------------------------------------------------------------------------
describe("the schema files themselves", () => {
  it("both compile under ajv 2020-12 in strict mode", () => {
    const a = newAjv();
    expect(() => a.compile(paperSchema)).not.toThrow();
    expect(() => a.compile(derivationSchema)).not.toThrow();
  });

  it("every object definition in both files closes its field set", () => {
    // Two intentional exceptions, and only two:
    //   Block.properties.payload — openness is redirected by the if/then branches to one of
    //     the four payload definitions, three of which set additionalProperties:false.
    //   OpaquePayload          — deliberately open in SHAPE (that is forward compatibility);
    //     its closure is delegated to $defs/ModelFreeSubtree, which recursively forbids
    //     authorship declarations and constrains every key via propertyNames.
    // Any THIRD entry appearing here is a hole.
    const open: string[] = [];
    const walk = (node: any, path: string, inApplicator: boolean): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, `${path}/${i}`, inApplicator));
        return;
      }
      if (node.type === "object" && !("additionalProperties" in node) && !inApplicator) {
        open.push(path);
      }
      for (const [k, v] of Object.entries(node)) {
        const applicator = inApplicator || k === "if" || k === "then" || k === "not";
        walk(v, `${path}/${k}`, applicator);
      }
    };
    for (const [name, s] of [
      ["paperir", paperSchema],
      ["derivation", derivationSchema],
    ] as const) {
      walk((s as any).$defs, `${name}/$defs`, false);
    }
    expect(open.toSorted()).toEqual([
      "paperir/$defs/Block/properties/payload",
      "paperir/$defs/OpaquePayload",
    ]);
    expect(paperSchema.$defs.OpaquePayload.$ref).toBe("#/$defs/ModelFreeSubtree");
    expect(paperSchema.$defs.OpaquePayload.propertyNames).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("the worked example", () => {
  it("validates (DESIGN.md §8 cannot drift from the schema)", () => {
    assertValid(EXAMPLE);
  });

  it("keeps every offset indexed against one string: Block.text as stored", () => {
    const para = blockOf(EXAMPLE, ID.para);
    const repair = para.repairs[0];
    expect(para.text.slice(repair.at, repair.at + repair.to.length)).toBe(repair.to);
    const inlineSpan = para.spans.find((s: any) => s.role === "inline_equation");
    expect(para.text.slice(inlineSpan.start, inlineSpan.end)).toBe(
      blockOf(EXAMPLE, ID.inline).text,
    );
  });

  it("keeps nested content out of the body reading order", () => {
    const inline = blockOf(EXAMPLE, ID.inline);
    expect(inline.parent_id).toBe(ID.para); // parent is a paragraph => nested
    expect(inline).not.toHaveProperty("doc_order");
    expect(EXAMPLE.pages[0].flows.body).not.toContain(ID.inline);
    expect(EXAMPLE.pages[0].block_ids).toContain(ID.inline);
  });

  it("the matching Derivation validates against derivation-1.0.0", () => {
    assertValid(DERIVATION, validateDerivation);
  });
});

// ---------------------------------------------------------------------------
describe("forward compatibility: unknown TYPES validate", () => {
  it("a block with a type this version has never seen validates", () => {
    assertValid(withExtraBlock(plainBlock({ type: "totally_new_type_v2" })));
  });

  it("a relation with a type this version has never seen validates", () => {
    assertValid(
      paper((p) => {
        p.relations.push({
          type: "brand_new_relation_v9",
          from: ID.para,
          to: ID.equation,
          confidence: 0.5,
          provenance: "experimental",
        });
      }),
    );
  });

  it("an unknown block type may carry its own payload data", () => {
    assertValid(
      withExtraBlock(
        plainBlock({ type: "marginal_gloss_v2", payload: { column: 3, is_boxed: true } }),
      ),
    );
  });

  it("a Derivation of an unknown kind validates", () => {
    assertValid({ ...DERIVATION, kind: "brand_new_kind_v9" }, validateDerivation);
  });

  it("ir_version 1.4.0 validates and 2.0.0 does not", () => {
    assertValid(paper((p) => (p.ir_version = "1.4.0")));
    assertInvalid(paper((p) => (p.ir_version = "2.0.0")));
  });

  it("type strings must be identifiers, so near-misses cannot evade the payload rules", () => {
    // "Equation" and "equation " used to fall through to the free-form payload branch and
    // escape the required `image`. The identifier pattern closes that (DESIGN.md §4 D2).
    assertInvalid(withExtraBlock(plainBlock({ type: "Equation" })));
    assertInvalid(withExtraBlock(plainBlock({ type: "equation " })));
    assertInvalid(withExtraBlock(plainBlock({ type: "某_new_type" })));
  });
});

// ---------------------------------------------------------------------------
describe("geometry is never discarded", () => {
  it("a block missing polygon fails", () => {
    const msg = assertInvalid(
      paper((p) => {
        delete blockOf(p, ID.para).polygon;
      }),
    );
    expect(msg).toMatch(/polygon/);
  });

  it("polygon cannot be null, empty, or fewer than 3 vertices", () => {
    for (const bad of [null, [], [[0, 0]], [[0, 0], [1, 1]]]) {
      assertInvalid(
        paper((p) => {
          blockOf(p, ID.para).polygon = bad;
        }),
      );
    }
  });

  it("a polygon may not have unbounded vertex count", () => {
    const huge = Array.from({ length: 513 }, (_, i) => [i % 600, 700]);
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).polygon = huge;
      }),
    );
  });

  it("a point is exactly two numbers and a bbox exactly four", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).polygon[0] = [1, 2, 3];
      }),
    );
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).polygon[0] = ["1", "2"];
      }),
    );
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).bbox = [1, 2, 3, 4, 5];
      }),
    );
  });

  it("Infinity, arriving as the JSON literal 1e400, is rejected", () => {
    // It satisfies exclusiveMinimum:0 and then re-serialises as null, so a document could
    // validate, be stored, and fail validation after a byte-preserving round-trip.
    const infinityFromJson = JSON.parse("1e400");
    expect(infinityFromJson).toBe(Infinity);
    expect(JSON.stringify({ x: infinityFromJson })).toBe('{"x":null}'); // not round-trip safe
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).polygon[0][0] = infinityFromJson;
      }),
    );
    assertInvalid(paper((p) => (p.pages[0].width = infinityFromJson)));
    assertInvalid(paper((p) => (p.pages[0].user_unit = infinityFromJson)));
  });

  it("page scalars are bounded: rotation, user_unit, width, height", () => {
    for (const r of [45, -90, 360]) assertInvalid(paper((p) => (p.pages[0].rotation = r)));
    for (const u of [0, -1, 1e-9]) assertInvalid(paper((p) => (p.pages[0].user_unit = u)));
    for (const w of [0, -612, 1e6]) assertInvalid(paper((p) => (p.pages[0].width = w)));
  });

  it("coordinate_space is the one permitted constant", () => {
    assertInvalid(paper((p) => (p.coordinate_space = "viewport_pixels")));
  });
});

// ---------------------------------------------------------------------------
describe("LLM-authored text in a source field fails", () => {
  it("Block.source may not be 'llm'", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).source = "llm";
      }),
    );
  });

  it("Block.source may not be 'model'", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).source = "model";
      }),
    );
  });

  it("Block.source may not be 'vlm'", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).source = "vlm";
      }),
    );
  });

  it("all four transcription kinds are accepted", () => {
    for (const s of ["pdf_text_layer", "pdf_vector", "pdf_raster", "ocr"]) {
      assertValid(
        paper((p) => {
          blockOf(p, ID.para).source = s;
        }),
      );
    }
  });

  it("a Block may not be stamped with 'generated_by'", () => {
    const msg = assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).generated_by = "gpt-4";
      }),
    );
    expect(msg).toMatch(/additional properties/i);
  });

  it("a Paper may not carry an extra field such as 'summary'", () => {
    assertInvalid(paper((p) => (p.summary = "a model-written abstract")));
  });

  it("a Relation may not carry an extra field", () => {
    assertInvalid(paper((p) => (p.relations[0].generated_by = "gpt-4")));
  });

  it("a Section has no title field, so an LLM-invented section title is unrepresentable", () => {
    assertInvalid(paper((p) => (p.sections[0].title = "Introduction, explained")));
  });

  it("a metadata value cannot exist without the block it was read from", () => {
    const msg = assertInvalid(
      paper((p) => {
        delete p.metadata.title.source_block_id;
      }),
    );
    expect(msg).toMatch(/source_block_id/);
  });

  it("a metadata value cannot be a bare string", () => {
    assertInvalid(paper((p) => (p.metadata.title = "Deep Residual Learning")));
  });

  it("an EquationSymbol cannot carry a model-written gloss", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.equation).payload.symbols = [
          {
            symbol: "\\mathcal{F}",
            definition_block: ID.para,
            gloss: "the residual mapping",
          },
        ];
      }),
    );
  });
});

// ---------------------------------------------------------------------------
describe("Block.payload is closed against derivation smuggling (review finding: FATAL)", () => {
  it("an unknown type's payload may not be stamped 'generated_by'", () => {
    assertInvalid(
      withExtraBlock(plainBlock({ type: "guided_paragraph", payload: { generated_by: "gpt-4" } })),
    );
  });

  it("a whole Derivation does not fit inside a payload", () => {
    assertInvalid(
      withExtraBlock(plainBlock({ type: "guided_paragraph", payload: { ...DERIVATION } })),
    );
  });

  it("a Derivation nested arbitrarily deep inside a payload does not fit either", () => {
    assertInvalid(
      withExtraBlock(
        plainBlock({
          type: "guided_paragraph",
          payload: { wrapper: { items: [{ derivations: [DERIVATION] }] } },
        }),
      ),
    );
  });

  it("a model-authored block masquerading as a new type is rejected", () => {
    assertInvalid(
      withExtraBlock(
        plainBlock({
          type: "guided_paragraph",
          payload: {
            author: { kind: "model", model_id: "anthropic/claude-opus-4", prompt_hash: "sha256:beef" },
            content: "<model prose>",
            render_as: "source",
          },
        }),
      ),
    );
  });

  it("payload keys must be identifiers", () => {
    assertInvalid(
      withExtraBlock(plainBlock({ type: "marginal_gloss_v2", payload: { "Not An Ident": 1 } })),
    );
  });

  it("a figure block's payload cannot be smuggled either — it must be a FigurePayload", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.figure).payload = { generated_by: "gpt-4" };
      }),
    );
  });
});

// ---------------------------------------------------------------------------
const modelRepair = (over: Record<string, unknown> = {}) => ({
  kind: "vlm_substitution",
  applied: false,
  at: 0,
  from: "We explicitly",
  to: "We formally",
  model_id: "anthropic/claude-opus-4",
  prompt_hash: "sha256:0a1b2c3d4e5f6071",
  confidence: 0.8,
  ...over,
});

describe("repairs: the LLM never overwrites source", () => {
  const setRepair = (r: unknown) =>
    paper((p) => {
      blockOf(p, ID.para).repairs = [r];
    });

  it("a vlm_substitution may not be applied", () => {
    const msg = assertInvalid(setRepair(modelRepair({ applied: true })));
    expect(msg).toMatch(/applied/);
  });

  it("an ocr_correction may not be applied", () => {
    assertInvalid(setRepair(modelRepair({ kind: "ocr_correction", applied: true })));
  });

  it("a model-authored repair must name its model and prompt", () => {
    assertInvalid(setRepair(modelRepair({ model_id: undefined })));
    assertInvalid(setRepair(modelRepair({ prompt_hash: undefined })));
  });

  it("an unapplied, fully attributed model repair is accepted", () => {
    assertValid(setRepair(modelRepair()));
  });

  it("a DETERMINISTIC repair may not name a model (review finding: FATAL)", () => {
    // {kind:"dehyphenate", applied:true, model_id:"gpt-4o", to:"<model prose>"} used to
    // validate: an openly model-stamped rewrite of source through a category whose entire
    // justification is that it is rule-based and reproducible.
    assertInvalid(
      setRepair({
        kind: "dehyphenate",
        applied: true,
        at: 49,
        from: "resid-\nual",
        to: "residual",
        model_id: "gpt-4o",
      }),
    );
    assertInvalid(
      setRepair({
        kind: "whitespace",
        applied: true,
        at: 0,
        from: "We  explicitly",
        to: "We explicitly",
        prompt_hash: "sha256:0a1b2c3d4e5f6071",
      }),
    );
  });

  it("an ordinary deterministic repair is accepted", () => {
    assertValid(
      setRepair({
        kind: "ligature",
        applied: true,
        at: 0,
        from: "reﬂ",
        to: "refl",
      }),
    );
  });

  it("`applied` is required, and unknown repair kinds are rejected", () => {
    assertInvalid(setRepair({ kind: "ligature", from: "a", to: "b" }));
    assertInvalid(setRepair({ kind: "llm_rewrite", applied: false, from: "a", to: "b" }));
    assertInvalid(setRepair({ kind: "vlm_substitution ", applied: false, from: "a", to: "b" }));
  });

  it("`from` is required, so the original always survives", () => {
    assertInvalid(setRepair({ kind: "ligature", applied: true, to: "refl" }));
  });
});

// ---------------------------------------------------------------------------
describe("alternatives: a model may argue, never decide (review finding: MATERIAL)", () => {
  const setAlts = (alts: unknown[]) =>
    paper((p) => {
      blockOf(p, ID.para).alternatives = alts;
    });

  it("a model-authored alternative cannot be the selected reading", () => {
    const msg = assertInvalid(
      setAlts([
        {
          parser: "openai/gpt-4o",
          authored_by: "model",
          text: "<model prose>",
          confidence: 0.99,
          decision: "selected",
          rule: "prefer_llm_when_ocr_conf<0.9",
        },
      ]),
    );
    expect(msg).toMatch(/decision must be equal to constant/);
  });

  it("a model-authored alternative that lost is legitimate evidence", () => {
    assertValid(
      setAlts([
        {
          parser: "vlm-repair",
          authored_by: "model",
          text: "<the model's reading>",
          confidence: 0.88,
          decision: "not_selected",
        },
      ]),
    );
  });

  it("authored_by is required and closed", () => {
    assertInvalid(
      setAlts([{ parser: "docling", confidence: 0.7, decision: "not_selected" }]),
    );
    assertInvalid(
      setAlts([
        { parser: "docling", authored_by: "human", confidence: 0.7, decision: "not_selected" },
      ]),
    );
  });

  it("decision is required", () => {
    assertInvalid(setAlts([{ parser: "docling", authored_by: "parser", confidence: 0.7 }]));
  });
});

// ---------------------------------------------------------------------------
describe("specialised payloads", () => {
  it("a figure block must carry a payload", () => {
    assertInvalid(
      paper((p) => {
        delete blockOf(p, ID.figure).payload;
      }),
    );
  });

  it("an equation payload must state whether its crop exists", () => {
    assertInvalid(
      paper((p) => {
        delete blockOf(p, ID.equation).payload.image;
      }),
    );
  });

  it("a crop that has not been rendered yet is explicitly null, never invented", () => {
    // Parsing is a resumable multi-step job; detection and rendering are different steps.
    assertValid(
      paper((p) => {
        blockOf(p, ID.figure).payload.image = null;
      }),
    );
    expect(blockOf(EXAMPLE, ID.inline).payload.image).toBeNull();
  });

  it("inline_equation shares EquationPayload rather than falling through to the opaque branch", () => {
    assertValid(EXAMPLE);
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.inline).payload = { latex: "x", not_a_field: true };
      }),
    );
  });

  it("an image URI must name a non-inline scheme", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.figure).payload.image.uri = "data:image/webp;base64,AAAA";
      }),
    );
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.figure).payload.image.uri = "/local/path.webp";
      }),
    );
  });

  it("figure interior text carries the same provenance as any other transcription", () => {
    assertInvalid(
      paper((p) => {
        delete blockOf(p, ID.figure).payload.detected_labels[0].source;
      }),
    );
    assertInvalid(
      paper((p) => {
        delete blockOf(p, ID.figure).payload.detected_labels[0].confidence;
      }),
    );
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.figure).payload.panels = [{ label: "(a)", polygon: [[1, 1], [2, 1], [2, 2]] }];
      }),
    );
  });
});

// ---------------------------------------------------------------------------
describe("generation identity (review finding: FATAL)", () => {
  it("a Paper must state which parse generation it is", () => {
    const msg = assertInvalid(
      paper((p) => {
        delete p.generation;
      }),
    );
    expect(msg).toMatch(/generation/);
  });

  it("generations are 1-based", () => {
    assertInvalid(paper((p) => (p.generation = 0)));
    assertValid(paper((p) => (p.generation = 7)));
  });
});

// ---------------------------------------------------------------------------
describe("no field a real parser must fabricate", () => {
  it("pending/parsing are job states, not document states", () => {
    assertInvalid(paper((p) => (p.status = "pending")));
    assertInvalid(paper((p) => (p.status = "parsing")));
    for (const s of ["partial", "complete", "failed"]) {
      assertValid(paper((p) => (p.status = s)));
    }
  });

  it("'no calibrated confidence estimate' is statable rather than faked as 0", () => {
    assertValid(
      paper((p) => {
        p.status = "failed";
        p.partial_reason = "page tree unreadable";
        p.confidence.overall = null;
        p.confidence.by_page = [null, null];
      }),
    );
  });

  it("an unclassified region with geometry and no text is as expressible as a title", () => {
    assertValid(withExtraBlock(plainBlock({ type: "unknown", text: undefined })));
    const unk = blockOf(EXAMPLE, ID.unknown);
    expect(unk).not.toHaveProperty("text");
    expect(unk.polygon).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("one canonical encoding of 'none'", () => {
  it("an empty optional array is invalid — omit it instead", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.title).child_ids = [];
      }),
    );
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).repairs = [];
      }),
    );
  });

  it("nullable fields are required, so absence is always stated", () => {
    assertInvalid(
      paper((p) => {
        delete p.partial_reason;
      }),
    );
    assertInvalid(
      paper((p) => {
        delete p.pages[0].image;
      }),
    );
  });

  it("a digest must be long enough to be a digest", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).content_hash = "x:0";
      }),
    );
  });
});

// ---------------------------------------------------------------------------
describe("spans locate inline constructs without shredding the paragraph", () => {
  it("a span may name its role and the block it corresponds to", () => {
    assertValid(EXAMPLE);
  });

  it("span roles are identifiers, like every other open vocabulary", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).spans[2].role = "Inline Equation";
      }),
    );
  });

  it("span.block_id must have the block-id shape", () => {
    assertInvalid(
      paper((p) => {
        blockOf(p, ID.para).spans[2].block_id = "#/texts/47";
      }),
    );
  });
});

// ---------------------------------------------------------------------------
describe("source and derivation are different stores", () => {
  it("a Derivation cannot be pushed into paper.blocks[]", () => {
    const msg = assertInvalid(paper((p) => p.blocks.push({ ...DERIVATION })));
    expect(msg).toMatch(/required|additional/i);
  });

  it("a Derivation must be model-authored — there is no human or source option", () => {
    assertInvalid(
      { ...DERIVATION, author: { ...DERIVATION.author, kind: "human" } },
      validateDerivation,
    );
  });

  it("a Derivation must point at at least one source block", () => {
    assertInvalid({ ...DERIVATION, derived_from: [] }, validateDerivation);
    assertInvalid({ ...DERIVATION, derived_from: undefined }, validateDerivation);
  });

  it("a Derivation rejects unknown fields, like everything else", () => {
    assertInvalid({ ...DERIVATION, rendered_as: "source" }, validateDerivation);
  });

  it("a PaperIR Block cannot be smuggled into the derivation store either", () => {
    assertInvalid(blockOf(EXAMPLE, ID.para), validateDerivation);
  });
});

// ---------------------------------------------------------------------------
describe("documented gaps: these validate ON PURPOSE, and the named check owns them", () => {
  // Recorded as executable tests so that the honest limits of the schema are visible to
  // anyone who reads this file, and so a future "fix" cannot silently claim them.

  it("model prose in Block.text with source:'ocr' validates — DESIGN.md §11.1", () => {
    // The schema makes AI-in-source UNDECLARABLE, not undetectable. Owner:
    // ingest/source-authenticity.spec (Epic 1).
    assertValid(
      paper((p) => {
        const b = blockOf(p, ID.para);
        b.source = "ocr";
        b.text = "In this landmark contribution the authors demonstrate, with remarkable clarity.";
      }),
    );
  });

  it("a wrong-space polygon that lands inside the CropBox validates — DESIGN.md §11.3", () => {
    // Owner: semantic validator rules G4/G7/G8 catch most spaces; a mirrored origin needs
    // F0.4's round-trip conformance vectors.
    assertValid(
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
  });

  it("an externally-enriched Reference validates — DESIGN.md §5.2 rule 35", () => {
    assertValid(
      paper((p) => {
        p.references.push({
          reference_entry_block_id: ID.unknown,
          title: "Attention Is All You Need (supplied by Crossref, not printed here)",
          year: 2017,
          confidence: 1,
        });
      }),
    );
  });

  it("a bbox contradicting its polygon validates — DESIGN.md §5.2 rule 1", () => {
    assertValid(
      paper((p) => {
        blockOf(p, ID.para).bbox = [0, 0, 1, 1];
      }),
    );
  });

  it("a new block type escapes the required crop — DESIGN.md §5.2, type-prefix rule", () => {
    // It CANNOT, however, carry an authorship declaration; that half is closed above.
    assertValid(withExtraBlock(plainBlock({ type: "figure_v2", payload: { is_vector: false } })));
  });
});

describe("block ids from ADR-001 Amendment 1 validate against the frozen pattern", () => {
  // History: EPIC-00 pinned `^blk_[a-z2-7]{16}$` (lowercase) before the id formula was settled.
  // Amendment 1 rev-2 then specified the UPPERCASE RFC 4648 alphabet, and 0 of its 217 vectors
  // validated here. The conflict was resolved in favour of the schema — Amendment 1's ENCODE
  // step now lowercases — so this block asserts AGREEMENT rather than the old contradiction.
  //
  // These are the same 427 vectors that identity.spec (F0.4) consumes from TypeScript AND
  // Python. If the formula ever moves again, this goes red before anything is minted.
  const VECTORS = join(PKG, "conformance/identity-vectors.json");

  function conformanceIds(): string[] {
    const doc = JSON.parse(readFileSync(VECTORS, "utf8"));
    return (doc.vectors as any[]).map((v) => v.block_id).filter(Boolean);
  }

  const blockIdPattern: string = paperSchema.$defs.BlockId.pattern;

  it("the schema's pinned pattern is the lowercase one EPIC-00 specified", () => {
    expect(blockIdPattern).toBe("^blk_[a-z2-7]{16}$");
  });

  it("EVERY normative conformance vector validates against it", () => {
    const ids = conformanceIds();
    expect(ids.length).toBeGreaterThanOrEqual(400);

    const re = new RegExp(blockIdPattern);
    const rejected = ids.filter((id) => !re.test(id));
    expect(rejected).toHaveLength(0);
  });

  it("a Paper carrying a real conformance-vector block id is accepted", () => {
    const realId = conformanceIds()[0];
    assertValid(withExtraBlock(plainBlock({ block_id: realId })));
  });

  it("an uppercase block id is still rejected — the alphabet is not case-insensitive", () => {
    // Two spellings of one id would break byte-identical re-parse (DESIGN.md D11 / §7.1).
    const doc = withExtraBlock(plainBlock({ block_id: "blk_7USUVPRFZ34OQA5T" }));
    expect(assertInvalid(doc)).toMatch(/pattern/);
  });
});

// ---------------------------------------------------------------------------
// FIXTURES — TODO (F0.7, another agent).
//
// Add here, and nowhere else:
//
//   import { readdirSync } from "node:fs";
//   describe("golden fixtures", () => {
//     const dir = join(PKG, "fixtures");
//     const files = readdirSync(dir).filter((f) => f.endsWith(".paperir.json"));
//     it("all three fixtures are present", () => expect(files).toHaveLength(3));
//     it.each(files)("%s validates against paperir-1.0.0", (f) => {
//       assertValid(JSON.parse(readFileSync(join(dir, f), "utf8")));
//     });
//   });
//
// Nothing above needs to change: `assertValid`, `PKG` and the compiled `validatePaper` are
// already in scope. Fixtures must ALSO pass the Tier-A semantic rules in DESIGN.md §5.2 —
// that assertion belongs with the validator (F0.4), not here.
// ---------------------------------------------------------------------------
