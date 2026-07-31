# EPIC 1 — Ingest & Document Intelligence: result

**Status: INCOMPLETE. 5 of 10 acceptance tests met.** Branch `epic-1-ingest`, 30 commits,
`63be37d..1aaea2d`. `research/build/EPIC-01-ingest.md` is **unedited** — no acceptance criterion
was weakened, and no test file claims a criterion it does not meet.

Every number below was measured on this machine at `pymupdf 1.28.0` / `docling 2.117.0` against
the 8-paper, 195-page corpus. Nothing is quoted from a doc without being re-run.

---

## 1. The decision the epic exists to make

> **Fixed rule, committed to before seeing results:** if deterministic reaches **≥85 % of
> Docling's F1** on element detection, reading order and figure recall at **≥20× the speed**,
> zero-ML ships as default. Otherwise a small local layout model becomes default and Docling
> stays opt-in.

### Verdict: **the rule is not satisfied, and it is not fully evaluable.**

**The speed half is measured and it FAILS.** Median over the 8 papers both parsed:

| | p50 s/page | p95 s/page | failure rate |
|---|---|---|---|
| pymupdf-raw (floor) | 0.046 | 0.107 | 0 % |
| **papertree-deterministic** | **0.288** | **1.644** | **0 %** |
| docling | 4.584 | 6.017 | 0 % |

**12× faster, against a 20× bar.** Not 250×, which is what an earlier partial measurement of
mine suggested and which I am correcting here: that figure compared a parse without tables,
crops or validation against findings.md H2's Docling run, which had triggered the OCR path.
Docling on this machine today is **4.6 s/page, not 19** — roughly 4× faster than H2 recorded —
and the deterministic path is **288 ms/page, not 134**, because it now also detects tables,
renders 130+ crops per paper and runs the full semantic validator. Both halves of the ratio
moved toward each other.

**The F1 half cannot be computed at all.** `research/benchmarks/README.md` §7: *"Gold
annotations: **not started** — the critical path item; ~60 expert-hours"*, and *"No parser
selection is authorised until Tier B gold exists and rows 1–5 have been run."* The metrics are
implemented and tested (§4 below); there is nothing to run them against.

I did not manufacture the gold. An agent annotating the corpus with knowledge of its own
parser's output, or treating Docling's output as gold, produces exactly the number the rule was
written in advance to prevent.

**So: zero-ML does not ship as default on this evidence.** The honest reading is that the epic's
own fallback applies — Docling stays opt-in, and the question of a small local layout model is
open — but that conclusion rests on the speed half alone and should be revisited once gold
exists, because the capability table below is not a bad result.

### Capability, measured (findings.md H2's columns)

**ResNet** (12 pp, two-column, all-vector figures):

| Candidate | blocks | bbox | page | stable id | headings | eq | figures | captions linked | tables | cells | sections | s/page |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PaperTree LIVE *(H2, deleted)* | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2.0 | 0.2 |
| PaperTree dead extractor *(H2, deleted)* | 233 | 233 | 233 | 0 | 58 | 86 | **0** | 0 | 0 | 0 | — | 4.1 |
| pymupdf-raw | 549 | 549 | 549 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.05 |
| docling | 519 | 497 | 497 | **0** | 22 | 2 | **7** | 21 | 15 | 342 | 22 | 2.10 |
| **papertree-deterministic** | 931 | **931** | **931** | **931** | 7 | 0 | **11** | 3 | 10 | **580** | 7 | **0.14** |

Rows 1 and 2 are carried forward from findings.md H2 and marked as such: both are **deleted**
(§5), and re-implementing 1,698 lines of removed code to re-measure what was already measured
would be the opposite of the point.

Three things in that table are worth stating plainly:

- **Every block has geometry and a content-derived stable id.** Docling's `self_ref` ids are
  positional JSON pointers (`#/texts/47`) — stable within a parse, not across re-parses. H2
  calls this "the single most important schema consequence"; it is why PaperTree mints its own
  ids whichever parser wins, and it is the column where the deterministic path is not merely
  competitive but categorically different.
- **Figures: 11 against Docling's 7**, all correctly `pdf_vector`, where both old extractors
  scored 0. That is findings.md B3 closed.
- **Headings: 7 against Docling's 22.** The deterministic hierarchy is weak, and §3 says so.

