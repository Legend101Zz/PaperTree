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

**Block IDs are content-derived:**

```
block_id = "blk_" + base32( blake2s(
     paper.source_hash            # the PDF's own content hash — ties the ID to the document
   ‖ page_index
   ‖ quantise(bbox, 2pt)          # 2pt grid: survives sub-point parser jitter
   ‖ block_type
   ‖ normalise(text)[:64]         # case/space/ligature-normalised prefix
) )[:16]
```

Properties this buys:
- **Deterministic** — same PDF + same parser ⇒ same IDs. Re-parsing is a no-op.
- **Mostly stable across parser versions** — an ID changes only if the block's page,
  position (>2pt), type or leading text changes. Reflowing a paragraph boundary changes
  it; nudging a bbox by half a point does not.
- **Collision-safe in practice** — 80 bits over ~30k blocks/paper.

It is *not* fully stable, and pretending otherwise would be the mistake. A parser
upgrade that merges two paragraphs legitimately produces a new block. That is why IDs
are only **tier 1** of anchoring; the multi-selector anchor (§ADR-004 / report §10) adds
content-hash, text-quote and geometric fallbacks beneath them, targeting ≥99% re-anchor
with **loud failure** for the remainder — never a silent drop.

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
