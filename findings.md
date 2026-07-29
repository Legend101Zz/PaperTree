# PaperTree — Findings

Evidence log. Every claim here is either a code citation (`file:line`) or an empirical
measurement reproducible via the scripts in `.audit/`.

Raw data: `research/experiment-results/current-extractor-probe.json`

---

## A. The headline finding: the document-intelligence layer is dead code

PaperTree contains **three** independent PDF extraction implementations:

| # | Location | Size | Produces | Reachable? |
|---|----------|------|----------|-----------|
| 1 | `apps/api/papertree_api/papers/routes.py:25-37` `extract_text_from_pdf` | **13 lines** | flat string, `[Page N]` markers | **YES — the only live one** |
| 2 | `apps/api/papertree_api/papers/services.py:48` `extract_pdf_content` | 682 lines | structured blocks, math/heading detection | **NO — zero importers** |
| 3 | `apps/api/papertree_api/papers/extraction.py:320` `PDFExtractor` | 1016 lines | blocks with **block IDs, bounding boxes, SourceLocation, figures, outline** | **NO — zero importers** |

Proof (`.audit/` grep, reproduced):

```
papers.services              -> 0 importers
papers import services       -> 0
papers.extraction            -> 0
papers import extraction     -> 0
from .services               -> 0
from .extraction             -> 0
```

`main.py:14` imports only `papers.routes`. Nothing else in the package reaches
either file. (`explanations/routes.py:13` and `canvas/routes.py:22` import `from
.services`, but those are *their own* sibling modules, not `papers/services.py`.)

**Consequence.** The one file in the repository that implements geometry, stable
block identity and source provenance — the entire foundation the product vision
requires — has never executed in production. What the product actually persists is:

```python
# routes.py:25-37 — the real, entire document model
text_parts.append(f"[Page {page.number + 1}]\n{page.get_text('text', sort=True)}")
return "\n\n".join(text_parts), page_count
```

Measured on the corpus:

| Paper | Live path | Dead path (discarded) |
|---|---|---|
| ResNet (12p) | 99,210-char flat string; geometry **none**, block ids **none**, figures **none**, outline **none** | 233 blocks with bbox + page + char range; outline 58; images 86 |
| Attention (15p) | 44,839-char flat string; same nulls | 181 blocks with bbox; figures 3; outline 42; images 63 |

This single fact explains nearly every downstream limitation: highlights cannot be
anchored to document objects, answers cannot cite regions, the canvas cannot
navigate back to source, and the audiobook has nothing but a string to read.

> This is also the good news. The hard architectural work is *not* "rip out a
> working system" — it is "there is no system yet". Nothing of value is lost by
> replacing paths 2 and 3 wholesale.

---

## B. Empirical defects in the (dead) structured extractor

Even if `extraction.py` were wired up, it would not be usable. Measured across
8 papers (5 arXiv/ACL + the 3 PDFs already in `apps/api/storage/papers/`):

### B1. Math classification is 100% font-driven, never symbol-driven

`extraction.py:455-458`:

```python
for char in text:
    total_chars += 1
    if is_math_char(char) or is_math_font(font):   # <-- font check inside the char loop
        math_chars += 1
```

If a span's font is "math-ish", **every character in it counts as math**, including
ordinary prose. And `MATH_FONTS` (`extraction.py:252-258`) contains `cmr` and
`latinmodern` — the *body-text* fonts of most LaTeX papers.

Measured (`.audit/probe_math_mechanism.py`), of lines the extractor classifies as math:

| Paper | lines called "math" | driven by font | driven by actual math symbols |
|---|---|---|---|
| ResNet | 86 | **86 (100%)** | 0 |
| Neural ODEs | 574 | **574 (100%)** | 0 |
| PDF-to-Tree | 47 | **47 (100%)** | 0 |

Not a single math classification in the entire corpus came from mathematical
symbol density. The classifier is detecting *typeface*, not mathematics.

Resulting damage — share of all blocks classified as math:
Neural ODEs **68.3%**, ResNet **36.9%**, Attention **33.1%**, PDF-to-Tree **24.0%**.

Because every font switch mid-sentence forces a math block and flushes the current
paragraph, **prose is shredded**. Neural ODEs' median text block is **59 characters**.
Actual "math" blocks include plain English:

