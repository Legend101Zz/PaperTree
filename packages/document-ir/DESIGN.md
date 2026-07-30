# PaperIR — design and interpretation record

**Artefact:** F0.2 (EPIC 0 — the Spine)
**Implements:** `research/architecture-decisions/ADR-001-canonical-document-representation.md`
**Files:** `schema/paperir-1.0.0.schema.json`, `schema/derivation-1.0.0.schema.json`
**Acceptance test:** `test/schema.spec.ts` (`document-ir/schema.spec`)
**Status:** frozen after two adversarial reviews. Changing PaperIR after Epic 0 requires a
migration and an ADR (`research/build/README.md` anti-slop rule 3).

This document is the interpretation record between ADR-001 and the schema files.
Three later agents read _this_ rather than re-deriving intent:

- **F0.3 (codegen)** — what the TS/Zod and Pydantic bindings must look like, and which
  `$defs` are validation constraints versus documentation (§6).
- **F0.4 (identity + geometry)** — what the geometry commitment actually promises, and
  which invariants the library has to check because JSON Schema cannot (§5.2).
- **F0.7 (fixtures)** — what a golden fixture must carry beyond schema-validity (§10).

§9 records every critique that was raised and **rejected**, with the reason, so nobody
re-litigates it. §11 records the residual risks a reader of the schema must know about.
**§12 records the known divergences between ajv, Zod and Pydantic** — the output of the F0.3
differential attack. Read it before trusting "the three validators agree".

---

## 1. Why the schema exists at all

`findings.md` §A: the live product persists one representation of a paper — a
concatenated string with `[Page N]` markers, produced by 13 lines. Measured on ResNet it
is 99,210 characters and **zero addressable objects**. Two structured extractors (1,698
lines, with bounding boxes and `SourceLocation`) exist and have **zero importers**.

`findings.md` §G5: the repo already demonstrates the failure this schema prevents — two
`Highlight` types, two canvas type systems, three extractors. One authoritative schema
with generated bindings is the structural fix. **The JSON Schema is the single source of
truth; TypeScript, Zod and Pydantic are generated from it and must never be hand-edited.**

---

## 2. The three commitments, as schema constructs

| ADR-001 commitment                                 | How it is enforced here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Source and derivation are different stores**  | Two schema files. `Block.source` is a closed enum with no model value. Every object sets `additionalProperties: false`, _including_ the free-form payload of unknown block types (`$defs/OpaquePayload` + `$defs/ModelFreeSubtree`). `Repair` pins model kinds to `applied: false` and forbids deterministic kinds from naming a model. `Alternative.authored_by: "model"` forces `decision: "not_selected"`. A derivation has nowhere to live inside a `Paper` — including one level down, inside a payload. |
| **2. Geometry is PDF user space and never leaves** | `Paper.coordinate_space` is `{"const": "pdf_user_space_topleft"}`; `polygon` is required on every block; every coordinate is numerically bounded; `crop_box` is pinned to `[0, 0, width, height]` by rule G4.                                                                                                                                                                                                                                                                                                 |
| **3. Reading order is per-flow**                   | `Block.flow` is a closed enum; `order` ranks within `(page, flow, container)`; `doc_order` ranks within the body flow and exists only on top-level body blocks; `Page.flows` holds the six per-flow orders over top-level blocks only.                                                                                                                                                                                                                                                                        |

### 2.1 Why `additionalProperties: false` everywhere is the load-bearing choice

Forward compatibility in PaperIR is about **types, not fields**.

- `Block.type` and `Relation.type` accept **any identifier-shaped string**
  (`^[a-z][a-z0-9_]{0,63}$`) — a type this version has never seen validates. The known
  vocabularies live in `$defs/KnownBlockType` and `$defs/KnownRelationType`, which are
  **not referenced by anything** and are **not validation constraints**. They exist for
  codegen (emit a union type + an `isKnown*()` guard) and for humans.
- Every object rejects unknown **fields**. There is exactly one object in the schema whose
  shape must stay open — `Block.payload` for an unrecognised block type — and it is
  closed against authorship declarations at arbitrary depth instead.

This pair is deliberate. An open _field_ policy would let a producer bolt
`"generated_by": "gpt-4"` onto a `Block`, and "AI content must not look like source"
would go back to being a convention.

The identifier **pattern** on the type fields is not cosmetic. The payload constraints key
on the literal strings `"equation"`, `"figure"`, `"table"`; without a pattern, `"Equation"`
and `"equation "` are near-misses that fall through to the free-form branch and evade the
required `image`. Types are identifiers, not display strings.

The acceptance test is exactly this pair: unknown block/relation **type** validates,
unknown **field** does not — at the top level _and_ inside a payload.

### 2.2 Why `Block.source` has no model value — and precisely what that buys

`SourceKind` = `pdf_text_layer | pdf_vector | pdf_raster | ocr`.

The line is **transcription vs generation**. OCR transcribes a region of the source and is
legitimate. An LLM generating prose is not, and there is no value it could be recorded
under. A model's _reading_ of a region is a `Repair` (proposal, `applied: false`, obliged
to name its model) or an `Alternative` (`authored_by: "model"`, obliged to be
`not_selected`) — stored alongside the original, never in place of it.

**The guarantee, stated exactly, because the first draft of this document overclaimed it
and a critic was right to say so:**

> There is **no field** in which a producer may **record** that content is model-authored.
> AI-in-source is **UNDECLARABLE**. It is **not undetectable**.

A producer that writes model prose into `Block.text` and stamps `source: "ocr"` passes
every check in the schema. `ocr` is already legitimate for a scanned page, so it raises no
signal. `provenance.parser` is a free string, so `{parser: "openai/gpt-4o", stage:
"generation"}` validates alongside it and _corroborates_ the lie rather than exposing it.
No field in the schema was even consulted, because JSON Schema validates **shape**, not
**authorship**.

That is still a real and useful property: an honest producer _cannot express_ AI-in-source,
and a dishonest one must **lie** rather than annotate — which turns a design mistake into
misconduct, and makes the mistake visible in code review of the adapter rather than
invisible in the data. But it is a _labelling_ guarantee, not a _content_ guarantee.

**Consequence that must not be dropped.** `research/build/README.md` anti-slop rule 5 says
"Never fabricate content that renders as source … **Enforced by schema, tested by a
lint**". The schema half is what §2.1/§2.2 describe. **The lint does not exist yet, and the
schema does not substitute for it.** It is owed by Epic 1, which is the epic that first
runs a model against a document:

> **`ingest/source-authenticity.spec` (Epic 1, owed).** For every block with
> `source != "ocr"`, `text` must be reconstructible from the PDF's own glyph stream within
> a stated edit distance. For `source == "ocr"`, the OCR engine's raw output must be
> retained and re-derivable. Any block whose text cannot be traced to pixels or glyphs
> fails the build. This is the check that catches undeclared model prose; the schema
> cannot.

Recording it here rather than in a comment because the failure mode is precisely that an
epic reads "enforced by schema" and skips the lint.

---

## 3. Object model

Root is `Paper`. Everything is in `$defs`; the root schema is a `$ref` to `$defs/Paper`.

### 3.1 Containers

| Object                 | Purpose                                                             | Notes                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Paper**              | one parse **generation** of one PDF                                 | Identity is `(paper_id, generation)`. Immutable. A re-parse writes generation N+1 _alongside_ N; anchors are migrated; promotion happens at ≥99% re-anchor and is reversible for one cycle. Which generation is promoted is **not** in this document — it is mutable state owned by `packages/db`. |
| **ParserInfo**         | which software produced this generation                             | `config_hash` is what makes "re-parsing is a no-op" checkable. `parsed_at` is excluded from the determinism comparison (§7).                                                                                                                                                                       |
| **Metadata**           | bibliographic metadata                                              | Every scalar is a provenance-carrying object; all keys required, `null` when absent; every value must _derive from_ its cited block (rule 6b).                                                                                                                                                     |
| **DocumentConfidence** | document-level uncertainty rollup                                   | `overall` and each `by_page` entry are required-**and-nullable**: `null` = "no calibrated estimate", which is the honest value for a failed parse.                                                                                                                                                 |
| **Page**               | one page, with everything needed to place blocks on it              | `rotation` is recorded but **already applied**. `crop_box` is always `[0, 0, width, height]` (§4 D23).                                                                                                                                                                                             |
| **Flows**              | the page's six independent reading orders over **top-level** blocks | All six keys required; empty array means "none in that flow". Nested blocks are deliberately absent (§4 D14).                                                                                                                                                                                      |

### 3.2 The addressable unit

**Block** is the only thing anything anchors to: highlights, citations, retrieval,
narration, canvas nodes.

Required set — deliberately minimal: `block_id`, `type`, `page_index`, `polygon`, `bbox`,
`flow`, `order`, `source`, `confidence`, `provenance`.

