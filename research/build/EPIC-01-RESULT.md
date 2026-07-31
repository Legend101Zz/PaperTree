# EPIC 1 — Ingest & Document Intelligence: result

**Status: INCOMPLETE. 5 of 10 acceptance tests met.** Branch `epic-1-ingest`, 58 commits,
`63be37d..e8276de`. `research/build/EPIC-01-ingest.md` is **unedited** — no acceptance criterion
was weakened, and no test file claims a criterion it does not meet.

Every number below was measured on this machine at `pymupdf 1.28.0` / `docling 2.117.0` against
the 8-paper, 195-page corpus. Nothing is quoted from a doc without being re-run.

**Gold-based numbers arrived on 2026-08-01** and are marked as such. Reproduce them with
`uv run python -m papertree_evaluation score`.

---

## 1. The decision the epic exists to make

> **Fixed rule, committed to before seeing results:** if deterministic reaches **≥85 % of
> Docling's F1** on element detection, reading order and figure recall at **≥20× the speed**,
> zero-ML ships as default. Otherwise a small local layout model becomes default and Docling
> stays opt-in.

### Verdict: **the rule is not satisfied.**

Both halves now fail. The speed half fails at 12× against a 20× bar; the accuracy half is
measured on human gold for the first time and comes in at macro F1 **0.08–0.22**. The
*comparison* to Docling is still not formable — the Docling adapter reports counts, not geometry
— but the deterministic path's absolute number is low enough that the ratio is no longer the
interesting question.

*This section was rewritten on 2026-08-01, when gold arrived. What it said before — "not fully
evaluable", resting on the speed half alone — is preserved in git history rather than deleted,
because a prediction made before the measurement is worth being able to check.*

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

**The F1 half is now measured, on human gold, and it is bad.**

Gold exists as of 2026-08-01: 18 pages, 249 regions, hand-drawn by one annotator over three
papers (`research/benchmarks/gold/`). That is **15 % of README §1.2's Tier B**, single-annotator,
with no inter-annotator agreement figure — so it measures without authorising, and every number
below carries that n.

| paper | pages | macro F1 @0.5 | @0.75 | reading order | near misses |
|---|---|---|---|---|---|
| attention-is-all-you-need | 6 | **0.250** | 0.101 | 0.278 | 24 |
| neural-odes-mathheavy | 6 | **0.193** | 0.104 | 0.389 | 20 |
| resnet-cvpr-2col | 6 | **0.212** | 0.159 | 0.967 | 21 |

*(First measured at 0.223 / 0.077 / 0.146, reading order 0.167 / 0.333 / 0.800. Five fixes since —
front-matter typing, the single-column barrier, equation block merging, the footnote flow, and the
bibliography — are the difference. Every one of the five was found by this gold set and none was
visible from the capability counts.)*

**A quarter of the gold is found in the right place and boxed to a different convention.** 67 of
249 gold regions have a same-type prediction at IoU 0.25–0.5 — detected, but missing the bar on
shape. `attention`'s title is the clearest case: gold drew it 31 pt tall, the parser boxes it
16 pt from the font's typographic band, IoU **0.474**. The §4.1 threshold stays at 0.5 — moving it
after seeing results is what the decision rule was written in advance to prevent — but the split
says which failures need detecting and which need reconciling.

Docling has not been scored on this gold — `DoclingAdapter` returns capability counts, not
per-region geometry (issue open, §7). **So the ratio the decision rule asks for still cannot be
formed.** What has changed is that the deterministic path's own F1 is no longer a question mark:
it is 0.08–0.22, and no plausible Docling number makes 85 % of it a passing grade.

Two of §4.1's four metrics remain not evaluable, and are reported as such rather than as zero,
because a zero is a claim about the parser: **caption association** (gold carries no `parent`
links) and **vector-figure recall** (no `is_vector` flag). The annotator tool did not collect
either. That is a tool defect, recorded, and it costs PaperTree the one metric — vector figures —
where it was expected to look good.

**Where the F1 goes.** The macro-average is over gold types, and the first scored run found
**seven of fifteen gold types on `attention` were never emitted by the parser at all** — each a
structural 0.00 weighted as heavily as a type the parser gets right. Five have since been closed:

| type | how | outcome |
|---|---|---|
| `title` `author` `affiliation` `abstract` | `frontmatter.py` — a retype pass over page 0's visual rows | typed on all three papers; `metadata.authors` populated |
| `footnote` | the flow test asked for the bottom 6 % of the page; real footnotes are at 75–90 % | ResNet F1 **0.50**, the first real score on the type |
| `reference_entry` | `references.py` — a sweep after the `References` heading | 45 / 53 / 6 entries; `Paper.references` no longer `[]` |

Two remain absent: `citation` and `inline_equation`.

Over-segmentation was the other half, and it was never a threshold to tune:

| | before | after | cause |
|---|---|---|---|
| paragraphs (attention) | 107 | **44** | a full-width *column barrier* applied on a single-column page, which split every paragraph's short last line into its own block |
| paragraphs (neural-odes) | 153 | **106** | same |
| equations (neural-odes) | 89 | **16** vs 17 gold | layout segmenting a display equation with prose rules, before equation detection ran |

