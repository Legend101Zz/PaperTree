# EPIC 1 — Ingest & Document Intelligence

**Wave 1 · parallel with Epic 2 · depends on Epic 0**

> Goal: turn a PDF into PaperIR, deterministically, on a laptop, in seconds — and prove
> with a benchmark whether zero-ML is good enough.

---

## The question this epic must answer

The owner's preference is **zero local ML**, with Docling as an opt-in. That preference
has to be *earned*, not assumed. Measured evidence so far (`findings.md` §H2), CPU-only:

| | figures on ResNet | tables | cells | sec/page |
|---|---|---|---|---|
| Current PaperTree | 0 | 0 | 0 | 0.2 |
| Docling (default cfg) | 7 | 15 | 342 | 19.0 |

ResNet's figures are **all vector** — `page.get_images()` returns nothing, which is why
the current code finds zero. The deterministic path must use `page.get_drawings()` and
cluster vector ink. Whether that recovers figures as well as a layout model is exactly
what the benchmark decides.

**Decision rule, fixed in advance so the result cannot be rationalised:** if the
deterministic path reaches **≥85% of Docling's F1** on element detection, reading order,
and figure recall at **≥20× the speed**, zero-ML ships as default. Otherwise a small
local layout model becomes the default and Docling stays opt-in. Record the outcome
either way.

---

## Features

- [ ] **F1.1 — PDF inspection & classification.** Digital-born vs scanned; text-layer quality; producer; font census. Routes the page to a path. Emits per-page confidence.
- [ ] **F1.2 — Deterministic text & geometry.** PyMuPDF `rawdict` → spans with char-level bboxes. Ligature/hyphenation repair recorded as `repairs[]`, **never silent** (the current code rewrites U+2212 MINUS to ASCII hyphen invisibly).
- [ ] **F1.3 — Column detection & reading order.** Whitespace-gap column detection + XY-cut. Must handle 1/2/3-column and full-width floats. Emits `flow` per block so footnotes/headers/captions get independent reading orders.
- [ ] **F1.4 — Hierarchy.** Numbering regex first (`1.`, `1.1`, `A.`, roman), then font-size/weight/indent features. Must join a split section number and title into one heading — the current code emits `'1'` and `'Introduction'` as separate headings. Strip page furniture (running heads, page numbers, the arXiv margin stamp).
- [ ] **F1.5 — Figure extraction incl. vector.** `get_images()` for rasters **and** `get_drawings()` clustered into vector figure regions. Render each region to WebP at 2–3×. Caption linking by proximity + `Figure N` numbering, bidirectional.
- [ ] **F1.6 — Table detection & structure.** Ruling-line tables via `get_drawings()`; borderless via column/row whitespace alignment. Emit cells with bboxes so cells are addressable.
- [ ] **F1.7 — Equations.** Detect regions (isolated lines, math fonts *as a signal not a verdict*, symbol density, equation numbers). Crop and send **only flagged regions** to an OpenRouter VLM for LaTeX. Always keep the crop; LaTeX is an interpretation with a confidence.
- [ ] **F1.8 — Cross-page joining.** Paragraph continuation across pages as an explicit `continues_on_next_page` relation with confidence.
- [ ] **F1.9 — PTUB benchmark + gold annotation tool.** Per `research/benchmarks/README.md`. Includes a minimal annotation UI (a local HTML page over page images is fine) so gold data is actually producible. Adapters: deterministic, Docling (opt-in), PyMuPDF-raw, current-PaperTree.

