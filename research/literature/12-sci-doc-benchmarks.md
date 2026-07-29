# 12 — Scientific Document Understanding: Benchmarks & Datasets

**Research date:** 2026-07-29. Most recent primary evidence found: OmniDocBench README update dated **2026/07/27** (two days before writing); Dr.DocBench arXiv submission **2026-05-31**; SciEGQA v2 **2026-03-30**.

**Purpose:** decide (a) which public benchmarks PaperTree should measure itself against, (b) which annotation corpora PaperTree can *reuse* rather than hand-build, and (c) what methodology PaperTree's own benchmark should copy.

**The framing that matters:** almost every benchmark in this space evaluates *serialised text output* (markdown/LaTeX strings). PaperTree's product depends on *geometry* — page number + bbox per block, stable block IDs, section tree, caption↔figure links. Only a small subset of these datasets carries geometry, and that subset is the only part PaperTree can reuse directly. Everything else is a text-quality regression suite at best.

---

## 1. Comparison table

| Dataset | What it measures | Size | Geometry in annotations? | Code licence | Data licence | Commercial-safe? |
|---|---|---|---|---|---|---|
| [OmniDocBench](https://github.com/opendatalab/OmniDocBench) | End-to-end PDF→markdown parsing, per doc-type & per-attribute | 1,651 pages, 10 doc types (v1.6); 981 pages in v1 paper | **Yes** — polygon bbox per block, reading order | Apache-2.0 | **Research-only, no commercial use** | ❌ data |
| [olmOCR-Bench](https://huggingface.co/datasets/allenai/olmOCR-bench) | OCR/markdown fidelity as pass/fail unit tests | 1,403 PDFs, 7,010 tests | **No** (assertions are text predicates) | Apache-2.0 | ODC-BY-1.0 | ✅ |
| [Dr.DocBench](https://arxiv.org/abs/2606.01393) | "Expert-level / difficult" parsing, long docs | 4,514 pages / 312 PDFs, 70k+ annotations, 21 block categories | **Yes** — bbox, category, reading order, structural relations | n/a (no repo found) | **CC0-1.0** (annotations, per paper) | ✅ if confirmed |
| [DocLayNet](https://github.com/DS4SD/DocLayNet) / [v1.2](https://huggingface.co/datasets/docling-project/DocLayNet-v1.2) | Layout segmentation (11 classes) | 80,863 human-annotated pages | **Yes** — COCO bbox; v1.2 adds embedded PDFs + `pdf_cells` in PDF coords | Apache-2.0 (tooling) | **CDLA-Permissive-1.0** | ✅ |
| [PubLayNet](https://github.com/ibm-aur-nlp/PubLayNet) | Layout detection, auto-derived | large (count unverified) | **Yes** — COCO bbox | — | annotations CDLA-Permissive-1.0; **images under PMC OA terms** | ✅ w/ care |
| [PubTabNet](https://github.com/ibm-aur-nlp/PubTabNet) | Table structure→HTML (origin of TEDS) | 568k+ table images | Table region boxes | — | CDLA-Permissive-1.0 (+PMC OA for images) | ✅ w/ care |
| [GROTOAP2](https://repod.icm.edu.pl/dataset.xhtml?persistentId=doi:10.18150/8527338) | Zone labelling of scholarly PDFs (22 labels) | 13,210 docs / 119,334 pages / 1,640,973 zones | **Yes** — zone geometry (TrueViz XML) | — | CC-BY (secondary source) | ✅ likely |
| [QASPER](https://huggingface.co/datasets/allenai/qasper) | QA over full papers **with evidence selection** | 5,049 Q / 1,585 NLP papers | **No** — evidence = paragraph/figure/table IDs in parsed text | Apache-2.0 (baseline) | **CC BY 4.0** | ✅ |
| [SciEGQA](https://arxiv.org/abs/2511.15090) (was *BBox-DocVQA*) | QA over sci. docs with **bbox-grounded evidence regions** | 1,623 human QA + >30K auto | **Yes** — bbox per evidence region | — | unverified | ⚠️ |
| [SciFact](https://github.com/allenai/scifact) | Claim verification + rationale sentence selection | ~1.4K claims | No | Apache-2.0 | claims **CC BY 4.0**; corpus ODC-By 1.0 | ✅ |
| [SciCap](https://github.com/tingyaohsu/SciCap) | Scientific figure captioning | 416k+ figures / 290k+ papers | No | — | **CC BY-NC-SA 4.0 — NON-COMMERCIAL** | ❌ |
| [ArXivCap / ArXivQA](https://huggingface.co/datasets/MMInstruction/ArxivQA) | Figure comprehension, GPT-4V-generated MCQ | 6.4M images / 3.9M captions / 572K papers; 100K QA | No | — | **CC-BY-SA-4.0 + OpenAI ToU** | ⚠️ share-alike |
| [SciMMIR](https://github.com/Wusiwei0410/SciMMIR) | Sci. image↔text retrieval, 2-level taxonomy | 537K image-text pairs (arXiv 2023.05–10) | No | unverified | unverified | ⚠️ |
| [ChartQA](https://github.com/vis-nlp/ChartQA) | Chart QA (relaxed accuracy) | 9.6K human + 23.1K machine Q | Bbox annotations shipped in repo | **GPL-3.0** (repo) | GPL-3.0 (repo) | ❌ copyleft |
| [PlotQA](https://github.com/NiteshMethani/PlotQA) | Synthetic plot QA | 224,377 plots / 28.9M QA | No | MIT | CC-BY-4.0 | ✅ |
| [DocVQA](https://arxiv.org/abs/2007.00398) | Document-image QA (ANLS) | 12k+ images / 50k Q | No | — | RRC terms (unverified) | ⚠️ |
| [InfographicVQA](https://arxiv.org/abs/2104.12756) | Infographic QA + arithmetic | 5,485 images / 30,035 Q | No | — | RRC terms (unverified) | ⚠️ |
| [S2ORC](https://github.com/allenai/s2orc) | Corpus (not a benchmark) | 81M+ nodes, 8M+ (2019) → 12M full texts | No | — | **ODC-By 1.0** via S2 API | ✅ |
| [unarXive](https://github.com/IllDepence/unarXive) | Corpus from LaTeX source | 1.9M full texts, 742M LaTeX math spans, 9M fig captions | No (LaTeX, not PDF geometry) | MIT (code) | open subset = permissively-licensed arXiv papers ([Zenodo](https://zenodo.org/records/7752615)) | ✅ subset |

---

## 2. Deep dive: QASPER's evidence-selection metric

QASPER ([Dasigi et al., NAACL 2021](https://aclanthology.org/2021.naacl-main.365/)) is the closest existing analogue to PaperTree's grounding requirement. Questions were written by NLP practitioners who saw **only title and abstract**, then answered by *different* practitioners with access to the full paper, who marked the supporting evidence. That two-stage protocol is why the questions are genuinely information-seeking rather than reading-comprehension paraphrase.

**Evidence-F1** is an F1 over *sets*: the set of paragraphs, figures and tables the system selects versus the reference evidence set, taking the **max over multiple reference annotations** when a question has several annotators. **Answer-F1** is token-level span F1, again max over references, with all four answer types (extractive span, abstractive free-form, yes/no, unanswerable) flattened into comma-separated strings so a single metric covers them. Answer type distribution: extractive ~51.8%, abstractive ~24.2%, yes/no ~13.9%, unanswerable ~10.2%; **55.5% of questions need multi-paragraph evidence and ~13% need a figure or table** ([source](https://ar5iv.labs.arxiv.org/html/2105.03011)).

Reported gap (LED-base over full text, test set): Answer-F1 **32.80** vs human lower bound **60.92**; Evidence-F1 **29.85** vs human **71.62**. The paper's abstract independently states models trail humans "by at least 27 F1 points", which is consistent with the 28.1-point answer gap.

**Two design choices PaperTree should steal:**
1. **Evidence is a first-class, separately-scored output.** A system that gets the answer right by luck scores badly on Evidence-F1. PaperTree should never report a single "QA accuracy" number.
2. **Unanswerable is 10% of the set.** This is the operational form of "uncertainty must be representable" — if the paper doesn't say it, the correct output is *no evidence and no answer*.

**Critical limitation:** QASPER evidence is annotated over **S2ORC-parsed paragraph text, not PDF geometry**. There are no bounding boxes and no page numbers. QASPER can validate PaperTree's *retrieval/grounding logic*, but it cannot validate the geometry pipeline, and QASPER-style evidence cannot be turned into a highlight without a separate text→bbox alignment step.

---

## 3. Deep dive: how OmniDocBench structures per-page-type evaluation

[OmniDocBench](https://arxiv.org/abs/2412.07626) (CVPR 2025) is the methodological template worth copying. Its structure:

**Axis 1 — document type.** The v1 paper reports 981 pages split as: academic papers 129, books 104, exam papers 114, financial reports 81, magazines 97, newspapers 111, notes 116, slides 133, textbooks 96 ([v1 HTML](https://arxiv.org/html/2412.07626v1)). Current release is 1,651 pages over 10 types. Every metric is reported *per type*, which is what exposes that a tool strong on academic literature collapses on handwritten notes.

**Axis 2 — page attributes.** Layout type (single/double/three-column/mixed/complex), language, text background, special issues (fuzzy scan, watermark, coloured background), text rotation. Results are sliced by attribute independently of type.

**Axis 3 — task.** Separate metrics per element class rather than one blended score:
- text blocks → normalised edit distance (plus BLEU/METEOR)
- display formulas → **CDM** ([Character Detection Matching, arXiv:2409.03643](https://arxiv.org/abs/2409.03643) — renders both predicted and GT LaTeX to images and matches characters spatially, so it does not punish semantically-equivalent LaTeX) + edit distance
- tables → **TEDS** + edit distance on HTML
- reading order → normalised edit distance over text components
- layout detection → COCO mAP/mAR

**The matching problem.** Because parsers segment blocks differently from the ground truth, naive alignment penalises correct output. v1 used "Adjacency Search Match" (edit-distance threshold → fuzzy substring match → iteratively merge adjacent paragraphs while edit distance decreases). v1.5 (Sept 2025) added **Hybrid Matching** so a formula can match text, fixing the case where a model emits Unicode maths instead of LaTeX. v1.6 (April 2026) replaced it with **Multi-Granularity Adaptive Matching (MGAM)**, which searches for optimal segmentation granularity *only on the prediction side*, leaving GT untouched to remove matching bias ([README](https://github.com/opendatalab/OmniDocBench)).

**Maintenance:** actively maintained — README updated 2026-07-27 with an EvalScope integration; two substantive dataset+algorithm releases in the past 12 months.

**Licence blocker:** the code is Apache-2.0, but the README states verbatim: *"The dataset is for research purposes only and not for commercial use."* PaperTree may run OmniDocBench internally to compare candidate parsers; it may **not** redistribute the data, ship it in CI artefacts, or use it to train a shipped model.

---

## 4. The 2025–2026 additions worth knowing

- **olmOCR-Bench** ([HF card](https://huggingface.co/datasets/allenai/olmOCR-bench), ODC-BY-1.0). 1,403 PDFs, 7,010 tests across 7 splits: arXiv math 2,927; tables 1,020; multi-column 884; headers/footers 753; old scans 526; old-scans math 458; long tiny text 442. Five predicate types: **text present, text absent, reading order, table cell adjacency, math formula**. The "text absent" class is the interesting one — it tests that headers/footers/page numbers are *suppressed*. Published scores from the [olmOCR README](https://github.com/allenai/olmocr) (vendor-run, self-reported): Chandra OCR 0.1.0 **83.1±0.9**, Infinity-Parser 7B **82.5**, olmOCR v0.4.0 **82.4±1.1**, PaddleOCR-VL **80.0±1.0**, Marker 1.10.1 **76.1±1.1**, DeepSeek-OCR **75.7±1.0**, MinerU 2.5.4 **75.2±1.1**, Mistral OCR API **72.0±1.1**. olmOCR model weights (olmOCR-2-7B-1025-FP8) are **Apache-2.0**; the toolkit needs ≥12GB VRAM.
- **Dr.DocBench** ([arXiv:2606.01393](https://arxiv.org/abs/2606.01393), 2026-05-31). 4,514 annotated pages from 312 PDFs averaging ~100 pages, 21 block categories, 14 languages, annotations released **CC0-1.0** with bounding boxes, categories, transcriptions, reading order and structural relations. If the CC0 release is real and downloadable, this is the single most PaperTree-compatible new asset: permissive licence *and* geometry *and* long documents.
- **SciEGQA** ([arXiv:2511.15090](https://arxiv.org/abs/2511.15090), v2 2026-03-30; originally titled *BBox-DocVQA*). 1,623 human-annotated QA pairs plus >30K auto-generated, over arXiv papers, where **evidence is a semantically-coherent document region with a bounding box** — explicitly positioned as an intermediate granularity between page-level and token-level. This is QASPER's evidence idea plus geometry, i.e. exactly PaperTree's highlight-anchoring contract.
- **Five Years of SciCap** ([arXiv:2512.21789](https://arxiv.org/abs/2512.21789), AI2ASE 2026) — retrospective; useful for framing figure-caption evaluation but does not change SciCap's non-commercial licence.
- **DocLayNet-v2 is proprietary.** IBM's [Docling layout paper](https://arxiv.org/html/2509.11720v1) states its models were trained on post-processed DocLayNet **plus a proprietary DocLayNet-v2 plus WordScape** (~150k pages, 2.3M elements, 17 unified classes). Only v1/v1.2 are public.

---

## 5. What PaperTree can reuse directly

**Reuse with confidence (permissive, has geometry):**
1. **DocLayNet-v1.2** — CDLA-Permissive-1.0, 80,863 pages, and crucially the HF variant embeds the source PDF *and* `pdf_cells` (text with coordinates inside each bbox). This is a ready-made regression set for "does every block have a page number and a correct PDF-coordinate bbox", plus reading-order and 11-class labelling. Its scientific-articles slice covers PaperTree's domain; the other five categories give robustness signal for free.
2. **GROTOAP2** — 1.64M labelled zones with geometry over 13,210 scholarly PDFs, 22 zone labels including affiliation/reference structure. Older (CERMINE-era, PMC-derived) but it is the largest *scholarly-specific* geometry corpus available and covers header/metadata zones DocLayNet does not.
3. **PubTabNet** — CDLA-Permissive-1.0, the canonical source of TEDS. Use it for table row/cell addressability regression.
4. **QASPER** — CC BY 4.0. Reuse the *task and metric* directly for PaperTree's grounding evaluation, even though it lacks geometry.
5. **unarXive open subset** and **S2ORC** (ODC-By 1.0) — reuse as *silver* structure references: unarXive is built from LaTeX source, so its section hierarchy, LaTeX maths and figure/table captions are ground truth for what a PDF parser *should* have recovered. Pairing an arXiv PDF with its unarXive LaTeX-derived tree is the cheapest possible large-scale hierarchy/equation evaluation, with zero hand annotation.
6. **PlotQA** (CC-BY-4.0 data / MIT code) if chart-reading is ever in scope.

**Run internally but do not ship or redistribute:** OmniDocBench (research-only). Treat as a comparison harness for choosing a parser, not as a PaperTree asset.

**Avoid for a commercial product:** SciCap (CC BY-NC-SA 4.0 — non-commercial, disqualifying), ChartQA (GPL-3.0 repo — copyleft contamination risk if vendored), ArxivQA (CC-BY-SA-4.0 share-alike *and* bound by OpenAI terms because it is GPT-4V-generated).

**Must still be hand-annotated by PaperTree — no public dataset covers these:**
- **Vector figures.** No benchmark surveyed distinguishes vector drawings from embedded rasters. CS architecture diagrams are the dominant figure type in PaperTree's corpus and are precisely the case where box-only layout labels are insufficient — you need the region *and* a faithful rendering. This is the single biggest annotation gap.
- **Stable block identity across re-parses.** No benchmark tests re-parse stability at all. PaperTree must build its own: parse the same PDF twice (and across parser versions), and measure ID/anchor drift.
- **Equation source-region retention.** OmniDocBench and olmOCR-Bench both score LaTeX *strings*; neither requires the source bbox to be retained. PaperTree needs LaTeX ↔ region pairs annotated.
- **Caption↔figure linkage as a scored relation.** DocLayNet labels `Caption` and `Picture` as separate boxes but does not annotate which caption belongs to which figure. Dr.DocBench claims "structural relations" — worth checking whether this covers it.
- **Hallucination / silent-rewrite detection.** olmOCR-Bench's "text absent" predicate is the closest existing mechanism and is the right pattern to copy, but a scientific-text-specific version (numbers, symbols, citation markers must not be invented) needs building.

---

## 6. Implications for PaperTree

1. **Copy OmniDocBench's three-axis structure, not its data.** PaperTree's benchmark should report per-**page-archetype** (two-column ACL/IEEE, single-column arXiv preprint, NeurIPS style, scanned/old paper, appendix-heavy, supplementary-with-large-tables), per-**attribute** (column count, has-vector-figure, has-display-math-density, is-scanned), and per-**element-task** (text ED, formula CDM, table TEDS, reading-order ED, layout mAP) — never one blended number. Adopt **MGAM-style prediction-side-only granularity search** for matching; otherwise you will penalise parsers for legitimate segmentation differences.
2. **Adopt CDM for equations, TEDS for tables.** Both are already the field standard and both have public implementations; edit distance on LaTeX strings is known to mis-rank semantically-equivalent output.
3. **Adopt QASPER's Evidence-F1 verbatim as the grounding metric**, but redefine the evidence unit as *PaperTree block ID* rather than paragraph index. Keep the max-over-references rule and keep an ~10% unanswerable slice.
4. **Add a geometry layer QASPER lacks.** Score evidence twice: (a) set-F1 over block IDs, and (b) IoU of the union of highlighted regions against a human-drawn region. SciEGQA is the existing precedent for region-level evidence and is worth mining for annotation-protocol design even if its licence turns out unusable.
5. **Bootstrap cheaply.** DocLayNet-v1.2 + GROTOAP2 + PubTabNet give geometry ground truth for free under permissive licences; unarXive gives LaTeX-derived hierarchy and equations for free. Reserve hand annotation budget almost entirely for vector figures, caption linkage and re-parse stability — the three things nobody else has measured.
6. **Cost note.** olmOCR-Bench and OmniDocBench both assume GPU-served VLM parsers (olmOCR needs ≥12GB VRAM). Running these benchmarks against a CPU-only pipeline is fine; running them against the VLM baselines you want to compare with is not — budget for rented GPU time for the comparison runs only, not for PaperTree's own serving path.

---

## 7. What I could not verify

- **PubLayNet's exact page/image count.** The GitHub README did not state it and I did not open the paper; the commonly-cited ~360k figure is unconfirmed here.
- **GROTOAP2's licence.** "CC-BY" comes from a secondary summary of the ICM repod record, not from a licence file I read. The `cermine.ceon.pl` host did not resolve during this session. Verify before relying on it.
- **Dr.DocBench's actual availability.** I confirmed the arXiv abstract page (title, authors, 2026-05-31 date) but found **no GitHub or HuggingFace link**, and the CC0-1.0 annotation licence and all size figures come from a summarisation of the paper HTML rather than a downloaded dataset card. Treat as promising but unconfirmed until the data is located.
- **SciEGQA's dataset licence.** CC BY 4.0 appears on the arXiv listing, which is the *paper's* licence, not necessarily the dataset's. The project page (`yuwenhan07.github.io/SciEGQA-project/`) was not fetched.
- **DocVQA / InfographicVQA distribution terms.** The Robust Reading Competition downloads page failed with a TLS certificate error. Both are widely assumed research-only with registration; I could not confirm. Do not assume commercial usability.
- **SciMMIR's licence** — not stated in the GitHub README I read; the HF mirror (`m-a-p/SciMMIR`) was not checked.
- **QASPER's LED baseline and human-ceiling numbers** (32.80 / 60.92 Answer-F1; 29.85 / 71.62 Evidence-F1) come from a summarisation of the ar5iv HTML, not from a table I read directly. The direction and magnitude are corroborated by the abstract's "at least 27 F1 points" claim, but treat the exact decimals as second-hand.
- **Whether ChartQA's *data* is separately licensed from its GPL-3.0 repo.** The repo LICENSE is GPL-3.0; some HF mirrors label the data differently. Legal review needed if ChartQA is ever wanted.
- **olmOCR-Bench leaderboard currency.** The numbers above are from the GitHub README, which I read raw. A first-pass fetch of the HF dataset card surfaced higher scores (Infinity-Parser2-Pro 87.6, Chandra-OCR-2 85.8) that I could **not** locate in the raw README front-matter, so I have excluded them. The leaderboard may be more current than what I cite.
- **OmniDocBench category counts.** The v1 paper says 19 layout categories + 14/15 attribute labels; the current HF card says 28 block-level + 4 span-level categories. Both are reported above; I did not reconcile which applies to which release.
- **Nothing here was benchmarked by me.** All performance numbers are vendor- or author-reported.
