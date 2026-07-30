# `packages/document-ir/schema` — the single source of truth

Two JSON Schema (draft 2020-12) files define every document contract in PaperTree v2.

| File                           | Root         | What it is                                                                                                                                                                                                                   |
| ------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paperir-1.0.0.schema.json`    | `Paper`      | **PaperIR** — source-derived document content only. Geometry, blocks, relations, repairs, uncertainty. No LLM ever writes into it.                                                                                           |
| `derivation-1.0.0.schema.json` | `Derivation` | **Derivations** — AI-generated content _about_ a paper (guided sections, summaries, narration, explanations, canvas nodes, flashcards), always attributed to a model and always pointing back at the block ids it came from. |

They are two files on purpose. ADR-001 Commitment 1 says source and derivation are
different stores; two schemas are the structural expression of that. A derivation cannot
be smuggled into a `Paper` because a `Paper` has nowhere to put it.

## These files are authoritative. Everything else is generated.

```
schema/*.schema.json          <-- edit here, and only here
        |
        +--> src/generated/*.ts          TypeScript types + Zod validators
        +--> python/papertree_document_ir/generated/*.py   Pydantic v2 models
```

**Do not hand-edit anything under `src/generated/` or
`python/papertree_document_ir/generated/`.** Those files exist so the TypeScript and
Python sides cannot drift — which is exactly the failure this repo already exhibits
elsewhere (two `Highlight` types, two canvas type systems, three extractors;
`findings.md` §G5). A hand edit reintroduces it.

A CI drift test (`document-ir/codegen-drift.spec`) regenerates from these schemas and
fails if the result differs from what is committed.

## Regenerating

```bash
# from the repo root
pnpm --filter @papertree/document-ir codegen

# or from this package
cd packages/document-ir && pnpm codegen
```

Commit the regenerated files in the same commit as the schema change.

## Changing a schema

1. Read `../DESIGN.md` first — it is the interpretation record between
   `research/architecture-decisions/ADR-001-canonical-document-representation.md` and
   these files, and it lists every deliberate deviation and the reason for it.
2. Decide the version bump using the table in `../DESIGN.md` §7. Briefly: a new optional
   field is a **patch**; a new block/relation type that producers actually emit is a
   **minor**; changing geometry semantics, changing block-id derivation, removing a field,
   or widening a _closed_ enum (`Flow`, `SourceKind`, `PaperStatus`, `RepairKind`) is a
   **major** and needs a new file plus a migration plus a full re-anchor pass.
3. **A released schema file is immutable.** `paperir-1.0.0.schema.json` is not edited in
   place after Epic 0 — a major change means `paperir-2.0.0.schema.json` alongside it.
4. The schema is **frozen after Epic 0** (`research/build/README.md` anti-slop rule 3).
   Changing PaperIR later requires a migration and an ADR, not a pull request.

## Two rules that are not negotiable

- **Forward compatibility is about types, not fields.** `Block.type`, `Relation.type` and
  `Derivation.kind` accept _any string_; the known vocabularies live in
  `$defs/KnownBlockType`, `$defs/KnownRelationType`, `$defs/KnownDerivationKind`, which are
  referenced by nothing and constrain nothing. Every object, meanwhile, sets
  `"additionalProperties": false`. Do not open the field sets — closed fields are what
  makes `"generated_by": "gpt-4"` on a block impossible to express.
- **`Block.source` never gains a model value.** The enum is
  `pdf_text_layer | pdf_vector | pdf_raster | ocr`. A model's reading of a region is a
  `Repair` with `applied: false`, or an `Alternative` — never a source.

## Validating

Any draft 2020-12 validator works; the package uses `ajv` with strict mode on, plus
`ajv-formats` for `date-time`. Both files compile standalone — there is no cross-file
`$ref`, and the block-id pattern is duplicated in `derivation-1.0.0.schema.json`
deliberately so each can be loaded on its own.

JSON Schema cannot express every PaperIR invariant. `bbox == polygon extent`, referential
integrity of relation endpoints, dense/unique `order` within `(page, flow)`, span ranges
within `len(text)`, and about thirty others are checked by the **semantic validator** in
`src/` and its Python twin. The full list is `../DESIGN.md` §5.2. A document that passes
JSON Schema validation is well-formed, not yet correct.