- `"where t ∈{0 . . . T} and ht ∈RD. These iterative"`
- `"[T1, T2, ..., Tn] from d with PDF Miner or OCR"`
- `"side is in {224, 256, 384, 480, 640})."`
- `"LayerNorm(x + Sublayer(x)), where Sublayer(x) is the function implemented by the sub-layer"`

### B2. LaTeX conversion produces invalid LaTeX

`_text_to_latex` (`extraction.py:698-747`) is character substitution plus regex.
Actual outputs observed:

| Source | Emitted "LaTeX" | Problem |
|---|---|---|
| `√dk` | `\sqrt dk` | renders √d·k — wrong; `\sqrt` needs braces |
| `ht+1 = ht + f(ht, θt)` | `ht+1 = ht + f(ht, \theta t)` | every subscript lost (`h_{t+1}` → `ht+1`) |
| `as Ti ∈RH.` | `as Ti \in RH.` | prose with a LaTeX command spliced in |

`re.sub(r'(\w+)/(\w+)', r'\\frac{\1}{\2}', latex)` (`:737`) converts `and/or` → `\frac{and}{or}`
and mangles any URL or units. Coverage: only 12/60 (Attention) and 4/47 (PDF-to-Tree)
math blocks got any `latex` at all; the rest store `null`.

### B3. Figures are largely invisible

`_extract_page_images` (`:781`) uses `page.get_images(full=True)`, which returns only
**embedded raster** images, and skips anything under 50×50pt.

| Paper | Figures extracted | Reality |
|---|---|---|
| ResNet | **0** | 0 rasters, **60 significant vector draw ops** — every figure is a vector drawing |
| BERT | **0** | 34 rasters present, all sub-tile sized → all skipped |
| Attention | 3 | 3 rasters + **169 vector ops** |
| Shannon (1948) | **0** | 30 vector ops |

Most CS architecture diagrams and all plots produced by matplotlib/TikZ/pgfplots are
**vector**. `page.get_drawings()` is never called. Captions: 1 of 3 found (Attention),
1 of 4 (Neural ODEs) — `_find_figure_caption` (`:844`) searches only a 60pt band
directly below a single image rect.

### B4. Extracted image bytes are discarded

`extraction.py:370` returns image metadata only:

```python
images={k: {"id": v.id, "page": v.page, "mime_type": v.mime_type,
            "bbox": v.bbox.to_dict()} for k, v in self.images.items()}
```

`ExtractedImage.data` never leaves the extractor, and the extractor instance is
discarded by `extract_pdf_content` (`:960`). Measured `images_dict_carries_pixel_bytes:
false` for all 8 papers. Every `FigureBlock.image_id` is therefore a dangling reference.

### B5. Reading order is broken in three separate ways

1. **Figures precede their page's text.** `_extract_page_images` is called at
   `:415`, before text processing at `:420`. Measured violations: Attention 3,
   Neural ODEs 4, PDF-to-Tree 2.
2. **Columns interleave.** PyMuPDF `sort=True` orders blocks top-to-bottom, which on a
   two-column page alternates between columns. Measured L/R alternations within a
   single page: ResNet p4 **44**, PDF-to-Tree p2 **39**, seq2seq p5 **38**, BERT p2 **25**.
3. **Paragraphs merge across those columns.** `current_paragraph` (`:418`) accumulates
   across *all* PyMuPDF blocks on a page and is flushed only on a heading/math/list
   line — so left-column and right-column text concatenate into one block. Largest
   observed text blocks: 4,673 chars (ResNet), 4,668 (PDF-to-Tree), 4,366 (seq2seq).

### B6. Heading detection promotes figure labels, table cells and page furniture

Outline sizes: Attention **42** items, BERT **81**, ResNet **58**, Shannon **193** —
against real section counts around 7–25. Actual entries emitted as headings:

- Section numbers split from their titles: `'1'`, `'Introduction'`, `'2'`, `'Background'` — separate blocks.
- The arXiv margin stamp, on every arXiv paper: `'arXiv:1706.03762v7  [cs.CL]  2 Aug 2023'`.
- Diagram interior labels (BERT Fig. 1): `'T[SEP]'`, `'E[CLS]'`, `'BERT'`.
- Table cells (Neural ODEs): `'0.24 M'`, `'0.22 M'`, `'O(1)'`.
- Figure labels (PDF-to-Tree Fig. 2): `'BUFFER'`, `'STACK'`, `'[ROOT, T1]'`.
- Author/affiliation lines (ResNet): `'Kaiming He'`, `'Microsoft Research'`.