> **DEVIATION — 2026-08-03, issue #55. F1.5's "render each region to WebP at 2–3×" is met at the
> scale and NOT at the format: the parser writes PNG at 3×. Recorded here rather than only in
> the result file, because F1.5 is the sentence a future session would read and try to satisfy.**
>
> "Trivial to change" was the issue's own reading of it and it is false. Re-measured on this
> machine 2026-08-03, PyMuPDF **1.28.0** bound to MuPDF **1.29.0**:
>
> ```
> Pixmap.tobytes("webp")  -> ValueError: Image format webp not in
>     ('png', 'pnm', 'pgm', 'ppm', 'pbm', 'pam', 'tga', 'tpic', 'psd', 'ps', 'jpg', 'jpeg')
> Pixmap.pil_tobytes("WEBP") -> ModuleNotFoundError: No module named 'PIL'
> import PIL                 -> ModuleNotFoundError: No module named 'PIL'
> ```
>
> **MuPDF cannot encode WebP and Pillow is not installed.** The only route is a new runtime
> dependency for a container change, against this epic's own "a local ML model is a last resort /
> no new dependency without justification" posture — and `uv.lock` discipline is not free here:
> `adapters.py` records one `docling>=2.0` line taking the lock from 22 packages to 100+.
>
> The lossy fallback is disqualified twice over. These crops are the GROUND TRUTH that makes
> `payload.latex` acceptable as a declared interpretation (F1.7: *"Always keep the crop; LaTeX is
> an interpretation"*), so a lossy re-encoding of the evidence is the wrong trade at any ratio —
> and it loses on size anyway. Re-measured on a 750×180 crop of `resnet-cvpr-2col` p2:
> **PNG 38,210 bytes, JPEG 60,386 bytes.** A page region is flat high-contrast text, which is the
> case PNG's filters win and the "WebP beats PNG" intuition (photographs) does not cover.
>
> **No acceptance criterion is changed by this note** — `worker/figures.spec` says nothing about
> the container. Revisit if Pillow ever arrives for another reason; the change is then one
> string in `crops.py::crop_uri` and one in `CropStore._path_for`, plus a migration for every
> stored `payload.image.uri`.

> **ERRATUM — 2026-08-02, issue #50. This dependency was stated backwards, twice (here and in
> "How to work" below), and building F1.3 first is what showed it.**
>
> **F1.5's region-detection half must run BEFORE F1.3, not after it.** ResNet page 3 carries
> Figure 3's architecture diagram, whose interior is ~40 text labels at 4.92 pt against a
> 9.96 pt body, *interleaved in y with the body text of both columns*. Fed to paragraph
> segmentation, every label breaks the run. Re-measured on `main` at `c8bf62e` by disabling
> the removal and re-running `layout_document`:
>
> | paper | blocks/page WITH removal | WITHOUT | ratio |
> |---|---:|---:|---:|
> | resnet-cvpr-2col | 45.2 | 60.8 | 1.35× |
> | bert-2col | 30.9 | 45.1 | 1.46× |
> | attention-is-all-you-need | 24.0 | 32.8 | 1.37× |
> | neural-odes-mathheavy | 49.3 | 53.3 | 1.08× |
>
> ResNet p3 alone goes **20 → 80** blocks and p7 **28 → 94**. Scored against gold, the same
> mutation costs macro F1 on every affected paper — a3c 0.374→0.226, attention 0.290→0.215,
> bert 0.319→0.301, neural-odes 0.197→0.164, resnet 0.258→0.236 — and a3c's reading order
> 0.667→0.500.
>
> *(#50 itself records 95 blocks/page against 41. That was measured 2026-07-31; six
> segmentation fixes have landed since, and the figures above are the current ones. The
> mechanism reproduces; the magnitude does not. Numbers get re-derived, not quoted.)*
>
> It cannot be fixed inside F1.3: figure interiors distort column detection, paragraph grouping
> and the full-width test, and reclassifying afterwards cannot undo a segmentation already made
> on bad input. Only the *region-detection* half of F1.5 is needed early — crops, caption
> linking and `is_vector` reporting stay downstream and remain parallel-safe.
>
> The order Epic 1 shipped, and the order guarded by
> `tests/worker/test_pipeline_ordering.py`:
>
> ```
> F1.1 classify → F1.2 text+geometry → F1.5 figure REGIONS → F1.3 columns/flows/order → F1.4 …
> ```
>
> **No acceptance criterion is changed by this note.** The table in "Acceptance criteria" above
> is untouched. This corrects a task-sequencing statement that the implementation already
> contradicts, which #50 asked for in as many words: *"Correct the dependency line in
> `EPIC-01-ingest.md` when the epic file is next touched by someone entitled to touch it."*