**`text` is optional.** This is not laxity, it is the `unknown` requirement. A parser that
cannot classify a region must emit `unknown` _with geometry intact_ rather than dropping
it (PDF-to-Tree's `connect_orphans` discipline). Nothing in the schema makes an unknown
block harder to express than a classified one: no text, no spans, no hierarchy, no
payload is required of it. Only geometry, identity and provenance are.

**Hierarchy carries two different meanings, and the difference drives reading order:**

| `parent_id` names a block of type…                                                      | Meaning                 | Child is                                                                                                     |
| --------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `title` / `heading` (`$defs/KnownHeadingBlockType`)                                     | **section containment** | **top-level** — keeps `doc_order`, appears in `Page.flows`                                                   |
| anything else — `table`, `table_row`, `list`, `figure`, `paragraph`, or an unknown type | **nesting**             | **nested** — ranks by `order` inside its parent, has **no** `doc_order`, does **not** appear in `Page.flows` |

Stated as the complement of a two-value list rather than as a list of containers so that an
**unknown** parent type nests by default — the safe direction, since splicing the children
of an unrecognised container into the body stream is the damaging error. See §4 D14 for the
measurement that forced this.

Supporting objects: `Span` (char-range → box, plus an optional `role`/`block_id` for
inline constructs), `Provenance`, `Repair`, `Alternative`, `ImageRef`,
`Polygon`/`BBox`/`Point`.

### 3.3 Graph and views

- **Relation** — typed, directed, confidence-scored. Identity is `(type, from, to)`,
  matching the physical model's primary key, so a relation carries no id and cannot be
  duplicated. `Relation.provenance` is a _string_ describing the derivation method
  (`"geometric+numbering"`), unlike `Block.provenance` which is an object — this
  asymmetry is ADR-001's and is preserved.
- **Section** — a materialised view over heading blocks. **It has no `title` field.** Its
  title _is_ its heading block's text, by construction, which makes an LLM-invented
  section title unrepresentable (`findings.md` C3). It also has no id: it is identified by
  `heading_block_id`. **Front matter is section-less** by design — see §4 note and rule 21.
- **Reference** — a materialised view over `reference_entry` blocks. The verbatim entry
  text is **not** copied here; it lives in exactly one place, the block. Every parsed field
  must appear in that block's text (rule 35): externally-enriched bibliography is not a
  PaperIR fact.

### 3.4 Specialised payloads

`EquationPayload`, `FigurePayload`, `TablePayload` (+ `EquationSymbol`, `FigurePanel`,
`DetectedLabel`, `TableGrid`, `TableCell`), all reached through `Block.payload` and
selected by `if/then` on `Block.type`. `inline_equation` shares `EquationPayload`. Every
other type — including unknown ones — gets `OpaquePayload`: open in shape, closed
against authorship declarations at any depth.

`image` is **required and nullable** on equation and figure payloads. ADR-001 says
"Equations and figures always retain the rendered source region"; that is a statement about
a _finished_ parse, and the schema now says so exactly — nullable while the render step
is outstanding, non-null when `status == "complete"` (rule 36). See §4 D16.

---

## 4. Deviations from ADR-001

Every one of these is a place where the schema does something ADR-001's prose or JSONC
does not literally say. Recorded so the orchestrator can log them and so nobody
re-litigates them later. **D1–D12 survived both reviews; D13–D23 were added or changed in
response to them.**

### D1 — Specialised payloads are nested in `payload`, not hoisted onto `Block`

**ADR-001** sketches `{ "type": "equation", "display": true, "latex": "…" }` — equation,
figure and table fields hoisted onto the block.
**Here:** `Block.payload` is an object, constrained by `if/then` on `Block.type` to
`EquationPayload` / `FigurePayload` / `TablePayload` / `OpaquePayload`.
**Why:** with `additionalProperties: false`, hoisting forces the base `Block` to enumerate
every specialised field of every type — and then it breaks cleanly for unknown types,
destroying the forward-compatibility property that is the whole point of an open type
vocabulary. Nesting also maps 1:1 onto the `blocks.payload` JSONB/TEXT column already in
ADR-001's physical model.

### D2 — `Block.type` and `Relation.type` are OPEN vocabularies, with an identifier pattern

**ADR-001** says "Block types (**closed vocabulary**…)" — but the same document's
versioning table says adding a block type is a _minor_ bump and "consumers must tolerate
unknown types (**required from v1**)". These two statements contradict each other.
**Here:** any string matching `^[a-z][a-z0-9_]{0,63}$`, with the full vocabulary in
`$defs/KnownBlockType` / `$defs/KnownRelationType` for codegen and documentation.
**Why:** the versioning contract wins — a closed enum makes every minor bump a breaking
change. The pattern is a review finding: without it `"Equation"` and `"equation "` silently
disable the payload `if/then` and evade the required `image`. Non-ASCII and free-text type
strings are now rejected; that is a deliberate narrowing of "any string", not of "unknown
types validate".

### D3 — `Block.source` exists and its enum is different

**ADR-001**'s `Block` JSONC has no `source` field at all; `synthesis-05` has
`source: textlayer | ocr | model | vlm`.
**Here:** `source` is **required** on every block and is
`pdf_text_layer | pdf_vector | pdf_raster | ocr` — the `model` and `vlm` values are gone.
**Why:** a `source` enum that _contains_ `model` makes model-authored source text a valid,
_declared_ document. Removing those values makes it undeclarable (§2.2). `pdf_vector` /
`pdf_raster` are split out because "was this figure vector or raster" is the exact blindness
measured in `findings.md` B3.

### D4 — `Repair` gains a required `applied` boolean; model kinds are pinned to `false` **and** must name their model; deterministic kinds may **not** name a model

**ADR-001** shows `{ "kind": "dehyphenate", "at": 118, "from": "…", "to": "…" }` with no
applied/proposed distinction, and says of `vlm_substitution`: _"the original stays in
`repairs[].from`, the model and prompt hash are recorded"_.
**Here:** `applied` is required. Two mirror-image `if/then` branches:
`kind ∈ {ocr_correction, vlm_substitution}` ⇒ `applied: false` **and**
`required: [model_id, prompt_hash]`; `kind ∈ {dehyphenate, ligature, unicode_normalise,
whitespace, reorder}` ⇒ `model_id` and `prompt_hash` **forbidden**.
**Why:** the first branch is ADR-001's rule in full. The second is a review finding and the
more important half: without it,
`{kind: "dehyphenate", applied: true, model_id: "gpt-4o", to: "<model prose>"}` validated
— an openly model-stamped rewrite of source, through the category whose entire
justification is that it is rule-based and reproducible. Closing the model kinds bought
nothing while the deterministic kinds were an open door. Semantic rule 30b closes the
remaining half by checking that `from → to` is actually an edit of the declared class.

**Behaviour change, recorded honestly.** ADR-001's prose describes a model repair as
_applied_, with the original preserved. This schema forbids that: `Block.text` keeps the
unrepaired reading permanently and the model's version sits in `repairs[].to`. That is the
safer default, but it means **every consumer reads the unrepaired text by default** unless
it applies proposals itself — and three epics independently implementing repair
application is the "each feature invents its own representation" failure the ADR exists to
kill. **Mitigation, and it is mandatory, not optional:** F0.4 ships
`resolvedText(block, { applyProposed: boolean })` in TS and its Python twin as the _single
sanctioned reader_ of `Block.text`. No epic may concatenate `text` and `repairs` by hand.

### D5 — `Paper.coordinate_space` is a new required `const`

Not in ADR-001's JSONC; the commitment was prose only.
**Why:** it gives the geometry commitment a machine-checkable home and a future major
version an explicit place to change.
**Claim corrected after review:** a `const` makes an un-normalised document **mislabelled**,
not unrepresentable. A polygon in viewport pixels, or in normalised fractions, or with a
bottom-left origin, still validates. What actually catches wrong-space geometry is rules
G4/G7/G8 in §5.2, and one case (bottom-left origin whose numbers happen to fall inside the
CropBox) is not catchable at all — see §11.

### D6 — Metadata provenance field renamed; `year` is no longer a bare integer

**ADR-001:** `"title": { "value": "…", "source": "blk_a1b2…", …}` and `"year": 2015`.
**Here:** the key is `source_block_id`, and **every** metadata scalar including `year` is
`{value, source_block_id, confidence}`.
**Why:** `source` would collide semantically with `Block.source`; a bare `year` has no
traceable origin, which is the class of bug that produced `title = <uploaded filename>`.
A required citation alone was **not enough** — rule 6b now also requires the value to
_derive from_ the cited block, because a pipeline that reads a real title block and then
asks a model to "tidy" the title otherwise produces a perfectly valid document.

### D7 — `Block.doc_order` is optional, not always present

**ADR-001** shows it on every block sketch.
**Here:** present on exactly the **top-level** blocks whose flow is `body`.
**Why:** `doc_order` is defined as "rank within the whole **body** flow". A footnote has no
place in the body sequence, and neither does a table cell (D14). `null`/`-1` sentinels
would invite consumers to sort on them.

### D8 — `Alternative` gains required `decision` **and** required `authored_by`

ADR-001's example shows one alternative with `decision`/`rule` and one without, and does
not say who produced a reading.
**Here:** `decision` (`selected | not_selected`) and `authored_by` (`parser | model`) are
both required, and an `if/then` forces `authored_by: "model"` ⇒ `decision: "not_selected"`.
**Why:** "the selection rule is recorded so the decision is auditable" only holds if every
competing reading states whether it won. `authored_by` is a review finding: the semantic
rule "the selected alternative's text equals `block.text`" enforces the wrong direction —
it is _satisfied_ when a model's reading is what the reader sees. `authored_by` is the exact
mirror of `Repair.applied`, which is the pattern the schema already uses correctly
elsewhere. This was the last channel through which model text could sit inside a `Paper`
without a "this is not what you are reading" flag beside it.

### D9 — `EquationSymbol.gloss` is removed; `definition_block` is required

**ADR-001:** `{ "symbol": "\\mathcal{F}", "definition_block": "blk_…", "gloss": "residual mapping" }`.
**Here:** `{symbol, definition_block}` only.
**Why:** a gloss is model-authored natural-language explanation. By Commitment 1 that is a
_derivation_ — `kind: "explanation"`, `derived_from: [<equation block>]` — where the
UI is obliged to render it in a distinct register. Leaving `gloss` in PaperIR would have
been the one _declared_ field in the whole schema through which model prose could enter the
source store.

### D10 — `ir_version` accepts any `1.x`, not `const "1.0.0"`

**Why:** a minor bump only adds block/relation types (open vocabularies) or optional
fields, so a `1.1.0` document is by definition still valid against this file. A `2.x`
document is rejected. See §7 for the one exception (closed-enum widening).

### D11 — Optional arrays use `minItems: 1`; empty arrays are invalid

Not addressed by ADR-001.
**Why:** exactly one canonical encoding of "none". `child_ids`, `spans`, `repairs`,
`alternatives`, `symbols`, `panels`, `detected_labels`, `referenced_by`, `authors` (on
`Reference`) are **omitted** when empty, never `[]`. Required arrays (`Paper.blocks`,
`Page.block_ids`, `Flows.*`, …) are always present and may be empty. The same rule drives
the scalar policy: optional scalars are **never nullable** (absent means none), and nullable
fields are **always required** (`partial_reason`, `Page.image`, `payload.image`,
`confidence.overall`, all `Metadata` keys). One representation of "no value" is what makes
"re-parsing produces byte-identical PaperIR" achievable rather than aspirational.

### D12 — `Derivation`'s id field is `derivation_id`, with a `drv_` ULID prefix

The brief said "a Derivation has `id`".
**Why:** symmetry with `paper_id`/`page_id`/`block_id`, and no bare `id` colliding with ORM
conventions.

---

### D13 — `Paper.generation` is added and required _(new; resolves a FATAL)_

**ADR-001 §Versioning** requires it in prose — "a new parse is written as a **new IR
generation** alongside the old one … the old generation is retained for one cycle so
promotion is reversible. **This is the rollback plan**" — and no field expressed it.
**Here:** `generation`, integer ≥ 1, required.
**Why:** without it the rollback plan does not exist. Concretely: ADR-001's own DDL has
`papers(source_hash UNIQUE)`, so two generations of one PDF are unstorable; and
`blocks(block_id PK)` collides outright, because content-derived ids are **identical** for
unchanged blocks across generations — that being their entire purpose. Epic 2's
`anchoring/reparse.spec` ("≥99% re-anchor when block ids change under a perturbed parse")
would have had no old generation to migrate _from_.
**Consequences for `packages/db` (F0.5), stated here because F0.5 is a different agent:**
key `papers` on `(paper_id, generation)` with `UNIQUE(source_hash, generation)`; `blocks`
PK `(paper_id, generation, block_id)`; ditto `block_vectors`, `pages`, `relations`.
**Rejected sub-proposal:** a `promoted` boolean on `Paper` — see §9.

### D14 — Nested content is excluded from `Page.flows` and from `doc_order` _(new; resolves a FATAL)_

ADR-001 makes table cells first-class blocks and gives `Flow` six values with no home for
nested content; `synthesis-05` had a `float` flow which was dropped.
**Here:** a block whose `parent_id` names a **non-heading** block is _nested_: it ranks by
`order` within its parent, carries no `doc_order`, and is not listed in `Page.flows`. It is
still in `Page.block_ids` and is still a fully addressable, highlightable, citable block.
**Why (measured):** Docling produces **342 cells** for one ResNet table (`findings.md` §H2).
Under the previous rules all 342 had to sit in the `body` flow with dense, unique `order`
_and_ `doc_order`, i.e. 342 consecutive slots between two paragraphs. `doc_order` is defined
as "the sequence a continuous reader or an audiobook follows" — so Epic 2's Guided view
and Epic 4's TTS would read the table cell by cell, and Epic 3's `get_adjacent_blocks` on
the preceding paragraph would return cells. The same argument applies to `list_item`,
`table_row`, and to an `inline_equation` inside a paragraph (which would otherwise
reintroduce the 59-character-median shredding of `findings.md` B1).
**Rejected alternative:** widening `Flow` — see §9.

### D15 — `PaperStatus` drops `pending` and `parsing` _(new; resolves a MATERIAL)_

**ADR-001:** `pending | parsing | partial | complete | failed`.
**Here:** `partial | complete | failed`.
**Why:** `Paper` requires a fully-populated `ParserInfo` (with `config_hash` and
`parsed_at`) and a `DocumentConfidence`. At upload time none of those exist, so a `pending`
PaperIR document could only be produced by **fabricating** them — which is exactly the
failure class this schema exists to prevent. `pending`/`parsing` are **job** states: they
belong to the `papers` and `jobs` tables in `packages/db`, and the first PaperIR document
for a generation is written when there is something real to write.

### D16 — `payload.image` is required-**and-nullable** on equations and figures _(new; resolves a FATAL)_

**ADR-001:** "Equations and figures **always retain** the rendered source region."
**Here:** `image` is required and may be `null`, mirroring `Page.image`; rule 36 requires it
non-null when `Paper.status == "complete"`.
**Why:** Epic 1 runs parsing as a durable, resumable, per-step job. F1.5 detects a vector
figure region in one step and renders the WebP in another. Between those steps a
non-nullable `image` leaves the adapter three moves: invent a URI, drop the region, or
re-emit it as `unknown` — all of which destroy the exact fact that was correctly
extracted, and the third breaks Epic 1's own `worker/figures.spec` ("ResNet yields ≥5
figures"). `status: "partial"` — ADR-001's own first-class state — could not otherwise
contain a detected-but-unrendered figure. ADR-001's "always" is a statement about a
_finished_ parse, and rule 36 is that statement, exactly.

### D17 — `Span` gains `role` and `block_id`; all offsets index the stored `text` _(new; resolves a MATERIAL)_

**ADR-001:** `Span` is `{start, end, bbox, font?, size?}`; `Span.start` indexes `Block.text`
while `Repair.at` was documented as indexing the **original** text.
**Here:** `Span.role` (open identifier: `inline_equation`, `citation`, …) and
`Span.block_id` (pointer at the block that construct _is_) are optional additions; and
**every offset in the schema — `Span.start/end` and `Repair.at` — indexes `Block.text`
as stored, i.e. post-applied-repair.**
**Why (two findings, one fix each):**
(a) With two offset bases, the worked example's own 2-character dehyphenation shifted every
span after offset 47, so tier-1 character anchoring — Epic 2's entire highlight model —
drifted silently by the cumulative length delta of the applied repairs. One addressable
string removes the class of bug. For an `applied: false` repair, `at` is where `from` still
sits; for `applied: true`, where `to` now sits.
(b) Inline math is the _majority_ of real math (1,411 inline vs 641 display in the 2026
benchmark corpus) and inline citations are what `resolve_citation` resolves. Without
`role`/`block_id`, "this inline equation occupies characters 68–72 of paragraph X" is
expressible only by fragmenting X into three blocks — the shredding of `findings.md` B1.
Both fields are optional, so a parser that has neither is unaffected.

### D18 — `continues_in_next_column` is added to the known relation vocabulary _(new; resolves a FATAL)_

**ADR-001** offers `continues_on_next_page` only, and DESIGN.md's first draft rejected
`synthesis-05`'s `prov: list[Prov]` on the grounds that the relation covered continuation.
It does not: the relation is cross-**page**.
**Here:** `continues_in_next_column` joins `$defs/KnownRelationType`. **No schema change** —
`Relation.type` is already an open string — so this is a documentation and
semantic-validator change (rule 24b), not a version bump.
**Why:** a paragraph running from the foot of column A to the head of column B _on the same
page_ is the most common structure in the corpus (4 of 8 papers are two-column) and had no
representation. The parser's only two options were both named failures: merge, whose single
polygon must span the gutter (reintroducing the highlight bleed Commitment 2 exists to
prevent, and failing `worker/reading-order.spec`); or split with no link, so Guided view,
retrieval chunks and the audiobook all see half-sentences.
**The `prov: list[Prov]` rejection stands, but it is now conditional on this relation
existing** — that condition is recorded here so it is not silently lost.

### D19 — `inline_equation` shares `EquationPayload` _(new)_

ADR-001 lists `inline_equation` as a block type and gives it no payload contract, so it fell
through to the opaque branch and could carry no `latex`, no `latex_confidence` and no crop.
**Here:** the equation `if/then` matches `equation` **or** `inline_equation`; `display` must
be `false` for the latter (rule 39). Free, given D16 made `image` nullable — an inline
equation that has not been cropped is now expressible.

### D20 — `figure.payload.is_vector` is decoupled from `Block.source` _(new)_

The first draft carried semantic rule 33: `is_vector: true` ⟺ `source == "pdf_vector"`.
**Here:** that rule is **deleted**. `source` names the _dominant extraction path_;
`is_vector` names _whether the figure contains vector drawing operations_.
**Why:** it was one fact in two places kept in sync by a validator — the redundancy this
schema is otherwise careful to avoid — and it made a common object unrepresentable: a
matplotlib plot with an embedded raster inside vector axes has no honest single answer.
Decoupling costs nothing and removes a rule. (Widening `SourceKind` with `pdf_mixed` was
considered and rejected — §9.)

### D21 — `DocumentConfidence.overall` and `by_page` entries are nullable _(new; resolves a MATERIAL)_

**Here:** `Confidence | null`, still required; rule 13b requires non-null when
`status == "complete"`.
**Why:** a `failed` parse and a page still queued for vision repair have **no calibrated
estimate**, and the natural workaround — writing `0` — is a fabricated measurement in
the very field the UI uses to decide whether to trust the document. `null` states absence.
`Block.confidence` and `Page.confidence` stay required and non-nullable; see the normative
table in §10 for what a deterministic parser must put there, and §9 for why they were not
made nullable too.

### D22 — Numeric bounds everywhere, and `Block.payload` is closed against authorship _(new; resolves a FATAL and a MATERIAL)_

**Here:** every coordinate is bounded to ±20000 pt; `Polygon` has `maxItems: 512`;
`Page.width/height ≤ 20000`; `user_unit ∈ [0.001, 1000]`; `ImageRef.scale ≤ 64`,
`dpi ≤ 4800`; `Span.size ≤ 2000`; `AlgoPrefixedHash` hex body is 16–128 chars;
`ImageRef.uri` must carry an explicit non-inline scheme. And `Block.payload`, for any type
other than `equation`/`inline_equation`/`figure`/`table`, is `$defs/OpaquePayload`:
**identifier-shaped keys at every depth**, and **no object anywhere in its subtree may carry any
of the 35 model-authorship key names** in `$defs/ModelFreeSubtree` (recursive).

_Revised 2026-07-30, acceptance review._ It was seven key names, and `propertyNames` applied only
to the OUTERMOST payload object — so `{"meta": {"GENERATED_BY": "gpt-4"}}` and `{"meta":
{"model-id": "gpt-4o"}}` validated while their identical lowercase spellings one level up were
correctly rejected, and every near-miss spelling (`model`, `authored_by`, `completion`,
`system_prompt_digest`, …) was open at every depth. A review assembled a block openly declaring
model authorship — `payload.author.kind: "model"`, `payload.completion`, `payload.render_as:
"source"` — that passed ajv, Zod, Pydantic and the Tier-A semantic validator with zero findings.
Both halves are fixed and both are pinned as a PROPERTY in `schema.spec`, not by one example.
**The mechanism is still a deny-list of names plus a key shape and it cannot be complete** — see
§11 residual risk 8, and do not read the summary sentence as "authorship is unrepresentable".
**Why (two findings):**
(a) `payload` was the **only** object in the file without `additionalProperties: false`. A
complete, schema-valid `Derivation` fitted inside it whole, one level below the `Block` that
rejects exactly those fields; so did a bare `{"generated_by": "gpt-4"}`. "A derivation has
nowhere to live inside a `Paper`" was false, and so was the field-closure half of §2.1.
(b) `1e400` parses to `Infinity`, satisfies `exclusiveMinimum: 0`, and then re-serialises as
`null` — which does _not_ validate. A document could validate, be stored, and fail
validation after a byte-preserving round-trip, directly threatening the milestone criterion
"re-parsing produces byte-identical PaperIR". Bounds close this and the `1e-300` degenerate
cases at the same time.
**Limit, stated:** (a) blocks the _shape_ of a declared derivation, not prose. A payload
string containing model output is still expressible — see §2.2 and §11.

### D23 — `crop_box` / `media_box` are normalised, and `crop_box` is always `[0, 0, width, height]` _(new; resolves a MATERIAL)_

ADR-001 never says which space these are in; the first draft flagged it as an open question,
and `geometry.spec` requires <0.01 pt round-trip with `CropBox ≠ MediaBox`.
**Here, decided:** both are expressed in this document's coordinate space — normalised,
top-left origin, **post-rotation** — not as raw PDF arrays. Because block geometry is
CropBox-relative, `crop_box` is **always** `[0, 0, page.width, page.height]`, and
`media_box` coordinates are frequently **negative** (the media box extends above/left of the
crop box), which is correct rather than an error.
**Why:** it converts an ambiguity into rule G4 (`page.width == crop_box[2] - crop_box[0]`),
which is the cheapest coordinate-space sanity check available and catches a whole class of
normalisation error outright. Getting it wrong silently offsets every polygon on the common
pages where CropBox ≠ MediaBox, and would be invisible until a highlight landed in the wrong
place.

### Choices where ADR-001 is silent

- **`Section`** — `{heading_block_id, level, parent_heading_block_id?, block_ids}`, no
  title and no id (§3.3). `block_ids` **excludes** `heading_block_id` itself, excludes
  nested blocks, and is ordered by `doc_order` where present and by `(page_index, order)`
  otherwise — which is how a caption or footnote, having no `doc_order`, still gets a
  defined position. **Front matter (title, authors, affiliations, abstract, everything
  before the first heading) belongs to no `Section`.** Epic 3's `get_parent_section` must
  return null for it rather than discover that at runtime.
- **`Reference`** — a pointer at the `reference_entry` block plus parsed fields, with no
  verbatim `raw`. Rule 35 requires every parsed field to appear in the entry's text.
- **`synthesis-05`'s `verified: bool`** — not adopted. `confidence` plus
  `DocumentConfidence.needs_review` already carry it, and a second boolean would drift.
- **`synthesis-05`'s `prov: list[Prov]`** — not adopted, **conditional on D18**: with
  `continues_in_next_column` in the vocabulary, both cross-page and cross-column
  continuation are links rather than concatenations, and each block keeps a single polygon.
  If D18's relation is ever dropped, this rejection must be revisited.

---

## 5. Invariants: what the schema checks, and what it cannot

### 5.1 Enforced by JSON Schema (no code needed)

- All id string shapes: `ppr_` ULID, `pg_`/`blk_` base32(16), `drv_` ULID.
- `polygon` present on every block, 3–512 vertices, each a 2-number tuple, each coordinate
  finite and within ±20000 pt. `bbox` is exactly 4 bounded numbers.
- `coordinate_space` is the one permitted constant; `generation` is present.
- `source` is one of four transcription kinds; `model`/`llm`/`vlm` are rejected.
- No unknown fields, anywhere, on any object — including inside `payload`, where an
  unknown block type's payload additionally rejects authorship keys at any depth.
- Model-authored repair kinds cannot have `applied: true` and must carry `model_id` +
  `prompt_hash`; deterministic kinds must not carry either.
- A model-authored `Alternative` cannot be `selected`.
- Metadata scalars cannot exist without a `source_block_id` of the correct shape.
- `equation` / `inline_equation` / `figure` / `table` blocks must carry the matching
  payload; the payload's `image` key must be present (possibly null).
- `DetectedLabel` and `FigurePanel` carry a `source` and a `confidence`.
- `derived_from` on a `Derivation` has ≥1 element; `author.kind` is `"model"`.
- Confidences are in `[0, 1]`; `rotation ∈ {0,90,180,270}`; page dimensions bounded > 0;
  `user_unit ∈ [0.001, 1000]`.
- Optional arrays are non-empty when present (D11).
- `ir_version` is `1.x`; `ImageRef.uri` has a non-inline scheme.

### 5.2 Semantic validator spec — invariants JSON Schema CANNOT express

The TS library (`src/`) and its Python twin (`python/papertree_document_ir/`) must
implement these. F0.7's golden fixtures must pass every **Tier A** rule.

**Tier A — must pass in Epic 0.** Rules 1–26, 30, 30b, 31, 32, 35–42 and G4–G8.
Rules 27–29 and 30b depend on F0.4's `resolvedText` / `normalise` / `contentHash` helpers,
which are Epic 0 deliverables; they land with F0.4, not with F0.2.

**Tier B — deferred, with an owner.**

- **32b** → **Epic 1**, which owns the grid→HTML serialiser.
- **34** → **Epic 3**, which owns the derivations store (it is cross-document and Epic 0
  has no second store to check against).

This split answers the review point that a 34-rule validator exceeds Epic 0's stated scope:
it does not, once 32b and 34 are handed to the epics that own the code they need.

**Geometry**

1. `block.bbox` **equals** the extent of `block.polygon` — `[min x, min y, max x, max y]`
   over its vertices — within a stated epsilon. (ADR-001: "always == polygon extent".)
2. Every `bbox` satisfies `x0 ≤ x1` and `y0 ≤ y1`.
3. Every block polygon lies within its page's `crop_box`. **WARN** individually — parsers
   do emit marginally out-of-box geometry — but see G7.

- **G4.** `page.width == crop_box[2] - crop_box[0]` and
  `page.height == crop_box[3] - crop_box[1]`, within epsilon; and `crop_box[0] == crop_box[1] == 0`
  (D23). **ERROR.** This is the cheapest coordinate-space check that exists and it catches a
  normalised-fraction document outright.
- **G5.** Every polygon and bbox coordinate is finite (not NaN, not ±Infinity) after
  deserialisation. **ERROR.**
- **G6.** Every block polygon has strictly positive area (**ERROR**) and a simple,
  non-self-intersecting ring (**WARN** — a bowtie is a parser bug, not a data-integrity
  failure).
- **G7.** Rule 3 is promoted to **ERROR** when more than 5% of a page's blocks fall outside
  `crop_box`. A systematic coordinate-space error looks different from parser jitter, and
  that difference is what makes the rule usable at error severity at all.
- **G8.** The union of all block bboxes on a page covers ≥1% of the page area. **WARN.**
  Flags a document stored in normalised `[0,1]` fractions, which every other check passes,
  and a page the parser has under-read.

  **Why WARN and not ERROR** (amended after F0.4's adversarial review demonstrated the rule
  firing at ERROR on a legitimate page — a page carrying a single running-header block covers
  0.25 % of US Letter). Tier A **ERROR** means the document is _wrong_: a reference that does
  not resolve, a bbox that contradicts its own polygon, an id that does not recompute. Low
  page coverage does not mean the document is wrong; it means it is **suspicious** — the
  parser may have missed content. PaperIR already has a first-class channel for "we are not
  sure about this page": `page.confidence`, `DocumentConfidence.weakest_pages` and
  `needs_review`. Routing a heuristic through the error channel instead is exactly what
  produces a validator people learn to ignore, and a validator that is ignored catches
  nothing. Consumers should feed a G8 diagnostic into `weakest_pages` / `needs_review`
  rather than reject the document. Nothing is lost at the bottom end: a page whose blocks
  are genuinely missing is still caught as an ERROR by the page/block consistency rules
  (10, 11, 40), which do not depend on coverage at all.

**Referential integrity** 4. Every relation endpoint (`from`, `to`) resolves to a block in `Paper.blocks`. 5. Every `parent_id`, `prev_id`, `next_id`, `child_ids[]` resolves to a real block. 6. Every metadata `source_block_id`, and every `abstract.block_ids[]`, resolves.

- **6b.** Every `MetadataValue.value` (and `MetadataYear.value` rendered as a decimal
  string), under the library's normalisation, is a **substring of the normalised `text` of
  the block named by `source_block_id`**. **ERROR.** Requiring the citation was only half of
  D6: without this, `title = <model-composed>` with a plausible `source_block_id` validates
  end to end.

7. Every `caption_block`, `definition_block`, `cell_id`, `referenced_by[]`,
   `heading_block_id`, `parent_heading_block_id`, `section.block_ids[]`,
   `reference_entry_block_id`, `span.block_id` resolves.
8. Block ids are unique across `Paper.blocks`; page ids and `page.index` are unique across
   `Paper.pages`.
9. Relations are unique on `(type, from, to)`.

**Page / flow consistency** 10. `page.block_ids` matches exactly the set of blocks whose `page_index` equals that
page's `index` — no more, no fewer, nested blocks included. 11. `page.flows[f]` contains only **top-level** blocks on that page whose `flow == f`, and
the union of the six flows equals the set of top-level blocks on the page. 12. Each `page.flows[f]` is ordered by ascending `block.order`. 13. `confidence.by_page` has one entry per page; `weakest_pages` are valid page indices.

- **13b.** When `status == "complete"`, `confidence.overall` and every `by_page` entry are
  non-null (D21).

**Ordering** 14. `order` is **dense and unique** — `0..n-1`, no gaps, no duplicates — within each
`(page_index, flow, container)` group, where `container` is the block's nesting parent
(a non-heading `parent_id`) or "top level" when it has none (D14). 15. `doc_order` is unique across the document and present on **exactly** the top-level
blocks whose `flow == "body"`; the sequence is dense across the whole body flow. 16. `doc_order` is monotonically non-decreasing with `(page_index, order)` within the body
flow — the body stream never runs backwards through the document.

**Tree consistency** 17. `parent_id` and `child_ids` are mutually consistent: `b.parent_id == p.block_id` ⟺
`b.block_id ∈ p.child_ids`. 18. `prev_id`/`next_id` are mutually consistent and link **siblings only**:
`a.next_id == b.block_id` ⟺ `b.prev_id == a.block_id`, and `a.parent_id ==
    b.parent_id`. A parent is never its child's `prev`/`next`. 19. `parent_of` relations agree with `parent_id`/`child_ids`; `next_in_reading_order`
relations agree with `prev_id`/`next_id`. 20. The parent graph is acyclic; the sibling chain contains no cycles. 21. `section.level` is 1 when `parent_heading_block_id` is absent, and `parent.level + 1`
otherwise; a section's `heading_block_id` points at a block whose type is in
`$defs/KnownHeadingBlockType` (`title` or `heading`) — a paper's `title` block
legitimately opens the outermost section.

**Typed-relation semantics** 22. `caption_of.from` and every `payload.caption_block` point at a block of type
`caption`; `caption_of.to` points at a float (`figure` / `table` / `diagram` / `plot`). 23. `cites.to` points at a block of type `reference_entry`. 24. `continues_on_next_page` connects blocks on **different** pages, in ascending page
order.

- **24b.** `continues_in_next_column` connects blocks on the **same** page, in ascending
  `bbox.x0` order, with non-overlapping x-extents (D18).

**Text and spans** 25. Every span satisfies `0 ≤ start < end ≤ len(block.text)` (Unicode code points), and a
block with `spans` has `text`. 26. Spans within a block do not overlap and are in ascending `start` order. 27. `repair.at`, when present, is a valid offset into `block.text` **as stored**; for
`applied: true`, `text[at : at+len(to)] == to`; for `applied: false`,
`text[at : at+len(from)] == from` (D17). 28. `text_normalised`, when present, is the library's normalisation of `text`. 29. `content_hash`, when present, matches the library's digest of `text_normalised`.

**Provenance and model discipline** 30. Repairs of kind `ocr_correction` / `vlm_substitution` carry `model_id` **and**
`prompt_hash` — now _also_ enforced by the JSON Schema `if/then`; this rule is
retained so the validator reports it with a useful message.

- **30b.** For each **deterministic** kind, `from → to` must be an edit **of that class**,
  exactly reproducibly: `whitespace` — `to == from` under whitespace collapse;
  `ligature` / `unicode_normalise` — ligature expansion / `to == NFKC_15.0.0(from)`, i.e. NFKC
  **version-pinned to `CASE_FOLD_UNICODE_VERSION`**, not the runtime's. This was the ONE runtime
  Unicode call left in the validator and it forked the two twins on **83 code points** — the 46
  that gained a canonical combining class after Unicode 15.0.0 plus the 37 that gained a
  compatibility decomposition (U+A7F1, U+1CCD6–U+1CCF9) — so one and the same repair was an ERROR
  in Python 3.12 and clean in Node 22. A validator verdict that depends on which language ran it
  is the "two implementations, one contract" failure this rewrite exists to end. Pinned by
  `validate.pinnedNfkc` / `validate.pinned_nfkc`, by the same split-at-the-post-15.0.0-starters
  mechanism as `identity.pinnedNfc`, and guarded by a cross-language digest over all 1,112,064
  code points. The widening is recorded in §11 residual risk 9;
  `dehyphenate` — `to == from` with a soft/hard hyphen + line break removed;
  `reorder` — `to` is a permutation of `from`'s tokens. **ERROR.** This is the single
  highest-value rule in the spec: it is what stops a "deterministic" repair from being an
  arbitrary rewrite, and every check is two lines precisely because reproducibility is the
  category's stated justification.

31. At most one `alternative` per block has `decision: "selected"`; if one does, its `text`
    (when present) equals `block.text`. The converse hazard — a model-authored selected
    alternative — is now closed by the schema (`authored_by`), not by this rule.
32. `table.payload.grid.cells[].text`, when present, equals the text of the block named by
    `cell_id`; `cell_id` points at a block of type `table_cell` on the same page.

- **32b.** _(Tier B → Epic 1.)_ `table.payload.html`, when present, is the library's
  deterministic serialisation of `grid`. A derived field nobody checks is a second
  representation that drifts. If Epic 1 does not want to own the serialiser, it must **drop
  the field** instead.

33. _(deleted — see D20.)_
34. _(Tier B → Epic 3.)_ Every `derivation.derived_from[]` block id resolves in the
    referenced paper's **currently promoted generation**. A derivation whose sources have
    vanished after a re-parse must fail **loudly** — never be silently rendered against
    nothing.

**Materialised-view honesty** _(new)_ 35. Every non-null `Reference` scalar (`title`, `venue`, `doi`, `arxiv_id`, `url`, each
`authors[]`, `year` as a decimal string), under the library's normalisation, appears in
the normalised `text` of the block named by `reference_entry_block_id`. **ERROR.** One
`includes()` per field. This is the rule that makes "a citation enriched from Crossref
is not a PaperIR fact" true rather than aspirational, and bibliographic enrichment is a
normal, well-intentioned feature a future epic _will_ try to add. 36. When `status == "complete"`, `payload.image` is non-null on every `equation`,
`inline_equation` and `figure` block (D16). 37. When `text` is present and `source == "pdf_text_layer"`, `text_normalised` and
`content_hash` are also present. Tier-2 anchoring cannot be optional on exactly the
blocks anchors land on. 38. `section.block_ids` excludes `section.heading_block_id`, contains no duplicates, and
contains no nested blocks. 39. A block of type `inline_equation` has `payload.display == false`. 40. `page.index` values are contiguous `0..n-1`; `pages` is non-empty whenever `blocks` is
non-empty. 41. `status == "failed"` implies `partial_reason` is non-null;
`status == "complete"` implies `partial_reason` is null. 42. No nested block appears in any `page.flows[f]` (the enforcement half of D14).

---

## 6. Notes for F0.3 (codegen)

- Root type is `Paper`; generate one type per `$def`.
- `KnownBlockType`, `KnownHeadingBlockType`, `KnownRelationType`, `KnownDerivationKind` are
  **not referenced** by the schema. Emit them as string-literal unions plus
  `isKnownBlockType()` / `isHeadingBlockType()`-style guards, and emit the corresponding
  fields as plain `string`. Do **not** narrow `Block.type` to the union — that would
  reintroduce the closed vocabulary at the type level and break forward compatibility.
- The `if/then` on `Block.type` becomes a discriminated union in TS
  (`type: "equation" | "inline_equation"` ⇒ `payload: EquationPayload`) with a fallback
  member `{ type: string; payload?: OpaquePayload }`. In Pydantic, a model validator rather
  than a `Literal` discriminator, for the same reason.
- `ModelFreeSubtree` is a **recursive** constraint. Emit it as a runtime validator
  (`assertModelFree(value)`), not as a type — TS cannot express "no object in this
  subtree has key X".
- The `if/then` on `Repair` and on `Alternative` become model validators, not types.
- `oneOf: [X, null]` fields are `X | null` (required, nullable). Optional fields are
  `X | undefined` / `X | None` and are **never** nullable (D11).
- Optional arrays are non-empty when present: `[T, ...T[]]` in TS,
  `list[T] = Field(min_length=1)` in Pydantic. Serialisers must **omit** empty arrays.
- Two schema files ⇒ two generated modules. Do not merge them; do not add a cross-file
  `$ref`. Each file compiles standalone (the block-id pattern is duplicated on purpose).
- **Python writers MUST call `paper.model_dump(mode="json", by_alias=True,
exclude_unset=True)`.** The obvious call, `model_dump_json()`, is silently wrong: it emits
  `from_` — the Python-keyword-escaped field name — instead of `from` for every `Relation`, and
  `null` for every absent optional, producing a document with 1,241 ajv errors. `by_alias`
  without `exclude_unset` fixes the first and not the second. This incantation appeared nowhere
  in this file, the generated models, the Python tests or `fixtures/README.md`; it is now pinned
  by `python/tests/test_canonical.py::test_the_only_model_dump_that_reproduces_a_valid_document`.

## 7. Versioning contract, and what "byte-identical" means

`ir_version` is semver, per ADR-001 §Versioning and migration.

| Change                                                                                                                                                                                                                                                                       | Bump      | Consequences                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add an **optional** field; add a value to a **documented open vocabulary** (`KnownBlockType`, `KnownHeadingBlockType`, `KnownRelationType`, `KnownDerivationKind`); clarify a description                                                                                    | **patch** | Nothing. Bindings regenerate; old documents stay valid; consumers unaffected.                                                                                                                                                                                                                                                                                            |
| Add a new **block type or relation type that producers actually emit**; add a new optional object; add a new specialised payload                                                                                                                                             | **minor** | Consumers must already tolerate unknown types — required from v1. No migration, no re-anchor. Old and new documents both validate against this file.                                                                                                                                                                                                                     |
| Add a value to `RepairKind`'s **deterministic** set (e.g. `soft_hyphen_strip`, `column_merge`)                                                                                                                                                                               | **minor** | New schema file `1.1.0`. **No migration and no re-anchor**: block ids are unaffected and the safety property keys on the _model_ set, which never widens. Documents emitting the new kind declare `ir_version: 1.1.0` and validate against `1.1.0`+ only — the one place where "any 1.x validates against this file" does not hold, and it is stated rather than hidden. |
| Change geometry semantics or `coordinate_space`; change block-id derivation; **remove** a field; make an optional field **required**; add a value to `Flow`, `SourceKind`, `PaperStatus`, `Alternative.decision`, `Alternative.authored_by`, or `RepairKind`'s **model** set | **major** | New file `paperir-2.0.0.schema.json`. Full re-parse into a new generation, migration of every anchor, promotion only at ≥99% re-anchor success, old generation retained one cycle.                                                                                                                                                                                       |

`Flow` is the clearest major case: adding a seventh flow changes what "read the document"
means for every existing consumer. `SourceKind` and `RepairKind`'s model set are major
because they are the safety enums.

Schema files are named by version and are **immutable once released**. `1.0.0` is never
edited in place after Epic 0; a change means a new file plus a row in this table.

### 7.1 Determinism, defined

`research/build/README.md` definition-of-done #1 and `worker/determinism.spec` require
"re-parsing produces byte-identical PaperIR". Taken literally that is unachievable, because
`parser.parsed_at` is a wall-clock timestamp and `paper_id` is a ULID. **The criterion is
therefore defined as:**

> Two parses of the same `source_hash` by the same `(parser.name, parser.version,
parser.config_hash)` produce **byte-identical canonical JSON after removing
> `parser.parsed_at`**, where canonical JSON is: keys sorted, no insignificant whitespace,
> numbers in shortest round-trip form, empty optional arrays omitted (D11).
>
> `paper_id` is minted **once per `source_hash`** and held fixed across every re-parse;
> re-parses vary only `generation`. `paper_id` is therefore _not_ a source of nondeterminism.

Both facts are written into the `PaperId` and `ParserInfo.parsed_at` descriptions in the
schema so Epic 1 cannot mis-read the criterion.

**AND IT IS IMPLEMENTED, ONCE, IN EACH LANGUAGE.** `src/canonical.ts` (`canonicalJson`,
`canonicalJsonForDeterminism`) and `python/papertree_document_ir/canonical.py`
(`canonical_json`, `canonical_json_for_determinism`) are the only implementations; they are
pinned to each other by `conformance/canonical-vectors.json` and by `canonical.spec` in both
languages. **Epic 1's `worker/determinism.spec` and Epic 2 must CALL them, not re-derive them
from the four clauses above.** Until this landed, the four clauses were prose and nothing
implemented them — the one contract Epic 0 defined and did not ship, which is precisely the
"every feature invents its own representation" failure `findings.md` records. The two runtimes
did not even agree on the bytes of the same committed fixture: 112,359 in TypeScript against
112,777 in Python, diverging at 145 numeric literals, because the fixtures store
`"confidence": 1.0` and JavaScript re-emits it as `1`.

Two clauses need reading carefully, because the prose above is loose about both:

- **"numbers in shortest round-trip form" means ECMAScript `Number::toString`** (ECMA-262
  §6.1.6.1.20), in BOTH languages. Python's `repr` is also shortest-round-trip and formats
  differently; `canonical.py` re-derives the layout. An integer-valued number outside
  ±(2^53 − 1) is **rejected**, never emitted, in both — see §12.8.
- **"empty optional arrays omitted (D11)" is a SCHEMA guarantee, not a serialiser step.** Every
  optional array carries `minItems: 1`, so an empty one is not schema-valid and cannot reach the
  serialiser; several REQUIRED arrays (`Paper.relations`, every `Flows.*`, `Section.block_ids`)
  legitimately ARE empty, and a serialiser that dropped empty arrays would turn a valid document
  into an invalid one. `canonical.spec` asserts the `minItems` property directly, in both
  languages, so a future optional array shipped without it fails a test rather than quietly
  reopening the gap.

---

## 8. Worked minimal example

A valid `Paper`: two pages; a title with two children; a paragraph carrying an inline
equation located by a `role`-tagged span; a vector figure with its caption and a
`caption_of` relation; a display equation with a rejected model alternative; and one
`unknown` block. This JSON is not illustrative — `test/schema.spec.ts` extracts it from
between the markers below and validates it, so the documented example cannot drift from the
validated one.

<!-- BEGIN worked-example -->

```json
{
  "ir_version": "1.0.0",
  "paper_id": "ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE",
  "source_hash": "sha256:9f2c4b1e7a03d5c68f19b2e4a7c0d3f6819b5e2a4c7d0f36819b5e2a4c7d0f36",
  "generation": 1,
  "coordinate_space": "pdf_user_space_topleft",
  "parser": {
    "name": "pdfium-deterministic",
    "version": "0.1.0",
    "config_hash": "sha256:0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9",
    "profile": "born-digital-fast",
    "parsed_at": "2026-07-30T09:14:22Z"
  },
  "status": "complete",
  "partial_reason": null,
  "metadata": {
    "title": {
      "value": "Deep Residual Learning for Image Recognition",
      "source_block_id": "blk_7k2m4qx3tz5b6d7f",
      "confidence": 0.97
    },
    "authors": [],
    "abstract": null,
    "doi": null,
    "arxiv_id": null,
    "venue": null,
    "year": null
  },
  "pages": [
    {
      "page_id": "pg_2a4c6e2g4j6m2p4r",
      "index": 0,
      "width": 612,
      "height": 792,
      "rotation": 0,
      "user_unit": 1,
      "crop_box": [0, 0, 612, 792],
      "media_box": [0, 0, 612, 792],
      "image": {
        "uri": "r2://papers/ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE/pages/000@2x.webp",
        "scale": 2,
        "dpi": 144,
        "rendered_from": "page"
      },
      "has_text_layer": true,
      "is_scanned": false,
      "block_ids": [
        "blk_7k2m4qx3tz5b6d7f",
        "blk_a3c5e7g2j4m6p7r2",
        "blk_f2h4k6n2q4s6u2w4",
        "blk_b4d6f2h4k6n2q4s6",
        "blk_c5e7g3j5m7p3r5t7"
      ],
      "flows": {
        "body": ["blk_7k2m4qx3tz5b6d7f", "blk_a3c5e7g2j4m6p7r2", "blk_b4d6f2h4k6n2q4s6"],
        "caption": ["blk_c5e7g3j5m7p3r5t7"],
        "footnote": [],
        "header": [],
        "footer": [],
        "margin": []
      },
      "confidence": 0.98
    },
    {
      "page_id": "pg_3b5d7f3h5k7n3q5s",
      "index": 1,
      "width": 612,
      "height": 792,
      "rotation": 0,
      "user_unit": 1,
      "crop_box": [0, 0, 612, 792],
      "media_box": [0, 0, 612, 792],
      "image": {
        "uri": "r2://papers/ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE/pages/001@2x.webp",
        "scale": 2,
        "dpi": 144,
        "rendered_from": "page"
      },
      "has_text_layer": true,
      "is_scanned": false,
      "block_ids": ["blk_d6f2h4k6n2q4s6u2", "blk_e7g3j5m7p3r5t7v3"],
      "flows": {
        "body": ["blk_d6f2h4k6n2q4s6u2", "blk_e7g3j5m7p3r5t7v3"],
        "caption": [],
        "footnote": [],
        "header": [],
        "footer": [],
        "margin": []
      },
      "confidence": 0.83
    }
  ],
  "blocks": [
    {
      "block_id": "blk_7k2m4qx3tz5b6d7f",
      "type": "title",
      "page_index": 0,
      "polygon": [
        [54, 72],
        [558, 72],
        [558, 96],
        [54, 96]
      ],
      "bbox": [54, 72, 558, 96],
      "flow": "body",
      "order": 0,
      "doc_order": 0,
      "child_ids": ["blk_a3c5e7g2j4m6p7r2", "blk_b4d6f2h4k6n2q4s6"],
      "text": "Deep Residual Learning for Image Recognition",
      "text_normalised": "deep residual learning for image recognition",
      "content_hash": "blake2s:3f9a1c47b208e6d5",
      "source": "pdf_text_layer",
      "confidence": 0.99,
      "provenance": {
        "parser": "pdfium-deterministic",
        "stage": "layout+text"
      }
    },
    {
      "block_id": "blk_a3c5e7g2j4m6p7r2",
      "type": "paragraph",
      "page_index": 0,
      "polygon": [
        [54, 120],
        [292, 120],
        [292, 240],
        [54, 240]
      ],
      "bbox": [54, 120, 292, 240],
      "flow": "body",
      "order": 1,
      "doc_order": 1,
      "parent_id": "blk_7k2m4qx3tz5b6d7f",
      "child_ids": ["blk_f2h4k6n2q4s6u2w4"],
      "next_id": "blk_b4d6f2h4k6n2q4s6",
      "text": "We explicitly reformulate the layers as learning residual functions F(x).",
      "text_normalised": "we explicitly reformulate the layers as learning residual functions f(x).",
      "content_hash": "blake2s:8b1d0e2f6a4c9375",
      "spans": [
        {
          "start": 0,
          "end": 45,
          "bbox": [54, 120, 292, 132],
          "font": "NimbusRomNo9L-Regu",
          "size": 9.96
        },
        {
          "start": 45,
          "end": 68,
          "bbox": [54, 132, 240, 144],
          "font": "NimbusRomNo9L-Regu",
          "size": 9.96
        },
        {
          "start": 68,
          "end": 72,
          "bbox": [240, 132, 262, 144],
          "role": "inline_equation",
          "block_id": "blk_f2h4k6n2q4s6u2w4",
          "font": "CMMI10",
          "size": 9.96
        }
      ],
      "source": "pdf_text_layer",
      "confidence": 0.96,
      "provenance": {
        "parser": "pdfium-deterministic",
        "stage": "layout+text",
        "native_id": "#/texts/47"
      },
      "repairs": [
        {
          "kind": "dehyphenate",
          "applied": true,
          "at": 49,
          "from": "resid-\nual",
          "to": "residual"
        }
      ]
    },
    {
      "block_id": "blk_f2h4k6n2q4s6u2w4",
      "type": "inline_equation",
      "page_index": 0,
      "polygon": [
        [240, 132],
        [262, 132],
        [262, 144],
        [240, 144]
      ],
      "bbox": [240, 132, 262, 144],
      "flow": "body",
      "order": 0,
      "parent_id": "blk_a3c5e7g2j4m6p7r2",
      "text": "F(x)",
      "text_normalised": "f(x)",
      "content_hash": "blake2s:1a2b3c4d5e6f7081",
      "source": "pdf_text_layer",
      "confidence": 0.74,
      "provenance": {
        "parser": "pdfium-deterministic",
        "stage": "formula-region"
      },
      "payload": {
        "display": false,
        "latex": "\\mathcal{F}(\\mathbf{x})",
        "latex_confidence": 0.71,
        "image": null
      }
    },
    {
      "block_id": "blk_b4d6f2h4k6n2q4s6",
      "type": "figure",
      "page_index": 0,
      "polygon": [
        [320, 120],
        [558, 120],
        [558, 300],
        [320, 300]
      ],
      "bbox": [320, 120, 558, 300],
      "flow": "body",
      "order": 2,
      "doc_order": 2,
      "parent_id": "blk_7k2m4qx3tz5b6d7f",
      "prev_id": "blk_a3c5e7g2j4m6p7r2",
      "source": "pdf_vector",
      "confidence": 0.92,
      "provenance": {
        "parser": "pdfium-deterministic",
        "stage": "vector-figure"
      },
      "payload": {
        "figure_number": "2",
        "figure_kind": "diagram",
        "is_vector": true,
        "image": {
          "uri": "r2://papers/ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE/fig/blk_b4d6f2h4k6n2q4s6.webp",
          "scale": 3,
          "rendered_from": "vector"
        },
        "caption_block": "blk_c5e7g3j5m7p3r5t7",
        "detected_labels": [
          {
            "text": "conv 3x3",
            "polygon": [
              [340, 160],
              [396, 160],
              [396, 172],
              [340, 172]
            ],
            "source": "pdf_text_layer",
            "confidence": 0.88
          }
        ]
      }
    },
    {
      "block_id": "blk_c5e7g3j5m7p3r5t7",
      "type": "caption",
      "page_index": 0,
      "polygon": [
        [320, 308],
        [558, 308],
        [558, 332],
        [320, 332]
      ],
      "bbox": [320, 308, 558, 332],
      "flow": "caption",
      "order": 0,
      "text": "Figure 2. Residual learning: a building block.",
      "text_normalised": "figure 2. residual learning: a building block.",
      "content_hash": "blake2s:c40a7719e2b58d63",
      "source": "pdf_text_layer",
      "confidence": 0.95,
      "provenance": {
        "parser": "pdfium-deterministic",
        "stage": "layout+text"
      }
    },
    {
      "block_id": "blk_d6f2h4k6n2q4s6u2",
      "type": "equation",
      "page_index": 1,
      "polygon": [
        [54, 150],
        [292, 150],
        [292, 186],
        [54, 186]
      ],
      "bbox": [54, 150, 292, 186],
      "flow": "body",
      "order": 0,
      "doc_order": 3,
      "next_id": "blk_e7g3j5m7p3r5t7v3",
      "source": "pdf_text_layer",
      "confidence": 0.9,
      "provenance": {
        "parser": "pdfium-deterministic",
        "stage": "formula-region"
      },
      "alternatives": [
        {
          "parser": "pdfium-deterministic",
          "authored_by": "parser",
          "confidence": 0.9,
          "decision": "selected",
          "rule": "prefer_native_text_when_delta<0.2"
        },
        {
          "parser": "vlm-repair",
          "authored_by": "model",
          "text": "\\mathcal{F}(x) + x",
          "confidence": 0.88,
          "decision": "not_selected",
          "rule": "prefer_native_text_when_delta<0.2"
        }
      ],
      "payload": {
        "display": true,
        "equation_number": "1",
        "latex": "\\mathcal{F}(\\mathbf{x}) := \\mathcal{H}(\\mathbf{x}) - \\mathbf{x}",
        "latex_confidence": 0.88,
        "image": {
          "uri": "r2://papers/ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE/eq/blk_d6f2h4k6n2q4s6u2.webp",
          "scale": 3,
          "rendered_from": "page"
        }
      }
    },
    {
      "block_id": "blk_e7g3j5m7p3r5t7v3",
      "type": "unknown",
      "page_index": 1,
      "polygon": [
        [320, 400],
        [558, 400],
        [558, 520],
        [320, 520]
      ],
      "bbox": [320, 400, 558, 520],
      "flow": "body",
      "order": 1,
      "doc_order": 4,
      "prev_id": "blk_d6f2h4k6n2q4s6u2",
      "source": "pdf_vector",
      "confidence": 0.31,
      "provenance": {
        "parser": "pdfium-deterministic",
        "stage": "layout"
      }
    }
  ],
  "relations": [
    {
      "type": "caption_of",
      "from": "blk_c5e7g3j5m7p3r5t7",
      "to": "blk_b4d6f2h4k6n2q4s6",
      "confidence": 0.91,
      "provenance": "geometric+numbering"
    },
    {
      "type": "parent_of",
      "from": "blk_7k2m4qx3tz5b6d7f",
      "to": "blk_a3c5e7g2j4m6p7r2",
      "confidence": 1,
      "provenance": "font-cluster"
    },
    {
      "type": "parent_of",
      "from": "blk_7k2m4qx3tz5b6d7f",
      "to": "blk_b4d6f2h4k6n2q4s6",
      "confidence": 1,
      "provenance": "font-cluster"
    },
    {
      "type": "parent_of",
      "from": "blk_a3c5e7g2j4m6p7r2",
      "to": "blk_f2h4k6n2q4s6u2w4",
      "confidence": 1,
      "provenance": "span-role"
    }
  ],
  "sections": [
    {
      "heading_block_id": "blk_7k2m4qx3tz5b6d7f",
      "level": 1,
      "block_ids": [
        "blk_a3c5e7g2j4m6p7r2",
        "blk_b4d6f2h4k6n2q4s6",
        "blk_c5e7g3j5m7p3r5t7",
        "blk_d6f2h4k6n2q4s6u2",
        "blk_e7g3j5m7p3r5t7v3"
      ]
    }
  ],
  "references": [],
  "confidence": {
    "overall": 0.91,
    "by_page": [0.98, 0.83],
    "weakest_pages": [1],
    "needs_review": true
  }
}
```

<!-- END worked-example -->

Things to read out of it:

- The `unknown` block on page 1 carries polygon, bbox, flow, order, source, confidence and
  provenance — and **no text**. It is exactly as expressible as the title block. That is
  the `connect_orphans` discipline in schema form.
- The `inline_equation` is a real, addressable block with its own geometry and LaTeX, **and
  it is located inside the paragraph** by the third span (`role: "inline_equation"`,
  `block_id`, offsets 68–72). It is nested (its parent is a paragraph, not a heading), so it
  has **no `doc_order`** and does **not** appear in `page.flows.body`: the body stream reads
  `title → paragraph → figure`, not `title → paragraph → F(x) → figure`.
- Its `payload.image` is `null` — detected, not yet cropped. Legal here; illegal if
  `status` were to stay `"complete"` after the crop step (rule 36 applies to a finished
  parse, and this example is the shape a mid-pipeline document takes).
- The caption is in the `caption` flow with its own `order: 0` and no `doc_order`.
- Every offset indexes one string: `text[49:57] == "residual"` (the applied dehyphenation)
  and `text[68:72] == "F(x)"` (the inline-equation span).
- The equation keeps a VLM's competing reading — and that alternative is
  `authored_by: "model"`, which the schema pins to `not_selected`. It is evidence in the
  record and can never be what renders.
- `next_id`/`prev_id` link **siblings only**: `title.child_ids` descends, `paragraph.next_id`
  goes sideways to the figure. A parent is never its child's `next`.

And a matching `Derivation`, which is the only place model prose about this paper may
live — **one Derivation per renderable unit**, so a twenty-paragraph guided section is
twenty of these, not one:

```json
{
  "derivation_id": "drv_01JQ8ZD7Y5V3WCP7S4MFXZ8JBG",
  "paper_id": "ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE",
  "kind": "guided_section",
  "author": {
    "kind": "model",
    "model_id": "anthropic/claude-haiku-4.5",
    "prompt_hash": "sha256:1f2e3d4c5b6a7988"
  },
  "content": "Residual learning reframes each block as learning a correction to the identity.",
  "derived_from": ["blk_a3c5e7g2j4m6p7r2", "blk_d6f2h4k6n2q4s6u2"],
  "created_at": "2026-07-30T09:20:00Z"
}
```

Push that object into `paper.blocks[]` and it fails validation on many counts (missing
required block fields plus rejected unknown fields). Push it into `paper.blocks[i].payload`
— which is where it used to fit whole — and it now fails too, on `derivation_id`,
`derived_from` and the nested `model_id`/`prompt_hash`. That is Commitment 1 working at both
levels.

---

## 9. Critiques considered and rejected

Every FATAL and MATERIAL finding from the two reviews was either fixed (§4 D13–D23, §5.2)
or rejected here. Silence was not an option; these are the rejections, with reasons.

| #   | Proposal                                                                                                     | Rejected because                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Split `Repair.kind` into a closed `authorship: {deterministic, model}` plus an open `kind` string.           | It stores one fact in two places and keeps them in sync by convention — the exact redundancy this schema deletes elsewhere (D20). The real complaint behind it, "a new deterministic repair kind costs a major bump", is answered directly in §7: it is now a **minor** bump with no migration and no re-anchor.                    |
| R2  | Add a required closed `Block.kind_class` enum and key the payload `if/then` on it.                           | A second classification axis that must be kept consistent with `type` forever, for one benefit — near-miss type strings — that the `^[a-z][a-z0-9_]{0,63}$` pattern (D2) already delivers in one line. ADR-001 does not ask for it and no Wave-1 epic needs it.                                                                     |
| R3  | Validate `provenance.parser` against a parser registry.                                                      | No registry exists in Epic 0 and creating one is Epic 1's business (it owns the adapters). Recorded as a note for Epic 1 rather than as an Epic 0 rule that would have nothing to check against.                                                                                                                                    |
| R4  | Give `Reference` per-field provenance objects like `MetadataValue`.                                          | `Reference` is a materialised view over **one** block, so per-field `source_block_id` would be that same id repeated seven times. Rule 35 (every field appears in the entry's text) carries the entire weight at a fraction of the size.                                                                                            |
| R5  | Semantic rule "no `applied: true` repair on a block whose `alternatives[]` contain a model-authored parser". | Unenforceable without R3's registry, and made redundant by two fixes that _are_ in: deterministic repairs may not name a model (D4), and model-authored alternatives cannot be selected (D8).                                                                                                                                       |
| R6  | Add a `float` or `nested` value to `Flow`.                                                                   | Widening a closed enum is a **major** bump (§7) and it conflates two orthogonal things: _which reading order_ a block belongs to, and _whether it is nested_. Nesting is already a tree property (`parent_id`), so D14 expresses it with **no schema change at all**.                                                               |
| R7  | Add `Repair.accepted_at` / `accepted_by` so a user-accepted VLM repair can become `applied: true`.           | It reopens the one door D4 closes: a second path by which non-source text becomes `Block.text`. A user accepting a repair is a new _parse generation_ (D13), not an in-place mutation of an immutable document. Out of Epic 0's scope; revisit in v1.1 if Epic 2 actually builds the acceptance UI.                                 |
| R8  | Make `Block.confidence` required-and-nullable.                                                               | It forces every consumer to branch on `null` at the hottest field in the schema, for a case that has a well-defined answer instead: §10 gives the deterministic adapter a normative mapping. Nullability was applied where there genuinely is no answer — `DocumentConfidence` on a failed parse (D21).                             |
| R9  | Make `spans` required in the schema.                                                                         | A parser without character geometry must still be able to emit a document; requiring spans would make its output _unrepresentable_ rather than merely poorer, which is the failure mode D16 exists to avoid. It is instead a **fixture** requirement (§10) and a semantic rule for the fields that _are_ about anchoring (rule 37). |
| R10 | Add a `paperir-slice` schema for page-scoped API responses.                                                  | Epic 0 is deliberately small and no wire format exists yet to model. Recorded in §10 as an explicit ownership assignment instead: the slice type is Epic 2's, must be **generated from these `$defs`**, and must never be hand-written.                                                                                             |
| R11 | Add an optional free-form `Alternative.payload` so two competing LaTeX readings can be kept.                 | Real, but an _optional_ field is a **patch** bump (§7) and can be added the day Epic 1 F1.7 actually produces two disagreeing VLM readings. Adding it now would be a field with no producer — the over-build ADR-001's own falsification condition warns about.                                                                     |
| R12 | Add `pdf_mixed` to `SourceKind` for figures with vector axes and raster content.                             | `SourceKind` is a safety enum and widening it is a **major** bump. D20 solves the same problem for free by decoupling `is_vector` from `source`.                                                                                                                                                                                    |
| R13 | Add `Paper.promoted` (boolean) alongside `generation`.                                                       | `Paper` is immutable; promotion is mutable state that changes _after_ the document is written. Recording it inside the document would guarantee a stale field. It belongs in `packages/db` (D13).                                                                                                                                   |
| R14 | Add `Repair.at_original` alongside `at`.                                                                     | Two offset bases is the bug, not the fix. D17 makes **one** string addressable — `Block.text` as stored — and every offset in the schema indexes it.                                                                                                                                                                                |
| R15 | Constrain `Derivation.content` to `[{text, derived_from}]` for `kind: "guided_section"`.                     | `content` being unconstrained is the point of the second file. The grounding granularity ADR-001 asks for is achieved by **stating** that one Derivation is one renderable unit (§3, and the `Derivation` description), which costs nothing and does not standardise a shape that five different derivation kinds would each fight. |

---

## 10. Notes the other Epic-0 features and Wave 1 need

**F0.5 (SQLite schema).** The generation model changes the keys: `papers` on
`(paper_id, generation)` with `UNIQUE(source_hash, generation)`; `blocks` PK
`(paper_id, generation, block_id)`; same for `pages`, `relations`, `block_vectors`.
F0.5's table list also has no home for `Paper.sections` or `Paper.references`, which are
required arrays: add either two tables or two JSON columns on `papers`. `Reference`'s parsed
fields are **parse outputs, not derivable**, so they must be stored. `Page.flows` is
reconstructable from `blocks(page_index, flow, order)` filtered to top-level blocks and
should **not** be stored.

**F0.7 (fixtures) — beyond schema-validity.** All three fixtures must additionally carry:
every text block's `spans` at line-fragment granularity, and `text_normalised` +
`content_hash` on every `pdf_text_layer` text block (rule 37). Without them Epic 2 is handed
fixtures that `anchoring/zoom.spec` (<1 pt centroid drift) and `anchoring/reparse.spec`
(≥99% re-anchor) cannot run against — neither tier-1 character geometry nor tier-2
content hashes would exist. At least one fixture must contain a real table so the D14
nesting rules are exercised, and at least one an inline equation with a `role`-tagged span.

**Confidence — the normative mapping for the deterministic adapter (Epic 1).** Required
because otherwise every block gets `0.99`, `by_page` becomes a constant array, and
`weakest_pages` / `needs_review` are noise from day one.

| Situation                                                                                                                                                               | `Block.confidence`                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Text read directly from a born-digital text layer, region fully recovered, type assigned by an unambiguous rule (e.g. `reference_entry` inside the bibliography region) | `1.0` — a legitimate value, not a placeholder             |
| Text-layer text, type assigned by a heuristic with a competing candidate                                                                                                | `1 − (margin between top two candidates)`, floored at 0.5 |
| Region detected but unclassified (`unknown`)                                                                                                                            | the detector's own score, or `0.3` if it has none         |
| OCR transcription                                                                                                                                                       | the OCR engine's mean per-character confidence            |
| Vector figure region from drawing-operation clustering                                                                                                                  | cluster cohesion score                                    |

`Page.confidence` is the block-count-weighted mean of its blocks. `DocumentConfidence.overall`
is the page-weighted mean, or `null` (D21). `needs_review` is true iff any page is below
0.7. Epic 1 may revise these numbers, but it must revise this table with them — a
confidence whose meaning is not written down is a fabricated measurement.

**Fields with no Wave-1 producer** (record in `EPIC-00-RESULT.md`; not defects — ADR-001
asks for all of them — but ADR-001's falsification condition is about exactly this):
`EquationPayload.symbols`, `FigurePayload.panels`, `FigurePayload.detected_labels`,
`Alternative` (Epic 1 ships one parser, so nothing disagrees), all `Reference` parsed
fields, all of `Paper.metadata`, and the relation types `defines`, `explains`, `result_of`,
`references`, `cites`, `visually_associated_with`. **`Metadata` is a required object and no
epic currently owns filling it** — Epic 1's feature list needs document-metadata and
bibliography extraction added, or Wave 1 ships all-null metadata.

**The API wire format is deliberately not PaperIR.** `Paper` requires `pages`, `blocks`,
`relations`, `sections` and `references` all present; a 55-page paper at ~30k blocks is
~12 MB of JSON and Epic 2 mounts "visible page ± 2". Any per-page endpoint therefore returns
something that is **not** a valid `Paper`. That type is **Epic 2's to define**, and it must
be _generated from these `$defs`_ (a `Pick`/`Partial` over `Block`, `Page`, `Relation`), not
hand-written — hand-writing it is the "two representations that drift" failure of
`findings.md` G5.

---

## 11. Residual risks

Stated plainly, because an overclaimed guarantee is how an epic skips a check.

### 11.0 CLOSED — the block-id alphabet conflict was resolved in favour of the schema

Kept as a closed historical note, in §12's style, because it was a FREEZE-BLOCKING banner on a
resolved conflict for long enough that an acceptance review found it and traced every sentence in
it to be false at HEAD. A reader who acted on it would have "fixed" a non-existent conflict by
changing the pattern to `^blk_[A-Z2-7]{16}$` — invalidating all 433 conformance vectors, all 3
fixtures and the whole identity suite.

**What it said:** the schema pinned `^blk_[a-z2-7]{16}$` while ADR-001 Amendment 1's ENCODE step
produced uppercase, so 0 of the then-217 conformance vectors validated, and one artefact had to
change before Epic 1 minted an id.

**How it was resolved:** THE FORMULA MOVED, NOT THE SCHEMA. ADR-001 Amendment 1's ENCODE step now
lowercases the base32 (ADR-001, "the formula moved, not the schema"), and
`conformance/identity-vectors.json` was regenerated. **433 of 433 vectors validate against
`^blk_[a-z2-7]{16}$`**; `research/benchmarks/id-conformance-vectors.json`, the file this section
cited, no longer exists. `test/schema.spec.ts`'s block is now titled "block ids from ADR-001
Amendment 1 validate against the frozen pattern" and asserts AGREEMENT.

**The lesson worth keeping**: the tripwire test that was supposed to turn red on reconciliation
DID turn red, was corrected, and the prose did not follow it. A tripwire guards the artefact it
asserts on; it does not guard the paragraph that describes it. When a §11 entry is resolved,
resolve the entry.

Do **not** re-open this by making the pattern case-insensitive: two spellings of one id
reintroduces exactly the two-encodings-of-one-fact problem D11 exists to remove, and it would
break the canonical-JSON byte-identity criterion (§7.1).

---

1. **Undeclared model prose in `Block.text` is not detectable by this schema.** `source:
"ocr"` is legitimate for a scanned page and costs a dishonest producer nothing.
   `provenance.parser` is a free string and will corroborate rather than expose. The schema
   makes AI-in-source _undeclarable_; the `ingest/source-authenticity.spec` lint owed by
   Epic 1 (§2.2) is what makes it _detectable_. **Do not treat the schema as a substitute
   for that lint.**
2. **`Block.payload` on an unknown block type is closed against the _shape_ of a
   derivation, not against prose.** `{"note": "<model paragraph>"}` on a
   `type: "guided_paragraph"` block still validates. Blocking it entirely would destroy the
   forward compatibility that D2 exists to provide. The mitigation is the same lint, plus
   the fact that no consumer renders an unknown type's payload as source.
3. **A bottom-left-origin document whose coordinates happen to fall inside the CropBox is
   indistinguishable from a correct one.** G4 catches wrong page dimensions, G7 catches
   out-of-box geometry, G8 warns on normalised fractions — but a vertically mirrored page
   passes all three. Only `geometry.spec`'s round-trip against the actual PDF catches it,
   which is why F0.4's conformance vectors are not optional.
4. **`EquationPayload.latex` / `mathml` and `TablePayload.html` accept arbitrary strings.**
   Acceptable: each is a _declared interpretation_ with its own confidence, the required
   `image` is the ground truth, and the UI is obliged to render them in the "our reading"
   register. This holds **only if the UI actually does that** — Epic 2 owns that promise.
5. **`figure_kind` is an open string while `diagram` and `plot` are also block types.**
   ADR-001 has it both ways and this schema does not resolve it. Epic 1 must pick one
   convention and document it rather than populating both.
6. **`Paper.partial_reason` is operator-facing free text that is surfaced to the reader**
   and has no stated discipline. Minor, but it is the one free string in the schema with
   none.
7. **Block-id derivation is settled elsewhere, and only the string shape is frozen here.**
   ADR-001 **Amendment 1** (2026-07-30) resolved it by measurement: SHA-256, **1.0 pt grid**,
   `q(v) = floor(v/1.0 + 0.5)`, **anchor** geometry (`x0, y0` only), **8-code-point** text
   prefix, base32 lowercased and truncated to 16 chars. Nothing in this schema depends on the
   outcome. (This item said "2.0 pt grid" and "32-code-point text prefix" until an acceptance
   review caught it: those are the pre-rev-3 numbers, they contradicted `$defs/BlockId`'s own
   description and the shipped `GRID_PT = 1.0` / `TEXT_PREFIX_CODEPOINTS = 8` in the same
   repository, and anyone re-implementing the formula from here rather than from ADR-001 or the
   code would have produced ids matching none of the 433 conformance vectors.)
8. **`Block.payload`'s closure against authorship is a DENY-LIST OF KEY NAMES plus a key
   shape, not a proof.** Every key at every depth must match `^[a-z][a-z0-9_]{0,63}$` and no
   object anywhere may carry one of the 35 names in `$defs/ModelFreeSubtree`. That is stronger
   than it was — the list was seven names and the key shape applied only to the OUTERMOST payload
   object, so `{"meta": {"GENERATED_BY": "gpt-4"}}` and `{"meta": {"model-id": "gpt-4o"}}` both
   validated while their lowercase depth-0 spellings did not — but a deny-list cannot be
   complete. A producer declaring authorship under a name nobody listed still validates. Read the
   def's description, not the summary sentence, and see risk 1: detection is the owed lint's job.
9. **Rule 30b's `unicode_normalise` class means NFKC AS OF UNICODE 15.0.0, which is a small
   widening of "to == NFKC(from)".** It used to call the runtime's NFKC and forked the two twins
   on 83 code points — the 46 that gained a canonical combining class after 15.0.0 plus the 37
   that gained a compatibility decomposition (U+A7F1, U+1CCD6–U+1CCF9) — so one and the same
   repair was an ERROR in Python 3.12 and clean in Node 22. It is now pinned by
   `validate.pinnedNfkc` / `validate.pinned_nfkc` the same way NFC and the case fold are pinned,
   and guarded by a cross-language digest over all 1,112,064 code points. The residual is the
   widening itself: a document whose repair was written against a NEWER NFKC is now rejected.
   That is the intended direction — a verdict that depends on which language ran it is worse.
10. **Nothing forbids `status: "complete"` with zero blocks.** Deliberate — a genuinely
    empty PDF exists — but it is also the shape a total extraction failure takes, so the
    ingest epic should treat it as a red flag. (Rule 41 covers the `failed` direction.)

## 12. Known binding divergences

The schema is the contract; ajv is its reference implementation; Zod and Pydantic are generated
bindings. §6 says a binding is never a _second_ source of truth — but three programs in two
languages can still disagree on inputs the schema never anticipated, and the only honest way to
carry that is to write the disagreements down and test them.

This section is the output of a **differential attack**: 347 hostile documents were pushed through
ajv, Zod and Pydantic side by side. 316 were unanimous; the remaining 31 collapsed into 8 classes,
listed below with what was done about each. Six were closed in `codegen/generate.ts`. Two remain,
deliberately, and both are _asserted_ by `test/cases/` — see the `divergence` block in
`codegen/build-corpus.ts`, which `equivalence.spec.ts` and `test_equivalence.py` pin one verdict at
a time. **A closed divergence turns its own annotation red**, so nothing here can go stale quietly.

The rule the section exists to enforce: a _documented_ divergence is acceptable, a _silent_ one is
not. Nothing below was fixed by hand-editing a generated file — a hand edit is exactly the drift
`codegen-drift.spec.ts` exists to catch, and the next `codegen` run deletes it.

### 12.1 `__proto__` under `Block.payload` — CLOSED (was FATAL)

`JSON.parse('{"__proto__": {...}}')` creates an **own** property; an object _literal_ with the same
text sets the prototype and creates no key at all. The Zod binding validated `payload` with
`z.record(z.string(), z.unknown())`, and `z.record` **rebuilds** the object key by key — where
`out["__proto__"] = v` writes the prototype rather than a key. The key therefore vanished from the
parsed output _before_ `propertyNames`, `findModelDeclaration`, or a nested `EquationPayload`'s
`.strict()` ever ran.

Consequences beyond the verdict: **ADR-001 Commitment 1** ("there is no field in which a producer
may record that content is model-authored") was defeated specifically through Zod — a whole
`Derivation` fitted inside `__proto__` — and the payload re-serialised as `{}`, silently losing data
and breaking the byte-identical re-parse criterion of §7.1. ajv and Pydantic were both right;
`json.loads` makes `__proto__` an ordinary key, so Python was never exposed.

**Fix:** the generator emits `openObject()` — a `z.custom` guard that passes the parsed value
through _by reference_ — everywhere `{"type": "object"}` appears, including `OpaquePayloadSchema`.
`codegen-drift.spec.ts` now asserts that `z.record(` does not reappear in any generated validator,
because the older structural check (`.object({` count === `.strict()` count) structurally _cannot_
see this class of hole. Corpus: `proto-payload-*`, `proto-inside-equation-payload`,
`proto-as-block-key`, and `constructor-payload-key` (which must stay **valid** — the fix must not
over-reject a key that legitimately matches the identifier pattern).

### 12.2 `\s` means three different things in three regex engines — CLOSED (was FATAL + MATERIAL)

`ImageRef.uri`'s `[^\s]` is the schema's only whitespace class, and it was handed verbatim to three
engines that do not agree on `\s`:

| code point    | ECMA-262 `\s` (ajv, Zod)      | Rust `regex` `\p{White_Space}` (pydantic-core) |
| ------------- | ----------------------------- | ---------------------------------------------- |
| U+FEFF ZWNBSP | whitespace → **rejected**     | not whitespace → **accepted**                  |
| U+0085 NEL    | not whitespace → **accepted** | whitespace → **rejected**                      |

Two live divergences in opposite directions, from one backslash. A sweep of 20 code points found
these two and no others.

**Fix:** `generate.ts` expands `\s`/`\S` into an explicit ECMA-262 character class before emitting
any non-JavaScript regex (`expandEcmaClasses`). The Zod binding keeps the schema's own pattern —
JavaScript is the reference. The schema file is untouched. `codegen-drift.spec.ts` asserts that no
bare `\s` survives into a Python `pattern=` or `re.compile`. Corpus: `uri-whitespace-*`, covering
both directions plus the controls.

> Recorded for 2.0.0: a companion `pattern` written without shorthand classes would make the
> contract reproducible in any language for free. `\s` in a frozen schema is a portability bug.

### 12.3 `"type": "integer"` is a _number_ with no fractional part — CLOSED (was MATERIAL)

JSON Schema `integer` matches `1.0`, `1e0` and `10e-1`; `z.number().int()` agrees, because
JavaScript has one number type. Strict Pydantic refused all three (`int_type`,
`input_value=1.0, input_type=float`), on **all 10 integer fields** — `generation`, `pages[].index`,
`pages[].rotation`, `blocks[].order`, `blocks[].doc_order`, `blocks[].page_index`, `spans[].start`,
`repairs[].at`, `sections[].level`, `metadata.year.value`. This was the widest blast radius in the
set: every non-JavaScript producer (a Go `float64`, a numpy pipeline, `json.dumps` of a computed
year) emitted documents ajv blessed and the Python binding refused.

**Fix:** integer fields emit as `JsonInt = Annotated[int, BeforeValidator(_json_integer)]`, which
converts a `float` with a zero fractional part and leaves everything else alone. `bool` is passed
through **unchanged** so strict mode still rejects it — `False == 0` in Python and ajv rejects
`rotation: false`, and a conversion here would have quietly reopened that trap. Integer _enums_
(`Page.rotation`) already avoided `Literal[0, 90, …]` for the same reason and now sit on `JsonInt`
too, so the conversion happens before the membership test. Corpus: `integer-*`.

### 12.4 U+0085 in `ImageRef.uri` — CLOSED

The mirror of §12.2, same root cause, same fix, opposite direction. Kept as its own entry because
it is the case where the bindings had to become **more permissive**, not less: `ajv` and Zod accept
U+0085 and Pydantic must too. A fix that only chased "Pydantic is too lax" would have missed it.

### 12.5 Unpaired surrogates — OPEN, deliberate, asserted (`class: "lone-surrogate"`)

|          | verdict                  |
| -------- | ------------------------ |
| ajv      | **valid**                |
| Zod      | **invalid** (deliberate) |
| Pydantic | **invalid** (deliberate) |

An unpaired surrogate (`"a\ud800b"`) is legal in a JSON _text_ and both parsers read it. It is not
UTF-8-encodable, so such a document cannot survive the serialisation round-trip `$defs/Point`'s own
description makes a precondition, and it cannot be stored by F0.5. pydantic-core already rejected
it in every string carrying `pattern` or `min_length` (`string_unicode`) while silently **accepting**
it in an unconstrained one — a binding disagreeing with _itself_, which is worse than disagreeing
with ajv.

**Disposition: not closed against ajv; made uniform and explicit.** Both generated bindings now
reject an unpaired surrogate in **every** string — `isWellFormedText` in Zod, `JsonText` in
Pydantic — rather than inheriting one engine's incidental behaviour. This is a deliberate
_strengthening_ over the schema, and it is the one place in F0.3 where the bindings are not a
faithful port.

Residual, stated plainly: string **values inside an opaque payload** are typed `unknown`/`Any` in
both bindings and are not walked, so a surrogate can still hide there. Closing that would mean
walking every payload value in both languages; it was judged not worth the cost for a shape no
producer emits. If §7.1's canonicalisation is ever asked to guarantee UTF-8 encodability of a whole
document, this is the gap to close.

Corpus: `lone-surrogate-constrained-string`, `lone-surrogate-unconstrained-string` (both carrying
the `divergence` annotation), and `astral-pair-string`, which must stay **valid** in all three — a
well-formed surrogate pair is an ordinary character.

### 12.6 Payload nesting depth — OPEN, deliberate, asserted (`class: "payload-depth"`)

`$defs/ModelFreeSubtree` is recursive and the schema states no depth bound, so "is a 2000-deep
payload valid?" was a property of somebody's C stack:

| depth  | ajv                     | Zod (before) | Pydantic (before)    |
| ------ | ----------------------- | ------------ | -------------------- |
| ≤ 1500 | valid                   | valid        | valid                |
| 2000   | **throws `RangeError`** | **valid**    | **`RecursionError`** |
| 5000   | throws                  | throws       | `RecursionError`     |

Two problems. ajv _throws_ rather than returning `false`, so a caller writing `if (validate(doc))`
gets an exception on adversarial input. And in the 2000 window Zod returned **valid** where ajv
could not return valid at all — the same shape as §12.1.

**Disposition: bounded, not matched.** Both bindings bound opaque-payload nesting at
`MAX_PAYLOAD_DEPTH = 64` (one constant in `generate.ts`, emitted into both languages and asserted
equal by `codegen-drift.spec.ts`). The depth walk is **iterative** in both — a guard against
unbounded recursion that is itself recursive overflows on exactly the input it exists to reject.
64 is two orders of magnitude past anything a parser emits (real payloads are 2–4 deep).

The window this opens is honest and bounded: between depth 65 and ajv's stack limit, ajv says valid
and the bindings say invalid. Beyond it, ajv gives no answer at all, and `equivalence.spec.ts` now
wraps the ajv call in `try/catch → invalid`, because "could not decide" is not "accepted". A bound
you can state beats a bound you discover in production.

Corpus: `payload-depth-at-limit` (64, valid in all three) and `payload-depth-over-limit` (65,
annotated), plus a named criterion in both suites that drives 2000 levels and asserts ajv throws
while the bindings return a verdict.

### 12.7 `NaN` / `Infinity` at the parse layer — CLOSED at the boundary, documented

CPython's `json.loads` accepts the non-JSON literals `NaN`, `Infinity` and `-Infinity`; `JSON.parse`
cannot read them at all and throws before any validator sees the document. There is no hole
**today** only because every `number` in PaperIR 1.0.0 is bounded (`Confidence` 0–1, `Point` ±20000,
`ImageRef.scale` 0–64, …), so an infinity fails a bound in all three. The first _unbounded_ number
added in a later version would open it silently: Pydantic's `allow_inf_nan` defaults to `True`.

**Fix (defence in depth, no verdict changes today):** every float field emits
`Field(allow_inf_nan=False)`, and the Python package exposes `loads()` — `json.loads` with
`parse_constant` wired to raise — as the parse-layer twin of `JSON.parse`'s refusal. Use it instead
of `json.loads` when reading a PaperIR document.

### 12.8 Integers beyond 2^53 — OPEN, value fidelity only, documented

`{"generation": 9007199254740993}` is **valid in all three**, but JavaScript holds
`9007199254740992`; a 40-digit integer becomes `1.1111111111111112e+39`. Same for `spans[].start`,
`references[].year` and `metadata.year.value`, which carry a `minimum` and no `maximum`.

This is not a verdict divergence, and it is **not fixable in a binding**: adding a
`maximum: 9007199254740991` in the bindings would make them reject documents the schema accepts,
and adding it to the schema is a change to a frozen file. It is recorded here because it falsifies
the _other_ half of §7.1 — "re-parsing produces byte-identical PaperIR" does not hold across the
TypeScript/Python boundary for such a value. Corpus case
`integer-generation-beyond-safe-range` pins the unanimous **valid** verdict so the claim in this
paragraph stays true and visible.

**Owner: 2.0.0.** Give the unbounded integer fields a `maximum` of `9007199254740991`.

### 12.9 Two smaller residuals, unchanged from F0.3's own report

1. **`minLength` counts code points** in JSON Schema and in Python, and **UTF-16 units** in Zod's
   `.min()`. Reachable only with astral-plane characters in a `minLength`-constrained field; no
   corpus case reaches it, and the only such fields are identifiers whose `pattern` is ASCII-only,
   which makes it unreachable in practice rather than merely untested.
2. **`type: "integer"` and the literal `1.0`** — closed for _validation_ by §12.3. What remains is
   that canonical serialisation (§7.1, D11) must never emit `1.0` for an integer field, or the
   re-parse is not byte-identical. That is F0.4's contract, not F0.3's.

### 12.10 Probed and clean — the seams that did **not** diverge

Recorded so the next attacker does not re-run them: trailing-newline pattern escapes (ECMA `$` vs
Python `$` — codegen correctly uses `\Z` in the `re` helpers) on every patterned field; near-miss
discriminators (`"Equation"`, `"equation "`, `"equation​"`, ZWSP/RTL/NUL/fullwidth/Cyrillic-е);
`additionalProperties: false` at **all 26 closed objects**; unknown block and relation types; all
four nullable/optional states in both directions (the `NON_NULLABLE_OPTIONAL` before-validator
matches ajv exactly); duplicate keys (last-wins in both parsers); the `from` → `from_` Python-keyword
alias (`populate_by_name` is off, so `"from_"` is rejected as an extra key); `has_text_layer: 1` /
`"true"`, `index: "0"`, `rotation: false`; and all 23 `date-time` probes including leap seconds, the
1900/2000 century rules, offsets and separators.
