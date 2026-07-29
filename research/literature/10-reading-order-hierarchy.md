# Reading Order Prediction & Hierarchical Document Reconstruction — Technical Evaluation for PaperTree

**Research date:** 2026-07-29. **Most recent primary evidence:** docling release `v2.116.0` (2026-07-29), MinerU push 2026-07-29, Surya `v0.22.1` (2026-07-20), Marker `v2.0.0` (2026-07-20), arXiv:2607.01018 (2026-07-01), arXiv:2606.23344 (2026-06-22), arXiv:2601.07483 (2026-01-12).

**Verdict up front:** for multi-column academic PDFs the evidence favours a **deterministic geometric ordering core** (Docling-style topological sort, or XY-Cut++) over a learned sequence model. The best-known learned model in this space, **LayoutReader, generalises badly off its training distribution** — an independent 2026 evaluation measured it at **25% macro edge accuracy on OmniDocBench multi-column English pages**, *below* plain XY-cut at 75% ([arXiv:2607.01018](https://arxiv.org/abs/2607.01018)) — and the widely-used weights are **CC-BY-NC-SA-4.0**, i.e. unusable commercially. Learned ordering is worth adding only as an optional GPU-tier *re-ranker*, and only from an Apache-2.0 source.

---

## 1. The problem decomposed

PaperTree's "reading order" requirement is really four separable problems. Systems that claim to solve "reading order" usually solve only the first.

1. **Intra-page ordering** — sequence the layout blocks on one page.
2. **Cross-page / cross-column paragraph continuation** — join a paragraph split across a column break or page break.
3. **Furniture stripping** — running headers, footers, page numbers, journal marginalia.
4. **Hierarchy + footnotes** — build a section tree; keep footnotes out of the body stream.

Keeping these separate matters because #1 has good deterministic solutions and #2–#4 are where every open system is visibly weak.

---

## 2. Geometric baselines: XY-cut and its descendants

**Recursive XY-cut (RXYC)** decomposes a page by alternately projecting block bounding boxes onto the x and y axes and cutting at the widest background gap, recursing on each half. The bounding-box (rather than pixel) variant is Ha, Haralick & Phillips, *Recursive X-Y cut using bounding boxes of connected components*, ICDAR 1995 ([record](https://www.researchgate.net/publication/220860850_Recursive_X-Y_cut_using_bounding_boxes_of_connected_components)). It is **fully deterministic, free, ~200 lines, and produces an ordering tree** whose internal nodes are literally column/row regions — a free multi-column boundary inference.

Its failure mode is precise and well documented: it requires a **clean whitespace gutter fully separating the cells to be cut**. A single spanning element (full-width title, figure crossing the gutter, footnote rule) destroys the cut and produces an L-shaped region that RXYC cannot order. On academic two-column pages this fires on almost every page that has a full-width figure.

**Augmented XY-Cut** (XYLayoutLM, CVPR 2022, [arXiv:2203.06947](https://arxiv.org/abs/2203.06947)) randomises cut order during training to generate multiple plausible reading orders as data augmentation. It is a *training* device, not a better inference algorithm; an unofficial implementation exists at [littletomatodonkey/Augment-XY-CUT](https://github.com/littletomatodonkey/Augment-XY-CUT).

**XY-Cut++** ([arXiv:2504.10258](https://arxiv.org/abs/2504.10258), v1 2025-04-14, v3 2026-01-28) is the state of the art among deterministic methods and directly targets the L-shape failure. Three stages: (a) **pre-mask** — temporarily remove "cross-layout" elements wider than β×max-width (β=1.3 in the paper) so they do not block cuts; (b) **multi-granularity segmentation** — adaptive axis choice by content density (τd = 0.9); (c) **cross-modal matching** — reinsert masked elements using label-priority sequences and geometric distance. Self-reported results (authors' own new benchmark, so treat as home-field):

| Method | DocBench-100 BLEU-4 (mean) | complex subset | OmniDocBench BLEU-4 | Throughput (CPU) |
|---|---|---|---|---|
| XY-Cut (baseline) | 0.797 | 0.749 | — | 487 FPS |
| LayoutReader | 0.788 | 0.656 | 0.783 | 22 FPS |
| MinerU | 0.873 | 0.701 | 0.926 | 11 FPS |
| **XY-Cut++** | **0.988** | **0.986** | **0.953** | **514 FPS** |

Throughput measured on an Intel Xeon Gold 6326, ordering module only ([Table 6, arXiv:2504.10258](https://arxiv.org/html/2504.10258v3)). 514 FPS on CPU with no model weights is the single most PaperTree-relevant number in this review.

Reference code is at [liushuai35/PaddleXrc](https://github.com/liushuai35/PaddleXrc) (Apache-2.0) — but that repo is a PaddleX fork, **last pushed 2025-06-10**, i.e. stale. A cleaner path: MinerU has **vendored a simplified XY-Cut++ in ~414 lines of dependency-free Python** at `mineru/model/pptx/xycut_pp_sorter.py`, with constants `DEFAULT_BETA=2.0`, `DEFAULT_DENSITY_THRESHOLD=0.9`, `OVERLAP_THRESHOLD=0.1`, explicitly citing arXiv:2504.10258 and noting it is "a simplified geometric implementation without semantic type priorities."

**Column-boundary inference, done properly:** Breuel's maximal-empty-rectangle whitespace cover (*Two Geometric Algorithms for Layout Analysis*, DAS 2002, [PDF](https://link.springer.com/content/pdf/10.1007/3-540-45869-7_23.pdf)) returns *globally optimal* whitespace rectangles with no heuristics and an evaluation function that "reliably identifies maximal empty rectangles corresponding to column boundaries," in under 100 lines. This is the correct primitive for detecting the gutter explicitly rather than inferring it implicitly.

---

## 3. Learned sequence models

### LayoutReader + ReadingBank

*LayoutReader: Pre-training of Text and Layout for Reading Order Detection*, EMNLP 2021 ([arXiv:2108.11591](https://arxiv.org/abs/2108.11591)). ReadingBank = 500k pages (400k/50k/50k split, ~196 words/page) mined from **Word XML metadata**. On ReadingBank ([ar5iv Table 2](https://ar5iv.labs.arxiv.org/html/2108.11591)):

| Method | Encoder | Page-level BLEU ↑ | ARD ↓ |
|---|---|---|---|
| Heuristic (raster) | — | 0.6972 | 8.46 |
| LayoutReader (text only) | UniLM | 0.8765 | 10.65 |
| LayoutReader (layout only) | LayoutLM | 0.9732 | 2.31 |
| **LayoutReader (text+layout)** | LayoutLM | **0.9819** | **1.75** |

It also lifts Tesseract from BLEU 0.7532 → 0.9360 (Table 5) and a commercial OCR from 0.8530 → 0.9430 (Table 6). Robustness study (Table 3) shows the layout-only variant is near-invariant to input shuffling (BLEU 0.9701 at r=100% shuffle) while text-only collapses to 0.3355.

**Two decisive caveats.**

1. **Distribution.** ReadingBank is Word documents — overwhelmingly single-column business prose. The 2026 independent study measured LayoutReader on the **OmniDocBench multi-column English subset (140 pages)** at **25% macro edge accuracy**, versus 75% for XY-cut and 88% for their training-free graph method; LayoutReader also shifted by **up to 8 percentage points** under mirror-flip of the page, versus <1 point for the graph method ([arXiv:2607.01018](https://arxiv.org/abs/2607.01018), 2026-07-01). XY-Cut++'s own table independently puts LayoutReader *below* plain XY-cut on complex layouts (0.656 vs 0.749 BLEU-4).
2. **Licence.** ReadingBank's repo carries Apache-2.0 but the README states "**Our data can only be used for research purpose. Please DO NOT re-distribute our data**" ([doc-analysis/ReadingBank](https://github.com/doc-analysis/ReadingBank)) — an internal contradiction. The de-facto weights everyone uses, [`hantian/layoutreader`](https://huggingface.co/hantian/layoutreader) (LayoutLMv3, 0.4B params, ~400 MB BF16), are **CC-BY-NC-SA-4.0 — non-commercial. Hard block for PaperTree.** MinerU used to ship this and has since removed it.

### PP-DocLayoutV2 (PaddleOCR) — the Apache-2.0 learned option

RT-DETR detector + a **6-layer transformer pointer network** trained separately (detector frozen), decoded with a "deterministic win-accumulation" algorithm ([arXiv:2510.14528](https://arxiv.org/html/2510.14528v1)). Reported **reading-order edit distance 0.043 on OmniDocBench v1.5**, and 0.045 EN / 0.063 ZH on v1.0. Layout mAP@0.5 = **81.4%**, model size **203.8 MB**, end-to-end 25.82 ms with onnxruntime ([PaddleOCR docs](https://www.paddleocr.ai/main/en/version3.x/module_usage/layout_analysis.html)). **Weights Apache-2.0** ([HF card](https://huggingface.co/PaddlePaddle/PP-DocLayoutV2)); PaddleOCR code Apache-2.0, pushed 2026-07-22. All figures vendor-reported. This is what MinerU ≥3.x now uses for both layout and ordering.

A successor, **RT-DocLayout** (33M params, 132.1 FPS, [arXiv:2606.23344](https://arxiv.org/abs/2606.23344), 2026-06-22), unifies detection + segmentation + reading order in one RT-DETR decoder — same author group. No weights or licence announced yet.

### Surya's order head

Surya 2 ships an autoregressive reading-order head (`surya/common/order/order_ar.py`): box tokens cross-attend to the RF-DETR encoder feature map, an AR decoder emits a permutation over a **deterministic y-banded raster canonical order**, with **constrained greedy decode so every box appears once and none are invented** — a genuinely good anti-hallucination property. `MAX_BOXES = 128`, 19-class taxonomy including `Page-Header`, `Page-Footer`, `Footnote`, `Equation-Block`, `Caption`. Code **Apache-2.0**; **weights are a modified AI Pubs Open RAIL-M** whose Attachment A bars use if you or your employer exceed **$5M gross revenue *or* $5M raised**, and — critically — **bars use "if You … provide[] or otherwise make[] available any product or service that competes with any product or service offered by … Licensor"** ([MODEL_LICENSE](https://github.com/datalab-to/surya/blob/master/MODEL_LICENSE)). Datalab sells document parsing. **Treat Surya and Marker weights as unavailable to PaperTree.** Marker is the same story: code Apache-2.0 (`v2.0.0`, 2026-07-20), weights OpenRAIL-M.

### FocalOrder (2026)

[arXiv:2601.07483](https://arxiv.org/html/2601.07483), 2026-01-12. LayoutLMv3-large backbone, **0.4B params, 12.3 ms inference**. Best published reading-order edit distance on OmniDocBench v1.0: **0.038 EN / 0.055 ZH**, beating dots.ocr (0.040/0.067), PaddleOCR-VL (0.045/0.063) and MinerU 2.5 (0.045/0.068). On Comp-HRDoc REDS it reaches 97.1 (text) / 91.1 (graphical) vs UniHDSA-R50 96.7/91.0. **No code or weights released as of this review** — not actionable.

Its Table 2 is the most useful cross-system comparison available, and contains one number PaperTree should notice: **Docling scored 0.313 EN / 0.837 ZH reading-order edit distance** — worst of all pipeline tools except OpenParse — while PP-StructureV3 scored 0.069/0.091 and MinerU 0.079/0.292. (Staleness caveat: this reflects a Docling snapshot from before 2026-01; Docling's rule-based predictor has changed since, and Docling is absent from the current OmniDocBench leaderboard, so I could not re-verify.)

---

## 4. Docling's rule-based predictor — read it, it is the best-documented deterministic design

Docling's ordering lives in `docling_ibm_models/reading_order/reading_order_rb.py` (MIT, [docling-ibm-models](https://github.com/docling-project/docling-ibm-models), `v3.13.3`), driven by `docling/models/stages/reading_order/readingorder_model.py`. It is **pure Python, no weights, fully deterministic**. Per page:

1. Convert every element to bottom-left origin; build `h2i` index maps.
2. Build a left-to-right map (`_init_l2r_map`) — **note this is currently dead code**, guarded by a literal `if False` with the comment *"this currently leads to errors … might be necessary in the future."*
3. Build up/down maps via an **R-tree** query, adding edge i→j when i is strictly above j and horizontally overlapping, *unless* `_has_sequence_interruption` finds a third block w between them.
4. **Horizontal dilation**: widen each block toward its up/down neighbour, but only if the widening is ≤ `0.15 × page_width`, and only if the dilated box hits nothing else. Then rebuild the up/down maps. This is the multi-column trick — it lets a narrow line inherit its column's extent.
5. Find heads (no up-edge), sort them by a `__lt__` that prefers *higher* when horizontally overlapping and *left* otherwise, then DFS to a linear order.

Headers and footers are **not stripped** — they are partitioned out per page and re-emitted as a block before / after the body, and downstream tagged into `ContentLayer.FURNITURE` so Markdown suppresses them. Detection therefore depends entirely on the layout model emitting `PAGE_HEADER` / `PAGE_FOOTER`; there is **no cross-page repetition check**. This gap is live: docling issue [#2037](https://github.com/docling-project/docling/issues/2037) ("How to detect and remove repeated headers/footers from PDF pages?") was opened 2025-08-05 and is **still open at 2026-05-01 with 7 comments**.

**Cross-page paragraph continuation** is `predict_merges()` and it is refreshingly simple: walk the sorted stream; for a `TEXT` block, skip over header/footer/table/picture/caption/footnote, and merge with the next `TEXT` block iff it is on a **different page or strictly to the right**, AND the previous text matches `.+([a-z,\-­])(\s*)` AND the next matches `(\s*[a-zA-ZÀ-ɏ])(.+)`. Hyphen/soft-hyphen joins drop the last character; otherwise a space is inserted. The source carries two `TODO`s admitting the `orig` field is not correctly reconstructed on merge.

**Footnotes** are only linked when they immediately follow a `TABLE` or `PICTURE` (`_find_to_footnotes`). Body footnotes are emitted as free-standing `FOOTNOTE` items with no marker resolution. **Captions** use a nearest-preceding/nearest-following disambiguation with a greedy one-to-one assignment (`_remove_overlapping_indexes`).

Layout comes from RT-DETRv2 checkpoints, e.g. [`ds4sd/docling-layout-heron`](https://huggingface.co/ds4sd/docling-layout-heron) — **Apache-2.0 weights, 42.9M params**; heron-101 reports **78% mAP at 28 ms/image on an A100** ([arXiv:2509.11720](https://arxiv.org/abs/2509.11720)). Docling code is MIT, `v2.116.0` released 2026-07-29 (weekly cadence), 958 open issues.

**MinerU** by contrast does paragraph merging in `mineru/backend/pipeline/para_split.py` with a different rule family: `LINE_STOP_FLAG` sentence-terminator set, first-line-indent detection (`first_line.bbox[0] - block.bbox_fs[0] > line_height/2`), explicit `block1['page_num'] != block2['page_num']` cross-page branches, and list-group handling. MinerU code is **Apache-2.0 plus additional commercial thresholds** (separate licence required above **100M MAU or $20M monthly revenue**, plus a mandatory attribution obligation for online services — [LICENSE.md](https://github.com/opendatalab/MinerU/blob/master/LICENSE.md)). Those thresholds are irrelevant to PaperTree in practice; the attribution obligation is not.

**Marker** builds the section tree by **KMeans (k=4) over section-header line heights across the whole document** (`marker/processors/sectionheader.py`), then assigns `heading_level` by bucket. This is a stability hazard: heading levels are a *document-global* function, so re-parsing with one extra page can silently re-level every heading. Its `PageHeaderProcessor` merely moves `PageHeader` blocks to the top of each page — again no de-duplication.

---

## 5. Graph and hierarchy approaches

- **Doc2Graph** ([arXiv:2208.11168](https://arxiv.org/abs/2208.11168), TiE@ECCV 2022, [code](https://github.com/andreagemelli/doc2graph)) — GNN over document entities, node classification + edge classification. Aimed at forms/invoices (FUNSD, RVL-CDIP invoices), not reading order on papers. Useful as an architecture template only.
- **gDSA / GraphDoc** ([arXiv:2502.02501](https://arxiv.org/abs/2502.02501), ICLR 2025) — reframes structure analysis as relation-graph generation; **80K images, 4.13M relation annotations**; baseline DRGG hits **57.6% mAP_g@0.5**. Repo [yufanchen96/GraphDoc](https://github.com/yufanchen96/GraphDoc) is MIT but states "**Code and Implementation details will come soon!**" with 6 commits — **not usable**.
- **Detect-Order-Construct** ([arXiv:2401.11874](https://arxiv.org/abs/2401.11874), Pattern Recognition 2024, Microsoft) — the cleanest formulation of PaperTree's actual need: Detect page objects → Order (reading order = pre-order traversal of the structure tree) → Construct hierarchy (TOC-style). Introduced **Comp-HRDoc**. SOTA on PubLayNet, DocLayNet, HRDoc.
- **UniHDSA** ([arXiv:2503.15893](https://arxiv.org/html/2503.15893v1)) — unifies all subtasks as relation prediction in a shared label space, two stages (page-level, document-level incl. **cross-page grouping** and TOC extraction). REDS 96.7/91.0 on Comp-HRDoc. Benchmark code at `github.com/microsoft/CompHRDoc`; **model code/licence not confirmed**.
- **DocParser** ([arXiv:1911.01702](https://arxiv.org/abs/1911.01702), AAAI 2021) — earliest end-to-end hierarchical structure parser incl. nested tables/figures, with a weak-supervision framework for scarce domain data. Superseded on accuracy but still the reference for the *output schema* PaperTree needs.
- **Training-free graph + LM scoring** ([arXiv:2607.01018](https://arxiv.org/abs/2607.01018), 2026-07-01) — OCR lines as nodes, edges scored by causal-LM and BERT next-sentence-prediction signals, order recovered as a **directed path cover with max-regret inference**. 88% macro edge accuracy on OmniDocBench multi-column vs XY-cut 75%, LayoutReader 25%; 95% successor edges on wrap-around Glossa layouts vs 50%. **No training, no fine-tuned weights** — the most licence-friendly *learned-signal* approach in the review, though it needs an LM at inference and code availability is unconfirmed.

---

## 6. Comparison

| System | Ordering mechanism | Deterministic | Code licence | Weight licence | Best reading-order number | Cost profile |
|---|---|---|---|---|---|---|
| Recursive XY-cut | Projection-profile recursion | ✅ | n/a (algorithm) | n/a | 0.797 BLEU-4 DocBench-100; 75% edge acc. OmniDocBench multi-col | free, CPU, ~487 FPS |
| **XY-Cut++** | Pre-mask + adaptive cut + rematch | ✅ | Apache-2.0 (ref repo stale; MinerU vendored copy) | none needed | **0.988 BLEU-4** (self-reported, own benchmark); 0.953 OmniDocBench | free, CPU, **514 FPS** |
| **Docling `reading_order_rb`** | R-tree up/down graph + dilation + DFS | ✅ | **MIT** | n/a (weights only for layout: **Apache-2.0**) | 0.313 EN edit dist. (stale, poor) | free, CPU |
| LayoutReader | LayoutLM seq2seq | ❌ | MIT (unilm) | **CC-BY-NC-SA-4.0** (`hantian/layoutreader`) ❌ | 0.9819 BLEU in-domain; **25% out-of-domain** | 0.4B, 22 FPS |
| PP-DocLayoutV2 | RT-DETR + 6-layer pointer net | ❌ (but deterministic decode) | Apache-2.0 | **Apache-2.0** ✅ | **0.043** edit dist. OmniDocBench v1.5 (vendor) | 203.8 MB, 25.8 ms ONNX |
| Surya 2 order head | AR head over RF-DETR features, constrained decode | ❌ | Apache-2.0 | **OpenRAIL-M, $5M cap + non-compete** ❌ | 83.3% olmOCR-bench overall (not order-specific) | GPU; 5.35 pg/s on RTX 5090 |
| Marker | Surya blocks + KMeans heading levels | partial | Apache-2.0 | **OpenRAIL-M** ❌ | 0.243 edit dist. (OmniDocBench leaderboard) | GPU |
| MinerU (pipeline) | PP-DocLayoutV2 + `para_split` rules | ❌ | Apache-2.0 **+ commercial thresholds** | mixed | 0.120 (MinerU2.5-Pro, leaderboard) | 4 GB VRAM min for pipeline |
| FocalOrder | LayoutLMv3-large + focal preference opt. | ❌ | **unreleased** | unreleased | **0.038 EN** OmniDocBench v1.0 | 0.4B, 12.3 ms |
| GROBID | CRF cascade, academic-specific | ✅ (CRF, fixed weights) | **Apache-2.0**, models Apache-2.0, data CC-BY | Apache-2.0 ✅ | ~0.87 F1 reference parsing (not order) | CPU, JVM |

---

## 7. Implications for PaperTree

**Recommended stack (confidence: medium-high on the ordering core, medium on hierarchy, low-medium on furniture/footnotes).**

**Tier 0 — deterministic core, ships first, no GPU.**
1. Layout blocks from an **Apache-2.0 detector** (`ds4sd/docling-layout-heron`, 42.9M params, or PP-DocLayoutV2 ONNX at 25.8 ms/page). Both give page + bbox for every element, satisfying the geometry requirement.
2. Order blocks with **XY-Cut++ reimplemented from MinerU's 414-line vendored version** (arXiv:2504.10258 is the spec; the code is dependency-free geometry). Fall back to **Docling's R-tree up/down + 0.15×page-width dilation + DFS** when XY-Cut++ produces an unstable cut. Run both; **disagreement between the two deterministic orderers is your uncertainty signal** — surface it rather than hiding it. This directly satisfies "uncertainty must be representable."
3. Detect column gutters explicitly with **Breuel maximal-empty-rectangle whitespace cover** and store the gutter x-range per page. It is cheap, optimal, and gives you a debuggable artefact when ordering goes wrong.

**Tier 1 — the plumbing everyone under-builds. Budget real time here.**
4. **Furniture stripping:** do *not* rely on the layout model's `page-header`/`page-footer` classes alone — Docling's own tracker shows this is insufficient (issue #2037, open ~9 months). Add the classic **page-association** pass (Lin, SPIE DRR 2003, [record](https://www.spiedigitallibrary.org/conference-proceedings-of-spie/5010/1/Header-and-footer-extraction-by-page-association/10.1117/12.472833.short)): cluster top/bottom-N lines across pages by normalised position + font + fuzzy string similarity, and mark a band as furniture when it repeats on ≥ ~60% of pages, with the page-number digit run normalised away before comparison. Keep the stripped blocks with their bboxes in a `furniture` layer — never delete, so highlights over them still resolve.
5. **Cross-page continuation:** start from Docling's `predict_merges` rule (trailing `[a-z,\-­]` + leading letter + different page or strictly-left-of) and add MinerU's first-line-indent test (`x0 - block_x0 > line_height/2` ⇒ new paragraph) plus a sentence-terminator stop-list. Crucially, **model the join as a link, not a concatenation**: keep the two source blocks with their own page+bbox and expose a logical paragraph that references both. Concatenating destroys the geometry PaperTree needs.
6. **Footnotes:** the layout taxonomies you will use already have a `Footnote` class (Surya's 19-class list, DocLayNet). Route footnotes to a sibling stream, not the body. Resolving inline markers to footnote bodies is unsolved in every open system reviewed — plan a superscript-glyph + numeric-prefix matcher of your own.

**Tier 2 — hierarchy.**
7. Build the section tree the **Detect-Order-Construct** way — reading order as a pre-order traversal of a tree, hierarchy as an explicit Construct stage — rather than Marker's document-global KMeans on line heights, which is unstable across re-parses and will break highlight anchoring. Derive levels from **numbering patterns first** (`3.`, `3.1`, `IV.`, `Appendix A`), font-size clusters second, and record which signal fired.
8. For arXiv-style papers specifically, **GROBID** (Apache-2.0 code *and* models, CC-BY data, PDF coordinates for extracted structures) is the only mature academic-specific hierarchy extractor with a clean commercial licence. Use it as a **cross-check oracle** on the section tree and bibliography, not as the primary parser.

**Tier 3 — optional GPU worker.** If ordering error becomes the top complaint, add **PP-DocLayoutV2's pointer network** (Apache-2.0 weights, 0.043 OmniDocBench v1.5) as a re-ranker over the deterministic candidate order — never as a generator. **Do not adopt LayoutReader** (non-commercial weights, out-of-distribution collapse) and **do not adopt Surya/Marker weights** (OpenRAIL-M non-compete clause aimed squarely at products like PaperTree).

**On block identity:** none of these systems provides stable IDs across re-parses. Docling uses ephemeral integer `cid`s; Marker uses `page/blocktype/index`. PaperTree must mint its own content-addressed IDs — e.g. hash of (page, quantised bbox, normalised text prefix) with fuzzy re-anchoring — regardless of which parser is chosen. This is PaperTree-side work in every scenario.

---

## 8. What I could not verify

- **XY-Cut++'s headline 0.988 BLEU-4 is on DocBench-100, a benchmark the same authors introduced in the same paper.** I found no third-party reproduction. Its OmniDocBench figure (0.953) is more trustworthy but still author-run. I did not run either.
- **Docling's 0.313 EN reading-order edit distance** comes from FocalOrder's Table 2 (arXiv:2601.07483, Jan 2026), which in turn cites the OmniDocBench v1.0 leaderboard. Docling is **not** on the current OmniDocBench leaderboard, so I could not confirm whether the number reflects the current `reading_order_rb` implementation. Treat it as directionally negative but possibly stale.
- I confirmed FocalOrder's Table 2 values match OmniDocBench's reading-order column by pattern, but **I did not independently confirm the table caption says "reading order"** rather than overall edit distance. Verify before quoting externally.
- **PP-DocLayoutV2's reading-order numbers are entirely PaddlePaddle-reported**, and I found no ablation isolating the pointer network against XY-cut on the same detector output. The PaddleOCR docs table lists CPU/GPU inference time for PP-DocLayoutV2 as dashes.
- **GraphDoc/gDSA code and weights are not released** (repo says "coming soon", 6 commits); the DRGG 57.6% mAP_g@0.5 figure is from the paper only. **FocalOrder makes no code-release statement.** **UniHDSA's model code and licence are unconfirmed** — only the Comp-HRDoc benchmark repo is referenced.
- **arXiv:2607.01018's code availability and licence are unstated**; I could not find a repo. Its 25%-for-LayoutReader figure is from a single group on 140 pages and deserves replication before being treated as definitive, though it is directionally consistent with XY-Cut++'s independent finding.
- **RT-DocLayout (arXiv:2606.23344)** reports 33M params / 132.1 FPS but I could not retrieve its reading-order metrics, weights, or licence.
- I could not extract the LayoutReader **parameter count or max sequence length** from the paper (the ar5iv render omits them); training was 3 epochs / ~6 h on 4×V100.
- I did not verify **GROBID's latest release version/date** — the GitHub API returned no data for `kermitt2/grobid` on two attempts (likely a rename or transient failure), so its maintenance status is asserted from documentation only.
- **No system reviewed handles vector-figure extraction or LaTeX-recoverable equations as part of reading order** — those are orthogonal to this topic and are covered in the other reports in this series. I have not verified any claim about them here.
- All latency/throughput figures are vendor- or author-reported on their own hardware. **I benchmarked nothing.**
