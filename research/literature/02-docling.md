# Docling (IBM / LF AI & Data) — Technical Evaluation for PaperTree

**Evidence cut-off: 2026-07-29.** Latest release inspected: `v2.116.0`, published 2026-07-29 ([releases API](https://api.github.com/repos/docling-project/docling/releases)). Primary sources: the two arXiv technical reports, the `docling`, `docling-core` and `docling-eval` repositories at `main`, and Hugging Face model cards.

---

## 1. Bottom line

Docling is the strongest licence-and-geometry fit of any open document parser I have examined for PaperTree. Every layer — library code, layout weights, table weights, formula weights, figure classifier — is MIT / Apache-2.0 / CDLA-Permissive-2.0. Its intermediate representation (`DoclingDocument`) carries exactly the three things PaperTree's anchoring model needs: `page_no`, a `BoundingBox` in PDF bottom-left user space, and a **character span**, per provenance record. It is architecturally non-generative by default (text is lifted from the PDF text layer, never re-transcribed by an LLM), which directly satisfies the no-hallucination requirement.

Two real problems: **(a) block identity is positional, not content-derived** — `self_ref` is a JSON pointer like `#/texts/47`, so it is not stable across re-parses; and **(b) section hierarchy is off by default** — the PDF path leaves every heading at `level=1` unless you opt in. Both are solvable in PaperTree's own layer, but they are engineering work, not free.

---

## 2. Architecture and pipeline stages

Docling is a linear, model-per-stage pipeline, described identically in both reports ([arXiv 2408.09869v5 §3](https://arxiv.org/abs/2408.09869), [arXiv 2501.17887 §3–4](https://arxiv.org/abs/2501.17887)):

1. **PDF backend** — retrieves programmatic text tokens *with page coordinates* and renders a page bitmap. Default backend is `docling-parse` (built on [qpdf](https://github.com/qpdf/qpdf)); alternative is `pypdfium2`. The reports explicitly state they rejected PyMuPDF for "restrictive licensing" and pypdfium/PyPDF for "merged text cells across far-apart text tokens or table columns."
2. **Layout analysis** — object detector over the page image.
3. **OCR** (optional) — only for bitmap regions / scanned pages.
4. **Table structure** — TableFormer on each detected table crop.
5. **Assembly + post-processing** — reading-order inference, caption↔figure matching, language detection; emits a `DoclingDocument` (`docling-core`).
6. **Enrichment** (opt-in) — code, formula, picture classification, picture description, chart extraction.

Backend enum at `main` confirms: `pypdfium2`, `docling_parse`, `threaded_docling_parse` ([`pipeline_options.py`](https://raw.githubusercontent.com/docling-project/docling/main/docling/datamodel/pipeline_options.py)).

### Layout model
Derived from **RT-DETR** ([arXiv 2304.08069](https://arxiv.org/abs/2304.08069)), retrained on **DocLayNet** (80,863 human-annotated pages, 11 classes, [KDD '22](https://doi.org/10.1145/3534678.3539043)) "among other proprietary datasets". The v1 report fed pages at 72 dpi via onnxruntime; the v2 report moved inference to HF `transformers` + safetensors. The current default at `main` is **`docling-project/docling-layout-heron`**, with Egret medium/large/xlarge as higher-accuracy alternates ([`layout_model_specs.py`](https://raw.githubusercontent.com/docling-project/docling/main/docling/datamodel/layout_model_specs.py)).

For calibration: on DocLayNet's own test set, human inter-annotator agreement was mAP@0.5–0.95 **82–83**, and the paper's best baseline (YOLOv5x6) reached **76.8** — i.e. document layout is not a solved problem even for the dataset authors.

### Table structure
**TableFormer** ([CVPR 2022](https://openaccess.thecvf.com/content/CVPR2022/html/Nassar_TableFormer_Table_Structure_Understanding_With_Transformers_CVPR_2022_paper.html)), refined with the OTSL token language ([ICDAR 2023, doi:10.1007/978-3-031-41679-8_3](https://doi.org/10.1007/978-3-031-41679-8_3)). Crucially, **structure predictions are matched back to the PDF text cells rather than re-transcribed** — this is what makes the table path language-agnostic *and* hallucination-free. Modes: `fast` / `accurate`; default at `main` is `ACCURATE`.

### Formula handling
`do_formula_enrichment` (default **False**) routes `FORMULA` regions to **CodeFormulaV2** ([HF card](https://huggingface.co/docling-project/CodeFormulaV2)): 0.3B params, BF16, 120 dpi input, trained on SynthFormulaNet (6.45M) + SynthCodeNet (9.33M), and it "generates the corresponding LaTeX code." The result lands in `FormulaItem.text` — a `TextItem` subclass, so it keeps its `prov` list (page + bbox + charspan). **The source region is retained.** Licence: CDLA-Permissive-2.0.

### Figures / pictures
`PICTURE` is a layout class, detected on the **rendered page bitmap**. This is the key point for PaperTree: detection does not depend on there being an embedded raster XObject, so **vector CS architecture diagrams are detected**. `PictureItem` extends `FloatingItem`, which carries `captions: list[RefItem]`, `references`, `footnotes`. `FloatingItem.get_image()` falls back to `DocItem.get_image()`, which **crops the rendered page image at the provenance bbox** ([`items/node.py`](https://raw.githubusercontent.com/docling-project/docling-core/main/docling_core/types/doc/items/node.py)). So you get a raster crop at `images_scale` — *and* the bbox, which means PaperTree can re-render the vector region itself at any zoom.

Caveat: the v1 report states "Text content inside figures is currently dropped, the caption is retained and linked to the figure in the JSON representation." I could not confirm this was reversed; axis labels and in-diagram text should be assumed unreliable.

**Picture classification** (`do_picture_classification`, default False) uses `DocumentFigureClassifier-v2.5` (MIT). Its label set is directly relevant to papers: `bar_chart`, `line_chart`, `scatter_plot`, `box_plot`, `pie_chart`, `flow_chart`, `engineering_drawing`, `screenshot_from_computer`, `photograph`, `chemistry_structure` ([`labels.py`](https://raw.githubusercontent.com/docling-project/docling-core/main/docling_core/types/doc/labels.py)).

### OCR backends
Enum at `main`: `auto`, `easyocr`, `tesseract_cli`, `tesserocr`, `ocrmac`, `rapidocr`; plus `nemotron-ocr` and a KServe-v2 remote option as separate option classes. `do_ocr` defaults to **True** and `ocr_options` defaults to `OcrAutoOptions()`. **For born-digital arXiv PDFs this default is pure waste** — see §5.

---

## 3. The `DoclingDocument` representation

Verified directly against `docling-core` at `main`.

| Concern | Field | Verdict for PaperTree |
|---|---|---|
| Geometry | `DocItem.prov: list[ProvenanceItem]`; `ProvenanceItem = {page_no: int, bbox: BoundingBox, charspan: (int,int)}` | ✅ Exactly the required shape |
| Coordinate space | `BoundingBox{l,t,r,b, coord_origin}`; PDF path constructs boxes with `CoordOrigin.BOTTOMLEFT` ([`glm_utils.py`](https://raw.githubusercontent.com/docling-project/docling/main/docling/utils/glm_utils.py)) | ✅ Native PDF user space |
| Sub-block anchoring | `charspan` indexes into the item's own `text` (e.g. `caption["text"][span_i:span_j]`) | ✅ Char-level, per-page-fragment |
| Hierarchy | `body` root + `groups`; `NodeItem{self_ref, parent, children}`; reading order = order of `children` ([docs](https://docling-project.github.io/docling/concepts/docling_document/)) | ⚠️ Tree exists, but see §6 |
| Block identity | `self_ref: str` = JSON pointer, `#/texts/47` | ❌ Positional, not stable |
| Tables | `TableCell{bbox, row_span, col_span, start_row_offset_idx, end_row_offset_idx, start_col_offset_idx, end_col_offset_idx, column_header, row_header}` + `TableData.grid` | ✅ Full row/cell addressability with per-cell bbox |
| Uncertainty | `ConfidenceReport` with per-page `ocr_score`, `table_score`, `layout_score`, `parse_score` → `POOR/FAIR/GOOD/EXCELLENT`; `Cluster.confidence: float` ([`base_models.py`](https://raw.githubusercontent.com/docling-project/docling/main/docling/datamodel/base_models.py)) | ✅ Representable and machine-readable |
| Body vs furniture | `ContentLayer` separates BODY from headers/footers | ✅ Running heads excluded cleanly |
| Node types | `TextItem`, `TitleItem`, `SectionHeaderItem(level)`, `ListItem(marker)`, `FormulaItem`, `CodeItem`, `TableItem`, `PictureItem`, `KeyValueItem`, `FormItem`, `GroupItem`/`ListGroup`/`InlineGroup` | ✅ Rich enough |
| Serialization | JSON is **lossless**; Markdown/HTML are explicitly lossy | ✅ Persist the JSON, not the Markdown |

---

## 4. Licences (decisive)

| Component | Repo / weights | Licence | Flag |
|---|---|---|---|
| `docling` | [github](https://github.com/docling-project/docling) | MIT (© IBM) | clean |
| `docling-core` | [github](https://github.com/docling-project/docling-core) | MIT | clean |
| `docling-parse` | [github](https://github.com/docling-project/docling-parse) | MIT | clean |
| `docling-ibm-models` | [github](https://github.com/docling-project/docling-ibm-models) | MIT | clean |
| `docling-serve` | [github](https://github.com/docling-project/docling-serve) | MIT | clean |
| Layout weights (Heron) | [HF](https://huggingface.co/docling-project/docling-layout-heron) | Apache-2.0 | clean |
| TableFormer weights | [HF `docling-models`](https://huggingface.co/docling-project/docling-models) | CDLA-Permissive-2.0 + Apache-2.0 | clean, commercial OK |
| CodeFormulaV2 | [HF](https://huggingface.co/docling-project/CodeFormulaV2) | CDLA-Permissive-2.0 | clean |
| DocumentFigureClassifier-v2.5 | [HF](https://huggingface.co/docling-project/DocumentFigureClassifier-v2.5) | MIT | clean |
| granite-docling-258M (VLM) | [HF](https://huggingface.co/ibm-granite/granite-docling-258M) | Apache-2.0 | clean |
| SmolDocling-256M-preview | [HF](https://huggingface.co/docling-project/SmolDocling-256M-preview) | CDLA-Permissive-2.0 | clean |

No AGPL, no CC BY-NC, no revenue cap, no research-only term anywhere in the default path. `TableFormerV2` on HF carries **no licence tag** — do not adopt that specific repo until clarified.

**Contrast, verified:** Marker's code is Apache-2.0 but its **model weights are a modified AI Pubs Open RAIL-M licence, free only for orgs under $5M funding/revenue** ([Marker README](https://raw.githubusercontent.com/datalab-to/marker/master/README.md)). MinerU adds "additional terms" on top of Apache-2.0 ([LICENSE.md](https://raw.githubusercontent.com/opendatalab/MinerU/master/LICENSE.md)). Docling is the only one of the three with no commercial asterisk.

---

## 5. Performance — real numbers

**All figures below are vendor self-reported by IBM Research.** I ran no independent benchmark.

**2408.09869v5 (Dec 2024), 225 pages, OCR *disabled*, thread budget via `OMP_NUM_THREADS`:**

| CPU | Threads | docling-parse TTS / p-s | pypdfium TTS / p-s | Peak RSS (native / pypdfium) |
|---|---|---|---|---|
| Apple M3 Max (16c) | 4 | 177 s / 1.27 | 103 s / 2.18 | 6.20 GB / 2.56 GB |
| Apple M3 Max (16c) | 16 | 167 s / 1.34 | 92 s / 2.45 | " |
| Intel Xeon E5-2690 (16c) | 4 | 375 s / 0.60 | 239 s / 0.94 | 6.16 GB / 2.42 GB |
| Intel Xeon E5-2690 (16c) | 16 | 244 s / 0.92 | 143 s / 1.57 | " |

That report also says GPU acceleration was then "work-in-progress and largely untested" — **stale; superseded**.

**2501.17887 (Jan 2025), Docling 2.5.2, 89 PDFs / 4,008 pages, OCR + TableFormer-fast enabled, 8 threads:**

| Config | p5 | median | p95 | mean/page |
|---|---|---|---|---|
| x86 CPU (AMD EPYC 7R13, 8 vcore, 32 GB) | 0.6 s | 0.79 s | 16.3 s | 3.1 s |
| M3 Max (64 GB) | 0.26 s | 0.32 s | 6.48 s | 1.26 s |
| Nvidia L4 (24 GB VRAM) | 57 ms | 114 ms | 2,081 ms | 481 ms |

Per-stage means: PDF parse 81 ms (x86) / 44 ms (M3), no GPU path. Layout 633 ms / 271 ms / 44 ms. TableFormer-fast **per table** 1.74 s / 704 ms / 400 ms. EasyOCR **per page** 13 s / 5 s / 1.6 s. GPU speedups vs x86: 14× layout, 8× OCR, 4.3× table.

**The tuning lever that matters most for PaperTree:** disabling OCR saves **60%** of runtime on CPU (50% on L4); disabling table structure saves 16% (24% on L4); both off saves **~75%**. arXiv PDFs are born-digital — `do_ocr=False` is nearly free accuracy-neutral throughput.

Cross-tool, same harness: Docling 3.1 s/page (x86) and 1.27 s/page (M3) beat MinerU (3.3 s x86), Unstructured (4.2 s x86 / 2.7 s M3) and Marker (>16 s x86 / 4.2 s M3). With the L4, MinerU takes the lead at 0.21 s/page vs Docling 0.49 s/page.

**Quality (docling-eval, self-reported, files last touched 2025-04-07 — measured with the *old* default layout model, so these understate current Heron/Egret performance):** OmniDocBench TableFormer TEDS-struct mean **0.80** (median 0.86); reading-order ARD_norm mean **0.85**; markdown-text F1 mean **0.44**, BLEU **0.25**; Docling-DPBench layout mAP@[.5:.95] mean **0.48**. FinTabNet TEDS-struct **0.90**, with-content **0.89**; PubTabNet TEDS-struct **0.81**. The low OmniDocBench text F1 is partly a benchmark-composition artefact (heavily Chinese/scanned) against a default OCR language set of `fr/de/es/en`; do not read it as English-paper quality.

---

## 6. VLM pipeline — and why PaperTree should not use it as primary

`--pipeline vlm` swaps the whole model stack for a single VLM emitting **DocTags** ([arXiv 2503.11576](https://arxiv.org/abs/2503.11576)). Default at `main` is `granite-docling` (258M, Apache-2.0, Idefics3 arch: siglip2-base-patch16-512 vision encoder + Granite 165M LM). IBM's self-reported evals: equation recognition F1 **0.968** / edit-distance **0.073**; code F1 **0.988**; FinTabNet TEDS-struct **0.97** / with-content **0.96**; layout mAP **0.27**; full-page OCR edit-distance **0.45**; OCRBench 500.

Costs and risks:
- **Latency.** Docling's own docs measure one page on an M3 Max: SmolDocling-256M via MLX **6.15 s**, Qwen2.5-VL-3B **23.5 s**, Granite Vision 3.2 **104.75 s**, Pixtral-12B **1,828 s** ([vision_models docs](https://docling-project.github.io/docling/usage/vision_models/)). That is 5–20× the standard pipeline on the same machine, for a *small* model.
- **Geometry precision drops.** DocTags location tokens quantise to a 500×500 grid (`xsize=500, ysize=500` in `get_location_tokens`) — roughly 1.2 pt on a US-Letter page. The standard pipeline's float bboxes are strictly better for highlight anchoring.
- **Hallucination re-enters.** IBM's own card warns smaller models "may exhibit increased susceptibility to hallucination." The 2501 report's central design argument is that Docling's default path avoids exactly this.

Sensible use: keep the standard pipeline as primary; consider the VLM only as an optional GPU-worker fallback for pages where `ConfidenceReport` grades POOR.

---

## 7. Maintenance and adoption

- Repo created 2024-07-09; last push **2026-07-29** (same day as this review). 15 releases between 2026-06-15 and 2026-07-29 — roughly one every 3–5 days.
- **886 open issues / 72 open PRs / 1,039 closed issues.** Issue character is healthy-but-telling: overwhelmingly narrow fidelity bugs, several directly in PaperTree's path — *"PDF: figure caption words lose spaces producing CamelCase collapse"* (2026-07-26), *"Reading-order hard-hyphen continuations retain an inserted space"* (2026-07-27), *"PDF: hyphenated line wraps inside list items split into multiple items"*, *"PDF: drop-cap letter rendered as standalone text block mid-paragraph"*. These are exactly the artefacts a reader-facing product notices.
- Governance: donated by IBM to **LF AI & Data** as an Incubation project, April 2025 ([Linux Foundation press release](https://www.linuxfoundation.org/press/ai-workflows-get-new-open-source-tools-to-advance-document-intelligence-data-quality-and-decentralized-ai-with-ibms-contribution-of-3-projects-to-linux-fou-1745937200621)).
- Adoption (downloads, not stars): **18.36M** PyPI downloads of `docling` in the last 30 days, 6.05M for `docling-core` ([pypistats](https://pypistats.org/api/packages/docling/recent)); 2.96M HF downloads of `docling-models`, 1.96M of `docling-layout-heron`.
- Production: **Docling for IBM watsonx** went GA as a managed service on 2026-06-15, running "the same open stack everyone else uses: docling, docling-core, docling-parse, docling-jobkit, docling-serve" ([docling.ai blog](https://www.docling.ai/blog/20260615_00_docling_for_ibm_watsonx/)). Red Hat ships it in RHEL AI / InstructLab ([Red Hat blog](https://www.redhat.com/en/blog/docling-missing-document-processing-companion-generative-ai)). The June 2026 post also documents real hardening: `docling-parse` v6 added a bounded-memory threaded parser after the v4 parser was observed accumulating **20+ GB vs 4 GB** on long documents, plus per-page error isolation.

---

## 8. Chunking

`HierarchicalChunker` (structure-driven), `HybridChunker` (tokenizer-aware split+merge), `LineBasedTokenChunker` (preserves line boundaries for tables/code/logs) ([docs](https://docling-project.github.io/docling/concepts/chunking/)). The 2501 report states the lossless-JSON chunker path "can provide document-native RAG grounding via rich metadata such as the page number and the bounding box of the supporting context." Useful for PaperTree's semantic layer, but not on the critical path for parsing.

---

## 9. Implications for PaperTree

**Adopt as primary parser, with three named mitigations.**

Requirement-by-requirement:

- **Geometry survives** — ✅ Best-in-class. `page_no` + float `BoundingBox` in bottom-left PDF space on every `DocItem`, plus `charspan`. This is more than most competitors expose.
- **Stable addressable block identity** — ❌ **The one real gap.** `self_ref` is `#/texts/47`; insert one paragraph on re-parse and every downstream pointer shifts. PaperTree must mint its own IDs — e.g. hash of `(page_no, quantised bbox, label, normalised text prefix)` with a fuzzy re-match pass on re-parse. Do not persist `self_ref` in the highlight store. Budget this as real work.
- **Hierarchy, not a blob** — ⚠️ Tree exists (`body` + `groups` + `children`), but `HeadingHierarchyOptions.enabled` defaults to **False**, and the docstring is explicit: "the layout model only flags regions as `SECTION_HEADER` without a level, so every heading produced by the PDF path defaults to `level=1` and the document hierarchy is flattened." **Set `heading_hierarchy_options.enabled=True`.** Note the dependency: `use_style` silently no-ops unless `generate_parsed_pages=True`.
- **Equations as LaTeX with source region** — ✅ but **must be switched on** (`do_formula_enrichment=True`, CodeFormulaV2). Adds a per-formula VLM call; on a dense theory paper this will hurt CPU latency. Measure before committing.
- **Vector figures with captions** — ✅ Detection is on the rendered bitmap, so vector diagrams are found; `FloatingItem.captions` links caption items by ref; `get_image()` crops the page render. PaperTree should store the **bbox** and re-render vector at display resolution rather than shipping the low-res crop. Assume in-figure text is lost.
- **Tables with row/cell addressability** — ✅ `TableCell` gives offsets, spans, header flags and per-cell bbox.
- **No silent hallucination; uncertainty representable** — ✅ Strongest argument for Docling. Text comes from the PDF token stream; TableFormer matches structure back onto real cells. `ConfidenceReport` per-page scores give PaperTree a principled trigger for "flag this page" or "escalate to GPU worker."
- **Runs without a GPU** — ✅ With `do_ocr=False` on born-digital arXiv PDFs, expect roughly 1.3–2.5 pages/s on Apple Silicon and ~0.9–1.6 pages/s on an older server CPU. Peak RSS ~6.2 GB with the `docling-parse` backend, ~2.5 GB with pypdfium — size the worker at ≥8 GB. An optional L4-class GPU worker buys ~6× on the standard pipeline.

**Recommended starting configuration:** `StandardPdfPipeline`, `docling_parse` backend (better table cell fidelity), `do_ocr=False` with a confidence-triggered OCR retry, `do_table_structure=True` + `TableFormerMode.ACCURATE`, `do_formula_enrichment=True`, `do_picture_classification=True`, `heading_hierarchy_options.enabled=True`, `generate_parsed_pages=True`, `generate_page_images=True` with `images_scale≈2.0`, and **persist the lossless JSON** — never the Markdown export.

**What Docling does not give you:** a stable anchor ID scheme, in-figure text, or vector-preserving figure extraction. Those are PaperTree's to build on top.

---

## 10. What I could not verify

- **No independent benchmark.** Every latency, memory and accuracy number above is IBM/project self-reported. I ran nothing locally.
- **Current-version speed.** The published throughput tables are from Docling **2.5.2** (Jan 2025). The version at `main` is **2.116.0**. I found no updated performance report; treat the sec/page figures as indicative only.
- **Current-version quality.** The `docling-eval` result files were last committed **2025-04-07**, before Heron/Egret became the default layout model. Present-day accuracy is probably better, but I have no published number for it.
- **In-figure text.** The v1 report says text inside figures is dropped. I could not find a statement confirming or reversing this at `main`, and did not read enough of the layout post-processor to settle it. **Verify empirically on a vector architecture diagram before committing.**
- **`self_ref` stability.** I inferred instability from the JSON-pointer schema and the index-rewriting logic in `RefItem._update_with_lookup`. I did not run two parses of the same PDF across versions to measure actual drift.
- **granite-docling throughput.** A widely repeated "0.35 s/page on A100 via vLLM" figure appears in secondary write-ups; it is **not** in the official model card, and I could not trace it to a primary source. Discard it.
- **CodeFormulaV2 base architecture** and its formula accuracy on real arXiv equations (as opposed to the synthetic SynthFormulaNet training distribution) are undocumented on the card.
- **`docling-project/TableFormerV2`** carries no licence tag on Hugging Face. Unresolved.
- **CVE/security history** not audited beyond the dependency-bump notes in the June 2026 blog post.
- Third-party licences for Marker/MinerU/Unstructured were spot-checked only where directly contrasted; their full evaluation belongs to their own reports.