There is no header/footer/margin-furniture removal anywhere in the codebase.

### B7. `_clean_text` destroys mathematical characters

`extraction.py:633` and `services.py:540` both map `'−': '-'` — U+2212 MINUS SIGN is
rewritten to ASCII hyphen, in the same table as ligature repair, with no record of the
change. Same code also collapses en/em dashes.

---

## C. The live pipeline: what actually happens

```
POST /papers/upload                        (routes.py:40)
  └─ file.read() into memory, write to storage/papers/{uuid}.pdf
  └─ extract_text_from_pdf()               SYNCHRONOUS, in-request
  └─ insert {extracted_text: <flat string>, page_count}   ← the entire document model

POST /papers/{id}/generate-book            (routes.py:146)
  └─ generate_book_content()               SYNCHRONOUS, in-request
       ├─ generate_paper_tldr()            1 OpenRouter call, first 4000 chars
       └─ generate_multiple_pages()        N SEQUENTIAL OpenRouter calls (llm_service.py:265)
            └─ per page: extract_page_text() regex-slices the flat string on [Page N]
                         truncate to 5000 chars (first 2500 + last 2500)  (llm_service.py:161)
                         → LLM → JSON → PageSummary
  └─ smart_outline = one entry per PAGE, titled by the LLM   (routes.py:198-207)
```

### C1. Generation runs inside the HTTP request

`generate_book` awaits up to `default_pages` sequential OpenRouter calls, each with a
90s timeout (`llm_service.py:171`). Default 5 pages → up to **450 s in one request**;
`generate_all=true` on a 55-page paper → up to **4,950 s**. There is no job queue, no
task table, no `processing_status` field, and no progress endpoint. Any proxy (nginx
default 60s, most PaaS gateways 300s max) terminates this. There is no resumption —
`generate-pages` re-runs from scratch for missing pages.

### C2. Off-by-design bug: `pages` parameter is ignored

`routes.py:185-186` sets `default_pages = len(request.pages)`, then
`llm_service.py:316` computes `pages_to_generate = list(range(min(default_pages, page_count)))`.
Requesting pages `[7,8,9]` therefore generates pages **0, 1, 2**. The requested page
numbers are discarded.

### C3. The outline is page-indexed, not semantic

`SmartOutlineItem.section_id = f"page-{n}"` (`routes.py:204`). The "semantic outline"
is literally one entry per PDF page, named by the LLM. This is the explicit
anti-requirement: *PDF page boundaries are not semantic section boundaries*. The PDF's
own TOC (`doc.get_toc()`) and detected headings are computed only in the dead code.

### C4. Nothing generated is grounded

`PAGE_SUMMARY_USER_PROMPT` (`llm_service.py:67`) interpolates raw page text between
`---` fences and asks for a Feynman-style explanation. The response schema is
`{title, summary, key_concepts, has_math, has_figures}` — **no block IDs, no page
spans, no citations, no confidence**. There is no post-hoc verification. Nothing in
the system can answer "which part of the paper does this sentence come from?"

### C5. The model is instructed to invent diagrams

`llm_service.py:41-55` instructs the model to emit Mermaid diagrams for "process
flows, system architectures, decision trees". These are rendered by
`MermaidRenderer`/`Mermaid.tsx` identically to real content. The product therefore
displays **fabricated architecture diagrams that do not exist in the paper**, visually
indistinguishable from the paper's own figures. This directly violates the rule that
AI-generated content must not appear identical to source content.

### C6. Silent truncation

`llm_service.py:161-162`: pages over 5000 chars become `text[:2500] + "...[content
truncated]..." + text[-2500:]`. The middle of the page is dropped; the resulting
summary claims to describe the whole page. No record is kept.

### C7. Errors are persisted as content

`llm_service.py:282-292` stores `summary: "_Failed to generate summary: {error}_"` as a
normal `PageSummary`. Failures become indistinguishable from content in the database,
and `generate-pages` will treat that page as already generated (`routes.py:256`),
so it is never retried.

### C8. No injection defence

Untrusted PDF text is interpolated directly into the prompt with no delimiting,
marking, or instruction-hierarchy defence. `temperature=0.7` for a
structured-extraction task, with hand-rolled JSON recovery via three regex fallbacks
(`llm_service.py:366-380`) and no provider JSON/structured-output mode.

---

## D. Security and operational findings

