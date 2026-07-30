# ADR-001 — PaperIR: the canonical document representation

- **Status:** Proposed
- **Date:** 2026-07-29
- **Supersedes:** the de-facto representation (`papers.extracted_text`: a flat string with `[Page N]` markers)
- **Depends on:** ADR-002 (parsing pipeline), ADR-003 (primary database)

---

## Context

PaperTree today persists exactly one representation of a paper: a single concatenated
string produced by 13 lines in `routes.py:25-37`. It carries no geometry, no block
identity, no hierarchy, no figures and no confidence. Measured on ResNet it yields
99,210 characters and **zero addressable objects** (`findings.md` §A).

Two structured extractors exist — `papers/extraction.py` (1,016 lines, with bounding
boxes and `SourceLocation`) and `papers/services.py` (682 lines) — and **neither is
imported by anything**. The provenance layer the product vision requires has never run.

Every downstream feature is blocked by this one fact:

| Feature | Blocked because |
|---|---|
| Durable highlights | nothing to anchor to; current anchors are `getClientRects()/window.innerWidth` (`read/page.tsx:228`) and are unrecoverable |
| Source-grounded answers | no object can be cited |
| Guided view | LLM prose is *substituted for* the paper rather than aligned to it |
| Canvas → source navigation | a node's provenance is one page integer (`canvas/services.py:562`) |
| Audiobook + Paper Replay | nothing to map a spoken segment onto |
| Structure-aware retrieval | no structure |
| Equation/figure inspectors | no equation or figure objects |

So the representation is not one design problem among many. It is *the* design problem,
and every other decision in this report is downstream of it.

### Requirements PaperIR must satisfy

1. Faithful rendering and UI mapping (PDF *and* reflowed)
2. Reliable source-grounded AI questions
3. Equation and diagram understanding
4. Semantic reading modes
5. Audiobook generation with source mapping
6. Citation and provenance tracking
7. Infinite-canvas exploration
8. Stable highlights across devices, zoom levels **and parser upgrades**

Plus the standing rules: never discard geometry, never lose provenance, never silently
repair source, represent uncertainty explicitly, and never let AI-generated content be
indistinguishable from source.

---

## Decision

Adopt **PaperIR v1**, a versioned, geometry-preserving document graph, with **three
structural commitments** that distinguish it from "Markdown plus bounding boxes".

### Commitment 1 — Source and derivation are different stores

This is the most important decision in the ADR.

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│         PaperIR             │        │        Derivations           │
│  SOURCE-DERIVED ONLY        │◄───────│  AI-GENERATED ONLY           │
│  immutable per parse        │  refs  │  guided sections, summaries, │
│  every field traceable to   │        │  narration, explanations,    │
│  a region of the PDF        │        │  canvas nodes, flashcards    │
└─────────────────────────────┘        └──────────────────────────────┘
```

No LLM ever writes into PaperIR. Not a title, not a section name, not a caption.
A derivation **references** block IDs; it never replaces them.

Why this is structural rather than a UI convention: the current product violates the
"AI content must not look like source" rule in three separate places — Book mode renders
model prose as the document with real page numbers attached (`BookViewer.tsx:686-713`),
`smart_outline` is built from LLM-invented page titles (`routes.py:198-207`), and failed
generations are stored as content (`llm_service.py:282-292`). Each was a local decision
that seemed reasonable. A schema-level separation makes the violation *impossible to
express* rather than merely discouraged.

Practical consequence: the Guided view is not "the book". It is a derivation whose every
paragraph carries `derived_from: [block_ids]`, rendered in a visually distinct register,
with the source one tap away.

### Commitment 2 — Geometry is in PDF user space, and it never leaves

Every spatial fact is stored in **PDF user space (points), origin top-left**, normalised
from the PDF's native bottom-left origin exactly once at parse time, together with the
page's `width`, `height`, `rotation` and `user_unit`. Never viewport pixels. Never
fractions of a DOM element.

Regions are **polygons**, not rectangles, because a text selection spanning lines in a
two-column layout is not a rectangle and flattening it to a bounding box is what makes
highlights bleed across columns.

### Commitment 3 — Reading order is per-flow, not global

Borrowed from PDF-to-Tree's most transferable idea (`literature/01-pdf-to-tree.md`):
footnotes, captions, headers and page furniture get **their own reading orders** rather
than being spliced into the body stream. A block has a `flow` and an `order` within that
flow. This is what makes it possible to read the body continuously while still knowing
exactly where footnote 3 sits on the page.

---

## Schema

### Identity — the stable ID strategy

The hardest requirement is that a highlight created under parser v1.2 must still anchor
after parser v1.3 regenerates the document. Docling's `self_ref` (`#/texts/47`) is a
positional pointer and fails this immediately; so does the current extractor's
`uuid4()` per run (`extraction.py:312`).

**Block IDs are content-derived** — that commitment stands, and the reasoning below for
*why* content-derived beats positional (`self_ref`) and random (`uuid4()`) is unchanged.