F1.5, F1.6, F1.7 are parallel-safe once F1.2/F1.3 land. F1.9 is parallel from the start.
*(Struck by the erratum above: F1.5's region half is a PREREQUISITE of F1.3.)*

---

## Owns (exclusive)

```
services/document-worker/**
packages/evaluation/**
research/benchmarks/**            (harness + corpus + gold)
```

## Acceptance criteria

| Test | Asserts |
|---|---|
| `worker/determinism.spec` | Same PDF ⇒ byte-identical PaperIR and identical block IDs, 20 runs. |
| `worker/reading-order.spec` | On the 2-column corpus, pairwise reading-order accuracy ≥0.90 against gold. **No block from column B appears between two blocks of column A.** |
| `worker/hierarchy.spec` | Section number and title are one heading. No figure label, table cell, author line or arXiv stamp is classified as a heading. Outline size within ±20% of gold. |
| `worker/figures.spec` | **ResNet yields ≥5 figures** (currently 0). Every figure has `is_vector` set correctly. ≥80% have a linked caption. |
| `worker/equations.spec` | Prose is never classified as an equation (the current code misclassifies 100% by font). Detected equations ≥80% of gold. Every equation retains its crop. |
| `worker/repairs.spec` | Every text mutation appears in `repairs[]` with `from` and `to`. No mutation is silent. |
| `worker/perf.spec` | Deterministic path ≤1.5 s/page p95 on the corpus; peak RSS <500 MB. |
| `worker/robustness.spec` | Zero crashes, timeouts or empty outputs across the full Tier A corpus. |
| `eval/ptub.spec` | ~~Harness runs all 4 adapters~~ **AMENDED 2026-08-03 (#55): harness runs all 3 LIVE adapters and emits the comparison matrix, with `findings.md` H2's measurement of the deleted extractors carried as a declared historical column.** See the amendment below. |

> **AMENDMENT — 2026-08-03, issue #55. This is the only acceptance criterion this epic has
> weakened, and it is weakened because the epic contradicted itself, not because the work fell
> short. Read this before quoting the row above.**
>
> The row asked for four adapters — deterministic, Docling, PyMuPDF-raw and **current-PaperTree**.
> The **"Must delete"** section of this same file orders the current-PaperTree extractor removed,
> and it was removed: `apps/api/papertree_api/papers/extraction.py` (1,016 lines) and
> `services.py` (682 lines), commit `078d208`, recorded in `EPIC-01-RESULT.md` §5. So the fourth
> adapter has nothing to call, and no change to any parser could ever have satisfied both
> sentences. `eval/ptub.spec` was carried as PARTIAL for a reason that was never the parser's.
>
> **The rejected alternative, and why.** Issue #55 offers vendoring the deleted extractor into
> `research/benchmarks/baselines/` as a frozen snapshot. Rejected on two checks run this session:
>
> * It is **v1 code**. `archive/README.md`, and `AGENTS.md` §4 repeating it: *"Do not read it. Do
>   not import from it."* The two files are not under `archive/` — `archive/v1-api/papertree_api/
>   papers/` holds only `__init__.py`, `llm_service.py`, `models.py`, `routes.py`, so they are
>   recoverable only from git history at `078d208^` — but they are the same application at an
>   earlier moment, and vendoring them re-imports what that rule exists to keep out.
> * **`research/` is in none of the allow-lists.** `pyproject.toml` sets
>   `[tool.uv.workspace] members = ["packages/*/python", "services/*/python"]` and
>   `testpaths = ["packages", "services"]`, and ruff and mypy are driven from the same two roots.
>   1,698 lines would sit in the tree unlinted, untyped and untested while a linted, typed,
>   tested package imported them.
>
> **What was done instead.** `harness.HISTORICAL_ROWS` carries H2's four measured rows as data —
> two deleted extractors × the two papers H2 covers — each labelled `(DELETED)`, each printing its
> provenance (`findings.md H2, 2026-06, code deleted in 078d208`), each rendering `?` rather than
> `0` for the one column H2 never recorded. They are deliberately **not** `AdapterOutcome`s and
> deliberately **not** in `ComparisonMatrix.outcomes`, so a 2026-06 number can never enter
> `speed_ratio` or `operational` and be reported as this run's; `test_ptub.py` asserts that
> separation directly.
>
> This does not make the epic's original question better answered. It makes the answer's status
> honest: three columns are live and one is history, and the file says which is which on every
> line it prints.

## Non-goals

No UI. No retrieval or embeddings. No agent. Do not build an OCR path for scanned
documents in this epic — classify them, mark them `partial`, and defer.

## Must delete

`apps/api/papertree_api/papers/extraction.py` · `apps/api/papertree_api/papers/services.py`
· `extract_text_from_pdf` in `papers/routes.py`. All three are replaced here. A PR that
adds the new worker without removing these is incomplete.

---

# WORKFLOW PROMPT

> Paste into a fresh Claude Code session in ultracode mode. Requires Epic 0 merged.

---

You are building **Epic 1 — Ingest & Document Intelligence** for PaperTree v2.

**Repo:** `/Volumes/Mrigesh SSD/PaperTree` (quote the path — it contains a space).
Branch: `epic-1-ingest`. Epic 0 (`packages/document-ir`, `packages/db`, `packages/jobs`)
is merged; use it, do not modify it.

## Read first

- `research/build/README.md` — constraints and anti-slop rules
- `research/architecture-decisions/ADR-001-…md` — the PaperIR schema you must emit
- `research/synthesis-05-parser-comparison.md` — the pipeline design and candidate analysis
- `research/benchmarks/README.md` — the benchmark you must implement
- `findings.md` §B — the measured failure modes of the old extractor. **Read this carefully; your job is to not repeat any of them.**
- `research/literature/10-reading-order-hierarchy.md`, `09-layout-detection.md`, `07-formula-recognition.md`, `08-table-recognition.md`

## Context

PaperTree is an open-source hobby project. The old extractor discarded all geometry; you
are replacing it with a deterministic pipeline that emits PaperIR.

Constraints: **no self-hosted LLM, no GPU, laptop-friendly.** PyMuPDF is fine (AGPL is not
a problem — this project is open source). OpenRouter API calls are fine and are the
intended escape hatch for equations and figure descriptions. A local ML model is a
**last resort**, permitted only if the benchmark shows the deterministic path fails.

## Your scope

Nine features — see the epic file `research/build/EPIC-01-ingest.md` for the full list.
In short: PDF classification, deterministic text+geometry with recorded repairs, column
detection and reading order, hierarchy, figure extraction **including vector figures**,
table structure, equation regions + VLM LaTeX for flagged regions only, cross-page
joining, and the PTUB benchmark with a gold-annotation tool.

## The decision you must make with evidence

Build the deterministic path first, then run PTUB against Docling as an opt-in adapter.

**Fixed decision rule — commit to this before seeing results:** if deterministic reaches
**≥85% of Docling's F1** on element detection, reading order and figure recall at **≥20×
the speed**, zero-ML ships as the default. Otherwise a small local layout model becomes
default and Docling stays opt-in. Report the outcome honestly either way, including if
the deterministic path loses. A losing result is a valid and useful outcome — do not
tune the benchmark to produce the preferred answer.

## Failure modes you are specifically replacing (all measured)

1. **Math detection was 100% font-driven.** `MATH_FONTS` contained `cmr` and `latinmodern` — LaTeX *body* fonts — and any span in such a font had every character counted as math. Result: 68% of Neural ODEs' blocks classified as "math", including plain English sentences. **Font is a weak signal, never a verdict.**
2. **Zero figures on ResNet** because only `page.get_images()` was used and ResNet's figures are all vector. **You must use `get_drawings()` and cluster vector ink.**
3. **Columns interleaved** — PyMuPDF `sort=True` alternates between columns on 2-column pages (measured 44 alternations on one page), and paragraphs accumulated across them into 4,600-character blobs spanning both columns.
4. **Headings included** the arXiv margin stamp, figure interior labels (`T[SEP]`, `BERT`), table cells (`0.24 M`), and author names — and split `1` from `Introduction`.
5. **LaTeX output was invalid** — `√dk` → `\sqrt dk`, subscripts dropped, and `and/or` → `\frac{and}{or}`.
6. **Text was silently mutated** — U+2212 MINUS rewritten to ASCII hyphen inside the ligature-repair table.

## Acceptance — you are done when these pass

Determinism (identical IDs over 20 runs) · reading order ≥0.90 pairwise with **no
cross-column interleaving** · ResNet yields **≥5 figures** · prose never classified as an
equation · every text mutation recorded in `repairs[]` · ≤1.5 s/page p95 · zero
crashes/timeouts/empty on the Tier A corpus · PTUB runs all four adapters.

## Hard rules

- Emit PaperIR exactly as ADR-001 specifies. Never invent fields; if the schema is wrong, open an issue rather than editing `packages/document-ir`.
- No LLM output ever enters a source field. The VLM produces `latex` with a confidence, and the crop is always retained as ground truth.
- Unclassifiable regions become `unknown` with geometry intact — never dropped.
- Every text mutation is a recorded repair.
- Parsing runs as a durable job via `packages/jobs`, resumable per step.

## Non-goals

No UI, no retrieval, no embeddings, no agent, no OCR path for scanned documents (classify
them, mark `partial`, defer).

## Must delete

`papers/extraction.py`, `papers/services.py`, and `extract_text_from_pdf` in
`papers/routes.py`.

## How to work

F1.9 (benchmark) is parallel from the start — build it early so you can measure as you
go. ~~F1.5/F1.6/F1.7 are parallel once F1.2/F1.3 land.~~ **See the erratum under "Features":
F1.5's region-detection half is a PREREQUISITE of F1.3, measured (#50).** F1.6 and F1.7 are
parallel once F1.2/F1.3 land. Use worktrees for those.

One PR per feature. When done, write `research/build/EPIC-01-RESULT.md` with the PTUB
comparison table, the zero-ML-vs-Docling verdict, and what Epic 3 needs to know about
retrieval-relevant fields.