| # | Finding | Location | Consequence |
|---|---|---|---|
| D1 | **JWT passed in URL query string** | `routes.py:317-324`, `:349-362`; `api.ts:99-118` | Token leaks into browser history, server access logs, and `Referer` headers on any external resource. Applies to the PDF file endpoint and every page-image request. |
| D2 | `get_page_image` has no `scale` bound | `routes.py:359,396` | `scale` is caller-controlled and unbounded; `fitz.Matrix(scale, scale)` on a large page is a trivial memory-exhaustion DoS. |
| D3 | Orphaned data on delete | `routes.py:428-431` | Deletes `highlights`, `explanations`, `canvases` — but not `canvas_nodes`, `highlight_explanations`, or `paper_images`, all of which are indexed in `database.py:19,37-42`. Also never deletes the stored page images. |
| D4 | Bare `except:` | `routes.py:120`, `:240` | Swallows all exceptions including DB failures, reporting them as 404. |
| D5 | No file dedup | `routes.py:49-56` | The two identical PDFs in `storage/papers/` (`5a047c21…`, `e91a46cd…`) are byte-identical and produce identical extraction (106 blocks each). No content hash is computed, so re-uploads duplicate storage and re-pay for generation. |
| D6 | Upload reads whole file into memory | `routes.py:54` | `await file.read()` with no size limit. |
| D7 | PyMuPDF is undeclared | `requirements.txt`, `pyproject.toml` | Both manifests list `pypdf2`; **neither lists PyMuPDF**, yet `fitz` is imported in `routes.py:6`, `extraction.py:16`, `services.py:7`. A clean install per the documented instructions cannot start. Confirmed: `uv.lock` contains no pymupdf entry. |
| D8 | PyMuPDF licence | — | PyMuPDF is **AGPL-3.0** or paid commercial. It is currently the entire extraction stack of an intended commercial product. This needs an explicit decision. |
| D9 | Hardcoded dev secrets | `docker-compose.yml:24`, `config.py:14` | `JWT_SECRET=your-super-secret-jwt-key-change-in-production` is the compose default and the code default. |
| D10 | `apps/api/.env` is committed | repo root listing | Present in the working tree alongside `.env.example`. Needs checking for a live OpenRouter key. |
| D11 | CORS origins hardcoded to localhost | `main.py:36-40` | No configuration path for deployment. |

---

## E. Corpus and reproduction

Benchmark seed corpus downloaded to `research/benchmarks/corpus/`:

| File | Why |
|---|---|
| `attention-is-all-you-need.pdf` | single-column NeurIPS, tables, vector figures, moderate math |
| `resnet-cvpr-2col.pdf` | two-column CVPR, all-vector figures, many tables |
| `bert-2col.pdf` | two-column ACL, tiled raster figures |
| `neural-odes-mathheavy.pdf` | dense derivations, algorithm blocks, appendices |
| `pdf-to-tree-acl2col.pdf` | two-column ACL; also the subject of Part B1 |
| `06a65b89…pdf` (existing) | Shannon 1948, 55pp, old typesetting, vector diagrams |
| `5a047c21…`, `e91a46cd…` (existing) | seq2seq — byte-identical duplicates, evidence for D5 |

Reproduce (PDFs are fetched, not committed — see `research/benchmarks/fetch_corpus.sh`):

```bash
cd "/Volumes/Mrigesh SSD/PaperTree"

# 1. fetch the corpus and verify integrity
./research/benchmarks/fetch_corpus.sh
(cd research/benchmarks/corpus && shasum -c ../corpus.sha256)

# 2. build the probe venv (gitignored; ~1.4GB with docling)
python3 -m venv .audit/venv
.audit/venv/bin/pip install pymupdf pydantic pydantic-settings
.audit/venv/bin/pip install docling          # only needed for the capability matrix

# 3. run the probes
.audit/venv/bin/python research/benchmarks/probes/probe_extractor.py research/benchmarks/corpus/*.pdf
.audit/venv/bin/python research/benchmarks/probes/probe_math_mechanism.py research/benchmarks/corpus/resnet-cvpr-2col.pdf
.audit/venv/bin/python research/benchmarks/harness/compare_parsers.py research/benchmarks/corpus/resnet-cvpr-2col.pdf
```

Note: the probes import the **real repo modules** from `apps/api`, so they measure the
actual shipped code, not a reimplementation. They will stop working once Epic 1 deletes
`papers/extraction.py` and `papers/services.py` — that is expected, and the JSON in
`research/experiment-results/` preserves the measurements.

