# 08 — Table Detection and Structure Recognition

**Research date:** 2026-07-29. Most recent primary evidence found: `docling` 2.116.0 published to PyPI on 2026-07-29; `camelot-py` 2.0.0 on 2026-06-04; `pdfplumber` 0.11.10 on 2026-06-15; PaddleOCR 3.7.0 on 2026-06-11; arXiv:2603.18652v2 revised 2026-06-01.

---

## 1. Decomposing the problem

Table extraction is four tasks, and most tools only do some of them:

1. **Table detection (TD)** — find the table region on the page.
2. **Table structure recognition (TSR)** — recover the grid: rows, columns, spanning cells.
3. **Cell content recognition** — the text in each cell.
4. **Functional analysis** — which rows/columns are headers.

PaperTree needs all four *plus geometry at cell level*. This is the axis on which most 2025–2026 SOTA fails: the leading systems are generative VLMs that emit HTML/Markdown/LaTeX strings with **no per-cell bounding boxes**, which makes cell-level highlight anchoring impossible.

---

## 2. Evaluation metrics

### TEDS / TEDS-Struct
TEDS (Tree-Edit-Distance-based Similarity) was introduced with PubTabNet by Zhong et al. ([arXiv:1911.10683](https://arxiv.org/abs/1911.10683)). Both prediction and ground truth are converted to HTML DOM trees; TEDS is `1 − TreeEditDistance / max(|T_pred|, |T_gt|)`, where the node-substitution cost for `<td>` nodes includes a normalised string edit distance on the cell text. The reference implementation was released with PubTabNet in July 2020 ([repo](https://github.com/ibm-aur-nlp/PubTabNet)).

**TEDS-Struct** (also written S-TEDS / TEDS-S) sets the cell-content cost to zero, so it measures *structure only* and removes the OCR dependency. Always check which variant a paper reports — the gap is typically 1–3 points.

Known criticisms, from [arXiv:2208.00385](https://arxiv.org/abs/2208.00385): rows and columns are not treated symmetrically because of the tree encoding (a missing row is penalised more than a missing column); the metric confounds OCR quality with structure quality; and empty-cell alignment is captured poorly.

### GriTS
GriTS (Grid Table Similarity), Smock et al., [arXiv:2203.12555](https://arxiv.org/abs/2203.12555), evaluates the prediction **as a matrix** rather than a tree. It generalises the 2D largest-common-substructure problem (NP-hard) to "2D most similar substructures" and gives a polynomial-time heuristic returning an upper and lower bound. Crucially it unifies three sub-scores in one framework: **GriTS-Top** (topology), **GriTS-Loc** (cell location, i.e. geometry — the one PaperTree cares about) and **GriTS-Con** (content). GriTS-Loc is the only widely reported metric that scores cell *geometry*, so it is the metric PaperTree should track.

### 2026 development: metrics themselves are under attack
[arXiv:2603.18652](https://arxiv.org/abs/2603.18652) (Horn & Keuper, submitted 2026-03-19, revised 2026-06-01) benchmarked 21 PDF parsers over 100 synthetic documents / 451 tables and measured how well each metric correlates with human judgement: **LLM-as-judge r = 0.93, GriTS r = 0.70, TEDS r = 0.68**. Take published TEDS deltas under ~2 points as noise.

---

## 3. Systems

### 3.1 TableFormer (IBM) + OTSL — via Docling
- **Paper:** [arXiv:2203.01017](https://arxiv.org/abs/2203.01017), Nassar, Livathinos, Lysak, Staar (v1 2022-03-02, v2 2022-03-11). Encoder–dual-decoder; replaces the PubTabNet LSTM decoder with a transformer, and adds **an object-detection decoder for table cells**, so cell bboxes are a first-class output. Self-reported TEDS: simple tables 91 → 98.5, complex 88.7 → 95.
- **OTSL:** [arXiv:2305.03393](https://arxiv.org/abs/2305.03393) (ICDAR 2023). Replaces the 28+-token HTML vocabulary with **5 tokens** (`<sos>`, `<eos>`, `<c>` cell, `<r>` row-span marker, and repeated `<m>` markers for merged/spanning cells), halving sequence length and guaranteeing syntactic validity. Reported (Table 2): PubTabNet TEDS simple/complex/all — OTSL 0.965/0.934/0.955 vs HTML 0.969/0.927/0.955; FinTabNet — OTSL 0.955/0.961/0.959 vs HTML 0.917/0.922/0.920. Inference per table: PubTabNet 2.73 s (OTSL) vs 5.39 s (HTML); FinTabNet 1.85 s vs 3.26 s.
- **Licence — code:** MIT ([docling-ibm-models](https://github.com/docling-project/docling-ibm-models), PyPI 3.13.3, 2026-06-04); Docling itself MIT (PyPI 2.116.0, **2026-07-29**, 200 releases).
- **Licence — weights:** `cdla-permissive-2.0` and `apache-2.0` ([ds4sd/docling-models](https://huggingface.co/ds4sd/docling-models)). Commercially clean. Model card self-reports TEDS 93.6 overall, 95.4 simple, 90.1 complex.
- **Output:** `DoclingDocument` → `TableItem` → `TableData.table_cells: list[TableCell]`. Verified from source ([table_data.py](https://github.com/docling-project/docling-core/blob/main/docling_core/types/doc/items/table/table_data.py)):
  ```
  bbox: Optional[BoundingBox]; row_span; col_span;
  start_row_offset_idx; end_row_offset_idx;
  start_col_offset_idx; end_col_offset_idx;
  text; column_header; row_header; row_section; fillable
  ```
  `BoundingBox` carries `l,t,r,b` plus `coord_origin ∈ {TOPLEFT, BOTTOMLEFT}` ([base.py](https://github.com/docling-project/docling-core/blob/main/docling_core/types/doc/base.py)), so PDF-origin coordinates are representable.
- **No hallucination:** *"TableFormer structure predictions are matched back to the PDF cells in post-processing to avoid expensive re-transcription text in the table image"* ([Docling Technical Report, arXiv:2408.09869](https://arxiv.org/html/2408.09869v5)). Controlled by `do_cell_matching=True` (default) with `TableFormerMode.FAST|ACCURATE` ([docs](https://docling-project.github.io/docling/usage/advanced_options/)).
- **CPU cost:** Docling on a 225-page set, OCR disabled — M3 Max (16-core): 1.27 pages/s @4 threads, 1.34 @16; Xeon E5-2690: 0.60 @4, 0.92 @16; peak RSS ≈ 6.2 GB. "Typical tables require between 2 and 6 seconds on a standard CPU."
- **Weaknesses (open issues, primary evidence):** multi-page tables are **not** merged ([#2976](https://github.com/docling-project/docling/issues/2976); an LLM-assisted merge prototype is only proposed in [#2060](https://github.com/docling-project/docling/issues/2060)); rotated tables are detected but not de-rotated, so columns come back as rows ([#2343](https://github.com/docling-project/docling/issues/2343)); edge-to-edge tables need page padding ([#2965](https://github.com/docling-project/docling/issues/2965)).

### 3.2 Table Transformer / TATR + PubTables-1M (Microsoft)
- **Repo:** [microsoft/table-transformer](https://github.com/microsoft/table-transformer). **MIT code**; weights on HF also **MIT** ([v1.1-all card](https://huggingface.co/microsoft/table-transformer-structure-recognition-v1.1-all), 28.8M params, ~110 MB, trained on PubTables-1M + FinTabNet.c).
- **Dataset:** PubTables-1M, 947,642 annotated tables with **bounding boxes in both image and PDF coordinates** for rows, columns and cells — the richest geometry ground truth available.
- **Numbers (self-reported README, TATR-v1.0 on PubTables-1M):** GriTS-Top 0.9849, GriTS-Con 0.9850, **GriTS-Loc 0.9786**, AccCon 0.8243.
- **Structure:** DETR-style object detection over 6 classes (table, column, row, column header, projected row header, **spanning cell**); the detection model separately distinguishes `table` from `table rotated`. Spanning cells are therefore explicit detections resolved in `postprocess.py`.
- **Maintenance — the problem.** Last commit **2023-09-07**; 195 commits total; 97 open issues. Nearly three years stale as of 2026-07. Weights are excellent and licence is ideal; the codebase is not evolving.

### 3.3 TableMASTER (PingAn-VCGroup)
[arXiv:2105.01848](https://arxiv.org/abs/2105.01848); 2nd place, ICDAR 2021 Scientific Literature Parsing Task B. Splits the problem into structure recognition, text-line detection, text-line recognition and box assignment. Reported 0.9684 TEDS on the 9,115-sample PubTabNet val set, with 0.7767 exact structure accuracy. Reimplemented in PaddleOCR. Historically important; superseded on every axis by TableFormer and TATR.

### 3.4 SLANet / SLANeXt / PP-StructureV3 (PaddleOCR)
- **Licence:** PaddleOCR is **Apache 2.0**; v3.7.0 released 2026-06-11 ([repo](https://github.com/PaddlePaddle/PaddleOCR)). Genuinely alive.
- **Models & cost** ([PaddleX table-structure docs](https://paddlepaddle.github.io/PaddleX/3.3/en/module_usage/tutorials/ocr_modules/table_structure_recognition.html)): SLANet 59.52% / 6.9 MB / 43.12 ms CPU; SLANet_plus 63.69% / 6.9 MB / 41.80 ms; SLANeXt_wired 69.65% / 351 MB / 501.66 ms. Note these are a strict whole-table accuracy on an internal set, **not** TEDS — do not compare them against the 0.95 TEDS figures above.
- SLANet predicts structure **and cell coordinates**, and SLANeXt ships **separate wired/wireless (borderless) weights** — the only mainstream system with an explicit borderless specialisation. Tiny models (6.9 MB, ~40 ms CPU) make this the cheapest credible CPU option.

### 3.5 UniTable
[arXiv:2403.04822](https://arxiv.org/abs/2403.04822), [poloclub/unitable](https://github.com/poloclub/unitable). MIT code. Unifies structure, cell content **and cell bbox** into one language-modelling objective over pixel-only inputs with self-supervised pretraining. Last substantive activity ~April 2024. Weight licence is not stated on the repo page — treat as unresolved.

### 3.6 StructEqTable
[UniModal4Reasoning/StructEqTable-Deploy](https://github.com/UniModal4Reasoning/StructEqTable-Deploy), Apache 2.0 code; `StructTable-InternVL2-1B` weights **Apache 2.0** ([HF card](https://huggingface.co/U4R/StructTable-InternVL2-1B)). ~300M (base) and ~1B (InternVL2) variants; outputs **LaTeX** (all) and HTML/Markdown (InternVL2 only). ~1 s per image on an A100 with TensorRT. **Emits no cell bounding boxes** — disqualifying as a geometry source. Latest release 2024-12-12.

### 3.7 Ruling-line / lattice tools
- **pdfplumber** ([jsvine/pdfplumber](https://github.com/jsvine/pdfplumber)) — **MIT**, 0.11.10 released 2026-06-15, pure Python on pdfminer.six. Strategies: `lines`, `lines_strict`, `text`, `explicit`. `Table.cells` and `Table.bbox` give exact geometry in PDF space with zero inference cost and zero hallucination risk. Handles rotation via `line_dir_rotated` / `char_dir_rotated`. Weak on borderless and on spanning cells.
- **Camelot** — the original `atlanhq/camelot` was **archived 2025-01-06**; the live fork is [camelot-dev/camelot](https://github.com/camelot-dev/camelot), **MIT**, `camelot-py` 2.0.0 on PyPI 2026-06-04. **Ghostscript is no longer required** — pypdfium2 is the default backend and ships as a wheel. Flavors: `lattice`, `stream`, `network`, `hybrid`, `auto`, and an `ml` flavor (optional `torch`/`transformers`/`timm` extra) that wraps Table Transformer; the README claims `ml` "roughly doubles borderless TEDS vs `network`/`hybrid`" on FinTabNet (vendor-reported). ~50 open issues.

### 3.8 2025–2026 SOTA (VLM document parsers)

| System | Params | Code licence | Weight licence | Table score (self-reported) | Cell bboxes? |
|---|---|---|---|---|---|
| [MinerU2.5](https://arxiv.org/abs/2509.22186) | 1.2B | AGPL-3.0 | **AGPL-3.0** | TEDS 88.22 / TEDS-S 92.38 | No |
| [MinerU2.5-Pro](https://arxiv.org/abs/2604.04771) (2026-04) | 1.2B | not verified | not verified | OmniDocBench v1.6 overall 95.69 | No |
| [dots.ocr](https://huggingface.co/rednote-hilab/dots.ocr) (2025-07-30) | 1.7B | custom MIT-based | **custom "dots.ocr LICENSE AGREEMENT"** — commercial + SaaS allowed, but adds field-of-use bans (privacy, unauthorised digitisation of copyrighted material) | Table TEDS 88.6 EN / 89.0 ZH | No |
| [PaddleOCR-VL](https://huggingface.co/PaddlePaddle/PaddleOCR-VL) (2025-10-16) | 0.9B | Apache 2.0 | **Apache 2.0** | TEDS 0.9195 / TEDS-S 0.9543 on OmniDocBench-Table-block (512 tables) | No |
| [GLM-OCR](https://github.com/zai-org/GLM-OCR) (2026-03-11) | 0.9B | MIT (layout component Apache 2.0) | MIT | OmniDocBench v1.5 overall 94.62 (#1) | No |
| [TABLET](https://arxiv.org/html/2506.07015v1) (2025) | 16.1M + 32.5M | not released/verified | — | FinTabNet TEDS 98.54 / TEDS-S 98.71; PubTabNet 96.79 / 97.67; 18 FPS on A100 | **Explicitly no** — "eliminates unstable bounding box predictions" |

Two independent benchmarks worth weighting heavily:

- **[arXiv:2511.16134](https://arxiv.org/html/2511.16134v1)** (Soric, Gracianne, Manolescu, Senellart, 2025-11-20) benchmarked 9 end-to-end methods on PubTables, a heterogeneous arXiv set, and geological reports. Detection F₁/AP on PubTables: TATR 1.00, Docling 0.99, GROBID 0.67, PyMuPDF 0.42, **Camelot 0.25**. On heterogeneous Table-arXiv: **Docling 0.89**, XY-cut+TATR 0.85, TATR 0.84, VGT 0.73, GROBID 0.43. End-to-end TEDS on PubTables: **Docling F₁^TEDS 0.86**, TATR 0.80, VGT 0.70. Docling was the strongest overall; rule-based Python libraries performed poorly on complex structures.
- **[arXiv:2603.18652](https://arxiv.org/abs/2603.18652)** ranked 21 parsers by LLM-judged table quality: Gemini 3 Pro 9.55, Gemini 3 Flash 9.50, LightOnOCR-2-1B 9.08, Mistral OCR 3 8.89, dots.ocr 8.73, MonkeyOCR-3B 8.39; PyMuPDF4LLM and GROBID substantially lower. General-purpose multimodal models beat purpose-built parsers **on string fidelity** — but none of them return geometry.

---

## 4. Implications for PaperTree

**The decisive filter is geometry, not TEDS.** Every 2025–2026 leaderboard winner is a generative VLM that returns an HTML/Markdown string. That fails three of PaperTree's hard requirements simultaneously: no cell bbox → no cell highlighting; no bbox → no stable anchor across re-parses; and a generative decoder can silently rewrite a numeric cell. Only three families give per-cell geometry: **TableFormer/Docling, TATR, SLANet, and (research-grade) UniTable**.

**Recommended path:**

1. **Primary: Docling + TableFormer in `ACCURATE` mode with `do_cell_matching=True`.** MIT code, CDLA-Permissive-2.0/Apache-2.0 weights — no AGPL, no NC, no revenue cap. `TableCell` already carries `bbox`, `row_span`/`col_span`, four offset indices, and `column_header`/`row_header` flags, which is a direct one-to-one match with PaperTree's row/cell addressability requirement. Cell **text comes from the PDF text layer**, not from a decoder, so there is no hallucination surface for cell content. It runs at 1.27–1.34 pages/s on an M3 Max and 0.6–0.92 pages/s on a 16-core Xeon with ~6 GB RSS — viable with no GPU. It also won the only independent end-to-end academic benchmark I found (F₁^TEDS 0.86). Release cadence is the strongest in the field (200 PyPI releases; latest the day of this review).

2. **Deterministic geometry oracle: pdfplumber `lines_strict`.** For any vector PDF with ruled tables, run pdfplumber alongside TableFormer at near-zero cost. Where the two grids agree, mark the table high-confidence; where they disagree on row/column count, **surface uncertainty rather than picking silently**. This is how PaperTree satisfies "uncertainty must be representable" without a second model. Camelot 2.x `lattice` is a reasonable third opinion for heavily ruled tables (MIT, no Ghostscript), but note its 0.25 detection F₁ in the independent benchmark — use it only *inside* an already-detected table region, never as a detector.

3. **Optional GPU worker: TATR-v1.1-All (MIT weights, 28.8M params).** Only 110 MB, so it can even run on CPU. Value: it natively emits row, column and spanning-cell boxes (GriTS-Loc 0.9786) and its detection model has an explicit rotated-table class, which is exactly the gap Docling issue #2343 leaves open. Pin the weights locally — the repo has been unmaintained since 2023-09-07 and should be treated as a frozen artifact, not a dependency.

4. **Explicitly rejected as primary:** MinerU2.5 (**AGPL-3.0** — viral network copyleft, disqualifying for a commercial product); StructEqTable and all VLM parsers as the geometry source (no cell boxes); TABLET (deliberately drops bbox prediction). VLMs may still be useful as an *optional, clearly-labelled* repair layer for a table the geometric pipeline flagged as low-confidence — never as the default, and never overwriting the PDF-derived cell text.

**Engineering work PaperTree must own, because nothing off-the-shelf does it:**

- **Stable cell IDs.** Docling's `self_ref` (`#/tables/0`) is a positional index and will shift between re-parses. Mint `sha1(page_no, quantised bbox, start_row_offset_idx, start_col_offset_idx, normalised text)` with nearest-neighbour bbox fallback for re-anchoring.
- **Multi-page tables.** Unsolved upstream (Docling #2976 open; #2060 is only a proposal). Keep each page fragment as its own geometry-bearing block and add a *logical* table-group over them — merging must never destroy per-page provenance.
- **Rotation.** Read `/Rotate` and dominant text direction, rotate the crop before TableFormer, then invert the transform on returned bboxes.
- **Borderless.** TableFormer's training mix (PubTabNet/FinTabNet/SynthTabNet) covers borderless. If borderless quality proves insufficient, SLANeXt_wireless (Apache 2.0, dedicated wireless weights) is the cheapest targeted upgrade.

Track **GriTS-Loc**, not TEDS, as PaperTree's internal table metric — it is the only standard score that measures the thing PaperTree actually ships.

---

## 5. What I could not verify

- **UniTable's model-weight licence.** Code is MIT; the HuggingFace weight licence is not stated on the repo page and I did not fetch the HF card. I also could not confirm UniTable's own TEDS numbers: a search summary attributed "91→98.5 simple / 88.7→95 complex" to UniTable, but those are verbatim the TableFormer abstract's numbers ([arXiv:2203.01017](https://arxiv.org/abs/2203.01017)). I believe this is a search-tool conflation and have **not** credited them to UniTable.
- **OTSL Table 2 exact values.** Extracted via ar5iv. A first extraction pass from the PDF returned hedged approximations (~97%/~98%) that contradict the ar5iv values. I report the ar5iv figures but confidence is medium.
- **TableFormer per-table latency by hardware.** A search snippet attributed "400 ms on L4 GPU, 1.74 s x86 CPU, 704 ms M3 Max (fast flavour)" to the Docling technical report; the version I fetched (v5) contains no such fast/accurate breakdown, only "2 to 6 seconds on a standard CPU". Do not rely on the per-device figures.
- **PaddleX SLANet/SLANeXt accuracy metric name.** The docs give 59.52 / 63.69 / 69.65 % with no metric label; SLANeXt_wireless has no published row. These are not TEDS and are not comparable to other numbers here.
- **TATR's full 16-class taxonomy.** I confirmed 6 structure classes and a `table rotated` detection class, but the "16 classes including rotated counterparts" claim came from a secondary summary, not from the repo source.
- **TableMASTER's licence.** Not verified from the LICENSE file; likely inherited from MMOCR but unconfirmed.
- **TableSeq (IJDAR 2026) and InstructTable ([arXiv:2604.02880](https://arxiv.org/abs/2604.02880))** numbers come from search summaries; I did not read the papers, and I could not establish whether either releases code or weights.
- **GLM-OCR's table TEDS (86.0)** and LingDT-VL-OCR's 91.34 come from third-party leaderboard aggregation (llm-stats.com / idp-leaderboard.org), not the primary papers.
- **PubTables-1M dataset licence.** The README does not state one; only PubTabNet's licence was verified (annotations CDLA-Permissive-1.0; images under PMC Open Access terms, IBM explicitly disclaims image copyright). This matters only if PaperTree fine-tunes, not for inference.
- **No system I found solves multi-page table merging.** I searched specifically and found only an open Docling issue and an unmerged prototype.