Equation *extents* are still narrower than gold's full-column convention, so equations match at 0
even with the count right. That is a boxing-convention gap, and the near-miss column is what
distinguishes it from a detection failure.

**So: zero-ML does not ship as default on this evidence**, and the conclusion is now supported by
both halves rather than one. 12× against a 20× bar, and an absolute F1 that would need to roughly
quadruple before the ratio question is even interesting.

### Capability, measured (findings.md H2's columns)

**ResNet** (12 pp, two-column, all-vector figures):

| Candidate | blocks | bbox | page | stable id | headings | eq | figures | captions linked | tables | cells | sections | s/page |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PaperTree LIVE *(H2, deleted)* | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2.0 | 0.2 |
| PaperTree dead extractor *(H2, deleted)* | 233 | 233 | 233 | 0 | 58 | 86 | **0** | 0 | 0 | 0 | — | 4.1 |
| pymupdf-raw | 549 | 549 | 549 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.05 |
| docling | 519 | 497 | 497 | **0** | 22 | 2 | **7** | 21 | 15 | 342 | 22 | 2.10 |
| **papertree-deterministic** | 929 | **929** | **929** | **929** | 5 | 2 | **9** | 2 | 10 | **580** | 5 | **0.13** |

Rows 1 and 2 are carried forward from findings.md H2 and marked as such: both are **deleted**
(§5), and re-implementing 1,698 lines of removed code to re-measure what was already measured
would be the opposite of the point.

Three things in that table are worth stating plainly:

- **Every block has geometry and a content-derived stable id.** Docling's `self_ref` ids are
  positional JSON pointers (`#/texts/47`) — stable within a parse, not across re-parses. H2
  calls this "the single most important schema consequence"; it is why PaperTree mints its own
  ids whichever parser wins, and it is the column where the deterministic path is not merely
  competitive but categorically different.
- **Figures: 9 against Docling's 7**, all correctly `pdf_vector`, where both old extractors
  scored **0**. That is findings.md B3 closed.
- **Headings: 5 against Docling's 22**, and ResNet's real section count is about 10. The
  deterministic hierarchy is weak in BOTH directions depending on the paper, and §3 says so.

---

## 2. Acceptance criteria — per-test verdict

| Test | Verdict | Evidence |
|---|---|---|
| `worker/determinism.spec` | **MET** | 20 runs byte-identical via `canonical_json_for_determinism`, ids stable. `test_pipeline_end_to_end.py` |
| `worker/repairs.spec` | **MET** | 84,395 spans, 749 dehyphenation proposals, rules 25/26/27/30b hold; 30b checked against the validator's own `_dehyphenate` |
| `worker/robustness.spec` | **MET** | 8/8 papers parse and validate; 0 crashes, 0 timeouts, 0 empty outputs |
| `worker/perf.spec` | **MET** | p50 305 ms/page, p95 568 ms/page against a 1500 ms bar |
| `ingest/source-authenticity.spec` | **MET** | every line of every non-table block traced to the page's glyph stream; found 2 real bugs while being written |
| `eval/ptub.spec` | **PARTIAL** | harness + metrics + annotation tool + scorer, 63 tests; gold exists (18 pp); **3 adapters, not 4** and Docling returns counts not geometry, so no cross-parser F1 |
| `worker/figures.spec` | **PARTIAL** | ResNet ≥5 ✅ (9, all vector); `is_vector` correct ✅; ≥80 % captioned ❌ (58 % corpus-wide). Gold figure F1 0.67 on `attention`, **0.00 on the other two**; vector-figure recall still not evaluable — gold has no `is_vector` |
| `worker/equations.spec` | **NOT MET** | prose never classified as an equation ✅; every equation retains its crop ✅; **≥80 % of gold ❌ — 0 of 17 at IoU 0.5**. Count now 16 predicted against 17 gold (was 89); the extents are narrower than gold's full-column convention |
| `worker/reading-order.spec` | **NOT MET** | **0.278 / 0.389 / 0.967 pairwise against a ≥0.90 bar**, up from 0.167 / 0.333 / 0.800. ResNet is now over the bar; the two single-column papers are not. The ordering logic was never the weak part — the regions being ordered were |
| `worker/hierarchy.spec` | **NOT MET** | number/title joining and furniture stripping work; outline size improved 3–6× but is still outside ±20 % — now under-detecting on ResNet and over-detecting on a3c/gpt3 |

---

## 3. What is wrong, stated without rounding up

Gold turned the first three of these from suspicions into measurements. They are listed first
because they are the largest, and because neither was visible from the capability counts — a
parser that emits 929 blocks with 929 bboxes and 929 stable ids looks healthy until something
asks whether those boxes have the shape of the regions on the page.