---

## F. SECURITY: multi-tenancy is systematically broken

**This is the most urgent finding in the audit and is independent of the redesign.**
The app is running against a live MongoDB Atlas cluster with a real OpenRouter key.

Authorisation is applied inconsistently: some routes filter by `user_id`, many do not.
All of the following were verified by reading the code directly.

### F1. Cross-tenant read **and write** of another user's highlights — CRITICAL

`canvas/services.py:544` (read):
```python
highlight = await db.highlights.find_one({"_id": ObjectId(highlight_id)})
```
`canvas/services.py:645` (write):
```python
await db.highlights.update_one({"_id": ObjectId(highlight_id)},
                               {"$set": {"canvas_node_id": explore_id}})
```
Neither query filters on `user_id`. Any authenticated user who supplies another user's
highlight ObjectId to the canvas `explore` endpoint pulls that user's **selected text**
into their own canvas *and mutates the victim's highlight document*.

### F2. Cross-tenant read of another user's paper and AI summaries — CRITICAL

Four separate call sites fetch a paper with no ownership filter:
`canvas/services.py:170`, `:219`, `:464`, `:901` —
```python
paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
```
`:464` is inside `ensure_page_super_node`, reached from
`POST /papers/{paper_id}/canvas/expand-page` (`canvas/routes.py:162-176`). The route
scopes the *canvas* to the caller but never checks that `paper_id` belongs to them, then
copies `book_content.page_summaries[n].title` and `.summary` into the caller's canvas.

### F3. Explanation trees traverse without ownership filters — CRITICAL

`explanations/routes.py:242,246,362,365` walk `parent_id` chains with
`find_one({"_id": ObjectId(exp_id)})` / `find({"parent_id": exp_id})` and no `user_id`.
Ownership is checked only at the root. There is also no depth or cycle guard.

### F4. The entire legacy highlight router returns 500 — CRITICAL (availability)

`auth/utils.py:92-94` returns `{"id": str(user["_id"]), "email": ...}`. There is no
`_id` key. But `highlights/routes.py:27` (and `:57, :83, :108, :128, :147`) does:
```python
"user_id": str(user["_id"])     # KeyError: '_id'
```
Every one of those endpoints raises `KeyError` → HTTP 500. Because `api.ts:207` routes
reader deletions through `DELETE /highlights/{id}`, **users cannot delete a highlight at all.**

### F5. Summary of the authorisation audit

`grep` for `db.{papers,highlights,explanations,canvases}` queries lacking a `user_id`
filter returns **33 call sites** across `canvas/services.py`, `highlights/routes.py` and
`explanations/routes.py`. Not all are exploitable (some are scoped by a prior check),
but ownership is enforced ad hoc at the call site rather than structurally. There is no
repository layer, no `assert_owns(user, resource)` helper, and no test.

**Recommendation, independent of everything else in this report:** treat F1–F3 as a live
incident. Rotate the OpenRouter key and the Atlas credentials in `apps/api/.env`, add a
mandatory ownership filter at a data-access layer, and add regression tests. Do this
before any redesign work. (Mitigating fact: `apps/api/.env` is correctly gitignored and
`git log --all` confirms it was **never committed**, and no `sk-or-` string exists
anywhere in history — so there is no public key leak.)

---

## G. Audit findings inventory

Four subsystem audits (full text in `research/audit-*.md`) produced **~100 findings,
17 critical**. Themes, in order of importance:

1. **Provenance is destroyed at every layer.** Ingest discards geometry (§A); highlight
   capture discards it again (`read/page.tsx:228` divides `getClientRects()` by
   `window.innerWidth`, then `PDFViewer.tsx:146` renders that as a fraction of the
   *page* element — so highlights are misplaced immediately and differ per device);
   canvas nodes keep only a page integer (`canvas/services.py:562-573`).
2. **AI output is indistinguishable from source.** Book mode renders LLM prose as the
   document with source page numbers attached (`BookViewer.tsx:686-713`); highlights
   made in Book mode are stored as if they were highlights *of the paper*
   (`highlights/routes.py:367-393`); failed generations are persisted as answers
   (`canvas/services.py:726-728`, `llm_service.py:282-292`).