---

## 2. Acceptance criteria — per-test verdict

| Test | Verdict | Evidence |
|---|---|---|
| `worker/determinism.spec` | **MET** | 20 runs byte-identical via `canonical_json_for_determinism`, ids stable. `test_pipeline_end_to_end.py` |
| `worker/repairs.spec` | **MET** | 84,395 spans, 749 dehyphenation proposals, rules 25/26/27/30b hold; 30b checked against the validator's own `_dehyphenate` |
| `worker/robustness.spec` | **MET** | 8/8 papers parse and validate; 0 crashes, 0 timeouts, 0 empty outputs |
| `worker/perf.spec` | **MET** | p50 305 ms/page, p95 568 ms/page against a 1500 ms bar |
| `ingest/source-authenticity.spec` | **MET** | every line of every non-table block traced to the page's glyph stream; found 2 real bugs while being written |
| `eval/ptub.spec` | **PARTIAL** | harness + metrics + annotation tool done, 16 tests; **3 adapters, not 4** — rows 1/2 are deleted code |
| `worker/figures.spec` | **PARTIAL** | ResNet ≥5 ✅ (11, all vector); ≥80 % captioned ❌ (median ~35 %) |
| `worker/equations.spec` | **PARTIAL** | prose never classified as an equation ✅; ≥80 % of gold ❌ (no gold); every equation retains its crop ✅ |
| `worker/reading-order.spec` | **NOT MET** | needs gold for the ≥0.90 pairwise figure. Cross-column interleaving is reduced, not eliminated |
| `worker/hierarchy.spec` | **NOT MET** | number/title joining and furniture stripping work; outline size is far outside ±20 % on long papers |

---

## 3. What is wrong, stated without rounding up

- **Hierarchy over-detects badly on long papers.** a3c 156 heading candidates, gpt3 324, against
  real section counts of 7–25. Display equations and table rows are still promoted — ResNet
  yields `'y = F(x, {Wi}) + x.'` as a heading. The cause is pipeline ordering, the same one
  issue #50 records for figures: equations and tables must be claimed before hierarchy runs.
- **Caption linking is 8–100 % per paper, median ~35 %.** The linker takes the nearest unlinked
  region by vertical centre and ignores the caption's *own number* — "Figure 3" should bind to
  the third figure, not the closest one.
- **Figure over-detection on plot-heavy papers.** neural-odes yields 77 figures for a paper with
  about 4; every matplotlib panel and axis becomes its own region.
- **330 of ResNet's blocks still produce more than one polygon**, i.e. the geometry says they
  span a gutter. Down from 478, not resolved.
- **Equation regions over-fire inside algorithms.** 13 regions against 5 hand-labelled on
  neural-odes pages 0–2; 7 of the extras are math inside Algorithm 1.
- **`worker/equations.spec`'s LaTeX half is unexercised.** `vlm.py` works — verified live against
  MiniMax-M3 on a real crop, returning `\frac{d\mathbf{h}(t)}{dt} = f(\mathbf{h}(t), t, \theta)`
  correctly — but the pipeline runs with `vlm_max_calls=0` by default and no corpus-wide LaTeX
  pass has been made.
- **The Docling adapter reports counts, not documents**, so element-detection F1 against Docling
  is not computable even with gold until the bridge returns geometry.

---

## 4. What Epic 3 needs to know about retrieval-relevant fields

- **`doc_order` is body-only, by validator rule 15** — present on *exactly* the top-level
  `flow == "body"` blocks, dense across the document. Sorting by `doc_order ?? 0` collapses every
  caption, footnote, page number and nested table cell to position 0. Rebuild reading order from
  `Page.flows` plus parent/child descent. Issue #49.
- **`Block.text` is the glyph stream**, unmutated: ligatures, U+2212 and line-break hyphens are
  all still there, joined by U+000A. For retrieval you want
  `resolved_text(block, apply_proposed=True)`, which folds in the dehyphenation proposals —
  749 of them across the corpus.
- **`text_normalised` and `content_hash` are present on every text-layer block** (rule 37), and
  `content_hash` is `sha256:` over `normalise_text`, **not** the `blake2s` the schema's example
  still shows.