- **Two gold types are still never emitted**: `citation` and `inline_equation`. There were
  seven; five are closed (§1). `citation` is partly a gold-granularity question — gold boxes a
  whole reference page as one `citation` region while the parser now emits one `reference_entry`
  per entry, which is what `ANNOTATION_GUIDE.md` asks for — so the two will not match on this
  gold set and the parser is not the thing to change. `inline_equation` needs `equations.py` to
  separate inline from display, which it does not attempt.
- **Paragraph fragmentation is fixed and paragraphs are still not right.** 107 → 44 predicted on
  `attention`, 153 → 106 on `neural-odes`, F1 0.05 → 0.18 and 0.13 → 0.21. The cause was a
  single-column page being given a full-width *column barrier*, which routed every normal body
  line to the barrier bucket and every paragraph's short last line to column 0. Precision is
  still 0.11–0.39, so blocks are still finer than gold regions; it is no longer 3×.
- **Equation counts are right and extents are not.** 89 → **16** predicted against 17 gold, by
  merging the fragments an equation region already claims into the one block that region
  describes. Still **0 matched at IoU 0.5**: gold boxes a display equation across the full column
  including its right-margin number, and the parser boxes the glyph bands. Absorbing any non-prose
  block sharing a region's vertical band closes that and was measured and reverted — it chained
  distinct equations together and took 16 down to 6.
- **Two headline metrics could not be computed and it is the tool's fault.** Caption association
  needs `parent` links and vector-figure recall needs `is_vector`; the annotator collected
  neither. Vector figures are the one dimension where PaperTree was expected to beat every
  alternative — findings.md B3 measured both old extractors at 0 on ResNet — and that claim
  remains unverified. `annotate.py` must collect both before the next pass.
- **Hierarchy is much better and still wrong, now in BOTH directions.** Detecting headings after
  equations and tables have claimed their lines (issue #50's ordering, applied) moved ResNet
  31 → **5**, BERT 56 → **12** (real count ~12, essentially correct) and gpt3 324 → **192**.
  ResNet has now flipped to *under*-detecting — real count ~10, found 5 — while a3c (142) and
  gpt3 (192) remain far too high. Both are long papers whose headings come from the font rule
  rather than from numbering, and that rule still fires on emphasis runs. `hierarchy.spec` wants
  ±20 % of gold and neither end is inside it.
- **Caption linking is 58 %, against an 80 % bar**, up from ~35 % after two fixes: raster panels
  are merged (neural-odes 77 → 18 regions) and a caption now binds by horizontal overlap plus
  edge-to-edge adjacency rather than by nearest vertical centre, which on a two-column page
  routinely picked the float in the *other* column.
  **The bottleneck has moved and the next person should not re-tune the linker.** ResNet is 9
  figures with 2 linked because only **4 caption blocks are detected on a paper with ~12
  captions** — `is_caption_line` needs the marker at position 0 and segmentation is merging
  caption lines into the surrounding body block. That is a segmentation fix: captions need
  claiming before paragraph grouping, exactly as figures, tables and equations already did.
- **Figure over-detection persists**, at 83 regions corpus-wide. Regions overlapping a detected
  table are now suppressed (superglue correctly drops to 0 figures), but ResNet still reports 9
  for roughly 6 real figures.
- **The VLM independently confirms the equation over-detection.** A 6-call run on neural-odes
  returned `NOT_MATH` for **4 of 6** crops. That is a cheap, model-agnostic precision signal and
  it agrees with the 13-vs-5 count below.
- **330 of ResNet's blocks still produce more than one polygon**, i.e. the geometry says they
  span a gutter. Down from 478, not resolved.
- **Equation regions over-fire inside algorithms.** 13 regions against 5 hand-labelled on
  neural-odes pages 0–2; 7 of the extras are math inside Algorithm 1.
- **The VLM LaTeX path is wired and runs**, opt-in and budgeted, defaulting to 0 calls so no
  parse spends money unless asked. Verified live against MiniMax-M3: a standalone crop returned
  `\frac{d\mathbf{h}(t)}{dt} = f(\mathbf{h}(t), t, \theta)` correctly, and a 6-call pipeline
  run cost 2,754 tokens. The two LaTeX strings it produced are **not** claimed to be correct —
  both came from regions the `NOT_MATH` result suggests were dubious. `≥80 % of gold` stays
  unmeasurable.
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
- **`Metadata` is populated** — `title`, `authors`, `abstract`, `arxiv_id` and `year`, each a
  verbatim slice of a block it cites (rule 6b). `venue` and `doi` stay null: arXiv preprints carry
  neither in a form that survives the substring test. `authors` was `[]` on every paper until
  `frontmatter.py` existed, which was never a `metadata.py` bug — rule 6b had no `author` block to
  slice.
- **`Paper.references` is populated**: 45 / 53 / 6 entries across the annotated papers, each
  naming its `reference_entry` block. Only `year` and `arxiv_id` are parsed out. `title`,
  `authors` and `venue` are left null on purpose — a heuristic split of a reference string yields
  a *plausible* author list, which is worse than none, because it looks populated and nothing
  downstream would question it.

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