3. **The canvas auto-generates.** `populate_canvas` creates a node per page unbidden
   (`canvas/services.py:234`) and duplicates already-explored highlights; an
   auto-save ⇄ invalidate loop rewrites the canvas continuously
   (`canvasStore.ts:43-44`, `PaperCanvas.tsx:133-136`); server auto-layout destroys
   manual arrangement.
4. **No touch support anywhere.** Zero `onTouch*`/`onPointer*` handlers in the app.
   Every primary action on canvas nodes and panels is `hover`-only, i.e. unreachable on
   iPad — against a product brief whose headline is an iPad-class experience.
5. **Duplicated, contradictory type systems.** Two `Highlight` types
   (`types/highlight.ts:39` vs `types/index.ts:405`, with the API layer typed as the
   wrong one), two canvas type systems (`types/index.ts:273-346` vs `types/canvas.ts`),
   two API clients with different auth and error behaviour, four independent OpenRouter
   clients with four different prompt vocabularies.
6. **Substantial dead and broken code.** `hooks/useCanvas.ts` references ~10
   non-existent methods; `canvasApi.batchExport` is called but does not exist;
   `SearchResults.tsx` would crash on mount; `explanations/routes.py:129-131` imports
   symbols that do not exist so `auto_add_to_canvas` (default **true**) fails silently
   on every call.

---

## H. External research

See `research/literature/` (14 topics) and `research/audit-*.md` (4 subsystem audits).

### H1. PDF-to-Tree — verdict: adopt the ideas, reject the system

Verified 2026-07-29 against the paper and repo:
- Repo has **exactly one commit** (2024-11-29), **no licence** (= all rights reserved),
  **no released weights** (`weights/` holds only a `.gitignore`; total repo 19 KB), two
  unanswered issues, and a CUDA-11.3-era pinned dependency stack. **No PDF→tree entrypoint exists.**
- The headline "93.93%, +6.72%" is **UAS only**. On **LAS** — correct parent *and* label —
  PDF-to-Tree (0.8166) **loses** to the BROS_large baseline (0.8210), which the paper concedes.
- Every configuration above 0.9338 UAS depends on LayoutLMv2/v3 weights licensed
  **CC BY-NC-SA 4.0 (non-commercial)**. The best commercially-clean variant is
  `PDF-to-Tree_bert` (0.9158 UAS, Apache-2.0) — and would still need training from scratch
  on an unlicensed dataset with unlicensed code.
- Corpus is **manuals and technical reports, all born-digital, zero scanned** — not
  research papers. Meaningful domain gap.
- **Most valuable finding for PaperTree — the ablation.** Removing *layout* features
  costs 3.25 UAS; adding *vision* on top of text+layout buys only ~2.3 UAS. Font size,
  indentation and relative bbox offsets do most of the work. This is direct evidence
  that a cheap, deterministic, CPU-only layout-feature model captures most of the
  hierarchy signal — which is exactly the architecture PaperTree needs.

**Adopt:** blocks+arcs data model; left-child/right-sibling encoding (hierarchy *and*
per-container reading order in one structure); **independent reading orders** for
footnotes/captions/furniture; explicit `unknown`/orphan escape hatch instead of silent
drops; UAS/LAS as internal structure metrics.

**Does not solve** (must come from elsewhere): math OCR, figure *detection* (figures are
not even nodes — so vector diagrams are entirely invisible), plot/diagram semantics,
caption→figure linking, table cell structure, scanned documents, re-parse-stable IDs,
and any semantic comprehension. It addresses roughly one of PaperTree's eight hard
requirements.

### H2. Measured parser capability comparison (PTUB rows 1/2/3/5)

Not a hypothesis — actually run, on this machine, CPU-only, Apple Silicon.
Harness: `research/benchmarks/harness/compare_parsers.py`.
Raw: `research/experiment-results/ptub-capability-matrix.json`.

This measures **capability**, not accuracy — which of PaperTree's hard requirements each
parser can even *express*. Accuracy needs the Tier B gold set, which does not exist yet.

**ResNet (12pp, two-column, all-vector figures):**

| Candidate | blocks | bbox | page | stable id | headings | eq | eq+LaTeX | figures | captions linked | tables | table cells | nested tree | sec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. PaperTree **LIVE** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ✗ | 2.0 |
| 2. PaperTree dead extractor | 233 | 233 | 233 | 0 | 58 | 86 | 26 | **0** | 0 | 0 | 0 | ✗ | 4.1 |
| 3. PyMuPDF raw | 549 | 549 | 549 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ✗ | 0.6 |
| 5. **Docling** (default cfg) | 519 | **519** | **519** | 519 | 22 | 2 | 0 | **7** | **18** | **15** | **342** | ✓ | 228 |