> ⚠️ **THE FORMULA THAT USED TO BE PRINTED HERE IS SUPERSEDED BY
> [Amendment 1](#amendment-1--stable-block-id-formula-resolved-by-measurement-2026-07-30)
> (2026-07-30), which is binding. Do not implement from this section.**
>
> The original formula was written without measurement and **every one of its five axes
> moved**: the hash (`blake2s`, with no digest length, → `SHA-256`), the geometry payload
> (full bbox → top-left anchor only), the grid (2 pt → 1.0 pt), the text prefix (64 → 8
> code points), and the quantiser (`round(v/g)*g`, which forks between Python and
> JavaScript on real corpus coordinates, → an integer bucket index `floor(v/g + 0.5)`). It
> also left the coordinate frame, the base32 case and the truncation *unit* unstated —
> omissions worth up to 99.93 % ID loss when a reimplementation reads them differently.
>
> **Two claims made here are measurably false and are struck:**
> - *"2pt grid: survives sub-point parser jitter"* — at 2 pt, ±0.3 pt jitter changes
>   **14.4 %** of anchor IDs and a constant +0.4 pt shift changes **34.7 %**. What is true
>   instead: the grid absorbs movement strictly *inside* one bucket and nothing else, and
>   at any grid a meaningful fraction of blocks sit near a boundary.
> - *"a parser upgrade that merges two paragraphs legitimately produces a new block"* —
>   under the anchor-only payload the merged block **inherits the first constituent's ID**
>   and every other constituent's ID is retired. Amendment 1 §E.4 quantifies what that
>   buys (+11.7 pp of IDs survive a merge) and what it costs (the same 11.7 % of blocks
>   keep an ID on changed text; `content_hash` detects 100 % of them, and verifying it on
>   every tier-1 hit is therefore **mandatory**).
>
> One claim here is **upheld and now load-bearing**: IDs are *tier 1 only*. A formula that
> loses **42 %** of IDs to a segmenter change cannot be the whole of anchoring, and no
> quantisation scheme can do better — 35.75 % of that is a floor no formula can beat,
> because a merged block can inherit at most one constituent's ID. **ADR-004's
> multi-selector anchor (content hash, text quote, geometric fallback) is MANDATORY, not
> optional**, targeting ≥99 % re-anchor with **loud failure** for the remainder — never a
> silent drop.

The binding formula, its 427 cross-language conformance vectors, the joint sweep it was
derived from, and the limits of that derivation are in
[Amendment 1](#amendment-1--stable-block-id-formula-resolved-by-measurement-2026-07-30) at
the end of this document. The normative machine-readable artefact is
`packages/document-ir/conformance/identity-vectors.json`.

### Core objects

```jsonc
// ─────────────── Paper ───────────────
{
  "ir_version": "1.0.0",
  "paper_id": "ppr_01J...",
  "source_hash": "sha256:9f2c...",        // of the PDF bytes; the dedup key the product lacks today
  "parser": { "name": "docling", "version": "2.x.y", "config_hash": "sha256:...",
              "profile": "born-digital-fast", "parsed_at": "2026-07-29T…Z" },
  "status": "complete",                    // pending|parsing|partial|complete|failed
  "partial_reason": null,                  // e.g. "pages 12-14 low confidence, vision repair queued"
  "metadata": {
    "title":    { "value": "Deep Residual Learning…", "source": "blk_a1b2…", "confidence": 0.97 },
    "authors":  [ { "value": "Kaiming He", "source": "blk_c3d4…", "confidence": 0.93 } ],
    "abstract": { "block_ids": ["blk_e5f6…"], "confidence": 0.99 },
    "doi": null, "arxiv_id": "1512.03385", "venue": null, "year": 2015
  },
  "pages":      [ /* Page */ ],
  "blocks":     [ /* Block */ ],           // flat array; hierarchy via relations
  "relations":  [ /* Relation */ ],
  "sections":   [ /* Section — a materialised view over blocks+relations */ ],
  "references": [ /* Reference */ ],
  "confidence": { "overall": 0.91, "by_page": [0.98, 0.95, 0.61, …],
                  "weakest_pages": [2, 9], "needs_review": true }
}
```

Note `metadata.title` is `{value, source, confidence}` — **not a bare string**. Every
scalar that could have come from a model carries its provenance. The current code sets
`title = os.path.splitext(file.filename)[0]` (`routes.py:61`), i.e. the filename.

```jsonc
// ─────────────── Page ───────────────
{
  "page_id": "pg_…", "index": 0,
  "width": 612.0, "height": 792.0,          // PDF points, post-rotation
  "rotation": 0, "user_unit": 1.0,
  "crop_box": [0,0,612,792], "media_box": [0,0,612,792],
  "image": { "uri": "r2://papers/ppr_…/pages/000@2x.webp", "scale": 2.0, "dpi": 144 },
  "has_text_layer": true, "is_scanned": false,
  "block_ids": ["blk_…"],
  "flows": { "body": ["blk_…"], "caption": [...], "footnote": [...],
             "header": [...], "footer": [...], "margin": [...] },
  "confidence": 0.98
}
```

```jsonc
// ─────────────── Block ───────────────
{
  "block_id": "blk_7k2m…",
  "type": "paragraph",
  "page_index": 3,
  "polygon": [[54.0,231.5],[292.1,231.5],[292.1,402.7],[54.0,402.7]],
  "bbox": [54.0,231.5,292.1,402.7],         // derived convenience, always == polygon extent
  "flow": "body",
  "order": 7,                                // rank within (page, flow)
  "doc_order": 142,                          // rank within the whole body flow, cross-page
  "parent_id": "blk_sec3…",
  "child_ids": [],
  "prev_id": "blk_…", "next_id": "blk_…",   // left-child/right-sibling, per PDF-to-Tree
  "text": "We explicitly reformulate the layers as learning residual functions…",
  "text_normalised": "we explicitly reformulate the layers as learning residual…",
  "content_hash": "blake2s:3f9a…",           // anchoring tier 2
  "spans": [                                 // char-level geometry: the unit a highlight snaps to
    { "start": 0, "end": 62, "bbox": [54.0,231.5,292.1,243.1], "font": "NimbusRomNo9L-Regu", "size": 9.96 }
  ],
  "confidence": 0.96,
  "provenance": { "parser": "docling", "stage": "layout+text", "native_id": "#/texts/47" },
  "repairs": [                               // NEVER silent — see §Repairs
    { "kind": "dehyphenate", "at": 118, "from": "resid-\nual", "to": "residual" }
  ],
  "alternatives": []                         // populated only when parsers disagree
}
```

**Block types** (closed vocabulary, identical to the benchmark's gold vocabulary so
parser output and gold data compare directly):

`title · author · affiliation · abstract · heading · paragraph · list · list_item ·
equation · inline_equation · figure · diagram · plot · table · table_row · table_cell ·
algorithm · code · caption · footnote · citation · reference_entry · header · footer ·
page_number · margin_note · annotation · unknown`

`unknown` is mandatory and load-bearing. A parser that cannot classify a region must
emit `unknown` with geometry intact rather than dropping it — adopting PDF-to-Tree's
`connect_orphans` discipline. The UI surfaces these as "unstructured region".

### Specialised block payloads

```jsonc
// Equation — extends Block
{ "type": "equation", "display": true, "equation_number": "3",
  "latex": "\\mathcal{F}(\\mathbf{x}) := \\mathcal{H}(\\mathbf{x}) - \\mathbf{x}",
  "latex_confidence": 0.88,
  "mathml": "<math>…</math>",              // for the audiobook's speech-rule engine
  "image": { "uri": "r2://…/eq/blk_….webp", "scale": 3.0 },   // ALWAYS kept: the ground truth
  "symbols": [ { "symbol": "\\mathcal{F}", "definition_block": "blk_…", "gloss": "residual mapping" } ],
  "referenced_by": ["blk_…"] }

// Figure — extends Block
{ "type": "figure", "figure_number": "2", "figure_kind": "diagram",
  "is_vector": true,                        // the property the current extractor is blind to
  "image": { "uri": "r2://…/fig/blk_….webp", "scale": 3.0, "rendered_from": "vector" },
  "caption_block": "blk_…",
  "panels": [ { "label": "(a)", "polygon": [...] } ],
  "detected_labels": [ { "text": "conv 3x3", "polygon": [...] } ],
  "referenced_by": ["blk_…"] }

// Table — extends Block
{ "type": "table", "table_number": "1", "caption_block": "blk_…",
  "grid": { "rows": 6, "cols": 5,
            "cells": [ { "cell_id": "blk_…", "r":0, "c":0, "rowspan":2, "colspan":1,
                         "polygon": [...], "text": "layer", "is_header": true } ] },
  "html": "<table>…</table>" }
```

Equations and figures **always retain the rendered source region**, even when LaTeX
extraction succeeds. The image is the ground truth; the LaTeX is an interpretation. When
`latex_confidence` is low the UI shows the crop and offers the LaTeX as "our reading".

### Relations

Relations are first-class and typed, not implied by array order:

`parent_of · next_in_reading_order · caption_of · references · defines · explains ·
result_of · footnote_of · continues_on_next_page · visually_associated_with · cites`

```jsonc
{ "type": "caption_of", "from": "blk_cap…", "to": "blk_fig…",
  "confidence": 0.91, "provenance": "geometric+numbering" }
```

`continues_on_next_page` deserves special mention: cross-page paragraph joining is the
defect readers notice most and that no mainstream parser advertises. Making it an
explicit, confidence-scored relation means it can be measured (benchmark §4.1) and
repaired independently.

### Repairs — the anti-silent-fix mechanism

Every modification to source text is recorded as a structured `repair`, never applied
invisibly. The current code fails this twice: `_clean_text` rewrites U+2212 MINUS SIGN
to ASCII hyphen (`extraction.py:633`), destroying mathematical content in the same table
as ligature repair, and `llm_service.py:161` silently discards the middle of any page
over 5,000 characters.

Repair kinds: `dehyphenate · ligature · unicode_normalise · whitespace · reorder ·
ocr_correction · vlm_substitution`.

`vlm_substitution` is the important one. When a vision model repairs a region, the
original stays in `repairs[].from`, the model and prompt hash are recorded, and the UI
can show "this region was reconstructed". **The LLM never overwrites source; it proposes
a repair that is stored alongside the original.**

### Uncertainty and reconciliation

When two parsers disagree, both survive:

```jsonc
"alternatives": [
  { "parser": "docling", "text": "F(x) + x", "confidence": 0.71 },
  { "parser": "vlm-repair", "text": "\\mathcal{F}(x) + x", "confidence": 0.88,
    "decision": "not_selected", "rule": "prefer_native_text_when_delta<0.2" }
]
```

The selection rule is recorded so the decision is auditable. This directly implements
Part E's reconciliation requirement.

---

## Physical model

Per ADR-003 the store is **PostgreSQL**. The decisive evidence: at ~300–500 bytes of
BSON per block, 30k blocks is 9–15 MB against MongoDB's **16 MiB hard document limit**
(`literature/30-database-and-storage.md`). Blocks must be their own collection
regardless — and once that is true, Mongo's nested-document ergonomics, the only real
reason to be there, are gone.

```sql
papers        (paper_id PK, source_hash UNIQUE, ir_version, parser_name, parser_version,
               status, metadata JSONB, confidence JSONB, created_at)
pages         (page_id PK, paper_id FK, index, width, height, rotation, user_unit,
               image_uri, has_text_layer, is_scanned, confidence,
               UNIQUE(paper_id, index))
blocks        (block_id PK, paper_id FK, page_index, type, flow, "order", doc_order,
               parent_id, polygon geometry/JSONB, bbox float8[4], text, text_normalised,
               content_hash, spans JSONB, payload JSONB,   -- equation/figure/table extras
               confidence, provenance JSONB, repairs JSONB, alternatives JSONB)
relations     (paper_id FK, type, from_block, to_block, confidence, provenance,
               PRIMARY KEY (paper_id, type, from_block, to_block))
block_vectors (block_id FK, model, embedding vector(N))
```

Indexes that follow directly from the access patterns:
`blocks(paper_id, doc_order)` for reading; `blocks(paper_id, page_index, flow, "order")`
for page rendering; `blocks(parent_id)` for subtree fetch; GIN on
`to_tsvector(text_normalised)` for keyword search; HNSW on `block_vectors.embedding`.

`source_hash UNIQUE` gives the content dedup the product currently lacks — the two
byte-identical PDFs in `storage/papers/` today (`findings.md` D5) would collapse to one.

**Retrieval is a single query over structure + keyword + vector**, which is precisely
what a flat vector index cannot do and why the store choice and the IR choice are
coupled.

---

## Versioning and migration

`ir_version` is semver with explicit contracts:

| Change | Bump | Requires |
|---|---|---|
| Add optional field | patch | nothing |
| Add block type / relation type | minor | consumers must tolerate unknown types (**required from v1**) |
| Change geometry semantics, ID derivation, or remove a field | **major** | migration + full re-anchor pass |

Re-parsing is versioned, not destructive. A new parse is written as a **new IR
generation** alongside the old one; anchors are migrated; only when the migration
reports ≥99% success is the new generation promoted. The old generation is retained for
one cycle so promotion is reversible. This is the rollback plan.

**Partial processing is a first-class state**, not an error. `status: "partial"` with
per-page confidence lets the reader open a paper while pages 12–14 are still in vision
repair — versus today, where generation blocks an HTTP request for up to 450 s
(`findings.md` C1).

---

## Consequences

### Positive

- One representation powers rendering, highlighting, retrieval, Guided view, canvas,
  audiobook, citations and search. Today each feature invents its own.
- Highlights become durable by construction, with a measurable re-anchor rate.
- "AI content looks like source" becomes unrepresentable rather than discouraged.
- Uncertainty is visible to the UI, so the product can say "we're not sure about this
  equation" instead of confidently rendering garbage — which is what
  `\frac{and}{or}` currently does.
- Parser choice becomes a swappable implementation detail behind an adapter, so the
  benchmark can keep re-deciding it.

### Negative

- Substantially more storage: ~30k rows/paper vs one string. At ~400 B/block that is
  ~12 MB/paper in Postgres plus page images in R2. Acceptable; must be budgeted.
- Adapter work per parser (~200–400 lines each) to normalise into PaperIR.
- Content-derived IDs are *mostly* stable, not perfectly. The multi-selector anchor is
  mandatory, not optional — this ADR is incomplete without ADR-004.
- Migration from the current flat string cannot recover what was never captured.
  **Existing highlights cannot be migrated** — their anchors are viewport pixels
  divided by `window.innerWidth`. This is unrecoverable data loss that has already
  happened; the migration must tell affected users rather than silently dropping them.

### Rejected alternatives

| Alternative | Why not |
|---|---|
| **Markdown + bboxes** (Marker/MinerU default shape) | Markdown cannot express independent reading orders, typed relations, per-block confidence, alternatives or repairs. Serialising to Markdown for the LLM is fine; storing it as canonical is the mistake the brief explicitly forbids. |
| **Adopt DoclingDocument directly** | Good model, and PaperIR borrows from it. But it ties the canonical schema to one vendor's release cycle, and `self_ref` positional IDs fail the re-parse requirement outright. Use it as an *adapter input*. |
| **PDF-to-Tree's blocks+arcs as-is** | Adopt the shape (and we do), but it has no figure, equation or table objects at all — it covers ~1 of PaperTree's 8 requirements (`literature/01-pdf-to-tree.md`). |
| **Keep the flat string, add a sidecar index** | Two representations that drift. The repo already demonstrates this failure mode with three extractors and two highlight schemas. |
| **TEI XML** (GROBID's output) | Excellent for bibliographic structure and worth using *for references specifically*, but weak on geometry and figures, and XML tooling is a poor fit for a TS/Python codebase. |

---

## Falsification condition

Revisit this ADR if the Tier B benchmark shows that **no** available parser can populate
`polygon`, `flow` and `caption_of` at usable accuracy — in which case the geometric
ambitions of the schema outrun what is extractable, and PaperIR should degrade to a
simpler section-tree-plus-page-anchor model rather than carry fields nothing can fill.

---

## Artefacts to produce next

| Artefact | Path (when implementation starts) |
|---|---|
| JSON Schema | `packages/document-ir/schema/paperir-1.0.0.schema.json` |
| TypeScript types (generated) | `packages/document-ir/src/types.ts` |
| Pydantic models (generated) | `packages/document-ir/python/paperir/models.py` |
| Postgres DDL + migrations | `infrastructure/migrations/0001_paperir.sql` |
| Parser adapters | `services/document-worker/adapters/{docling,pymupdf,…}.py` |
| ID + anchor library (shared) | `packages/document-ir/src/identity.ts` + Python twin |

JSON Schema is the single source of truth; both language bindings are generated from it
so they cannot drift — the failure the repo currently exhibits with two `Highlight`
types and two canvas type systems (`findings.md` §G5).

---

## Amendment 1 — stable block ID formula, resolved by measurement (2026-07-30)

ADR-001 (above) and `research/synthesis-05-parser-comparison.md` §"block_id" proposed two
incompatible formulas and neither measured anything. This amendment settles it by
measurement and **supersedes the formula in § Identity above**. The answer is a hybrid
neither document proposed, and it overturns both on four of the five axes.

This is revision 4 of the measurement. Revisions 1–3 are not hidden here, because the
corrections are the evidence that the rule was applied rather than the answer chosen:

| rev | proposed | what refuted it |
|---|---|---|
| 1 | sha256, **4.0 pt**, full bbox, prefix **64**, `round(v/g)*g` formatted `%.4f` | two independent critiques, both reproducing the harness byte-identically: the quantiser forked between Python and JS on real corpus coordinates; 4.0 pt was the endpoint of an arbitrary list, not a result; and the two "0 % churn" headline perturbations were arithmetically incapable of producing churn |
| 2 | sha256, 2.0 pt, anchor, prefix 32, integer buckets, **UPPERCASE** base32 | swept one knob at a time; geometry payload still untested against grid and prefix jointly; 0 of its 217 vectors validated against the IR schema's `^blk_[a-z2-7]{16}$` |
| 3 | **the selection below** — sha256, 1.0 pt, anchor, prefix 8, lowercase | selection confirmed; but an independent two-language re-derivation found four defects in the shipped **contract data** — see *What revision 4 fixed* |
| 4 | **binding** | — |

Revision 4 changes **no measured quantity**. The sweep table, the churn figures, the
collision census and the derived configuration are bit-identical to revision 3; the diff is
confined to the contract tables, 9 added vectors (3 new equivalence pairs plus 3 standalone)
and one corrected `normalised_text`. That is stated first so nothing below reads as
post-hoc.

---

### A. The formula

Normative. `packages/document-ir/conformance/identity-vectors.json` is the machine-readable
form of every table and rule below and **is the artefact an implementation must satisfy** —
its `spec`, `ligature_table`, `whitespace_chars` and `case_fold_map` blocks are emitted by
the harness from the same constants the measurement ran with, so they cannot drift from what
was measured. Where this prose (hand-written) and that file disagree, **the file wins**.

```text
block_id = "blk_" + LOWER( BASE32( SHA-256( PAYLOAD ) ) )[:16]

PAYLOAD = UTF-8 bytes of the U+007C-joined string:

    source_hash | page_index | q(x0) | q(y0) | block_type | normalise(text)[:8]

  field 1  source_hash   lowercase hex SHA-256 of the PDF bytes, 64 chars, WITHOUT the
                         "sha256:" prefix the IR stores.
  field 2  page_index    0-based page ordinal, base-10 integer, no padding.
  field 3  q(x0)         quantised LEFT edge   -- see QUANTISE
  field 4  q(y0)         quantised TOP edge    -- see QUANTISE
                         ONLY the top-left ANCHOR is hashed. x1 and y1 are deliberately
                         NOT in the payload; see § E.4 "What anchor_xy means".
  field 5  block_type    the IR's block-type discriminator verbatim. Matches
                         ^[a-z][a-z0-9_]{0,63}$ and so contains no U+007C.
  field 6  text          normalise(block text) truncated to 8 UNICODE CODE POINTS.

  Only field 6 can contain U+007C, and it is last, so the encoding is unambiguous.
  No escaping is defined or permitted.

QUANTISE
    q(v) = floor(v / 1.0 + 0.5)          evaluated in IEEE-754 binary64
    emitted as a base-10 integer: optional leading "-", no "+", no leading zeros, no
    decimal point. There is no negative zero -- q returns an integer.

    NOT round(v/g)*g. Python round() is half-to-EVEN; JS Math.round and Rust f64::round
    are half-away-from-zero. They disagree on every coordinate where v/g lands exactly on
    k+0.5, and typeset PDFs hit that constantly (x0 = 90.0 pt is LaTeX's 1.25 in margin;
    90.0/4.0 = 22.5 exactly). floor(x + 0.5) has one definition in all three languages,
    and math.floor / Math.floor / f64::floor all round toward -inf, so it is also correct
    on negatives: floor(-0.5 + 0.5) = 0, floor(-22.5 + 0.5) = -22.

    Emitting the integer bucket INDEX rather than index*grid removes float formatting from
    the contract entirely, and with it the negative-zero hazard: Python f"{-0.0:.4f}" is
    "-0.0000" while JS (-0).toFixed(4) is "0.0000" -- same bucket, two different ids.

    RANGE. The bucket index MUST satisfy |q| <= 2^53 - 1 = 9007199254740991. An
    implementation MUST REJECT a coordinate outside that range rather than emit it:
    JS String() switches to exponential notation at 1e21 ("1e+21") where Python str()
    stays positional ("1000000000000000000000"). PDF 1.7 Annex C bounds user space at
    +/-32767, so conforming input sits eleven orders of magnitude inside the guard
    (2^53-1 / 32767 = 2.7e11). It can only fire on corrupt input -- which is exactly when
    it must fire rather than silently fork.

COORDINATE FRAME   (unspecified in the original ADR; the single highest-leverage clause in
                    the formula -- getting it wrong costs 99.93 % of ids, measured)
    units         PDF DEFAULT USER SPACE UNITS, i.e. 1/72 in.
    /UserUnit     NOT applied. A page's /UserUnit multiplier is deliberately IGNORED, so
                  coordinates are raw default-user-space units, never physical ones. THE
                  DECISION STANDS; the alternative (scaling by /UserUnit) is equally
                  defensible and equally arbitrary, and the only thing that matters is
                  that all three implementations make the SAME choice. NOTHING IN THE
                  CORPUS EXERCISES THIS -- all 8 PDFs have no /UserUnit at all -- so it is
                  pinned BY FIAT, not by measurement. See § H.2.

                  RETRACTION (2026-07-30, acceptance review). An earlier revision of this
                  amendment justified the rule with "it is what MuPDF's page.rect gives
                  and therefore what the IR stores". THAT CLAIM IS FALSE AND IS RETRACTED.
                  It is exactly inverted, and a parser author who followed the stated
                  reasoning would commit the very error this section measures at 99.93 %
                  of ids lost (perturbation P9).

                  MEASURED (PyMuPDF 1.28.0 / MuPDF 1.29.0, on
                  packages/document-ir/test/fixtures-pdf/userunit.pdf, whose page is
                  /MediaBox [0 0 200 300] with /UserUnit 2.5):

                      page.rect            = Rect(0, 0, 500, 750)   <- PRE-MULTIPLIED
                      page.mediabox        = Rect(0, 0, 200, 300)   <- not scaled
                      page.cropbox         = Rect(0, 0, 200, 300)   <- not scaled
                      page.rotation_matrix = Matrix(1, 0, 0, 1, 0, 0)  <- not scaled
                      get_drawings()[0].rect = Rect(50, 75, 150, 125)  <- SCALED
                                               (the raw marker is 20,250,60,270)

                  So page.rect, and every coordinate get_text()/get_drawings() returns,
                  ARE multiplied by /UserUnit; mediabox, cropbox and rotation_matrix are
                  not. A MuPDF-based parser must therefore DIVIDE /UserUnit BACK OUT
                  exactly once, in raw PDF space, before normalising -- see
                  `geometry.stripUserUnit` / `geometry.strip_user_unit`, which is what the
                  shipped library does and what the committed vector for userunit.pdf
                  records (`expected_page_size` [200, 300] alongside
                  `mupdf_page_rect_unadjusted` [0, 0, 500, 750]).
    origin        TOP-LEFT of the page's post-rotation rect
    y direction   DOWNWARD, so y0 is the TOP edge and y0 <= y1
    rotation      already applied; /Rotate is resolved before the bbox is taken
    translation   relative to the page rect's own origin (x = raw_x - rect.x0), so a
                  CropBox that does not start at (0,0) cannot leak into the id
    precision     the binary64 value the IR stores. Do NOT pre-round: JSON round-trips
                  binary64 exactly in Python, JS and Rust, and a rounding step would just
                  be a second place for the languages to disagree.

NORMALISE(text) -- exactly these four steps, in this order
    1. Unicode NFC.
    2. Ligature expansion via the explicit table
       { U+FB00 -> ff, U+FB01 -> fi, U+FB02 -> fl, U+FB03 -> ffi, U+FB04 -> ffl,
         U+FB05 -> st, U+FB06 -> st, U+0133 -> ij, U+0132 -> IJ }.
       Note that full case folding already maps U+FB00..U+FB06, so only U+0132/U+0133
       have independent effect; they are the reason this step exists.
    3. Collapse every maximal run of WHITESPACE to a single U+0020, then strip WHITESPACE
       from both ends. WHITESPACE is the enumerated set, 26 code points:
         U+0009 U+000A U+000B U+000C U+000D U+0020 U+0085 U+00A0 U+1680
         U+2000..U+200A U+2028 U+2029 U+202F U+205F U+3000 U+FEFF
       -- enumerated because Python's \s, JavaScript's \s and Rust's
       char::is_whitespace are three different sets. BUILD THIS TABLE FROM NUMERIC CODE
       POINTS, not from literal characters in a source file (see § F, defect 1).
    4. CASE FOLD BY TABLE. For each code point, replace it with case_fold_map[cp] if the
       map contains it, and leave it unchanged otherwise. `case_fold_map` is the complete
       Unicode full case-folding map (UAX #21 toCasefold, CaseFolding.txt status C+F,
       non-Turkic), 1530 entries, shipped in identity-vectors.json and PINNED TO
       UNICODE 15.0.0 by the `case_fold_unicode_version` field.

       An implementation MUST NOT call str.casefold() / String.prototype.toLowerCase() /
       str::to_lowercase() -- not for the mapped code points, and NOT FOR THE REMAINDER
       EITHER. Runtimes carry different Unicode versions (Python 3.12 = UCD 15.0.0,
       Node 22 = Unicode 17.0) and 55 code points gained a case mapping in between, so a
       runtime fallback forks the id between languages and forks it again in place the
       day the runtime is upgraded.

       Full case folding is context-INDEPENDENT, so per-code-point application is exactly
       equivalent to whole-string folding and JS's context-sensitive final-sigma rule
       cannot fire. That equivalence is asserted over all 1,112,064 code points and over
       20,004 adjacent pairs on every run, not assumed.

TRUNCATION
    8 UNICODE CODE POINTS (scalar values). NOT UTF-16 code units (JS .slice), NOT bytes
    (Rust &s[..n]). Reference JS: Array.from(s).slice(0, 8).join('').

ENCODE
    RFC 4648 base32 of the 32-byte SHA-256 digest, alphabet A-Z2-7, "=" padding stripped,
    LOWERCASED, then the FIRST 16 CHARACTERS. That is 80 bits, not 128 or 256. Prepend the
    literal ASCII "blk_". Total length 20, matching the IR schema's ^blk_[a-z2-7]{16}$.
```

**Entropy, stated honestly.** 16 base32 characters is **80 bits**, not the 256 the digest
carries. Over a 30 000-block paper the birthday bound gives a random-collision probability
of roughly 3.7 × 10⁻¹⁶, which is negligible — but that number is *not* the collision risk
that matters and is not what § C measures. Real collisions come from two blocks landing in
the same quantisation bucket with the same 8-code-point text prefix, which is a property of
the payload, not of the digest width. The digest is not the constraint; the payload is.

**One contract conflict was resolved, not inherited.** The IR schema pins
`^blk_[a-z2-7]{16}$` (lowercase, per EPIC-00) while revision 2's ENCODE step and all 217 of
its vectors were uppercase — 0 of them validated against the schema they were written for.
**The formula moved, not the schema**: ENCODE lowercases the base32. It is a one-character
change that alters no measured quantity, and all 427 current vectors satisfy the schema
pattern.

---

### B. Cross-language determinism — verified by execution, in both directions

The Epic 0 acceptance test *"TS and Python produce identical IDs for the shared vector file"*
is the thing revision 1's quantiser broke. It is now closed **by construction**, and checked:

| suite | ids per language | py ↔ ts mismatches |
|---|---:|---:|
| conformance vectors | 427 | **0** (block_id 0, payload 0, quantised_coords 0, normalised_text 0) |
| corpus blocks, all 8 PDFs | 5 670 | **0** |
| adversarial probes | 152 | **0** |
| **total** | **6 249** | **0** |
| exhaustive Unicode `normalise()` sweep | 4 448 256 strings (1 112 064 cps × 4 contexts) | **0** |

8/8 negative pairs differ; 11/11 equivalence pairs match; every one also reproduces the id
recorded in the file. Both implementations were written from the `spec` / `ligature_table` /
`whitespace_chars` / `case_fold_map` blocks of identity-vectors.json, importing nothing from
the harness. The JS one ships as
`packages/document-ir/conformance/verify-vectors.mjs` (zero dependencies,
`node verify-vectors.mjs`); it also reproduces all 5 670 corpus ids byte-for-byte on
Node v22.23.0.

The language-level facts are asserted rather than assumed, checked from Node:
`Math.floor(-0.5+0.5)===0`; `Math.floor(-22.5+0.5)===-22`; `q(90.0,4.0)===23` (half-UP);
`String(q(-0.0,2.0))==="0"`. The revision-1 bug is kept as a regression witness:
`Math.round(90/4)*4===92` in JS while `round(90/4)*4===88` in Python — one block, two ids.
Re-running the **old** formula over the same records reproduced **24 cross-language
mismatches at 1 pt (0.39 %) and 43 at 4 pt (0.71 %)**; the new formula, 0.

Ten negative controls confirm the suite has the power to catch each pinned clause rather
than passing vacuously. Divergences against the conforming implementation
(probe / vector / corpus / Unicode-17 probe set):

| control | a plausible wrong implementation of… | diverges on |
|---|---|---|
| C1 | truncation by UTF-16 code unit (`String.slice`) | 9 / 2 / 0 / 47 |
| C2 | truncation by UTF-8 byte (the Rust hazard) | 37 / 34 / **266** / 55 |
| C3 | `toLowerCase()` instead of full folding | 11 / 4 / 2 / 55 |
| C4 | whole-string lowercase (final-sigma rule fires) | 1 / 1 / 0 / 55 |
| C5 | the refuted `Math.round` quantiser at 1 pt | 2 / 0 / 0 / 0 |
| C6 | the whitespace table **as shipped** | **0 / 0 / 0 / 0** ← the defect-1 fix |
| C6b | the whitespace table as shipped **in rev 3** | 6 / 1 / 0 / 0 |
| C7 | NFKC instead of NFC | 2 / 2 / 2 / 0 |
| C8 | fold before NFC (order swapped) | 5 / 0 / 0 / 0 |
| C9 | ligature step deleted | 1 / **4** / 0 / 0 |
| C11 | table, then `toLowerCase()` for unmapped code points | 1 / 1 / 0 / **55** |
| C10 | UPPERCASE base32 | 6 304 / 6 304 schema-pattern failures |

C6 at 0 and C6b at 7 are the machine proof that defect 1 is fixed and was real. C9 at 4
vectors (it was 0 under rev 3) is the proof that the ligature step is now bound. C11 at
55/55 is the proof that the version-pinned fold map is doing work a runtime call would not.

`normalise()` output is **not** guaranteed to be in NFC (U+01F0 → `006A 030C`). A later
`packages/document-ir/src/identity.ts` author must not "tidy up" with a trailing
`normalize('NFC')` — that is control C8's failure mode exactly.

---

### C. The measurement

Harness `research/benchmarks/harness/id_stability.py` (revision 4), raw data
`research/experiment-results/id-stability.json`. Corpus: the 8-paper PTUB set, 195 pages,
**5 670 baseline blocks**, 18 175 line-granularity records, 3 628 merged blocks, 8 084 split
blocks. Seed 20260730, 5 seeds per jitter perturbation. Sweep: **geometry × grid × prefix =
3 × 8 × 8 = 192 combinations**, every one measured on every perturbation. SHA-256 is fixed,
not swept (§ C.5).

**Perturbations, and which are which.** Three are *realistic parser changes* — the things a
point release actually does — and are what the selection optimises. Four are *synthetic
stress*: reported, never optimised against, because no evidence exists that a real parser
produces them. Two are *auxiliary*, pricing an omission rather than selecting. Two are
*null*, and their 0 % results are worthless.

| | perturbation | class |
|---|---|---|
| P7 | paragraph MERGE — consecutive same-page text blocks, vertical gap < 6 pt, overlapping x-extents, merged (a PyMuPDF → Docling segmenter swap) | **realistic** |
| P8 | paragraph SPLIT — every ≥2-line block split at its largest internal line gap | **realistic** |
| P4 | text-normaliser change — NFKC + de-hyphenation across line breaks, no ligature table | **realistic** |
| P1 | uniform jitter ±0.3 pt on every coordinate, 5 seeds | synthetic stress |
| P2 | uniform jitter ±0.9 pt on every coordinate, 5 seeds | synthetic stress |
| P3 | constant +0.4 pt shift on x and y | synthetic stress |
| P10 | every bbox recomputed from character boxes instead of MuPDF font-metric line boxes | **empirical** geometry change |
| P9 | origin flip — y measured from the page bottom | auxiliary (prices the unstated frame) |
| N1 | line granularity instead of block granularity | null for churn; retained as the line-granularity **collision** case |
| N2 | `get_text('blocks')` vs `get_text('dict')` | null |

**Collision accounting, labelled accurately.** Three different numbers exist and the
harness reports all three, per run, per combination:

- `colliding_blocks` — blocks *involved* in any colliding group.
- `colliding_groups` — the number of distinct groups.
- `excess` = Σ(group − 1) — the blocks that actually **lose** their identity.

`excess` is the one used everywhere below, because it is the only one that answers "how many
highlights can resolve to the wrong text". Revision 1 reported blocks-involved and called it
collisions (its "88 at 32 pt" was 88 blocks in 44 groups, i.e. 44 lost identities); that
label is corrected here.

A colliding group is reclassified as a **duplicate render** and excluded from `genuine`
iff all members share a block type and a normalised text **and** all four coordinates agree
to within a fixed 1.0 pt. The tolerance is grid-independent, so a coarse grid cannot launder
a real collision into the exempt class. Both counts are in every row of the raw data.

**Why the tolerance is 1.0 pt, and what it actually exempts.** *(Added 2026-07-30, issue #22.
`DUP_TOL_PT = 1.0` is load-bearing at a value this document did not previously motivate.)*
At the selected configuration **exactly one** group is exempted, and it is **not** the
*"Tok 1"* pair the prose around this decision cites. It is the *"[CLS]"* pair on `bert-2col`
p14, `(329.4, 181.5, 340.9, 186.1)` against `(329.4, 180.8, 340.9, 185.5)` — a maximum
coordinate difference of **0.7 pt**, from
`chosen_row.collisions_by_run.N1_line_granularity.duplicate_render_examples` in
`id-stability.json`. A 0.5 pt tolerance would not exempt it, and the selected configuration
would then fail R1. The *"Tok 1"* pair is **0.4 pt** apart and would survive a 0.5 pt
tolerance; it is the group that binds at *other* configurations, not at this one. So the
value that matters is 0.7 pt, and 1.0 pt is the nearest round number above it — with no
measured group between 0.7 pt and 1.0 pt to distinguish the two.

---

#### C.1  R1 — where each (geometry, grid) stops working

The **floor** column is the *exact* shortest text prefix that separates every pair of records
sharing a (page, quantised coords, block type) bucket — computed by locating the longest
common prefix of every candidate pair, not sampled at 8 points. `unsep` counts pairs with
*identical* text in one bucket, which **no prefix length can fix**.

| geometry | grid pt | floor: block / line / merged / split | unsep | viable prefixes |
|---|---:|---|---:|---|
| full_bbox | 0.25 – 4.0 | 0 / 0 / 0 / 0 | 0 | 8 … 160 |
| full_bbox | 8.0 | 0 / **15** / 0 / 0 | 9 | **none** |
| full_bbox | 16.0 | 7 / **18** / 0 / 12 | 51 | **none** |
| full_bbox | 32.0 | 14 / 28 / 14 / 16 | 508 | **none** |
| **anchor_xy** | **0.25 – 1.0** | **1 / 0 / 0 / 1** | **0** | **8 … 160** |
| anchor_xy | 2.0 | 1 / 0 / **20** / 1 | 0 | 24 … 160 |
| anchor_xy | 4.0 | 2 / 15 / 20 / 2 | 10 | **none** |
| anchor_xy | 8.0 | 2 / 15 / 20 / 11 | 31 | **none** |
| anchor_xy | 16.0 | 15 / 25 / 20 / 16 | 337 | **none** |
| anchor_xy | 32.0 | 61 / 61 / 61 / 61 | 1101 | **none** |
| centre_xy | 0.25 – 2.0 | 2 / 0 / 2 / 0 | 0 | 8 … 160 |
| centre_xy | 4.0 | 2 / **15** / 2 / 1 | 5 | **none** |
| centre_xy | 8.0 – 32.0 | ≥ 2 / ≥ 18 / ≥ 2 / ≥ 7 | ≥ 40 | **none** |

Three things this settles that a one-knob-at-a-time sweep cannot:

1. **Line granularity is the binding constraint, not block granularity.** `full_bbox` has a
   block-level floor of 0 all the way to 16 pt but dies at 8 pt on lines. Revision 1's
   "zero collisions at 8 pt and 16 pt" measured only blocks.
2. **The grid and prefix axes are coupled.** `anchor_xy` at 1.0 pt needs a 1-code-point
   prefix; at 2.0 pt the merged world needs **20**. One knob at a time cannot see that cliff.
3. **Coarse grids fail structurally, not statistically.** Past 4 pt every geometry acquires
   `unsep` pairs — blocks with identical text in one bucket. No prefix length rescues them,
   so "use a coarser grid and a longer prefix" is not an available trade.

#### C.2  R2 — churn among R1 survivors (5 670 blocks, churn %)

A merged block can inherit at most **one** constituent's ID, so **35.75 % of blocks
(2 027 of 5 670) lose their ID under P7 no matter how the ID is computed**. That floor, not
zero, is what the geometries should be measured against. Split has a floor of 0 %.

| geometry (grid 1.0, prefix 8) | P7 merge | *over floor* | P8 split | *over floor* | P4 textnorm | P1 ±0.3 pt | P2 ±0.9 pt | P3 +0.4 pt | P10 glyph bbox |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| full_bbox | 53.86 % | +18.11 | 42.47 % | +42.47 | 0.035 % | 45.69 % | 90.83 % | 86.61 % | 0.00 % |
| **anchor_xy** | **42.17 %** | **+6.42** | **11.68 %** | **+11.68** | 0.035 % | 25.24 % | 69.58 % | 62.54 % | 0.00 % |
| centre_xy | 53.85 % | +18.10 | 42.47 % | +42.47 | 0.035 % | 18.16 % | 49.63 % | 62.56 % | 0.00 % |

`centre_xy` is **strictly dominated**: it buys jitter resistance (P1 18.2 % vs 25.2 %) and
pays with `full_bbox`'s merge and split behaviour, because a merged block's centre moves even
when its top-left corner does not. It also adds a float division to the frozen contract. It
is measured and rejected, not omitted.

#### C.3  R2/R3 — grid and prefix, jointly (anchor_xy)

| grid, prefix | R1 | P7 + P4 (R2 score) | P1 | P3 | note |
|---|---|---:|---:|---:|---|
| 1.0, **8** | PASS | **42.20** | 25.24 % | 62.54 % | **selected** |
| 0.5, 8 | PASS | 42.38 | 50.42 % | 96.74 % | within 1 s.e., finer grid |
| 0.25, 8 | PASS | 42.45 | 82.91 % | 100.00 % | within 1 s.e., finer grid |
| 2.0, 8 | **FAIL** | 42.15 | 14.41 % | 34.74 % | genuine collision in the merged run |
| 1.0, 16 | PASS | 43.56 | 25.24 % | 62.54 % | +1.36 pp |
| 2.0, 24 | PASS | 43.88 | 14.41 % | 34.74 % | **runner-up**: coarsest viable grid |
| 2.0, 32 | PASS | 44.09 | 14.41 % | 34.74 % | |
| 1.0, 160 | PASS | 57.35 | 25.24 % | 62.54 % | synthesis-05's prefix, +15 pp |

**R2 is a plateau, not a peak.** Churn is a proportion over 5 670 blocks, so its standard
error is **0.656 pp** and the top three candidates (42.20 / 42.38 / 42.45) are
indistinguishable. Applying R2 with that tolerance and then R3 gives **anchor_xy / 1.0 pt /
8** — the same answer as the strict argmin, so the tolerance is demonstrably not doing the
work. Both are recorded in the raw data.

**Prefix safety margin at the selected config:** binding floor **1** code point (block
granularity and split; 0 in the merged and line worlds), chosen prefix **8** — an **8×
margin**. Every prefix from 8 to 160 passes R1 here; 8 is selected because P4 *and* P7 both
fall monotonically as the prefix shortens, since a longer prefix samples more text and is
likelier to span a hyphenated line break, a ligature or a paragraph boundary:

| prefix (anchor_xy, 1.0 pt) | 8 | 16 | 24 | 32 | 48 | 64 | 96 | 160 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| P4 textnorm churn | 0.035 % | 0.106 % | 0.141 % | 0.194 % | 1.076 % | 2.504 % | 3.351 % | 5.150 % |
| P7 merge churn | 42.17 % | 43.46 % | 43.74 % | 43.90 % | 44.82 % | 46.46 % | 49.14 % | 52.21 % |
| P8 split churn | 11.68 % | 13.74 % | 15.45 % | 16.09 % | 18.34 % | 20.48 % | 23.69 % | 30.72 % |

#### C.4  Payload shape (selected config, genuine excess collisions)

| payload | block granularity | line granularity |
|---|---:|---:|
| with `block_type` (selected) | 0 | 0 |
| without `block_type` | 0 | — |
| **geometry removed entirely** | **1 800** | **4 398** |

Geometry **must** stay in the ID. `block_type` does no collision work on this corpus but is
retained: a paragraph re-classified as a heading should be a new block, and it costs nothing.

#### C.5  Why the hash is not a sweep axis

Both candidates are cryptographic and the ID keeps only 80 bits of either, so collision
behaviour is identical by construction — a sweep would measure the seed. The choice is
decided by **portability**:

- **Node cannot produce blake2s-128 at all.** `crypto.createHash('blake2s256',
  {outputLength:16})` throws `ERR_OSSL_EVP_NOT_XOF_OR_INVALID_LENGTH`;
  `webcrypto.subtle.digest('BLAKE2s')` throws `NotSupportedError`. SHA-256 works in Node,
  Deno, Bun and every browser. ADR-001 said "blake2s" with **no digest length** — an
  unspecified detail in a formula that must be reimplemented three times.

No performance claim is made here. Revision 1 quoted timings that were backwards, and the
harness's own timing probe shows all candidates hashing the entire 195-page corpus within a
few milliseconds of each other, i.e. speed cannot and does not decide this. The number is in
`id-stability.json → hash_timing_ms` for anyone who wants it; it is deliberately not a
supporting argument.

#### C.6  What the corpus cannot tell you

All 8 PDFs: every page rotation **0**, **zero** CropBox offsets, **zero** negative
coordinates, 0 blocks with astral code points in the prefix. The coordinate-frame
normalisation is therefore a **no-op on 100 % of the corpus and is untested by it**. The cost
of leaving it unspecified was measured directly instead: **P9 origin flip** — y measured from
the page bottom, which is a *conforming* implementation of ADR-001's original
`quantise(bbox, 2pt)` text — loses **99.93 %** of IDs. The coordinate frame, not the grid, is
the highest-leverage clause in the formula, and the conformance vectors carry synthetic
negative, zero and −0.0 coordinates because the corpus cannot.

Divergence if a second implementation inherits its language's primitives instead of the
enumerated spec, measured on the 5 670 baseline blocks: `toLowerCase` instead of full case
folding **2 blocks**; language-native `\s` **0**; UTF-16-unit truncation **0**; **UTF-8 byte
truncation 266**. Small on *this* corpus for three of the four — and precisely the kind of
number that is 0 until the first Turkish, Greek or emoji-bearing paper arrives, which is why
all four are pinned by table rather than by reference to a language primitive.

#### C.7  Null perturbations — reported, and excluded from the headline

| | result | why it proves nothing |
|---|---|---|
| N1 line granularity | 0.37 % churn | 3 256/3 270 matched pairs are single-line blocks where the line bbox **is** the block bbox. Retained for its real job: the line-granularity **collision** stress case. |
| N2 `get_text('blocks')` vs `'dict'` | 0.00 % churn | 5 380/5 380 matched pairs have **bit-identical** bboxes. Same segmentation, different API. |

A 0 % forced by construction is not evidence of stability. Both were headline results in
revision 1; neither could have failed.

---

### D. The decision rule, as applied

| | rule | effect |
|---|---|---|
| **R1** | *Hard constraint.* Zero **genuine** excess collisions at block granularity **and** line granularity **and** in the merged and split worlds, on **every** paper. Eliminates, does not penalise. | 192 → **102 survivors** |
| **R2** | Among survivors, minimise churn under the perturbations a parser point release actually produces: **P7 paragraph merge + P4 text-normaliser change**. P1/P2/P3 are synthetic stress; reported, not optimised. | plateau (§ C.3) |
| **R3** | Tie-break: **coarsest grid**, then **shortest prefix**. | confirms R2 |
| **R4** | Cross-language determinism: a constraint met **by construction** (integer buckets, enumerated normalisation, version-pinned tables), not a scoring axis. | verified (§ B), not scored |

#### D.1  Where the mandated rule stopped discriminating, and what was added

The epic brief's rule was *"coarsest grid with zero collisions"*. It does not select an
answer, for three separate reasons, each of which forced an explicit addition:

1. **It has no prefix axis, and the two axes are coupled.** "Coarsest grid with zero
   collisions" is only well-defined once the prefix is fixed, and which grids are viable
   depends on it (`anchor_xy` at 2.0 pt collides at prefix 8 and is clean at 24). The prefix
   was therefore swept **jointly**, not fixed by assumption. *Revision 1's 4.0 pt was the
   last entry of the list `[0.5, 1, 2, 4]` and its prefix 64 the last of `[8,…,64]`; both
   were endpoints of arbitrary sweeps, not results. Both axes are now swept past the point
   where they stop working, so the boundary is located rather than assumed.*
2. **Applied literally, it selects the coarsest grid — which is 16 pt, and 16 pt is wrong.**
   Revision 1's headroom probe found zero *block-level* collisions at 8 pt and 16 pt. Adding
   line granularity and the merged/split worlds kills both (§ C.1). And past 4 pt every
   geometry acquires `unsep` pairs that no prefix length can separate. So "coarsest" is
   bounded by a constraint the original rule never looked at.
3. **Applied literally, it eliminates the selected configuration — but not everything:
   56 of 192 pass the strict reading.** The strict survivors, from
   `research/experiment-results/id-stability.json`:

   | geometry | grids passing literal R1 |
   |---|---|
   | full_bbox | 0.25, 0.5, 1.0 |
   | anchor_xy | 0.25, 0.5 |
   | centre_xy | 0.25, 1.0 |

   The eliminations have one cause, and it is not an ID problem: `bert-2col` p14 renders two
   figure labels twice at sub-point offsets (a fake-bold / shadowed-label render) — the
   *"Tok 1"* pair **0.4 pt** apart and the *"[CLS]"* pair **0.7 pt** apart. Each pair's two
   records have different float bboxes so the harness calls them distinct, but they are the
   same ink — a highlight cannot land on the "wrong" one.

   > **Correction, 2026-07-30 (Epic 0.1, issue #22).** This item previously read
   > *"Applied literally, it eliminates everything — 0 of 192 pass."* That was false. It
   > contradicted the sentence eight lines below it, and it contradicted the harness's own
   > output: `id-stability.json`'s `combinations` array carries `r1_strict_pass = true` on
   > **56** of its 192 rows. No measured quantity, formula or table value changed with this
   > correction — only the claim. The same contradiction is baked into
   > `id-stability.json` itself, whose `decision.r1_as_literally_stated` object reads
   > `"survivors": 56` alongside `"outcome": "ELIMINATES EVERY COMBINATION…"`. That file is
   > generated by `research/benchmarks/harness/id_stability.py`, which also rewrites the
   > normative `identity-vectors.json`; both are outside Epic 0.1's scope, so the bad string
   > is recorded rather than regenerated (see `research/build/EPIC-00.1-RESULT.md`).

**The addition, in full.** (a) R1 is evaluated on **genuine** collisions only, per the
duplicate-render rule above; under the strict reading 56/192 still pass, so the relaxation
changes *which* combinations are viable, not *whether any are*. **The selected configuration
is not one of those 56.** `chosen_row` in `id-stability.json` reads `r1_pass = true`,
`r1_strict_pass = false`: `anchor_xy / 1.0 pt / prefix 8` exists as a candidate only because
of the exemption. This document previously stated the reassuring adjacent fact — that 56
combinations pass strictly — without stating that the shipped one is not among them.
(b) Once R1 has eliminated, the survivors are ranked by **churn under realistic
perturbations** — that is the criterion the mandated rule lacked entirely, and it is the one
that distinguishes 1.0 pt from 0.25 pt. (c) R3 is the mandated rule, applied last, as a
tie-break within one standard error.

Because R2 is a plateau, **R3 and the strict argmin agree**; the added criterion is not
smuggling in the answer.

**What the exemption is, and is not, load-bearing for.** *(Added 2026-07-30, issue #22 —
this is what the Epic 0 gate established in mitigation, and it is the reason the false claim
above was classified MAJOR rather than BLOCKING.)* The epic brief's rule is a statement about
the **grid**: *"pick the coarsest grid with zero collisions"*. Read off the 56 strict
survivors above, **the coarsest grid that passes even the literal reading is 1.0 pt — exactly
the grid that shipped.** On the axis the brief's rule actually addresses, the answer is
unchanged by the relaxation and the rule is satisfied on its own terms. What the exemption
*is* load-bearing for is the **geometry** axis: `anchor_xy` passes literal R1 only at 0.25 and
0.5 pt, so `anchor_xy` at 1.0 pt is a candidate only under the relaxed reading. Geometry is an
axis the brief's rule never mentioned and which ADR-001 above had fixed at `full_bbox`; that
change is disclosed as deviation 1 and justified on churn (42.17 % vs 53.86 % under merge;
11.68 % vs 42.47 % under split). Correcting the false claim therefore changes two sentences
and adds this disclosure; the code, schema, fixtures, vectors and tests are byte-identical
either way.

---

### E. What this buys, and what it does not

#### E.1  Churn is never zero

At the chosen parameters, on this corpus:

| change | ids lost |
|---|---|
| paragraph merge (P7) | **42.2 %** — of which **35.75 pp is a floor no formula can beat** |
| paragraph split (P8) | **11.7 %** — floor 0 % |
| text-normaliser swap (P4) | 0.035 % |
| bbox recomputed from glyph boxes (P10) | 0.00 % |
| origin convention wrong (P9) | 99.93 % |

**Segmentation change is the dominant risk and revision 1 never measured it.** Revision 1's
conclusion that "real parser upgrades are nearly free" was an artefact of two perturbations
that could not fail; the truth is the opposite. The repo's own
`ptub-capability-matrix.json` records 549 PyMuPDF vs 519 Docling vs 233 old-extractor blocks
on `resnet-cvpr-2col` — the segmenter swap is not hypothetical.

Per-paper P7 variance is large and unmodelled — the corpus mean is not a prediction for any
single paper:

| paper | P7 merge | P8 split |
|---|---:|---:|
| attention-is-all-you-need | 14.9 % | 10.0 % |
| superglue-tableheavy | 27.5 % | 11.4 % |
| gpt3-longform-singlecol | 28.1 % | 9.0 % |
| bert-2col | 29.7 % | 16.0 % |
| neural-odes-mathheavy | 44.0 % | 18.6 % |
| resnet-cvpr-2col | 53.5 % | 19.8 % |
| pdf-to-tree-acl2col | 65.8 % | 19.2 % |
| a3c-algorithmheavy | 66.1 % | 2.6 % |

Migration tooling must be sized for the worst paper, not the mean.

#### E.2  Block IDs are ANCHORING TIER 1 ONLY

**ADR-004's multi-selector anchor — content hash, text quote, geometric fallback — is
MANDATORY, not optional.** This is no longer a design preference; it is the only thing that
makes the numbers above survivable. A formula that loses 42 % of ids to a segmenter change
cannot be the whole of anchoring, and no quantisation scheme can do better: the 35.75 %
merge floor exists before any formula is chosen.

Concretely, three obligations that are **part of this decision**:

1. **Epic 2's resolver MUST verify `content_hash` on every tier-1 hit.** A matching
   `block_id` with a differing `content_hash` is a *hit with changed content*: fall through
   to the text-quote selector inside that block, then to document-wide search. **Without this
   rule the recommendation does not hold and `full_bbox` is the safer contract.**
2. **Epic 1 MUST treat any geometry-pipeline change as an ID-BREAKING MIGRATION** requiring a
   re-anchor pass. The migration's job is not only the 42.2 % of ids that disappear but also
   the 11.7 %–30.9 % that **survive onto changed content** — invisible if you only diff the
   id sets, which is precisely why they are quantified below.
3. Epic 1 must freeze **block granularity**. The line-granularity collision results are
   conditional on a granularity that is not yet frozen (§ F.3).

#### E.3  Claims struck from ADR-001

| claim (location) | verdict |
|---|---|
| § Identity, formula comment *"2pt grid: survives sub-point parser jitter"* | **FALSE — struck.** At 2 pt, ±0.3 pt jitter churns **14.4 %** of anchor ids and a constant +0.4 pt shift churns **34.7 %**. Replaced by: *the grid absorbs movement strictly inside one bucket and nothing else; sub-point jitter that crosses a bucket boundary changes the id, and at any grid a meaningful fraction of blocks sit near one.* |
| § Identity, *"nudging a bbox by half a point does not [change the ID]"* | **FALSE — struck.** Same measurement. |
| § Identity, `blake2s` with no digest length | **Corrected to SHA-256**, and the digest length pinned. Node cannot emit blake2s-128 at all. |
| § Identity, `quantise(bbox, 2pt)` — full bbox, 2 pt, no origin, no units, no rotation rule | **Corrected**: anchor only, 1.0 pt, and the coordinate frame written out in full. The unstated frame was worth 99.93 % id loss. |
| § Identity, `normalise(text)[:64]` | **Corrected to 8 code points**, with the truncation *unit* pinned. |
| § Identity, *"Collision-safe in practice — 80 bits over ~30k blocks/paper"* | **Kept but reframed.** The digest width was never the binding constraint; payload collisions are (§ A, § C.4). |
| § Identity, *"a parser upgrade that merges two paragraphs legitimately produces a new block"* | **STRUCK and replaced.** Under `anchor_xy` the merged block **inherits the first constituent's id** and every other constituent's id is retired. See § E.4 — the ADR's semantic claim had to be amended rather than quietly broken. |
| *"Reading order is correctly absent from the ID"* | **Upheld** — no ordinal in the payload; ids are content-derived, not positional. |
| *"Geometry must be in the ID"* | **Upheld** — removing it costs 1 800 (block) / 4 398 (line) identities. |
| *"IDs are only tier 1 of anchoring"* | **Upheld and now load-bearing** — see E.2. |

#### E.4  What `anchor_xy` means operationally, and its false-positive rate

Hashing only the top-left corner makes the ID invariant to how far the block extends right or
down. A block that **grows downward keeps its ID**. That is not a side effect; it is the
entire mechanism, and it is the only thing `anchor_xy` buys:

```
P7 merge, 5670 blocks, grid 1.0, prefix 8
  full_bbox   2616 ids survive (46.1 %),  2 land on changed text  (0.04 %)
  anchor_xy   3279 ids survive (57.8 %), 665 land on changed text (11.73 %)
  difference  +663 survivors                +663 false positives
```

Anchor's 11.69 pp churn advantage and its 11.73 % false-positive rate are **the same 663
blocks**. `anchor_xy` does not reduce churn; it **converts churn into inherited IDs on
changed content**. The identity holds for split too: +1 746 survivors, +1 752 false
positives, a 30.79 pp churn advantage against a 30.90 % false-positive rate.

*The case for* (strong for merge): the merged block is a **superset** — it contains the first
paragraph's text verbatim. A highlight anchored there resolves at tier 1 to a block that
still contains its quote, and ADR-004's text-quote selector refines the position within it.
The alternative is orphaning the highlight into a document-wide search.

*The case against* (strong for split): when a block splits, its ID stays on the **first
piece**, which is a **subset** — 1 752 blocks (30.9 % of the corpus) keep an ID on a block
that has **lost part of their text**. A highlight in the removed half resolves at tier 1 to a
block that no longer contains its quote. That is a silent partial failure *if the resolver
trusts tier 1*.

*The resolution, measured not asserted.* `Block.content_hash` (anchoring tier 2, already
required by the schema whenever text is present and source is `pdf_text_layer`) is a digest
over the **full** normalised text, so changed text is necessarily a changed `content_hash`.
The harness verified this rather than assuming it: content_hash detects **665/665** merge
false positives and **1 752/1 752** split false positives — **100.0 %** in both directions.
The cost of `anchor_xy` is therefore not silent misresolution but a **mandatory verification
step** (§ E.2, obligation 1).

---

### F. What revision 4 fixed, and how each fix was verified

Four defects in the shipped contract data, found by an independent two-language
re-derivation. **None changes a measured quantity**; three were live cross-language forks and
one was a coverage hole.

1. **Whitespace table corruption (fatal).** Revision 3 held `WS_CHARS` as a
   literal-character string and an editor/paste had flattened all 16 exotic spaces
   (U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F) to U+0020. The harness's own
   normaliser therefore ran with a **10**-element whitespace set, and `whitespace_chars`
   shipped with 16 duplicated `"U+0020"` entries — so a conforming implementation and the
   shipped file disagreed on vector `edge:exotic-whitespace` (its recorded `normalised_text`
   left a U+2009 uncollapsed). Now built from **numeric code points** and asserted to be 26
   distinct characters. **Verified:** control C6 (whitespace set taken from the shipped
   table) now diverges on 0/152 probes, 0/427 vectors, 0/5 670 corpus blocks; control C6b
   (the rev-3 table) diverges on 6 and 1. 0 of 5 670 corpus blocks contain any of the 16, so
   nothing measured moved — but U+2009/U+202F/U+2002 are routine in typeset maths and tables.
2. **The case fold was not Unicode-version-pinned (fatal, latent).** Revision 3 shipped only
   the **delta** between `casefold()` and the runtime's `lower()` and told non-Python
   implementations to lowercase the remainder. A delta table structurally cannot record a
   code point that one runtime maps and the other does not — in the generating runtime there
   *is* no delta. On 55 code points that gained a mapping after UCD 15.0.0 (U+1C89,
   U+A7CB/CC/CE/D2/D4/DA/DC, U+10D50–U+10D65 Garay, U+16EA0–U+16EB8 Medefaidrin) Python 3.12
   and Node 22 disagree — and so would Python 3.12 and Python 3.14. Now the **complete**
   1 530-entry map ships, pinned by `case_fold_unicode_version`, with runtime case functions
   forbidden outright. **Verified:** the exhaustive sweep of 4 448 256 strings went from
   **220 mismatches on 55 code points to 0**; control C11 (table + `toLowerCase` fallback)
   diverges on 55/55 of those code points.
3. **Integer emission was unbounded.** `String(Math.floor(v+0.5))` returns `"1e+21"` where
   Python `str()` returns `"1000000000000000000000"`. Now bounded at 2^53−1 with mandatory
   rejection. **Verified:** 31 quantiser probes including 1e20, 1e21, 1e22, 2^53, 2^52+0.5,
   ±nextafter(0.5), −0.0 — both languages agree on all 31, and all four out-of-range values
   are rejected identically.
4. **The ligature step was untested.** Full case folding already maps U+FB00–U+FB06, so 7 of
   the 9 table entries are redundant; only U+0132/U+0133 have independent effect
   (`casefold(U+0132)` is U+0133, not `"ij"`), and rev 3's single ligature vector put them
   past the 8-code-point prefix. Deleting the entire step passed all 418 rev-3 vectors and
   all 5 670 corpus blocks. Three vectors were added — `edge:ij-ligature-leading`,
   `eq:ij-ligature`, `eq:IJ-ligature` — plus `eq:exotic-whitespace` for defect 1.
   **Verified:** control C9 (ligature step deleted) now fails 4 vectors; it failed 0 before.

Vector count 418 → **427**; equivalence pairs 8 → **11**. Of the 418 shared vectors, **0
block_ids changed**; exactly one `normalised_text` was corrected. The full sweep table,
churn figures, collision census and derived configuration are bit-identical to revision 3.

---

### G. Reproducibility

**Corpus** — 8 papers, 195 pages. Five pre-existed; **three were added for this measurement**
and the epic brief's "8 papers" required extending `research/benchmarks/fetch_corpus.sh`
(the added three are marked ✚). Checksums in `research/benchmarks/corpus.sha256`.

| file | pages | blocks | source |
|---|---:|---:|---|
| attention-is-all-you-need.pdf | 15 | 543 | arXiv 1706.03762 |
| bert-2col.pdf | 16 | 501 | arXiv 1810.04805 |
| resnet-cvpr-2col.pdf | 12 | 535 | arXiv 1512.03385 |
| neural-odes-mathheavy.pdf | 18 | 866 | arXiv 1806.07366 |
| pdf-to-tree-acl2col.pdf | 11 | 354 | ACL |
| ✚ superglue-tableheavy.pdf | 29 | 483 | arXiv 1905.00537 — §7 complex tables, many near-identical numeric cells |
| ✚ a3c-algorithmheavy.pdf | 19 | 1 205 | arXiv 1602.01783 — algorithm2e pseudocode floats, repeated "end for" lines |
| ✚ gpt3-longform-singlecol.pdf | 75 | 1 183 | arXiv 2005.14165 — 75 pp single-column, appendices |

**RNG** — `SEED = 20260730`, 5 seeds per jitter perturbation. Every RNG is seeded by content
(`f"{SEED}|{pdf_filename}|{family}|{seed_index}"`), never by run order, so results do not
depend on the order papers are processed.

| artefact | path |
|---|---|
| Harness (revision 4) | `research/benchmarks/harness/id_stability.py` |
| Raw results | `research/experiment-results/id-stability.json` |
| Conformance vectors (**normative**) | `packages/document-ir/conformance/identity-vectors.json` |
| Zero-dependency JS reference verifier | `packages/document-ir/conformance/verify-vectors.mjs` |
| Corpus + checksums | `research/benchmarks/corpus/`, `research/benchmarks/corpus.sha256` |

```bash
cd "<repo>"

# 1. fetch the corpus (idempotent; verifies against corpus.sha256)
bash research/benchmarks/fetch_corpus.sh

# 2. re-run the whole measurement (~2.5 min on an M-series Mac).
#    Rewrites research/experiment-results/id-stability.json AND
#    packages/document-ir/conformance/identity-vectors.json.
uv run --python 3.12 --with pymupdf python research/benchmarks/harness/id_stability.py

# 3. re-run the cross-language proof: an independent JS implementation, written from the
#    conformance file alone, against all 427 vectors + 8 negative + 11 equivalence pairs.
node packages/document-ir/conformance/verify-vectors.mjs

#    ...and, optionally, against extra rows (e.g. every corpus block):
node packages/document-ir/conformance/verify-vectors.mjs \
     packages/document-ir/conformance/identity-vectors.json extra-rows.json
```

The run is **deterministic**: a full re-run produces `id-stability.json` and
`identity-vectors.json` identical modulo the `generated_at` timestamp and the timing probe —
verified by diffing two consecutive runs.

**The conformance vectors are the normative artefact. Any implementation of this formula in
any language MUST reproduce all 427 of them, plus the 8 negative and 11 equivalence pairs,
before it is allowed to write a `block_id` into the IR.**

---

### H. Limitations — read these before trusting a number above

1. **The corpus is one generator class.** All 8 papers are arXiv/LaTeX ML preprints
   (pdfTeX/XeTeX output). **No scanned or OCR'd PDF, no Office-origin PDF, no CJK body text,
   no rotated page, no CropBox offset, no negative coordinate, no astral code point in any
   text prefix.** Everything about how this formula behaves outside that class is
   extrapolation.
2. **The coordinate frame is measured only synthetically.** Because rotation is 0 and CropBox
   offset is 0 on 100 % of the corpus, `to_topleft()` is a **no-op on every block measured**.
   Its cost when wrong is P9's 99.93 %, and the conformance vectors carry synthetic negative,
   zero and −0.0 coordinates — but **nothing here exercises a genuinely rotated page, a real
   CropBox offset, or a `/UserUnit` multiplier** (all 8 PDFs have no `/UserUnit` at all, so
   the "not applied" rule is pinned by fiat rather than measured). The first such PDF in
   production is an untested path. *Epic 0 should add one rotated, one cropped and one
   `/UserUnit`-bearing PDF to the corpus.*
3. **Line-granularity collisions are conditional on a granularity Epic 1 has not frozen.**
   § C.1's most important finding — that line granularity, not block granularity, is what
   binds the grid — assumes the IR may one day carry line-level blocks. If Epic 1 freezes
   block granularity permanently, `full_bbox` at 8 pt becomes viable again and the derivation
   should be re-run.
4. **Single seed family, no confidence intervals.** One seed (20260730) with 5 jitter repeats.
   The reported standard error (0.656 pp) is the binomial s.e. of a proportion over 5 670
   blocks, **not** a bootstrap over corpora; it says nothing about how much the answer would
   move on a different 8 papers. Per-paper P7 spans 14.9 %–66.1 % (§ E.1), which is a better
   guide to that uncertainty than the s.e.
5. **P7/P8 churn is a lower bound.** Merge and split are paired by containment, and a
   baseline block counts as surviving if **any** block in its group carries its id — the most
   generous rule available, chosen so the method cannot be accused of favouring the anchor
   scheme. Real segmenter changes are messier than a clean merge or a clean split at the
   largest line gap, so the true cost of a PyMuPDF → Docling swap is **at least** 42.2 %.
6. **R1 required an explicit relaxation, and the selected configuration depends on it.**
   As literally stated R1 eliminates **136 of 192** combinations — **56 pass the strict
   reading** — because two figure labels in `bert-2col` p14 are each drawn twice at sub-point
   offsets (0.4 pt and 0.7 pt). R1 is evaluated on genuine collisions, excluding duplicate
   renders (§ C). The exemption is grid-independent and both counts are in every row of the
   raw data, but it **is** a relaxation, **the shipped `anchor_xy / 1.0 pt / prefix 8` is not
   among the 56** (`chosen_row.r1_strict_pass = false`), and a reviewer should check it rather
   than take it. Mitigation, computed by the Epic 0 gate: the **coarsest grid passing even the
   literal reading is 1.0 pt — the grid that shipped**, so the brief's "coarsest grid with
   zero collisions" holds on its own terms. The exemption is load-bearing for the *geometry*
   axis, which that rule never addressed (§ D.1).
   *Corrected 2026-07-30 (issue #22): this item previously claimed the literal rule
   "eliminates all 192 combinations", and did not disclose that the shipped configuration
   depends on the exemption. No measured quantity changed.*
7. **The grid is the weakest part of the answer.** 1.0 pt was selected because R2 is
   essentially flat across 0.25–1.0 pt while R1 forbids 2.0 pt at short prefixes — but the
   synthetic perturbations are strongly grid-sensitive and all favour a coarser grid (P3:
   62.5 % at 1 pt vs 34.7 % at 2 pt vs 7.7 % at 16 pt). The defence is that the only
   *empirical* geometry perturbation available (P10, bboxes recomputed from character boxes)
   churns **0.00 % at every grid** — real bbox-derivation changes do not reach the synthetic
   magnitudes. **That is one data point.** If anyone produces evidence that a real parser
   release shifts coordinates by a constant ~0.5 pt, the decision flips to the named
   runner-up **anchor_xy / 2.0 pt / prefix 24**, which costs +1.68 pp on R2 and halves P1 and
   P3.
8. **Prefix 8 is 8× its measured floor, and the floor has no error bar.** The binding floor is
   1 code point, computed exactly rather than sampled — but on 8 papers. A ninth, harder
   paper could raise it. The failure mode is **asymmetric**: a collision is fatal and
   irreversible (a highlight resolves to the wrong text) whereas churn is recoverable through
   anchoring tiers 2 and 3. If Epic 0 wants insurance rather than the rule's answer,
   **prefix 24 at grid 1.0 costs +1.68 pp on R2 and buys 24× margin**. The rule as written
   does not select it and it has not been overridden — but the asymmetry is real and the
   choice is a product call, not a measurement one.
9. **`anchor_xy`'s entire churn advantage is inherited ids on changed content** (§ E.4). The
   recommendation is **conditional** on tier-1 resolution always verifying `content_hash`. If
   Epic 2's resolver can return a tier-1 hit without that check, the false positives become
   silent misresolutions and `full_bbox` is the safer contract despite 11.7 pp more merge
   churn and 30.8 pp more split churn.
10. **`block_type` does no collision work on this corpus** (0 excess with or without it). It
    is retained on semantic grounds, which is an argument, not a measurement. A future pass
    could legitimately challenge it.
11. **The fold map is pinned to Unicode 15.0.0** — the version Python 3.12 carries. That is a
    deliberate freeze, not a claim that 15.0.0 is correct: bumping it is an **id-breaking
    change** requiring a `formula_version` bump and a re-anchor pass, exactly like a geometry
    change.