- **Table cells are addressable blocks**, nested under `table_row` under `table`, each with its
  own id and polygon, and cross-referenced from `payload.grid.cells[].cell_id`. 580 on ResNet.
- **`payload.html` is deliberately absent** on tables (rule 32b: own the serialiser or drop the
  field — it would have to live in `packages/document-ir`, which Epic 1 may not edit).
- **`Metadata` is all-null.** Every one of the seven keys is present and `authors` is `[]`, which
  validates clean, but no bibliographic extraction was built. Rule 6b makes this expensive to add
  carelessly: every value must be a *substring of its cited block's normalised text*.
- **`Paper.references` is `[]`.** No reference parsing.

---

## 5. Deletions, as promised

| Item | State |
|---|---|
| `apps/api/papertree_api/papers/extraction.py` | **deleted** (1,016 lines, zero importers) |
| `apps/api/papertree_api/papers/services.py` | **deleted** (682 lines, zero importers) |
| `extract_text_from_pdf` in `papers/routes.py` | **replaced** by `read_paper_text` |

1,698 lines with zero importers — findings.md §A's figure, confirmed exactly. The replacement is
measurably better, not merely different: the old function used `sort=True`, and on ResNet page 4
produced *"Residual Network. Based on the above plain network, we **image image image** insert
shortcut connections (Fig. 3, right) which turn the **output** network into its counterpart
residual version. The identity **size: 224 3x3 conv, 64**..."* — one sentence shredded by
Figure 3's interior labels. The new output keeps prose contiguous and drops the arXiv stamp.

Still synchronous, and that is not fixed: findings.md C1's "generation runs inside the HTTP
request" stands. `job.enqueue_parse` exists and works, but `apps/api` stores papers in MongoDB
while the job store is SQLite.

---

## 6. Deviations from the brief

| Deviation | Why |
|---|---|
| Crops are **PNG, not WebP** | MuPDF cannot encode WebP; Pillow would be a new dependency for a container change; JPEG is lossy and these crops are the *ground truth*; measured PNG 83 kB vs JPEG 119 kB on a 720×360 crop; PNG is already the repo's fixture convention |
| **F1.5 runs before F1.3**, reversing the epic's stated order | ResNet p3's Figure 3 has ~40 interior labels interleaved in y with both columns; feeding them to segmentation shredded the page 15 → 95 blocks. Issue #50 |
| **3 PTUB adapters, not 4** | Rows 1 and 2 are the deleted extractors |
| `payload.html` not emitted | Rule 32b explicitly permits dropping the field |
| `figure_kind` not populated | Residual risk 5 asks for one convention; `figure` + `is_vector` is used and `diagram`/`plot` are not emitted |
| Files edited outside ownership | `pyproject.toml`, `uv.lock`, `.github/workflows/ci.yml`, `package.json`, `.gitignore`, `apps/api/pyproject.toml` — all declared on **issue #45** |
| LLM backend swapped to MiniMax | At the owner's explicit request; ~30 call sites renamed `openrouter_*` → `llm_*`, `llm_vision_model` added as a separate setting |

---

## 7. Issues filed

**#45** boundary edits · **#47** `page.cropbox` is y-flipped while `page.mediabox` is not ·
**#48** `EPIC-02-RESULT` §2.3's span rule would delete the arXiv stamp · **#49** `doc_order` is
body-only by rule 15 · **#50** the F1.3/F1.5 dependency is stated backwards.

---

## 8. The single most valuable finding

`page.mediabox` is the raw `/MediaBox`; **`page.cropbox` has already been y-flipped into MuPDF's
top-left space.** Feeding the flipped box to `normalise_page_frame` intersects a top-left rect
with a bottom-left one — `negative-mediabox.pdf` came out **400 pt** tall against a true **450**,
which fails validator rule G4 and re-bases every block id on the page.

It is the identity on **8 of 8 corpus papers and 7 of 9 synthetic fixtures**, so nothing in the
repo would have caught it. ADR-001 Amendment 1 priced a wrong frame at **99.93 % of block ids**.
`tests/worker/test_geometry_contract.py` is the standing guard, and it is an oracle rather than a
tautology: it compares the worker's rects against `normalise_rect()` applied to the raw
content-stream operands recorded in `conformance/geometry-vectors.json`. 9 of 9 agree.
