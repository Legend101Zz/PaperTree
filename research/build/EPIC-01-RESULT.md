# EPIC 1 — Ingest & Document Intelligence: result

**Status: INCOMPLETE. 5 of 10 acceptance tests met, 3 PARTIAL, 2 NOT MET.** Branch
`epic-1-ingest`, 142 commits, `63be37d..fbfbf4d`; re-measured on `main` 2026-08-03 after #78
Session B.

**One acceptance criterion HAS since been weakened, and this line used to deny it.**
`research/build/EPIC-01-ingest.md` was unedited when this file was first written. It is not
now: `eval/ptub.spec` was amended from four adapters to **three live adapters plus a declared
historical column** (#55/#105), because the epic contradicted itself — it asks for a
current-PaperTree adapter and its own "Must delete" section orders that extractor deleted. The
epic also carries an erratum on the F1.3/F1.5 dependency (#50/#97) and a recorded deviation on
F1.5's WebP clause (#55/#105). No test file claims a criterion it does not meet.

Every number below was measured on this machine at `pymupdf 1.28.0` / `docling 2.117.0` against
the 8-paper, 195-page corpus. Nothing is quoted from a doc without being re-run.

**Gold arrived 2026-08-01 and grew twice that day**: 18 pages → 36, 249 regions → **442**, 3 papers
→ 6, single annotator, no inter-annotator agreement. That is 30 % of README §1.2's Tier B. Every
gold-based number carries that n — it measures, it does not authorise. Reproduce with
`uv run python -m papertree_evaluation score`.

**All four of §4.1's metrics are now computable.** Element-detection F1, reading order,
vector-figure recall and caption association were each "not evaluable — no gold" when the epic
began; the last of them landed 2026-08-01. Three of the four needed a tool fix as well as an
annotation pass, and two of those three had the metric function written but never wired into
the scorer — a shape worth remembering: **a metric that is never called reports nothing, and
nothing looks a lot like a metric that passed.**

### What remains, and where it is tracked

| | issue |
|---|---|
| Region detection blocks `figures.spec` + 2 metrics | [#51](https://github.com/Legend101Zz/PaperTree/issues/51) |
| Peak RSS 762 MB vs a 500 MB bar | [#52](https://github.com/Legend101Zz/PaperTree/issues/52) |
| The speed half is unmeasured, not failed | [#53](https://github.com/Legend101Zz/PaperTree/issues/53) |
| Gold coverage limits every remaining verdict | [#54](https://github.com/Legend101Zz/PaperTree/issues/54) |
| Equation extents, absent types, 4th adapter, WebP | [#55](https://github.com/Legend101Zz/PaperTree/issues/55) |

---

## 1. The decision the epic exists to make

> **Fixed rule, committed to before seeing results:** if deterministic reaches **≥85 % of
> Docling's F1** on element detection, reading order and figure recall at **≥20× the speed**,
> zero-ML ships as default. Otherwise a small local layout model becomes default and Docling
> stays opt-in.

### PROVISIONAL DECISION (owner's call, 2026-08-01): **zero-ML ships as default. Docling stays opt-in.**

Taken so Wave 2 is not blocked on a benchmark repair, and **explicitly not a claim that the rule
was satisfied** — the rule needs both halves and only one is established. What it rests on:

- **Accuracy passed on its merits**, measured against human gold: 97 % of Docling's F1, ahead
  outright on two of three papers.
- **Every speed measurement taken, however contaminated, favours the deterministic path by at
  least 4.8× and typically 12–19×.** The question is whether it clears 20×, not whether it is
  faster. No observation puts it anywhere near parity.
- **The rule's stated fallback would make things worse.** `otherwise` is *"a small local layout
  model becomes default"* — a remedy for losing on accuracy, which passed. A layout model is
  slower, so it degrades the only half in doubt.
- **The 20× bar's provenance is not documented anywhere in the epic file**, so there is nothing
  to check the number against.

**Revisit when task #26 lands** a reproducible ratio. If it comes in under 20× the decision above
still needs an owner's ruling on whether the bar or the parser moves — this defers that, it does
not answer it. Recorded here rather than in a commit message so a later reader finds the
reasoning attached to the evidence.

### Verdict on the rule itself: **accuracy PASSES. Speed is NOT ESTABLISHED — the measurement cannot resolve it.**

| half | bar | measured | |
|---|---|---|---|
| **accuracy** | ≥ 85 % of Docling's F1 | **97 %** | **PASS** |
| **speed** | ≥ 20× Docling | 12.4× / 16.8× / 18.7× across runs | **NOT ESTABLISHED** |

**Corrected 2026-08-01. The speed half was previously recorded as a measured FAIL at 12.4×. It
is not a measured anything — the noise is larger than the gap to the bar.** Three controlled
re-runs of the same comparison, same machine, same code, gave median ratios of **12.4×, 16.8×
and 18.7×**, with per-paper ratios spanning **4.8× to 36.4×**. The deterministic path alone
measured **0.076 s/page p50** where the recorded figure is **0.288** — a 3.8× discrepancy on a
parser that `test_determinism_over_twenty_runs` proves does byte-identical work every time.

The cause is that **no speed number on this branch was taken on an idle machine.** During this
session's runs a `rustc` build was consuming 1.25 of 10 cores. Quantified: ten identical parses
*within one process* spread 1.4× (0.081–0.115 s/page); the same paper *across* processes spread
**3.3×** (0.066 → 0.217). The gap between the recorded 12.4× and the 20× bar is **1.6×** — well
inside the between-run noise. A further confound: both parsers pay a fixed import/model-load
cost amortised over 11–15 page papers, so run *order* alone moved the ratio from 10.3× to 18.7×.

So the honest state is that the rule's speed half is **unresolved**, and everything below that
was written on the assumption it had failed should be read in that light. It may pass. Resolving
it needs a quiesced machine, discarded warm-up, repeated trials and a reported spread — and the
harness should refuse to emit a ratio when the spread is wide enough to make it meaningless.
Until then, neither "zero-ML ships" nor "a layout model becomes default" is supported by data.

The accuracy half is unaffected: F1 is computed from parser output, not from wall-clock.

**THE STATED FALLBACK DOES NOT ADDRESS THE FAILING HALF.** The rule's `otherwise` branch is *"a
small local layout model becomes default"* — a remedy for losing on accuracy. Accuracy is the half
that passed. The half that failed is speed, and a local layout model is **slower** than the
deterministic path, not faster; adopting it would move the failing number in the wrong direction
while replacing a metric that is already at 97 %.

So the fallback as written is not applicable, and this is a decision for whoever owns Wave 1
rather than one Epic 1 should quietly make. The options, stated without a recommendation dressed
up as a finding — and note that **(0) now precedes the others, because the rest are answers to a
question the data does not yet ask**:

0. **Measure the ratio properly before deciding anything.** Quiesced machine, warm-up discarded,
   N trials, spread reported, and the harness refusing to emit a ratio it cannot support. This is
   cheap and it may resolve the whole question — the observed range already brackets the bar.
1. **Ship zero-ML anyway** and record the 20× bar as unmet. Even the lowest observed ratio is an
   order of magnitude, and the bar's provenance is not documented anywhere in the epic file.
2. **Close the speed gap.** The parse includes table detection, 130+ crops per paper and full
   semantic validation. Crops are the obvious candidate to defer.
3. **Re-run the rule on Tier B gold** before deciding anything. 18 pages is 15 % of it (below).

*This section has been rewritten twice — once when gold arrived, once when Docling became
scoreable. Both earlier versions are in git history rather than deleted, because a conclusion
stated before the measurement is worth being able to check against.*

**The run that produced the table below is the contaminated one** — retained rather than deleted,
because the numbers in it are what the 12.4× verdict rested on and they should stay checkable.
Read the p50 of 0.288 against the 0.076 measured cleanly. Median over the 8 papers both parsed:

| | p50 s/page | p95 s/page | failure rate |
|---|---|---|---|
| pymupdf-raw (floor) | 0.046 | 0.107 | 0 % |
| **papertree-deterministic** | **0.288** | **1.644** | **0 %** |
| docling | 4.584 | 6.017 | 0 % |

**12× faster, against a 20× bar** — and independently reproduced: the `--with-docling` scoring
run over the three annotated papers measures 0.101 s/page against Docling's 1.250 s/page, a ratio
of **12.4×**. Two runs, different paper sets, different Docling warmth, same answer.

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
| attention-is-all-you-need | 6 | **0.283** | 0.100 | 0.389 | 23 |
| neural-odes-mathheavy | 6 | **0.192** | 0.103 | 0.389 | 20 |
| resnet-cvpr-2col | 6 | **0.228** | 0.165 | 0.967 | 20 |

*(First measured at 0.223 / 0.077 / 0.146, reading order 0.167 / 0.333 / 0.800. Six fixes since —
front-matter typing, the single-column barrier, equation block merging, the footnote flow, the
bibliography, and a bold-weight block boundary — are the difference. Every one was found by this
gold set and none was visible from the capability counts.)*

**A quarter of the gold is found in the right place and boxed to a different convention.** 67 of
249 gold regions have a same-type prediction at IoU 0.25–0.5 — detected, but missing the bar on
shape. `attention`'s title is the clearest case: gold drew it 31 pt tall, the parser boxes it
16 pt from the font's typographic band, IoU **0.474**. The §4.1 threshold stays at 0.5 — moving it
after seeing results is what the decision rule was written in advance to prevent — but the split
says which failures need detecting and which need reconciling.

**Docling, on the same gold, with the same metric:**

| paper | deterministic | docling | share of Docling | ≥ 85 %? |
|---|---|---|---|---|
| attention-is-all-you-need | 0.283 | 0.280 | **101 %** | yes |
| neural-odes-mathheavy | 0.192 | 0.168 | **115 %** | yes |
| resnet-cvpr-2col | 0.228 | 0.308 | **74 %** | no |
| | | | **mean 97 %** | **PASS** |

Reproduce with `uv run python -m papertree_evaluation score --with-docling`.

**Docling's own absolute numbers are also low — 0.168 to 0.308 — and that reframes the
deterministic path's 0.19–0.28.** A gold set on which a mature, ML-based, widely-used converter
scores 0.28 is a gold set whose boxing conventions differ from *both* parsers', not a verdict on
one of them. It is why the RATIO is the meaningful quantity here and the absolute is not, which is
also why the rule was written as a ratio.

ResNet is the one clear loss: Docling 0.308 against 0.228, and it is the two-column paper. Docling
beats it on `table` (1.00 vs 0.33), `equation` (1.00 vs 0.00), `caption` (0.82 vs 0.31) and
`footnote` (1.00 vs 0.50); the deterministic path wins `paragraph` (0.60 vs 0.17), `abstract`,
`margin_note` and — with 0 predicted on Docling's side — `title`, `author` and `affiliation`.

Reading order runs the other way and is not part of the rule: Docling scores 0.500 / 0.578 /
0.546 against 0.278 / 0.389 / **0.967**. The deterministic path is far better on the two-column
paper and worse on both single-column ones — the opposite of what "columns are the hard part"
would predict, and worth a look before Epic 2 relies on either.

> **Superseded 2026-08-03 on the deterministic side only.** Those three deterministic figures
> were three of six papers. All six now read a3c 0.667 / attention 0.389 / bert 0.699 /
> gpt3 0.222 / neural-odes 0.611 / resnet 0.929, mean **0.586** — see §2's
> `worker/reading-order.spec` row. **Docling's side has not been re-measured**, so the
> head-to-head above is not a current comparison and must not be quoted as one.

**Both of the "not evaluable" metrics below were re-checked and one of them was never a gold
defect at all.** Corrected 2026-08-03 (#86/#95):

- **caption association** and **vector-figure recall** were reported as not evaluable because
  the gold "carries no `parent` links" and "no `is_vector` flag". **It carries both.** The
  scorer's guards tested `any(r.get(field))` — TRUTHINESS, not presence — so a complete
  annotation in which every `parent` is a valid id but every `is_vector` is legitimately
  `False` read as a missing one. All 39 gold captions carry a `parent` and all 55 gold figures
  carry an `is_vector`. Caption association now measures **14/39 correct, 1 false**; vector
  recall is measured per paper.
- What remains genuinely not evaluable is narrower and is stated where it applies: `resnet` and
  `neural-odes` hold 51 floats between them with **no caption boxes drawn at all**, so caption
  association covers 4 of 6 annotated papers rather than 6.

The original text below is kept because the reasoning about zero-vs-unevaluable is right and
still governs; only its premise about this gold set was wrong. That is a tool defect, recorded,
and it costs PaperTree the one metric — vector figures —
where it was expected to look good.

**Where the F1 goes.** The macro-average is over gold types, and the first scored run found
**seven of fifteen gold types on `attention` were never emitted by the parser at all** — each a
structural 0.00 weighted as heavily as a type the parser gets right. Five have since been closed:

| type | how | outcome |
|---|---|---|
| `title` `author` `affiliation` `abstract` | `frontmatter.py` — a retype pass over page 0's visual rows | typed on all three papers; `metadata.authors` populated |
| `footnote` | the flow test asked for the bottom 6 % of the page; real footnotes are at 75–90 % | ResNet F1 **0.50**, the first real score on the type |
| `reference_entry` | `references.py` — a sweep after the `References` heading | 45 / 53 / 6 entries; `Paper.references` no longer `[]` |
| `heading` (recall) | a bold-weight change now starts a block; ResNet sets headings **bold at body size**, so nothing split them off | attention `heading` F1 0.00 → **0.35**; ResNet 2 → 5 predicted against 11 gold |

Two remain absent: `citation` and `inline_equation`.

Over-segmentation was the other half, and it was never a threshold to tune:

| | before | after | cause |
|---|---|---|---|
| paragraphs (attention) | 107 | **24** | a full-width *column barrier* applied on a single-column page, splitting every paragraph's short last line into its own block; then bold headings being absorbed into the paragraphs around them |
| paragraphs (resnet) | 51 | **48**, F1 0.40 → **0.60** | the bold-weight boundary; recall 0.55 → 0.79 |
| paragraphs (neural-odes) | 153 | **106** | the single-column barrier |
| equations (neural-odes) | 89 | **16** vs 17 gold | layout segmenting a display equation with prose rules, before equation detection ran |

Equation *extents* are still narrower than gold's full-column convention, so equations match at 0
even with the count right. That is a boxing-convention gap, and the near-miss column is what
distinguishes it from a detection failure.

**So: zero-ML does not ship as default on this evidence** — because the rule requires both halves
and speed misses. It is worth being precise about what that does and does not mean. It is not
"the deterministic path is not accurate enough": on this gold it reaches 97 % of Docling against a
bar of 85 %, and on `attention-is-all-you-need` it is ahead outright. It is "it is 12.4× faster where the rule asked for 20×", against a bar whose
provenance the epic file does not record.

And the n matters. 18 pages, one annotator, no inter-annotator agreement figure — enough to
measure, not enough to authorise, and README §2 is explicit that *"without [IAA], no metric on
this set has a meaningful ceiling."* 97 % against an 85 % bar is a more comfortable margin than
the 91 % measured an hour earlier, but it rests on three papers, and one of the three (ResNet, at
74 %) is below the bar on its own.

### Capability, measured (findings.md H2's columns)

**ResNet** (12 pp, two-column, all-vector figures):

| Candidate | blocks | bbox | page | stable id | headings | eq | figures | captions linked | tables | cells | sections | s/page |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PaperTree LIVE *(H2, deleted)* | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0.17 |
| PaperTree dead extractor *(H2, deleted)* | 233 | 233 | 233 | 0 | 58 | 86 | **0** | 0 | 0 | 0 | — | 0.34 |
| pymupdf-raw *(2026-08-01)* | 549 | 549 | 549 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.05 |
| docling *(2026-08-01)* | 519 | 497 | 497 | **0** | 22 | 2 | **7** | 21 | 15 | 342 | 22 | 2.10 |
| **papertree-deterministic** *(2026-08-03)* | 955 | **955** | **955** | **955** | 13 | 2 | **9** | **7** | 13 | **563** | 14 | see #53 |

Rows 1 and 2 are carried forward from findings.md H2 and marked as such: both are **deleted**
(§5), and re-implementing 1,698 lines of removed code to re-measure what was already measured
would be the opposite of the point.

**Every row is now dated, because they were not all measured at the same time and the table read
as though they were.** The deterministic row is re-derived on `main` @ `568487b` (after #102 and
#105) and it moved a long way from what this table carried: blocks 929 → **955**, headings
5 → **13**, captions linked 2 → **7**, tables 10 → **13**, cells 580 → **563**, sections
5 → **14**. Rows 3 and 4 are **2026-08-01 measurements and have NOT been re-derived** — Docling
is a ~4 s/page arm and re-running it belongs with #53's harness, not here. Read them as of their
date. The deterministic `s/page` cell is deliberately empty rather than filled from a run taken
while this machine was under load; #53 is measuring it properly.

**Corrected 2026-08-03.** H2's `sec` column is a per-paper **total** over ResNet's 12 pages, and
this table read it as a rate: row 1 printed `0.2` where 2.0 s / 12 pp is **0.17**, and row 2
printed `4.1` — the raw total — where 4.1 s / 12 pp is **0.34**, an error of 12×. Row 1's
`sections` cell held `2.0`, the same total leaking one column left; H2 records `nested tree ✗`
for that row and no section count at all, so it now reads `—`. Rows 3–5 are re-measurements
taken here and were never affected. The transcription now lives in
`packages/evaluation/python/papertree_evaluation/harness.py` as `HISTORICAL_ROWS`, which stores
the total and derives the rate, so this particular mistake cannot be made again by hand.

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
| `worker/perf.spec` | **PARTIAL** | time ✅ p50 305 ms/page, p95 568 ms/page against a 1500 ms bar. **Memory ❓ NOT DECIDABLE at this bar** — `gpt3-longform-singlecol` (75 pp, fresh subprocess) re-measured 2026-08-03 at **442.6 / 497.4 / 501.7 MB** against a <500 MB bar, and at **488.3 / 509.1 / 496.3 MB** on the commit before #102. Three identical runs of a byte-deterministic parser straddle the bar on both sides of that change, so the ~60 MB spread exceeds the distance to the bar and no run of this test decides the clause. Filed as #104. The **746 MB** this row previously carried no longer reproduces; ~240 MB came off it between 2026-08-01 and now and nothing recorded which change did it (#52) |
| `ingest/source-authenticity.spec` | **MET** | every line of every non-table block traced to the page's glyph stream; found 2 real bugs while being written |
| `eval/ptub.spec` | **MET on the amended criterion** (2026-08-03) | harness + metrics + annotation tool + scorer + Docling geometry; gold 36 pp; cross-parser F1 computed. The 4th adapter was **the epic contradicting itself** — the same file that asks for a current-PaperTree adapter orders that extractor deleted in its "Must delete" section, and it is (§5). Criterion amended in `EPIC-01-ingest.md` to **3 live adapters + a declared historical column**, carried in `harness.HISTORICAL_ROWS` with its provenance, labelled `(DELETED)`, printing `?` where findings.md H2 recorded nothing, and provably outside `ComparisonMatrix.outcomes` so a 2026-06 measurement of deleted code can never enter a computed ratio. **Read as: the criterion moved, the work did not grow.** #55 |
| `worker/figures.spec` | **PARTIAL** | ResNet ≥5 ✅ (9, all vector); `is_vector` correct ✅; **≥80 % captioned ❌ — 68.2 %** (58/85 over figures; 142/226 = 62.8 % over floats), up from 57.8 % / 49.1 % in #102. Float detection against gold **29/80 type-blind, 22/80 type-aware** — the 7-region gap is a convention disagreement, not a miss: on gpt3 the parser boxes 9 of 10 gold floats correctly and types them `table` where gold says `figure`, because GPT-3's boxed qualitative examples *are* booktabs tables in the source. Remaining real misses are figure-region **extents** on neural-odes (1/22) and resnet (5/29) — #103. `n = 36 pp / 6 of 8 papers / 442 regions / 1 annotator / no IAA` |
| `worker/equations.spec` | **NOT MET** (improved 2026-08-03) | prose never classified as an equation ✅; every equation retains its crop ✅; **≥80 % of gold ❌ — 8 of 21 gold equations at IoU 0.5 = 38 %**, up from **0 of 21**. Per paper: neural-odes **6/18**, resnet **2/2**, attention **0/1** (best IoU 0.063 → 0.293). Predicted count unchanged at 21, which is what separates this from the vertical merge that was measured and reverted (16 → 6 predicted). **What blocks the bar is no longer extents**: on neural-odes p14 the parser emits **8 equation blocks against 17 gold**, so 9 cannot match at any IoU. That is region detection — #51/#103. `n = 36 pp / 6 of 8 papers / 1 annotator / no IAA` |
| `worker/reading-order.spec` | **NOT MET** | Pairwise against a ≥0.90 bar, all six annotated papers: a3c **0.667**, attention **0.389**, bert **0.699**, gpt3 **0.222**, neural-odes **0.611**, resnet **0.929** — mean **0.586**. One paper clears the bar. The earlier "0.278 / 0.389 / 0.967" quoted three of the six and is superseded. neural-odes fell 0.667 → 0.611 in #105 and **that is not an ordering change**: the metric scores PAIRS of gold regions that both matched, so newly matched equations added pairs on a page previously scored on one. The ordering logic was never the weak part — the regions being ordered were. `n = 36 pp / 6 of 8 papers / 1 annotator / no IAA` |
| `worker/hierarchy.spec` | **PARTIAL** | number/title joining ✅, furniture routing ✅, and **"no table cell is classified as a heading" now holds on 6 of 8 papers** — a3c **193 → 17** headings (numeral-only 165 → **0**), gpt3 **181 → 52** (126 → **6**), fixed in `tables.py` rather than `hierarchy.py`. **Outline size now has an independent floor on all 8 papers** (#54 item 4: 4 from `hyperref` bookmarks, 4 hand-counted off the glyph stream, ONE annotator, no IAA). Inside ±20 %: superglue **1.00×**, attention **0.82×**, a3c **1.00×**, bert **1.03×**, resnet **0.81×** — **5 of 8**. Outside: gpt3 **1.63×** (was 1.91×), neural-odes **~2.4×** (over-detection is emphasis runs, not tables), pdf-to-tree **0.66×** (under-detection: bold-at-body-size subsection heads in a two-column ACL layout) |

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
- **Vector-figure recall is measurable as of 2026-08-01, and it is 0.167 / 0.000 / 0.000.** The
  third of the decision rule's three named metrics, computed for the first time. It needed
  `is_vector` on gold figures, which needed the annotator to be able to reopen its own output
  (`b282912`), a control with three states rather than a checkbox with two, and `normalise.py`
  rule 4 — *a figure on a page holding zero raster XObjects is vector* — which repaired 14 marks
  that were not merely wrong but impossible.

  **What the zero means matters more than the zero.** It is *not* findings.md B3 repeating: the
  parser is not blind to vector ink. On ResNet's six sampled pages it emits **2 figure regions
  where gold marks 12**, with 4 near misses; on neural-odes, 8 against 12 with 5 near. The ink is
  found and the boundaries disagree — gold boxes individual panels, the parser merges panels into
  one figure (`_merge_panels`). That is the same granularity argument as `citation` versus
  `reference_entry`, and like that one it needs a convention ruling rather than a parser fix. What
  is *not* explained by convention is ResNet's 2-against-12: merging cannot take 12 panels to 2
  regions across six pages, so some are genuinely missed.

  One caveat, stated because the metric is now load-bearing: rule 4 derives `is_vector` from
  PyMuPDF's image inventory, which is also where the parser's `is_vector` comes from, so the
  **label** is no longer independent. **Recall** — did `figures.py` cluster a region there at all
  — still is, and that is what §4.1 asks for.
- **Caption association is measurable as of 2026-08-01, and the failure mode is the good one.**
  The LAST of §4.1's four metrics. The third annotation pass added three papers with captions
  drawn as their own boxes and linked — 24 links across a3c, bert, gpt3 and attention.

  | paper | correct | false | missed |
  |---|---|---|---|
  | attention-is-all-you-need | **1 / 1** | 0 | 0 |
  | bert-2col | 3 / 6 | 0 | 3 |
  | a3c-algorithmheavy | 2 / 7 | 0 | 5 |
  | gpt3-longform-singlecol | 1 / 10 | **1** | 9 |
  | | **7 / 24** | **1** | 17 |

  §4.1 insists these are reported apart, and this is exactly why: **one false link against
  seventeen misses.** The parser is not attaching Figure 2's caption to Figure 3 — it is failing
  to attach at all. A confidently wrong link is the expensive failure, because everything
  downstream believes it; a missing one is visible as missing. `CAPTION_MAX_GAP_PT` and
  `CAPTION_MIN_X_OVERLAP` are too tight, which is a far easier thing to fix than a wrong rule.

  Still not evaluable on `resnet` and `neural-odes`: those two papers' 51 floats have no caption
  boxes drawn against them. The metric covers 4 of 6 annotated papers.

  A join worth recording, because getting it wrong scores a *perfect* parser at zero: gold links
  are `(caption gold_id, parent gold_id)` and the parser's are `(caption block_id, float
  block_id)`. Two namespaces for one page. `_caption_links` matches every predicted block to a
  gold region by IoU first and translates, and a link whose caption did not match is **dropped
  rather than failed** — that is a detection failure the `caption` row's F1 already counts, and
  counting it twice would report one defect as two.
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
- **The over-detection has ONE cause, and it is a named acceptance clause being violated:
  table values are becoming headings.** Measured 2026-08-01 over the whole corpus: **165 of
  a3c's 193 headings and 126 of gpt3's 181 are numeral-only strings** — `'570.2'`, `'133.4'`,
  `'3.66'`, `'44.3'` — plus bare column labels `'Game'`, `'DQN'`, `'Gorila'`. The other six
  papers have 0–2 between them. `hierarchy.spec` says in as many words: *"No figure label, table
  cell, author line or arXiv stamp is classified as a heading."* Nothing asserts it, which is why
  a 14×-inflated outline was carried as a vague "over-detecting on a3c/gpt3" rather than as the
  concrete defect it is.

  **FIXED 2026-08-01, in `tables.py`.** The root cause was one layer down: a containment check
  put **0** of those headings inside any detected table region, because `MIN_RULES = 2` rejected
  the tables holding them. a3c p18 — the Atari results table, ~50 rows — draws exactly **one**
  rule across 510 text lines. gpt3 p62's two rules bracket its **header only**, so the 60-row
  body below stayed unclaimed.

  `tables.py` now has a second, borderless path: runs of rows whose column positions repeat
  line after line, which is the *"borderless via column/row whitespace alignment"* F1.6 asked
  for and never got. Two things it had to learn the hard way — columns are **centred or
  right-aligned** as often as left (testing left edges only found *zero* tables on a3c p18,
  across 58 rows that split cleanly into 7–9 cells), and rows a ruled region already holds must
  be **dropped rather than re-emitted**, because `assign_ids` hashes position and text so a
  duplicate cell is an id collision, not a cosmetic one (`4650 blocks produced 4640 ids`).

  | | headings before | after | numeral-only before | after |
  |---|---|---|---|---|
  | a3c-algorithmheavy | 193 | **17** | 165 | **0** |
  | gpt3-longform-singlecol | 181 | **61** | 126 | **6** |

  a3c also went 6 → 10 tables and 325 → 901 addressable cells; gpt3 39 → 41 and 1,725 → 3,094.
  The six other papers are unchanged, and the three gold-scored papers' F1 and reading order are
  identical — this fixed a defect without moving the benchmark.

- **The ±20 % outline clause has never been measurable, and half of it now is — for free.**
  The gold set is region-level; nothing in it states a paper's section count, so "within ±20 % of
  gold" had no gold. But **4 of the 8 corpus papers carry an embedded PDF outline** written by
  `hyperref` at compile time — the author's own section list, independent of both parsers and of
  the annotator. `pymupdf.Document.get_toc()` returns it:

  | paper | embedded TOC | our headings | delta | ±20 %? |
  |---|---|---|---|---|
  | superglue-tableheavy | 20 | 20 | **0 %** | yes |
  | attention-is-all-you-need | 22 | 18 | −18 % | yes |
  | neural-odes-mathheavy | 21 | 47 | +124 % | no |
  | gpt3-longform-singlecol | 32 | 181 | +466 % | no |
  | a3c · bert · pdf-to-tree · resnet | *(none)* | — | — | — |

  Two of four already pass. gpt3's failure is mostly the table-numeral defect above (126 of its
  181 are numerals; without them it is 55 against 32, still outside but a different problem).
  This does not replace hand-annotated gold — a TOC lists what the author bookmarked, which is
  not always every visual heading — so it belongs as a *floor* check, not as the definition. But
  it turns an unmeasurable clause into a measurable one on half the corpus at zero annotation
  cost, and it should have been the first place anyone looked.
- **Caption linking is 68.2 %, against an 80 % bar** (58/85 over figures; 142/226 = 62.8 % over
  floats — the denominator was never stated and the two disagree). Up from ~35 % via, in order:
  raster panel merging (neural-odes 77 → 18 regions); binding by horizontal overlap plus
  edge-to-edge adjacency rather than by nearest vertical centre, which on a two-column page
  routinely picked the float in the *other* column; and #102, which found that
  `figures._CAPTION_START` matched `[0-9]+|[IVXivx]+` and so could not match an APPENDIX label —
  gpt3's 34 `Figure G.N:` captions were never captions at all and could bind to nothing.
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
- **`perf.spec`'s memory half was never actually checked, and it fails.** The brief asks for
  peak RSS **<500 MB**. `test_the_parse_stays_inside_the_performance_budget` asserts
  `peak_mb < 2000` — four times the bar — on `resnet-cvpr-2col`, the *second-smallest* paper in
  the corpus, because `ru_maxrss` is process-wide inside a shared pytest run and a tight bound
  there would be measuring the rest of the suite. The reasoning in that comment is sound; the
  consequence is that nothing measured the real number. Measured 2026-08-01, one clean process
  per paper: **`gpt3-longform-singlecol` peaks at 746 MB**, over the bar, while the other seven
  sit at 143–281 MB. It scales with page count (75 pp), so the fix is a streaming or
  page-batched assembly rather than holding every page's spans at once — and the assertion
  belongs in a subprocess against the *largest* paper, at the bar the brief actually states.

  > **The 746 MB no longer reproduces (2026-08-03).** Same paper, same method, fresh subprocess:
  > **442.6 / 497.4 / 501.7 MB** on `main` @ `dff69e5`, and **488.3 / 509.1 / 496.3 MB** on
  > `e9c58ca` before it. Roughly 240 MB came off between 2026-08-01 and now and **nothing
  > recorded which change did it** (#52) — which is its own finding. The subprocess assertion
  > described above was built and is right; what it cannot do is decide a 500 MB clause when
  > three identical runs of a byte-deterministic parser straddle 500. #104.
  This is the third time on this branch a green test has turned out to assert less than it
  appeared to; it is the same shape as the empty-`parametrize` trap `_corpus_manifest.py`
  documents.

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
