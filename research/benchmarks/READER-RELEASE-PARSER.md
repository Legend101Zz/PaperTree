# Reader release: parser robustness and measured quality (S2, #141)

- **Status: measured, owner review pending.** Branches `s2/parse-robustness` (branch 1, head
  `7051862`) and `s2/parse-quality` (branch 2, stacked on it; parser code final at `d425330`), both off
  `origin/main` `18f69ec`. Slice contract: `slice-plan.md` §S2; decision: ADR-002 §3.5.
- **Two golds, neither authoritative.** Every row below carries its n and provenance:
  - **repo gold** `research/benchmarks/gold/ptub-gold.json`: 36 pages of 6 corpus papers,
    **1 annotator, no IAA**;
  - **fresh gold** `research/benchmarks/fresh/gold-pp12.json`: pages 1-2 of 6 fresh papers, 125
    anchor units, **2 model annotators + adjudicator, owner review pending** (#54). It must not
    gate anything until the owner has reviewed it, so every fresh-gold verdict here is
    provisional.
- **Machine.** A shared box, never quiesced during this work (#129/#80): the 1-minute load
  average ran 7-25. Every timing and RSS number carries the load it was taken at.
- **This report does not claim universal accuracy.** It measures 14 papers (8 corpus + 6 fresh)
  on two small golds, and §7 lists where it is still wrong.

## 0. How the numbers were made

- **BEFORE and AFTER, interleaved.** For every paper, `18f69ec` (base), `7051862` (branch 1)
  and `d425330` (branch 2) were parsed back to back, each in a fresh subprocess under
  `/usr/bin/time -l`, from `git archive` copies of the worker placed first on `PYTHONPATH`. The
  output is the product serialisation (`model_dump(by_alias, exclude_unset)`). Nothing is
  cached across runs.
- **Scorers.** The repo gold is scored with `papertree_evaluation.scoring.score_paper` (per-page
  mean, the pooled rate and the zero-pair page count this slice added, macro-F1 and per-type F1 at
  IoU 0.5). The fresh gold is scored with `papertree_evaluation.fresh.score_fresh_paper`, the
  committed module, on the committed gold. Guided cards come from the product's
  `projectGuided`, and text-layer stamping from pdf.js through the product bridge. Both use the
  architecture judge's scripts unmodified: `dump_order.mts`, `probe_textlayer.mts`,
  `stamp_by_type.py`.
- **Text conservation.** Every rule was also checked against every MuPDF text line of every
  page of all 14 papers: is the line's text still inside some block? Two things were measured:
  lines lost against the parent commit, and lines in no block at all.
- **One rule, one commit, one measurement against its parent.** §3 is that ledger, including the
  rules that were dropped.
- **Reproduce** (the PDFs are gitignored):

  ```bash
  ./research/benchmarks/fetch_corpus.sh && ./research/benchmarks/fresh/fetch_fresh.sh
  uv run python -m papertree_evaluation score --verbose                                  # repo gold
  uv run python -m papertree_evaluation fresh --verbose                                  # fresh gold
  uv run pytest services/document-worker/python/tests/worker/test_fresh_papers.py \
      packages/evaluation/python/tests/eval/test_fresh.py                                # the pins
  ```

## 1. Verdict

### 1.1 Merge rule (slice-plan §S2), item by item

| # | criterion | verdict | evidence |
|---|---|---|---|
| 1 | Corpus plus fresh set parse at 100 % (partial counts) | **MET** | 14/14 `complete` on both branches (base: 12/14, DDPM and Mask R-CNN dead-lettered). All 14 branch-2 documents validate as PaperIR 1.0.0. Table A. |
| 2 | No per-paper regression on the repo gold, on pooled reading order or on macro-F1 | **NOT MET on branch 2** (MET on branch 1: identical to base) | Two papers fall below base. **gpt3** macro-F1 0.3429 → 0.3416: the gold boxes runs of printed paragraphs as one region, so splitting them into their printed paragraphs matches none of them. **resnet** pooled 96/103 = 0.932 → 77/85 = 0.906: the 8 remaining discordant pairs are all against gold defects (footnotes given a body order, against ANNOTATION_GUIDE rule 1; a second, duplicate box around Figure 6). The other four papers rise. The aggregate goes pooled 0.900 → 0.962 and macro-F1 0.320 → 0.346. §6 has the evidence. |
| 3 | YOLO: title first, 0 numeric headings, "2. Unified Detection" typed `heading` | **MET** (branch 2) | First body block on p0 is the title; 0 numeric headings (base 1: `66.4`); "2. Uniﬁed Detection" is a `heading`. Tests `test_title_first_on_yolo`, `test_no_numeric_only_headings_on_yolo`, `test_unified_detection_is_a_heading_on_yolo`. |
| 4 | Merged gold paragraphs on fresh pp1-2 at least halved against the baseline | **MET on provisional gold** | 58 → 10 of 71 (and 58 → 10 of 74 under the `alt_kind` reading). The baseline is branch 1, the first commit at which all six parse; base parses four of them, 45 of 52 merged. Over-segmentation did not rise: 56 unanchored fragments at branch 1, 54 after. Pinned in `test_merged_paragraphs_on_the_fresh_set_are_at_most_half_of_branch_1`. It cannot gate until #54. |
| 5 | Determinism, 20 runs byte-identical | **MET** | All 14 papers, 20 runs each, on both branches: 1 distinct output and 1 id sequence per paper (§5). The gate's `test_determinism_over_twenty_runs` also passes. |
| 6 | Peak-RSS ratchet of 520 MB holds on a quiesced machine | **NOT DEMONSTRATED** | The machine was never quiesced. gpt3 (the largest paper), interleaved trials: branch 1 510.7-515.2 MB (median 511.0), branch 2 511.7-519.7 MB (median 515.0), 5 trials each, 1-min load 7.7-17.5; every trial under 520, the branch-2 maximum 0.3 MB short of it. A single pass at load 16.1 read 523.5 MB (Table A). Branch 2 adds about 4 MB, from 263 more blocks. The ratchet test takes the max over trials, so on this box it can go red with no code change (#129). |

The items the slice plan lists as regression tests all exist and pass: `test_ddpm_parses`,
`test_image_overhang_is_clipped`, `test_retyped_heading_reparents`,
`test_invalid_ir_salvages_to_partial`, `test_no_numeric_only_headings_on_yolo` (the plan's
`[yolo]`), `test_title_first_on_yolo`, plus the determinism and RSS tests in the gate.

### 1.2 Baselines to beat (slice-plan §S2, re-measured here at `18f69ec`)

| measure | baseline (judge, `6ff15ad`) | re-measured at base | branch 2 | gold |
|---|---|---|---|---|
| repo gold, per-page reading order | 0.586 | 0.586 | **0.668** | 1 annotator, no IAA |
| repo gold, pooled reading order | 0.900 (235/261) | 0.900 (235/261) | **0.962 (230/239)** | 1 annotator, no IAA |
| repo gold, zero-pair pages | 11/36 | 11/36 | 11/36 (not reduced) | 1 annotator, no IAA |
| repo gold, macro-F1 | 0.320 | 0.3202 | **0.3456** | 1 annotator, no IAA |
| YOLO pp1-2: gold paragraphs merged / in blocks / body mistyped | 23 in 9, 6 mistyped (seed gold) | 21 of 22 in 9 blocks, 6 of 26 mistyped | **4 of 22 in 2 blocks, 0 of 26 mistyped** | 2 model annotators + adjudicator, owner review pending |
| ResNet pp1-2 (seed gold) | 14 in 5, 4 mistyped | not re-measurable: ResNet is a corpus paper and is not in the fresh gold | - | - |
| DDPM pp1-2 (C's row, quoted) | 3 in 1 | did not parse (G7) | **0 of 7** (branch 1: 3 of 7 in 1 block) | 2 model annotators + adjudicator, owner review pending |
| text-layer stamping, share of ALL items (ADR §2) YOLO / ResNet / Attention | 60.8 / 57.2 / 63.1 % | 60.8 / 57.2 / 63.1 % | 60.8 / **57.6** / **63.2** % | - |
| prose stamping by block type, YOLO / ResNet / Attention | 88.7 / 90.3 / 98.2 % | 88.7 / 90.3 / 98.2 % | 88.7 / 90.2 / **98.5** % | - |
| table-cell stamping by block type, YOLO / ResNet / Attention | 2.1 / 4.9 / 0.6 % | 2.1 / 4.9 / 0.6 % | 1.9 / 4.1 / 0.6 % | - |

- The code between `6ff15ad` and `18f69ec` differs only by the VLM removal and the generation
  plumbing, and every baseline reproduces exactly.
- The seed gold's YOLO row (23 paragraphs) is not this gold. The consensus found one seed
  "paragraph" to be a flush-left line of another and a missing paragraph (fresh README). So the
  YOLO baseline is re-measured on this gold, as the gold README requires.
- The by-type stamping shares move mostly because blocks are regrouped: they ask which block
  type contains an item. The ADR's own measure, the share of all text-layer items that get an
  exact IR offset, is equal or higher on 13 of 14 papers at branch 2. The exception is
  neural-odes, 10 items fewer (2,647 → 2,637 of 4,683). Table D2 has all 14.

## 2. Branch 1 (`s2/parse-robustness`): no real paper may dead-letter

| commit | what | measured |
|---|---|---|
| `cbf64b9` | the fresh set: `fetch_fresh.sh` (adjusted to the repo layout), `fresh.sha256`, `gold-pp12.json`, README; `.gitignore` gains `research/benchmarks/fresh/pdfs/` | PDFs never committed |
| `404d21d` | **G7**: image placements clipped to the crop box in `pdf._images`; a placement wholly off the page is dropped | DDPM p0's raster [347.6, 467.9, 661.5, 781.9] on a 612 pt page; a wholly off-page placement had crashed `crops.py` (`Invalid bandwriter header`). The 12 parsing papers stay byte-identical. |
| `1404bc1` | **R21**: sections orphaned by a heading retyped as a caption (`Algorithm 3 ...`) re-parented to the nearest preceding section one level up | DDPM: 25 pp, 463 blocks, 34 sections, complete (the judge's numbers); 4.2/4.3 sit under "Experiments" |
| `abfb863` | validator **R8** (duplicate ids): a table region covered by the UNION of the tables already kept is dropped | **a second dead letter the slice plan did not list**: Mask R-CNN p5, a ruled region straddling two side-by-side tables, re-emitted both tables' cells (848 blocks, 842 ids). Now 837 blocks, complete |
| `7051862` | **salvage lane**: when validation still fails, drop only what the failing rules name (regions, relations, colliding blocks), re-attach orphaned sections, keep every text block, and emit a VALIDATING document with `status: "partial"` and a `partial_reason` | never fires on the 14 papers (all validate first time); proven on injected failures: DDPM with both fixes disabled gives partial, 462 blocks, 34 sections; Mask R-CNN with the old dedupe gives partial with exactly the clean parse's blocks; a synthetic overhang; a synthetic off-page text block keeps its text and loses only geometry |

Parse outcome, speed and RSS for all three commits are in Table A (§4). Every regression test
has a synthetic-PDF half, so CI runs it without the corpus, and a real-parse half that skips
loudly and names the fetch script. The branch-1 gate was run uncached at `7051862` (1,346 TS
tests; pytest 1,844 passed, 2 skipped, 1 xfailed; ruff, mypy 179 files, prettier and
`next build` all green), and the branch was pushed there.

## 3. Branch 2 (`s2/parse-quality`): one rule per commit, each measured against its parent

"Better / worse" counts every per-paper metric that moved on any of: both repo-gold readings
(raw and normalised), the fresh gold, Guided card shares, and text conservation. A rule was kept
only when none of its "worse" is a parse regression. Each "worse" was traced to a block or page,
and where it is a gold convention or a gold defect, that is shown with page evidence. **Otherwise
the rule was dropped.** This is the reading of "drop a rule that regresses any metric" applied
here. The owner may rule otherwise, and §6 names the two commits that decision would touch.

| commit | rule | vs parent: better / worse | kept? | what the "worse" is |
|---|---|---|---|---|
| `19c6b38` | scorer: pooled reading order and zero-pair pages beside the per-page mean | scorer only | yes | - |
| `0aa30d7` | fresh-gold scorer (`papertree_evaluation.fresh`, `python -m papertree_evaluation fresh`) | scorer only; 4 scorer mutations killed | yes | - |
| `bd1792a` | one fresh-gold correction (see below) | - | yes | - |
| `6e2d222` | headings: Title-Case numbered heads are headings (the author-line guard ate them), run-in leads are not, the reference sweep reads in reading order | 102 / 12 | yes | attention/resnet pooled order: new matched headings below a figure placed by emission order (fixed by the floats rule); DDPM +2 prose fragments (two equation `T`s no longer false headings); all-card Guided shares (a heading split out of a paragraph is a new short card) |
| `0e534c4` | **rule 5**: numeric-only text is never a heading, and is typed `unknown` | 57 / 0 | yes | - |
| `aa6afa6` | **rule 6**: the abstract ends at the first heading or its column's foot; swept in reading order; the heading's own space-below no longer cuts it | 30 / 9 | yes | a3c macro-F1 0.4213 → 0.4193 and paragraph F1 on a3c/bert/resnet: blocks that stop being `abstract` become `paragraph`, gold's own type for that right column, but gold boxes the whole right column as ONE paragraph (IoU < 0.5). Attention's abstract, never typed at base, now is |
| `c4e3ae5` | floats: a table or figure is read where it stands in the body order | 14 / 4 | yes | resnet pooled 108/116 → 107/116: three new p7 pairs, all against gold's duplicate union box of Figure 6 (read after the text, while its panels are read first) |
| `952bb42` | **rule 8**: lines crossing the column split above the columns are read first (title, authors) | 12 / 2 | yes | pdf-to-tree's Guided short SHARE (two affiliation blocks became one, count unchanged); ONE FALSE `continues_in_next_column` on pdf-to-tree p0, whose target is a caption tail split by a pre-existing same-baseline defect (§7) |
| `a3a4f2c` | **table-claim fix: DROPPED**, kept as a strict xfail | A 4 / 24, B 2 / 24, C 0 / 22 | **no** | see §3.1 |
| `f7d7f45` | **rule 7**: one block per printed paragraph, from first-line indent and paragraph skip; runs keep the text exactly | 59 / 58 | yes (see §6) | repo gold's multi-paragraph boxes (paragraph F1 down on all six; gpt3 macro-F1 below base; resnet pairs 116 → 80); author-year resolution neural-odes 11 → 7 of 56 (all four lost had resolved to a WRONG entry) and pdf-to-tree 36 → 33 of 61 (a pre-existing hanging-indent cut leaves an entry's year on its second line) |
| `9cf0c99` | a caption line is never a figure's interior text | 5 / 12 | yes | attention RAW macro-F1 0.3639 → 0.3528, but NORMALISED up (0.3572 → 0.375): raw gold types p14's caption box `figure`; Guided short counts +1-2 (the recovered captions are short cards) |
| `d425330` | a sentence that names a figure ("Figure 4 shows ...") does not open a caption | 16 / 10 | yes | bert paragraph F1 0.347 → 0.342 (one retyped paragraph matches no gold box); Guided short counts +1 on two papers (the sentences are cards now) |
| `e214589` | two CONSUMER suites re-measured, outside S2's owned paths: `packages/retrieval` `test_expansion` (broken by the floats commit) and `packages/agent-tools` `test_tools` (broken by the headings commit) | - | - | **a process gap, stated plainly:** each rule's check ran the worker and evaluation suites only. The full gate at `d425330` caught 5 red tests in these two packages, and a bisect over exported sources assigned each to its commit. Both tests pinned the old reading order; each now asserts the new one by reason (details in the commit). |

- **Fresh gold, branch 1 → branch 2 overall.** Numeric headings 30 → 0 (Mask R-CNN 15,
  FlashAttention 9). Mistyped fresh body units 16 → 0 of 83 (YOLO 6 → 0, SBERT 4 → 0, Mask
  R-CNN 3 → 0, FlashAttention 3 → 0). Fresh headings typed 11 → 15 of 19, false headings 2 → 0,
  title first 5/6 → 6/6, pairwise within page 0.948 → 1.000.
- **Numbers from rule 7.** Merged fresh paragraphs 58 → 10. Repo-gold caption detection
  25 → 32 of 39, and linking given both ends 14/15 → 17/18; captioned floats 142 → 178 of 226
  across the corpus (177 after the last commit removed one false link). Guided text cards under
  60 characters fell on all 14 papers (YOLO 0.465 → 0.322). All 34 newly linked captions had
  sat under a stray table value in one `paragraph` block.
- **Numbers from the two caption rules.** Twelve captions are back in the document (DDPM Figures
  1, 2, 6 and 7; gpt3 H.6-H.10; attention Figures 4 and 5; one each on neural-odes and Adam). DDPM's fresh caption pairing went
  0 → 2 of 2. Twenty "Figure N shows ..." paragraphs are no longer typed `caption`.
- **Text conservation.** Not one MuPDF line was lost against its parent by any kept rule, the
  headings commit included (measured on its run). Lines in no block at all
  fall 2,289 → 2,272 over branch 2 (the recovered captions). The rest are text inside figures,
  which figure blocks do not carry by design, plus the defects in §7.
- **The fresh-gold correction (`bd1792a`).** SBERT p2's `cont` anchor was 'Similarity'; the page
  prints 'Semilarity', a typo in the paper. A 300 dpi page-image crop
  (`hard-cases/sbert-p2-semilarity-typo.png`) shows it, and the correction is logged in
  `_provenance.corrections`. No other unit was touched.

### 3.1 The table-claim fix: measured three ways, dropped, pinned

A table claims every line level with it, at any x, and a layout block whose lines are all
claimed is skipped as "already emitted as table cells". On a two-column page that deletes the
other column's text beside a table. Measured on this branch, these are in no block of the
document:
- whole section heads: bert-2col p6 `4.4 SWAG`, flashattention p7 `4.2 Better Models with
  Longer Sequences`, pdf-to-tree p6 `4.5 Inference Speed`;
- a whole SBERT p6 paragraph ("It appears that the sentence embeddings from SBERT capture well
  sentiment ...").

Three narrower claims were measured against the parent on all 14 papers:

| variant | better / worse |
|---|---|
| A: only the lines the cells were built from | 4 / 24 |
| B: only lines inside the table's box | 2 / 24 |
| C: never across the column split from a one-column table | 0 / 22 |

Each variant also releases the table's own columns that lie outside a too-narrow detected table
box ("VOC 07 test" and `41.5` on resnet p7; 18-36 blocks on Mask R-CNN) as short body blocks.
The x-blind claim was hiding exactly that. The right fix needs table-extent detection, which is
outside this slice. The shape stays in the suite as a **strict xfail**, checked to XPASS (fail)
with variant A applied, so a real fix has to remove the marker.

The earlier port of rule 7 ran into the same claim: a paragraph split off wholly within a
table's height was "fully claimed" and vanished (52 lines on 5 papers). `LayoutBlock.run` fixes
that without touching the claim, by asking the question of the block `_same_block` alone would
have formed.

## 4. Per-paper tables: base `18f69ec` / branch 1 `7051862` / branch 2 `d425330`

#### A. Parse outcome, speed, size, peak RSS (fresh subprocess each, `/usr/bin/time -l`)

| paper | set | pages | base: outcome | b1: outcome | b2: outcome | base: s/page | b1: s/page | b2: s/page | base: blocks | b1: blocks | b2: blocks | base: peak RSS MB | b1: peak RSS MB | b2: peak RSS MB | load avg 1/5/15 at start (b2) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a3c-algorithmheavy | corpus | 19 | complete | complete | complete | 0.331 | 0.279 | 0.284 | 1232 | 1232 | 1287 | 225.2 | 227.7 | 228.0 | 24.83/16.82/13.46 |
| attention-is-all-you-need | corpus | 15 | complete | complete | complete | 0.134 | 0.123 | 0.122 | 480 | 480 | 546 | 151.2 | 149.0 | 151.6 | 21.60/16.50/13.41 |
| bert-2col | corpus | 16 | complete | complete | complete | 0.127 | 0.122 | 0.129 | 681 | 681 | 770 | 176.3 | 176.0 | 176.3 | 20.35/16.32/13.36 |
| gpt3-longform-singlecol | corpus | 75 | complete | complete | complete | 0.123 | 0.123 | 0.124 | 4597 | 4597 | 4860 | 516.3 | 511.3 | 523.5 | 16.13/15.62/13.18 |
| neural-odes-mathheavy | corpus | 18 | complete | complete | complete | 0.257 | 0.193 | 0.235 | 626 | 626 | 679 | 167.5 | 166.4 | 167.6 | 13.10/14.96/13.00 |
| pdf-to-tree-acl2col | corpus | 11 | complete | complete | complete | 0.113 | 0.105 | 0.113 | 486 | 486 | 538 | 169.7 | 171.4 | 168.5 | 12.08/14.69/12.92 |
| resnet-cvpr-2col | corpus | 12 | complete | complete | complete | 0.117 | 0.110 | 0.109 | 955 | 955 | 1013 | 144.7 | 144.6 | 144.8 | 11.60/14.54/12.88 |
| superglue-tableheavy | corpus | 29 | complete | complete | complete | 0.041 | 0.033 | 0.034 | 846 | 846 | 955 | 145.1 | 145.0 | 149.1 | 11.60/14.54/12.88 |
| ddpm-2006.11239 | fresh | 25 | FAILED (SemanticValidationError: PaperIR failed ) | complete | complete | - | 0.185 | 0.183 | - | 463 | 540 | 315.8 | 319.1 | 318.5 | 9.93/14.02/12.73 |
| yolo-1506.02640 | fresh | 10 | complete | complete | complete | 0.204 | 0.191 | 0.136 | 770 | 770 | 825 | 186.3 | 183.5 | 183.9 | 11.21/13.75/12.70 |
| flashattention-2205.14135 | fresh | 34 | complete | complete | complete | 0.104 | 0.098 | 0.110 | 3261 | 3261 | 3438 | 318.0 | 318.1 | 322.3 | 9.17/13.65/12.61 |
| sbert-1908.10084 | fresh | 11 | complete | complete | complete | 0.226 | 0.137 | 0.136 | 628 | 628 | 704 | 123.9 | 124.9 | 124.5 | 12.17/14.01/12.77 |
| adam-1412.6980 | fresh | 15 | complete | complete | complete | 0.064 | 0.073 | 0.080 | 321 | 321 | 359 | 138.6 | 138.6 | 139.4 | 10.83/14.33/12.82 |
| maskrcnn-1703.06870 | fresh | 12 | FAILED (ValueError: duplicate block ids: 848 blo) | complete | complete | - | 0.424 | 0.483 | - | 837 | 899 | 198.0 | 211.6 | 211.6 | 12.07/14.05/12.77 |

#### B. Repo gold (`research/benchmarks/gold/ptub-gold.json`, gold as drawn)

| paper | n pages | base: RO per-page / pooled (agree/pairs) / zero-pair / macro-F1 | b1: RO per-page / pooled (agree/pairs) / zero-pair / macro-F1 | b2: RO per-page / pooled (agree/pairs) / zero-pair / macro-F1 | gold |
|---|---|---|---|---|---|
| a3c-algorithmheavy | 6 | 0.667 / 1.000 (4/4) / 2 / 0.3932 | 0.667 / 1.000 (4/4) / 2 / 0.3932 | 0.667 / 1.000 (9/9) / 2 / 0.4185 | 1 annotator, no IAA |
| attention-is-all-you-need | 6 | 0.389 / 0.921 (35/38) / 2 / 0.2899 | 0.389 / 0.921 (35/38) / 2 / 0.2899 | 0.667 / 1.000 (47/47) / 2 / 0.3528 | 1 annotator, no IAA |
| bert-2col | 6 | 0.699 / 0.806 (54/67) / 1 / 0.3523 | 0.699 / 0.806 (54/67) / 1 / 0.3523 | 0.833 / 1.000 (49/49) / 1 / 0.3752 | 1 annotator, no IAA |
| gpt3-longform-singlecol | 6 | 0.222 / 0.778 (7/9) / 4 / 0.3429 | 0.222 / 0.778 (7/9) / 4 / 0.3429 | 0.333 / 1.000 (9/9) / 4 / 0.3416 | 1 annotator, no IAA |
| neural-odes-mathheavy | 6 | 0.611 / 0.975 (39/40) / 2 / 0.2175 | 0.611 / 0.975 (39/40) / 2 / 0.2175 | 0.611 / 0.975 (39/40) / 2 / 0.2280 | 1 annotator, no IAA |
| resnet-cvpr-2col | 6 | 0.929 / 0.932 (96/103) / 0 / 0.3257 | 0.929 / 0.932 (96/103) / 0 / 0.3257 | 0.894 / 0.906 (77/85) / 0 / 0.3575 | 1 annotator, no IAA |
| **all six** | 36 | 0.586 / 0.900 (235/261) / 11 of 36 / 0.3202 | 0.586 / 0.900 (235/261) / 11 of 36 / 0.3202 | 0.668 / 0.962 (230/239) / 11 of 36 / 0.3456 | 1 annotator, no IAA |

##### B2. Repo gold per-type F1 @ IoU 0.5 (gold as drawn)

| paper | type | base | b1 | b2 | gold |
|---|---|---|---|---|---|
| a3c-algorithmheavy | abstract | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| a3c-algorithmheavy | affiliation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| a3c-algorithmheavy | author | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| a3c-algorithmheavy | caption | 0.769 | 0.769 | 0.857 | 1 annotator, no IAA |
| a3c-algorithmheavy | figure | 0.889 | 0.889 | 0.889 | 1 annotator, no IAA |
| a3c-algorithmheavy | footnote | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| a3c-algorithmheavy | heading | 0.000 | 0.000 | 0.250 | 1 annotator, no IAA |
| a3c-algorithmheavy | margin_note | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| a3c-algorithmheavy | paragraph | 0.417 | 0.417 | 0.357 | 1 annotator, no IAA |
| a3c-algorithmheavy | table | 0.250 | 0.250 | 0.250 | 1 annotator, no IAA |
| a3c-algorithmheavy | title | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| attention-is-all-you-need | abstract | 0.000 | 0.000 | 1.000 | 1 annotator, no IAA |
| attention-is-all-you-need | affiliation | 0.200 | 0.200 | 0.200 | 1 annotator, no IAA |
| attention-is-all-you-need | author | 0.250 | 0.250 | 0.250 | 1 annotator, no IAA |
| attention-is-all-you-need | caption | 0.667 | 0.667 | 0.500 | 1 annotator, no IAA |
| attention-is-all-you-need | citation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| attention-is-all-you-need | equation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| attention-is-all-you-need | figure | 0.500 | 0.500 | 0.500 | 1 annotator, no IAA |
| attention-is-all-you-need | footnote | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| attention-is-all-you-need | heading | 0.353 | 0.353 | 0.500 | 1 annotator, no IAA |
| attention-is-all-you-need | inline_equation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| attention-is-all-you-need | margin_note | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| attention-is-all-you-need | page_number | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| attention-is-all-you-need | paragraph | 0.378 | 0.378 | 0.341 | 1 annotator, no IAA |
| attention-is-all-you-need | table | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| attention-is-all-you-need | title | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| bert-2col | abstract | 0.333 | 0.333 | 0.500 | 1 annotator, no IAA |
| bert-2col | affiliation | 0.250 | 0.250 | 0.250 | 1 annotator, no IAA |
| bert-2col | author | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| bert-2col | caption | 0.667 | 0.667 | 0.833 | 1 annotator, no IAA |
| bert-2col | citation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| bert-2col | figure | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| bert-2col | footnote | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| bert-2col | heading | 0.118 | 0.118 | 0.286 | 1 annotator, no IAA |
| bert-2col | inline_equation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| bert-2col | margin_note | 0.667 | 0.667 | 0.667 | 1 annotator, no IAA |
| bert-2col | paragraph | 0.545 | 0.545 | 0.342 | 1 annotator, no IAA |
| bert-2col | table | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| bert-2col | title | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| gpt3-longform-singlecol | abstract | 0.667 | 0.667 | 0.667 | 1 annotator, no IAA |
| gpt3-longform-singlecol | affiliation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| gpt3-longform-singlecol | author | 0.100 | 0.100 | 0.100 | 1 annotator, no IAA |
| gpt3-longform-singlecol | caption | 0.900 | 0.900 | 0.900 | 1 annotator, no IAA |
| gpt3-longform-singlecol | citation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| gpt3-longform-singlecol | figure | 0.400 | 0.400 | 0.400 | 1 annotator, no IAA |
| gpt3-longform-singlecol | footnote | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| gpt3-longform-singlecol | heading | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| gpt3-longform-singlecol | margin_note | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| gpt3-longform-singlecol | page_number | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| gpt3-longform-singlecol | paragraph | 0.190 | 0.190 | 0.174 | 1 annotator, no IAA |
| gpt3-longform-singlecol | table | 0.200 | 0.200 | 0.200 | 1 annotator, no IAA |
| gpt3-longform-singlecol | title | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | abstract | 0.667 | 0.667 | 0.667 | 1 annotator, no IAA |
| neural-odes-mathheavy | affiliation | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | algorithm | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | author | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | caption | 0.222 | 0.222 | 0.400 | 1 annotator, no IAA |
| neural-odes-mathheavy | citation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | equation | 0.353 | 0.353 | 0.353 | 1 annotator, no IAA |
| neural-odes-mathheavy | figure | 0.077 | 0.077 | 0.077 | 1 annotator, no IAA |
| neural-odes-mathheavy | footnote | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | heading | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | inline_equation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | margin_note | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | page_number | 0.167 | 0.167 | 0.167 | 1 annotator, no IAA |
| neural-odes-mathheavy | paragraph | 0.212 | 0.212 | 0.212 | 1 annotator, no IAA |
| neural-odes-mathheavy | table | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | table_cell | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| neural-odes-mathheavy | title | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| resnet-cvpr-2col | abstract | 0.333 | 0.333 | 0.500 | 1 annotator, no IAA |
| resnet-cvpr-2col | affiliation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| resnet-cvpr-2col | author | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| resnet-cvpr-2col | caption | 0.625 | 0.625 | 0.900 | 1 annotator, no IAA |
| resnet-cvpr-2col | equation | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| resnet-cvpr-2col | figure | 0.211 | 0.211 | 0.211 | 1 annotator, no IAA |
| resnet-cvpr-2col | footnote | 0.500 | 0.500 | 0.500 | 1 annotator, no IAA |
| resnet-cvpr-2col | heading | 0.125 | 0.125 | 0.300 | 1 annotator, no IAA |
| resnet-cvpr-2col | inline_equation | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| resnet-cvpr-2col | margin_note | 1.000 | 1.000 | 1.000 | 1 annotator, no IAA |
| resnet-cvpr-2col | page_number | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |
| resnet-cvpr-2col | paragraph | 0.575 | 0.575 | 0.404 | 1 annotator, no IAA |
| resnet-cvpr-2col | table | 0.190 | 0.190 | 0.190 | 1 annotator, no IAA |
| resnet-cvpr-2col | title | 0.000 | 0.000 | 0.000 | 1 annotator, no IAA |

#### C. Fresh gold pages 1-2 (`research/benchmarks/fresh/gold-pp12.json`)

| paper | run | n units (found) | merged paragraphs gold / alt_kind | mistyped body | headings typed/gold | false headings | numeric headings (paper) | title first | pairwise within page | captions paired | Guided text cards <60 chars | stamping prose | stamping table cells | gold |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ddpm-2006.11239 | base | (did not parse) | - | - | - | - | - | - | - | - | - | - | - | 2 model annotators + adjudicator, owner review pending |
| ddpm-2006.11239 | b1 | 16 (14) | 3 of 7 / 3 of 9 | 0 of 9 | 1/3 | 2 | 4 | yes | 1.000 (42/42) | 0/2 | 118/249 = 0.474 | 1284/1530 = 83.9% | 7/74 = 9.5% | 2 model annotators + adjudicator, owner review pending |
| ddpm-2006.11239 | b2 | 16 (14) | 0 of 7 / 0 of 9 | 0 of 9 | 1/3 | 0 | 0 | yes | 1.000 (42/42) | 2/2 | 110/306 = 0.359 | 1415/1672 = 84.6% | 7/74 = 9.5% | 2 model annotators + adjudicator, owner review pending |
| yolo-1506.02640 | base | 34 (34) | 21 of 22 / 21 of 23 | 6 of 26 | 2/4 | 0 | 1 | no | 0.897 (245/273) | 2/2 | 74/159 = 0.465 | 790/891 = 88.7% | 11/528 = 2.1% | 2 model annotators + adjudicator, owner review pending |
| yolo-1506.02640 | b1 | 34 (34) | 21 of 22 / 21 of 23 | 6 of 26 | 2/4 | 0 | 1 | no | 0.897 (245/273) | 2/2 | 74/159 = 0.465 | 790/891 = 88.7% | 11/528 = 2.1% | 2 model annotators + adjudicator, owner review pending |
| yolo-1506.02640 | b2 | 34 (34) | 4 of 22 / 4 of 23 | 0 of 26 | 4/4 | 0 | 0 | yes | 1.000 (273/273) | 2/2 | 66/205 = 0.322 | 799/901 = 88.7% | 10/527 = 1.9% | 2 model annotators + adjudicator, owner review pending |
| flashattention-2205.14135 | base | 15 (14) | 6 of 7 / 6 of 7 | 3 of 8 | 1/2 | 0 | 9 | yes | 1.000 (51/51) | 1/1 | 233/449 = 0.519 | 2154/3403 = 63.3% | 91/3616 = 2.5% | 2 model annotators + adjudicator, owner review pending |
| flashattention-2205.14135 | b1 | 15 (14) | 6 of 7 / 6 of 7 | 3 of 8 | 1/2 | 0 | 9 | yes | 1.000 (51/51) | 1/1 | 233/449 = 0.519 | 2154/3403 = 63.3% | 91/3616 = 2.5% | 2 model annotators + adjudicator, owner review pending |
| flashattention-2205.14135 | b2 | 15 (14) | 0 of 7 / 0 of 7 | 0 of 8 | 1/2 | 0 | 0 | yes | 1.000 (51/51) | 1/1 | 238/595 = 0.400 | 2647/3768 = 70.2% | 95/3609 = 2.6% | 2 model annotators + adjudicator, owner review pending |
| sbert-1908.10084 | base | 25 (25) | 13 of 15 / 13 of 15 | 4 of 18 | 2/3 | 0 | 0 | yes | 0.959 (140/146) | 0/0 | 40/121 = 0.331 | 811/874 = 92.8% | 30/456 = 6.6% | 2 model annotators + adjudicator, owner review pending |
| sbert-1908.10084 | b1 | 25 (25) | 13 of 15 / 13 of 15 | 4 of 18 | 2/3 | 0 | 0 | yes | 0.959 (140/146) | 0/0 | 40/121 = 0.331 | 811/874 = 92.8% | 30/456 = 6.6% | 2 model annotators + adjudicator, owner review pending |
| sbert-1908.10084 | b2 | 25 (25) | 2 of 15 / 2 of 15 | 0 of 18 | 3/3 | 0 | 0 | yes | 1.000 (146/146) | 0/0 | 46/188 = 0.245 | 818/882 = 92.7% | 25/451 = 5.5% | 2 model annotators + adjudicator, owner review pending |
| adam-1412.6980 | base | 15 (15) | 5 of 8 / 5 of 8 | 0 of 8 | 3/4 | 0 | 1 | yes | 1.000 (49/49) | 1/1 | 134/203 = 0.660 | 1620/2088 = 77.6% | 183/289 = 63.3% | 2 model annotators + adjudicator, owner review pending |
| adam-1412.6980 | b1 | 15 (15) | 5 of 8 / 5 of 8 | 0 of 8 | 3/4 | 0 | 1 | yes | 1.000 (49/49) | 1/1 | 134/203 = 0.660 | 1620/2088 = 77.6% | 183/289 = 63.3% | 2 model annotators + adjudicator, owner review pending |
| adam-1412.6980 | b2 | 15 (15) | 2 of 8 / 2 of 8 | 0 of 8 | 3/4 | 0 | 0 | yes | 1.000 (49/49) | 1/1 | 125/223 = 0.560 | 1639/2059 = 79.6% | 183/289 = 63.3% | 2 model annotators + adjudicator, owner review pending |
| maskrcnn-1703.06870 | base | (did not parse) | - | - | - | - | - | - | - | - | - | - | - | 2 model annotators + adjudicator, owner review pending |
| maskrcnn-1703.06870 | b1 | 20 (20) | 10 of 12 / 10 of 12 | 3 of 14 | 2/3 | 0 | 15 | yes | 1.000 (91/91) | 2/2 | 131/223 = 0.587 | 1110/1205 = 92.1% | 20/574 = 3.5% | 2 model annotators + adjudicator, owner review pending |
| maskrcnn-1703.06870 | b2 | 20 (20) | 2 of 12 / 2 of 12 | 0 of 14 | 3/3 | 0 | 0 | yes | 1.000 (91/91) | 2/2 | 97/245 = 0.396 | 1238/1340 = 92.4% | 19/573 = 3.3% | 2 model annotators + adjudicator, owner review pending |
| **pooled (4 of 6 parsed)** | base | 89 (88) | 45 of 52 / 45 of 53 | 13 of 60 | 8/13 | 0 | 11 | 3/4 | 0.934 (485/519) | 4/4 | - | - | - | 2 model annotators + adjudicator, owner review pending |
| **pooled (6 of 6 parsed)** | b1 | 125 (122) | 58 of 71 / 58 of 74 | 16 of 83 | 11/19 | 2 | 30 | 5/6 | 0.948 (618/652) | 6/8 | - | - | - | 2 model annotators + adjudicator, owner review pending |
| **pooled (6 of 6 parsed)** | b2 | 125 (122) | 10 of 71 / 10 of 74 | 0 of 83 | 15/19 | 0 | 0 | 6/6 | 1.000 (652/652) | 8/8 | - | - | - | 2 model annotators + adjudicator, owner review pending |

#### D. Guided text cards under 60 chars, and stamping, on the corpus papers

| paper | base: Guided <60 (share) | b1: Guided <60 (share) | b2: Guided <60 (share) | base: stamping prose / table cells | b1: stamping prose / table cells | b2: stamping prose / table cells | MuPDF lines in no block (base / b1 / b2) |
|---|---|---|---|---|---|---|---|
| a3c-algorithmheavy | 36/92 = 0.391 | 36/92 = 0.391 | 40/144 = 0.278 | 95.8% / 6.2% | 95.8% / 6.2% | 95.4% / 6.1% | 736 / 736 / 736 |
| attention-is-all-you-need | 70/157 = 0.446 | 70/157 = 0.446 | 79/218 = 0.362 | 98.2% / 0.6% | 98.2% / 0.6% | 98.5% / 0.6% | 180 / 180 / 174 |
| bert-2col | 104/230 = 0.452 | 104/230 = 0.452 | 104/313 = 0.332 | 91.2% / 1.0% | 91.2% / 1.0% | 90.7% / 0.3% | 190 / 190 / 190 |
| gpt3-longform-singlecol | 193/480 = 0.402 | 193/480 = 0.402 | 216/703 = 0.307 | 86.1% / 1.2% | 86.1% / 1.2% | 84.3% / 0.6% | 0 / 0 / 0 |
| neural-odes-mathheavy | 297/434 = 0.684 | 297/434 = 0.684 | 259/462 = 0.561 | 82.0% / 1.3% | 82.0% / 1.3% | 82.7% / 0.0% | 44 / 44 / 43 |
| pdf-to-tree-acl2col | 58/144 = 0.403 | 58/144 = 0.403 | 61/186 = 0.328 | 98.1% / 6.1% | 98.1% / 6.1% | 98.0% / 5.4% | 92 / 92 / 92 |
| resnet-cvpr-2col | 55/175 = 0.314 | 55/175 = 0.314 | 52/212 = 0.245 | 90.3% / 4.9% | 90.3% / 4.9% | 90.2% / 4.1% | 128 / 128 / 123 |
| superglue-tableheavy | 62/153 = 0.405 | 62/153 = 0.405 | 57/265 = 0.215 | 86.6% / 0.2% | 86.6% / 0.2% | 86.2% / 0.2% | 13 / 13 / 13 |
| ddpm-2006.11239 | - | 118/249 = 0.474 | 110/306 = 0.359 | - | 83.9% / 9.5% | 84.6% / 9.5% | - / 49 / 45 |
| yolo-1506.02640 | 74/159 = 0.465 | 74/159 = 0.465 | 66/205 = 0.322 | 88.7% / 2.1% | 88.7% / 2.1% | 88.7% / 1.9% | 33 / 33 / 33 |
| flashattention-2205.14135 | 233/449 = 0.519 | 233/449 = 0.519 | 238/595 = 0.400 | 63.3% / 2.5% | 63.3% / 2.5% | 70.2% / 2.6% | 75 / 75 / 75 |
| sbert-1908.10084 | 40/121 = 0.331 | 40/121 = 0.331 | 46/188 = 0.245 | 92.8% / 6.6% | 92.8% / 6.6% | 92.7% / 5.5% | 8 / 8 / 8 |
| adam-1412.6980 | 134/203 = 0.660 | 134/203 = 0.660 | 125/223 = 0.560 | 77.6% / 63.3% | 77.6% / 63.3% | 79.6% / 63.3% | 88 / 88 / 87 |
| maskrcnn-1703.06870 | - | 131/223 = 0.587 | 97/245 = 0.396 | - | 92.1% / 3.5% | 92.4% / 3.3% | - / 653 / 653 |


#### D2. Text-layer stamping, share of ALL non-blank pdf.js items given an exact IR offset (the ADR §2 measure)

| paper | base | branch 1 | branch 2 |
|---|---|---|---|
| a3c-algorithmheavy | 1910/4706 = 40.6% | 1910/4706 = 40.6% | 1910/4706 = 40.6% |
| adam-1412.6980 | 2568/4826 = 53.2% | 2568/4826 = 53.2% | 2620/4826 = 54.3% |
| attention-is-all-you-need | 1114/1766 = 63.1% | 1114/1766 = 63.1% | 1116/1766 = 63.2% |
| bert-2col | 2077/3065 = 67.8% | 2077/3065 = 67.8% | 2077/3065 = 67.8% |
| ddpm-2006.11239 | (did not parse) | 2351/4188 = 56.1% | 2378/4188 = 56.8% |
| flashattention-2205.14135 | 3472/9242 = 37.6% | 3472/9242 = 37.6% | 3704/9242 = 40.1% |
| gpt3-longform-singlecol | 3325/7114 = 46.7% | 3325/7114 = 46.7% | 3333/7114 = 46.9% |
| maskrcnn-1703.06870 | (did not parse) | 1721/3185 = 54.0% | 1724/3185 = 54.1% |
| neural-odes-mathheavy | 2647/4683 = 56.5% | 2647/4683 = 56.5% | 2637/4683 = 56.3% |
| pdf-to-tree-acl2col | 1377/1929 = 71.4% | 1377/1929 = 71.4% | 1384/1929 = 71.7% |
| resnet-cvpr-2col | 1593/2784 = 57.2% | 1593/2784 = 57.2% | 1604/2784 = 57.6% |
| sbert-1908.10084 | 1340/1862 = 72.0% | 1340/1862 = 72.0% | 1340/1862 = 72.0% |
| superglue-tableheavy | 1400/2079 = 67.3% | 1400/2079 = 67.3% | 1400/2079 = 67.3% |
| yolo-1506.02640 | 1229/2023 = 60.8% | 1229/2023 = 60.8% | 1229/2023 = 60.8% |


## 5. Determinism and memory

**Determinism: every corpus and fresh paper parsed 20 times in one process, canonical serialisation (`canonical_json_for_determinism`, `parsed_at` excluded) and block-id sequence compared.** Load at start: branch 1 7.9/12.1/12.2, branch 2 8.0/12.2/12.2.

| paper | branch 1: distinct outputs / id sequences in 20 runs | branch 2: distinct outputs / id sequences in 20 runs |
|---|---|---|
| a3c-algorithmheavy | 1 / 1 | 1 / 1 |
| adam-1412.6980 | 1 / 1 | 1 / 1 |
| attention-is-all-you-need | 1 / 1 | 1 / 1 |
| bert-2col | 1 / 1 | 1 / 1 |
| ddpm-2006.11239 | 1 / 1 | 1 / 1 |
| flashattention-2205.14135 | 1 / 1 | 1 / 1 |
| gpt3-longform-singlecol | 1 / 1 | 1 / 1 |
| maskrcnn-1703.06870 | 1 / 1 | 1 / 1 |
| neural-odes-mathheavy | 1 / 1 | 1 / 1 |
| pdf-to-tree-acl2col | 1 / 1 | 1 / 1 |
| resnet-cvpr-2col | 1 / 1 | 1 / 1 |
| sbert-1908.10084 | 1 / 1 | 1 / 1 |
| superglue-tableheavy | 1 / 1 | 1 / 1 |
| yolo-1506.02640 | 1 / 1 | 1 / 1 |

**Peak RSS, gpt3 (75 pages, the largest paper), interleaved fresh subprocesses, `/usr/bin/time -l`:**

| trial | branch 1 MB | 1-min load | branch 2 MB | 1-min load |
|---|---|---|---|---|
| 1 | 510.9 | 7.92 | 519.7 | 7.70 |
| 2 | 513.1 | 7.74 | 514.3 | 7.88 |
| 3 | 511.0 | 8.07 | 515.0 | 9.23 |
| 4 | 510.7 | 10.44 | 515.3 | 11.28 |
| 5 | 515.2 | 11.96 | 511.7 | 17.46 |

The per-paper RSS column of Table A was taken in one pass, at 1-minute loads of 9.2 to 24.8.
In that pass gpt3 read 516.3 (base), 511.3 (branch 1) and 523.5 MB (branch 2, load 16.1).

## 6. The two golds disagree about what a paragraph is, and what that decides

- **The repo gold** boxes runs of printed paragraphs as ONE `paragraph` region on the pages where
  splitting "regresses" it. Examples, each shown on the page image:
  - resnet p2: three boxes, each holding three printed, indented paragraphs;
  - attention p3: 2 + 2;
  - bert p6: 3 and 2;
  - gpt3 p30: seven in one box.

  Crops: `hard-cases/repo-gold-multi-paragraph-{resnet-p2,attention-p3,bert-p6,gpt3-p30}.png`
  and `gpt3-p30-multi-paragraph-gold-box.png`.
- **The fresh gold** defines a paragraph as the printed paragraph.
- **No output satisfies both.** A parser that emits the printed paragraphs matches none of those
  multi-paragraph boxes at IoU 0.5, so paragraph F1 falls on all six corpus papers and their
  correctly ordered pairs leave the pooled denominator (resnet 116 → 85 pairs). Merge-rule
  items 2 and 4 then pull in opposite directions.
- **What branch 2 does.** It follows the fresh gold and the printed page, because the user-visible
  defect is a highlight or citation covering several paragraphs.
- **What the owner can do.** The owner can rule for the repo gold's convention instead. The rule
  is commit `f7d7f45`, and `9cf0c99` / `d425330` sit on top of it and do not need it in code.
  Reverting only `f7d7f45` restores the merged paragraphs (fresh 10 → 58), gives up its caption
  gains (§3), and needs its pins re-derived.
- **The two per-paper merge-rule misses, exactly:**
  - gpt3 macro-F1 is 0.0013 below base, from paragraph F1 0.190 → 0.174. Gold p30's
    seven-paragraph box is the clearest case.
  - resnet pooled order sits at 0.906 (77/85) against 0.932 (96/103). Its 8 discordant pairs
    are: gold p0 footnote r#3 vs a figure; gold p2 footnote r#11 (given a body `reading_order`,
    against ANNOTATION_GUIDE rule 1) vs an equation, a heading and a paragraph; and four p7 pairs
    against r#14. r#14 is a second box around Figure 6, drawn after the page's text, while that
    figure's panels r#0-r#2 are read first
    (`hard-cases/resnet-p7-duplicate-figure-box.png`, `resnet-p2-footnote-given-body-order.png`).
  - On the normalised gold, where footnotes are out of the order as the guide says, resnet is
    69/73 = 0.945 against base 87/89 = 0.978: the same duplicate figure box.

## 7. Hard cases: where a metric regresses or stays bad

- **Where the crops are.** All crops are in the S2 evidence folder under `hard-cases/`. None is
  committed (ANNOTATION_GUIDE §2).
- **How they are drawn.** Each is a 130 dpi page with every branch-2 block boxed and labelled by
  type, in reading order.

| paper, page (0-based) | what is wrong | crop |
|---|---|---|
| YOLO p5, p6 | tables: Table 1 split into two regions, its header row and last row left outside as `paragraph`/`unknown`; a pie-chart label `YOLO` typed `heading`; the bullet lines beside the figure | `yolo-p5-tables.png`, `yolo-p6-tables.png` |
| YOLO p0 | 2 blocks still hold 2 gold paragraphs each: the abstract's two paragraphs, and "We reframe ..." + "YOLO is refreshingly simple ..." | `yolo-p0-two-merged-blocks.png` |
| SBERT p1, Adam p1, Mask R-CNN p1 | one block holding two gold paragraphs each. Mask R-CNN: "We have released code to facilitate future research." is a ONE-line indented paragraph. Its only line is short, so the full-line requirement holds it back, and its extra gap (2.9 pt, 0.29 em) is under the 0.4 em skip. SBERT and Adam: not diagnosed | `sbert-p1-merged-paragraphs.png`, `adam-p1-merged-paragraphs.png`, `maskrcnn-p1-merged-paragraphs.png` |
| ResNet p4 | Table 1's architecture cells carry 48 private-use glyphs (the bracketed stage matrices) | `resnet-p4-table1-private-use-glyphs.png` |
| ResNet p5 | run-in heads ("Deeper Bottleneck Architectures.") are paragraph leads, correctly, but the tables beside them are split and their values leak into the body | `resnet-p5-run-in-heads-and-tables.png` |
| ResNet p7 | a vector plot detected as a `table`; gold's duplicate Figure 6 box | `resnet-p7-duplicate-figure-box.png` |
| ResNet p2 | gold footnote r#11 carries a body `reading_order` (gold defect; the pre-existing discordant pairs) | `resnet-p2-footnote-given-body-order.png` |
| Attention p12-p14 | attention-visualisation pages: word columns inside rasters and vector art, stamping 0 % for text inside figures; p14's caption is typed `figure` in the raw gold | `attention-p12-visualisation.png`, `attention-p14-caption-typed-figure-in-gold.png` |
| neural-odes | 26 spans with role `undecodable_glyphs`, unchanged from base (no rule here touches glyph decoding); the spans sit on p12 (10) and p15 (16) | `neural-odes-p12-undecodable-glyphs.png`, `neural-odes-p15-undecodable-glyphs.png` |
| neural-odes p13 | `z(t)`, a fragment of an equation, is still a false heading | `neural-odes-p13-false-heading-zt.png` |
| pdf-to-tree p0 | Figure 1's caption tail is split off: MuPDF returns "to confusion." and "Additionally, ..." as two lines on one baseline, and `_same_block` reads the 63 pt offset as an indent. It is typed `paragraph` and is now the target of one FALSE `continues_in_next_column` | `pdf-to-tree-p0-caption-tail.png` |
| SBERT p7 (and elsewhere) | the same same-baseline fragment defect: "(SBERT).", "SBERT", "fine-tunes" are separate blocks after a correctly split paragraph start. An earlier left-to-right re-join measured 60 worse / 20 better and was reverted | `sbert-p7-same-baseline-fragments.png` |
| DDPM p9 (every hanging-indent bibliography) | a reference entry is cut after its first line: a 20 pt hanging indent exceeds `_same_block`'s line gap (pre-existing). Now that entries split from each other, the second line is its own `reference_entry`, and 7 author-year markers no longer resolve (neural-odes, pdf-to-tree) | `ddpm-p9-reference-entries-cut.png` |
| DDPM p0 | the NeurIPS venue line is swallowed by the raster's padded placement box (the caption is recovered; telling padding from pixels needs the image) | `ddpm-p0-venue-line-swallowed.png` |
| BERT p6 (and flashattention p7, pdf-to-tree p6, sbert p6) | text beside a table in the other column is in no block: `4.4 SWAG` (the dropped claim fix, §3.1; strict xfail) | `bert-p6-text-beside-table-lost.png` |
| BERT p11 | the supplement's title and its contents note are swept into the bibliography (2 blocks typed `reference_entry`) | `bert-p11-supplement-in-bibliography.png` |
| Mask R-CNN p7 | Table 4's caption block starts with the table value `57.8` and is typed `paragraph` | `maskrcnn-p7-table-value-in-caption.png` |
| gpt3 p30 | seven printed paragraphs in one gold box (§6) | `gpt3-p30-multi-paragraph-gold-box.png` |
| DDPM p0-p1, FlashAttention p0 (fresh gold) | "1 Introduction" (and DDPM's "2 Background") cannot be matched: the section number is typed `page_number` and read in another flow, apart from its title. Fresh headings 1/3 and 1/2 | `ddpm-p0-venue-line-swallowed.png` (the boxed `1`) |
| every paper | 11 of 36 repo-gold pages still score no reading-order pair (the zero-pair count did not move) | - |

## 8. RegionModel probe (pymupdf-layout): deferred, not built in this slice

- **Deferred as instructed.** The slice was told not to build it here. The architecture judge's
  measurements stand:
  - `pymupdf-layout` peaked at **844 MB max RSS on YOLO** (`to_json` + `to_markdown`, 5.7 s
    convert at load ~12), against the **520 MB** ratchet the heuristic parser is held to;
  - the **typed hybrid still mistyped 6 YOLO body paragraphs** (typed `abstract`/`caption`,
    inheriting the shipped abstract spill);
  - C's fresh-gold "0 mistyped" row is the UNTYPED hybrid, and its repo-gold macro-F1 0.352 row
    is the TYPED hybrid, so no single measured variant has both.
- **Adopt rule (slice-plan §S2), unchanged.** Adopt only if all of these hold:
  - merged plus mistyped units on fresh pp1-2 are at most 50 % of the heuristic branch's;
  - no per-type F1 drop above 0.05 on heading, paragraph, caption, table or figure;
  - determinism holds, 20 runs on 2 machines;
  - peak RSS is under an owner-approved bar.
- **The heuristic branch's numbers for that comparison:** 10 merged + 0 mistyped = 10 units, so
  a probe would have to reach 5 or fewer, at a peak RSS the owner signs off (ADR §10 question 2).
- **Where it would go.** `research/benchmarks/probes/region-model/`, outside every workspace and
  `uv.lock`.

## 9. Open problems and owner decisions

- **Owner (#54):** review the fresh gold. Its three open rulings are `cont` after a display
  equation (both readings are reported), front-unit granularity, and small-caps case (scored
  case-insensitively). Until then items 4 and 1.2's fresh rows are provisional.
- **Owner:** the paragraph convention (§6). Keep `f7d7f45`, following the fresh gold and the
  page, or rule for the repo gold's multi-paragraph boxes.
- **Table extent** (§3.1): text beside a table is lost; the fix needs table-extent detection.
  Strict xfail in `test_parse_quality.py`.
- **Same-baseline fragments** (§7, pdf-to-tree p0, SBERT p7): `_same_block` splits one visual
  line that MuPDF returned in pieces. This is also the root of one false column continuation.
- **Hanging-indent references** (§7): entries are cut after their first line, and 7 author-year
  markers lose their resolution.
- **`layout._CAPTION_START` is case-sensitive** (found in the last commit, not changed): a real
  `Figure 1:` line never opens its own block or the caption flow at layout time. Captions are
  typed later by `figures.is_caption_line`. Fixing it touches every caption on every paper, so
  it needs its own measured commit.
- **RSS headroom:** branch 2 sits a few MB under the 520 MB ratchet on gpt3 on this loaded box
  (§5). The load-aware skip belongs to S8 (#129).
- **Zero-pair pages:** 11 of 36 repo-gold pages still score no reading-order pair. Nothing here
  moved that count.