**Attention Is All You Need (15pp):**

| Candidate | blocks | bbox | page | stable id | headings | eq | eq+LaTeX | figures | captions linked | tables | table cells | nested tree | sec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. PaperTree **LIVE** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ✗ | 0.8 |
| 2. PaperTree dead extractor | 181 | 181 | 181 | 0 | 42 | 60 | 12 | 3 | 1 | 0 | 0 | ✗ | 3.7 |
| 3. PyMuPDF raw | 540 | 540 | 540 | 0 | 22 | 0 | 0 | 0 | 0 | 0 | 0 | ✓(TOC) | 0.9 |
| 5. **Docling** (default cfg) | 518 | 518 | 518 | 518 | 28 | 5 | 0 | **6** | 9 | **4** | **222** | ✓ | 75 |

**Readings, stated carefully:**

- The live pipeline scores **zero on every column**. That is the finding, not a bug list.
- Docling is the only candidate that recovers **tables with addressable cells** (342 and
  222) and the only one that finds **figures in the all-vector ResNet paper** (7, where
  both PaperTree extractors find 0). It is also the only one producing a **nested
  section tree**.
- **Caveats I am not glossing over.** This is Docling's *default* configuration.
  `eq+LaTeX = 0` because `do_formula_enrichment` is off by default; formula *detection*
  is also low (2 and 5, against ~10 numbered equations in each paper). The literature
  report (`02-docling.md`) says PaperTree must explicitly set
  `heading_hierarchy_options.enabled=True` (default `False` flattens every heading to
  level 1), `do_formula_enrichment=True`, `TableFormerMode.ACCURATE`, and `do_ocr=False`
  for born-digital pages. **These numbers are a floor, not Docling's ceiling.**
- **Cost is the real problem.** 228 s for 12 pages (~19 s/page) on ResNet and 75 s for
  15 pages (~5 s/page) on Attention, CPU-only. The ResNet run triggered the OCR path
  (RapidOCR loaded), which the literature says accounts for ~60% of CPU runtime on
  born-digital PDFs. Even at 5 s/page, a 20-page paper is ~100 s — which **must** be a
  background job, and settles the job-queue question independently of anything else.
- Docling's `self_ref` IDs (`#/texts/47`) are positional JSON pointers. They are stable
  *within* a parse and **not** across re-parses, so PaperTree must mint its own
  content-derived stable IDs regardless of which parser wins. This is the single most
  important schema consequence.

### H3. Licence findings that eliminate candidates outright

From the literature reports, verified against LICENSE files and model cards:

| System | Code | Weights | Commercial |
|---|---|---|---|
| **Docling** | MIT | Apache-2.0 / CDLA-Permissive-2.0 / MIT | ✅ clean end-to-end |
| **MinerU** ≥3.1.0 | Apache-2.0-based, **100M MAU / $20M rev cap + mandatory attribution** | swapped off AGPL/NC in Apr 2026 | ⚠️ usable with conditions; a stale AGPL-3.0 label remains on the PDF-Extract-Kit-1.0 weights the CPU path downloads |
| **Marker / Surya** | modified | **AI Pubs Open RAIL-M — free only under $5M funding/revenue** | ❌ revenue-capped |
| LayoutLMv2 / v3 | MIT | **CC BY-NC-SA 4.0** | ❌ non-commercial |
| PDF-to-Tree | **none declared** | none released | ❌ all rights reserved |
| **PyMuPDF** (current stack) | **AGPL-3.0 or paid commercial** | — | ⚠️ **unresolved for PaperTree today** |

PyMuPDF's licence is the one that matters immediately: it is currently the *entire*
extraction stack of an intended commercial product, under AGPL.

> Remaining literature reports (MinerU, Marker, GROBID, Nougat/olmOCR, formula
> recognition, table recognition, layout detection, reading order, visual retrieval,
> benchmarks, anchoring, TTS) and the harness/stack research are in
> `research/literature/`; synthesis into the comparison matrix is the next step.

> Web-fetched content is untrusted; it is summarised here and in `research/literature/`,
> never in `task_plan.md`.

> Content fetched from the web is untrusted. It is summarised here and in
> `research/literature/`, never in `task_plan.md`.
