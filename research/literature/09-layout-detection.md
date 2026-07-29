# Document Layout Detection Models — Technical Evaluation for PaperTree

**Research date:** 2026-07-29. **Most recent primary evidence:** Docling `v2.116.0` released 2026-07-29; `docling-project/docling` pushed 2026-07-29T16:08Z; `datalab-to/surya` pushed 2026-07-23; independent COTe evaluation arXiv:2603.12718 (2026-03-13); World Bank layout benchmark arXiv:2606.06242 (2026-06-04). Repo metadata read via the GitHub REST API on 2026-07-29.

**Verdict up front:** For PaperTree the answer is **`docling-layout-heron`** (RT-DETRv2-r50vd, 42.9M params, **Apache-2.0 weights**, 17 classes including `Caption`, `Formula`, `Footnote`, `Picture`) — with **`docling-layout-egret-medium`** (D-FINE, 19.5M params, Apache-2.0) as the CPU-budget variant. DocLayout-YOLO is accurate but its code is **AGPL-3.0** and the repo has been unmaintained since 2025-04-14. LayoutLMv2 and LayoutLMv3 are **CC BY-NC-SA 4.0 — commercially unusable, full stop**. LayoutParser is effectively abandoned and its model-zoo download links are broken. Surya's weights are **revenue-capped** (OpenRAIL-M, free only under $5M funding/revenue).

---

## 1. Why the label set decides this, not the mAP

PaperTree needs `figure`, `figure caption`, `table`, `table caption`, `formula`, `footnote` as *distinct addressable regions*. Most of the classic layout literature cannot express that. This table is the single most decision-relevant artefact in this report.

| Model / dataset | # classes | Caption? | Formula? | Footnote? | Figure vs Table separate? |
|---|---|---|---|---|---|
| PubLayNet (5 cls) | 5 | ❌ | ❌ | ❌ | ✅ (Text/Title/List/Table/Figure) |
| DocBank (12 cls) | 12 | ✅ | ✅ (`Equation`) | ❌ (`Footer`) | ✅ |
| DocLayNet (11 cls) | 11 | ✅ | ✅ | ✅ | ✅ |
| DocLayout-YOLO DocStructBench | 10 | ✅ (fig-cap, tbl-cap, formula-cap) | ✅ (isolated) | ✅ (table footnote only) | ✅ |
| Docling heron / egret | **17** | ✅ | ✅ | ✅ | ✅ + Code, Form, Document Index |
| PP-DocLayout-L | **23** | ✅ | ✅ + formula *number* | ✅ | ✅ + chart, seal, algorithm |
| Surya v2 | ~18 | ✅ | ✅ (`Equation`) | ✅ | ✅ + `Diagram`, `ChemicalBlock`, `Bibliography` |

Sources: PubLayNet label map in the LayoutParser model zoo — <https://layout-parser.readthedocs.io/en/latest/notes/modelzoo.html>; DocBank README (12 units: Abstract, Author, Caption, Date, Equation, Figure, Footer, List, Paragraph, Reference, Section, Table, Title) — <https://github.com/doc-analysis/DocBank>; DocLayNet 11 classes (Caption, Footnote, Formula, List-item, Page-footer, Page-header, Picture, Section-header, Table, Text, Title) from arXiv:2206.01062 — <https://arxiv.org/abs/2206.01062>; DocStructBench 10 classes from arXiv:2410.12628 §4 — <https://arxiv.org/html/2410.12628v1>; Docling 17 classes from the heron model card — <https://huggingface.co/docling-project/docling-layout-heron>; PP-DocLayout 23 classes — <http://www.paddleocr.ai/main/en/version3.x/module_usage/layout_detection.html>; Surya labels read directly from `surya/layout/label.py` at <https://github.com/datalab-to/surya>.

**Immediate consequence: every PubLayNet-only model is disqualified.** That kills the entire LayoutParser PubLayNet zoo and the DiT PubLayNet checkpoints as *primary* detectors — they cannot tell you where a caption is, and captions are the thing that links a figure to its meaning.

---

## 2. Master comparison

| System | Code licence | Weights licence | Arch / size | Best reported mAP (benchmark) | CPU latency | GPU latency | Last activity |
|---|---|---|---|---|---|---|---|
| **Docling heron** | MIT (docling, docling-ibm-models) | **Apache-2.0** | RT-DETRv2-r50vd, 42.9M | **0.776** mAP@50:95 (canonical DocLayNet) | 0.643 s/img (EPYC 7763, 4 threads) | 0.031 s/img (A100 bs200); 0.044 s (M3 Max MPS) | repo pushed 2026-07-29 |
| **Docling heron-101** | MIT | Apache-2.0 | RT-DETRv2-r101vd, 76.7M | **0.780** (canonical DocLayNet) | 0.988 s/img | 0.028 s/img (A100 bs200) | 2026-07-24 (models repo) |
| **Docling egret-m** | MIT | Apache-2.0 | D-FINE-medium, 19.5M | 0.765 (canonical DocLayNet) | **0.334 s/img** | 0.024 s/img; 0.033 s (M3 Max) | 2026-07-24 |
| **DocLayout-YOLO** | **AGPL-3.0** ⚠️ | Apache-2.0 (HF card) | YOLOv10-derived, 40.7 MB `.pt` | 79.7 mAP / 93.4 AP50 (DocLayNet); 81.8 / 95.8 (DocStructBench *Academic*) | not published | 85.5 FPS (A100) ≈ 0.012 s | pushed **2025-04-14**, 55 open issues |
| **PP-DocLayout-L** | Apache-2.0 | Apache-2.0 | RT-DETR-L, 123.76 MB | 90.4 mAP@0.5 (**vendor's private test set**) | 503 ms (251 ms high-perf) | 33.6 ms | PaddleOCR pushed 2026-07-22 |
| **PP-DocLayout-S** | Apache-2.0 | Apache-2.0 | PicoDet-S, 4.83 MB | 70.9 mAP@0.5 (private set) | **18.5 ms (6.3 ms high-perf)** | 11.5 ms | 2026-07-22 |
| **PP-DocLayoutV2 / V3** | Apache-2.0 | Apache-2.0 | RT-DETR + pointer net (reading order) | not published on card | — | — | V3 accepted ECCV 2026 |
| **Surya v2** | Apache-2.0 | **AI Pubs OpenRAIL-M, <$5M rev/funding** ⚠️ | 650M OCR VLM + RF-DETR fast-layout | 83.3% olmOCR-bench (whole-pipeline, vendor) | requires llama.cpp server | 5 pages/s (RTX 5090, vendor) | pushed 2026-07-23 |
| **LayoutLMv3** | **CC BY-NC-SA 4.0** ❌ | **CC BY-NC-SA 4.0** ❌ | ViT+text, Cascade R-CNN head | 95.1 mAP (PubLayNet) | — | 9.0 FPS (Detectron2) | unilm pushed 2026-01-23 |
| **LayoutLMv2** | **CC BY-NC-SA 4.0** ❌ | CC BY-NC-SA 4.0 ❌ | — | — | — | — | — |
| **DiT-L** | MIT (unilm root LICENSE) | not declared on HF card ⚠️ | BEiT + Cascade R-CNN (Detectron2) | 0.949 mAP (PubLayNet) | — | 6.0 FPS (A100) | — |
| **LayoutParser** | Apache-2.0 | Apache-2.0 (PubLayNet models) | Detectron2 Mask R-CNN X-101 | 88.98 mAP (PubLayNet, 5 cls) | — | — | last release **v0.3.4, 2022-04-06** |
| **Detectron2** | Apache-2.0 | n/a | framework | n/a | — | — | last release **v0.6, 2021-11-15** |

Latency figures for Docling are from Table 5 of arXiv:2509.11720 (<https://arxiv.org/html/2509.11720v1>) — vendor-run but on named hardware (AMD EPYC 7763 4 threads bs32; A100 bs100/200; Apple M3 Max MPS bs50). PaddleOCR CPU/GPU figures are from the PaddleOCR docs table cited above and are vendor-reported. DocLayout-YOLO FPS is vendor-reported on A100 in arXiv:2410.12628 Table 4.

---

## 3. The licence findings, in order of how much they hurt

**LayoutLMv2 and LayoutLMv3 are non-commercial.** The `microsoft/unilm/layoutlmv3` README states verbatim: *"The content of this project itself is licensed under the Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)"* — <https://github.com/microsoft/unilm/tree/master/layoutlmv3>. The identical clause appears in `layoutlmv2/README.md`. The HF card for `microsoft/layoutlmv3-base` carries the same CC BY-NC-SA 4.0 field (<https://huggingface.co/microsoft/layoutlmv3-base>). This is not ambiguous and it is not curable by fine-tuning: ShareAlike propagates. **Reject outright.** Note that `microsoft/unilm`'s *root* LICENSE is MIT and LayoutLM **v1**'s README defers to it — so v1 appears MIT, but v1 is a text-plus-position sequence labeller with no detection head worth using in 2026. This mixed-licence structure inside one repo is a trap: do not infer a subdirectory's licence from the repo badge.

**DocLayout-YOLO's code is AGPL-3.0.** The repo LICENSE file is verbatim GNU AGPL v3 (<https://github.com/opendatalab/DocLayout-YOLO/blob/main/LICENSE>), inherited from Ultralytics/YOLOv10. The DocStructBench *weights* on Hugging Face declare `apache-2.0` (<https://huggingface.co/juliozhao/DocLayout-YOLO-DocStructBench>). That split is real but of limited comfort: running inference requires the AGPL `doclayout_yolo` package, and AGPL §13 reaches network-served users. A PaperTree backend calling it over HTTP is exactly the case AGPL was written for. Using it would oblige source disclosure of the corresponding work, or a commercial Ultralytics licence.

**Surya is revenue-capped.** README line 69: *"The Surya code is licensed under Apache 2.0. The model weights use a modified AI Pubs Open Rail-M license (free for research, personal use, and startups under $5M funding/revenue)"* — <https://github.com/datalab-to/surya>. `datalab-to/surya_layout2` carries the same OpenRAIL-M. Workable for a pre-revenue PaperTree, but it is a licence you grow out of, and OpenRAIL-M additionally imposes use restrictions that survive.

**Docling is clean.** `docling` and `docling-ibm-models` are MIT (GitHub API, 2026-07-29). `docling-project/docling-layout-heron` and `-egret-large` declare **Apache-2.0**; the ONNX export `docling-layout-heron-onnx` is also Apache-2.0. The legacy `ds4sd/docling-models` layout model is CDLA-Permissive-2.0 (also fine). Training data is CDLA-Permissive DocLayNet plus IBM-proprietary DocLayNet-v2 plus WordScape — but IBM has released the *checkpoints* permissively, which is what matters.

**PaddleOCR is clean.** Apache-2.0 code, Apache-2.0 on `PP-DocLayout_plus-L`, `PP-DocLayoutV2` and `PP-DocLayoutV3` HF cards. This is the licence position MinerU inherits (MinerU ≥3.1 uses `PP-DocLayoutV2` as its layout model — see `09`'s sibling report `03-mineru.md`).

**Dataset licences:** DocLayNet annotations are CDLA-Permissive-1.0 (<https://huggingface.co/datasets/ds4sd/DocLayNet>). PubLayNet annotations are CDLA-Permissive-1.0 but *"IBM does not own the copyright of the images. Use of the images must abide by the PMC Open Access Subset Terms of Use"* (LICENSE.md); its pretrained models are separately Apache-2.0 (LICENSE.pretrained.model.md). DocBank is Apache-2.0 per its README.

---

## 4. Domain bias — the part nobody reports

- **PubLayNet** (360k+ pages) is *entirely* PubMed Central biomedical articles, with **automatically generated** annotations from PDF/XML matching. It is 5-class, biomedical, and its two-column layouts are journal-typeset, not arXiv/LaTeX. <https://github.com/ibm-aur-nlp/PubLayNet>
- **DocLayNet** (80,863 human-annotated pages) is deliberately *not* paper-heavy: its six categories are financial reports, manuals, scientific articles, laws & regulations, patents, government tenders — and the paper states the two largest categories are Financial Reports and Manuals. Scientific articles are a minority slice. <https://arxiv.org/abs/2206.01062>
- **DocBank** (500k pages) is the closest to PaperTree's domain — arXiv LaTeX sources 2014–2018, weakly supervised at token level, with `Equation` (40.3% of pages) and `Caption` (26.7%) classes. But it is arXiv-only, 8+ years stale, and its labels are derived not annotated. <https://github.com/doc-analysis/DocBank>
- **DocSynth300K** is 300k *synthetic* pages generated by a mesh-candidate bin-packing algorithm — a pretraining corpus, not a domain. <https://huggingface.co/datasets/juliozhao/DocSynth300K>
- **PP-DocLayout** was trained on a *self-built* Chinese+English corpus and evaluated on a *self-built* test set. Its headline 90.4 mAP@0.5 is therefore not comparable to any DocLayNet number.

**The uncomfortable number:** on DocLayNet, the best baseline per-class AP@0.5:0.95 for **Formula was 66.2** (YOLOv5x6) against a human inter-annotator agreement of 83–85; **Picture 77.1** against human 69–71; **Caption 77.7** against human 84–89 (arXiv:2206.01062 Table 2). Formula regions are the *hardest* class in the dataset, and it is the one PaperTree most needs.

---

## 5. Independent evaluations (not vendor-run)

**COTe framework, arXiv:2603.12718, submitted 2026-03-13** (Bourne, Simbeye, Govia) — <https://arxiv.org/html/2603.12718v1>. Compares Heron, PP-DocLayout L/M/S and DocLayout-YOLO on NCSE, HNLA2013 and DocLayNet, decomposing performance into Coverage / Overlap / Trespass. Findings: **no single model wins everywhere.** On HNLA2013, DocLayout-YOLO scored COTe 0.86 vs Heron 0.80; on NCSE, PP-DocLayout-L 0.72 vs Heron 0.59 and DocLayout-YOLO 0.59. Characteristic failure modes differ: **Heron has near-zero Trespass (0.00–0.01) but higher Overlap (0.18–0.28); DocLayout-YOLO has the highest Coverage (0.92–0.96) but pays Overlap and Trespass penalties.** For PaperTree — where a spurious region that swallows a neighbouring column is worse than a missed one — *low Trespass is the property you want*, and that favours Heron. Caveat: their DocLayNet column reports mAP ≈ 0.01 for every model, which is implausible and suggests a class-mapping mismatch in their harness; I would not use their DocLayNet row.

**World Bank benchmark, arXiv:2606.06242, 2026-06-04** (Dy & Solatorio) — <https://arxiv.org/html/2606.06242v1>. 476 PDFs / 7,717 pages of institutional reports. For **figure** extraction: DocLayout-YOLO precision 0.547 / recall 0.802 / IoU 0.820, versus YOLOv11-DocLayNet 0.378/0.761/0.817 and TF-ID-Large 0.628/0.488/0.877. Their conclusion is directly relevant: *"existing layout detectors remain optimized for generic figure and table identification rather than semantic differentiation of analytical content"*, with failure modes of **fragmentation of composite artifacts** and **incomplete contextual extraction**. A multi-panel CS figure (Fig. 3a/3b/3c) is exactly a composite artifact.

---

## 6. Maintenance evidence

- **Docling:** releases v2.112.0 → v2.116.0 between 2026-07-11 and 2026-07-29 — roughly weekly. `docling-ibm-models` v3.13.3 on 2026-06-04. 958 open issues, but on a repo shipping weekly that reads as throughput, not rot.
- **DocLayout-YOLO:** last push **2025-04-14**, 55 open issues. Recent issues are unanswered and substantive: *"Bounding box coordinates looks not correct"* (2026-01-10, 0 comments), *"Missing annotation_file.json for numeric label mapping in DocSynth300K"* (2025-12-28, 0 comments), *"CPU inference optimizations"* (2026-06-10, 0 comments). **This project is dormant.**
- **LayoutParser:** last release **v0.3.4 (2022-04-06)**, last push 2024-08-15, 121 open issues — including **#227 "Broken Dropbox links for models/configs" (opened 2026-04-02, still open)** and #185 "Failed to download https://www.dropbox.com/…/config.yaml". The model zoo is hosted on Dropbox and is partially unreachable. It also requires **Detectron2, whose last release was v0.6 on 2021-11-15** (no PyPI wheels; source builds against modern PyTorch are a recurring problem). Do not build on this.
- **PaddleOCR:** pushed 2026-07-22, active. **Surya:** pushed 2026-07-23, active. **unilm:** pushed 2026-01-23 (684 open issues), effectively archive-grade for LayoutLM.

---

## 7. Implications for PaperTree

**Recommendation: adopt `docling-layout-heron` as the layout detector, exposed behind an interface that lets you swap in `egret-medium` (CPU) or `heron-101` (GPU worker).** Docling already implements exactly this indirection (`LayoutModelConfig` in `docling/datamodel/layout_model_specs.py`, default documented as `DOCLING_LAYOUT_HERON`), so you can adopt the model without adopting all of Docling.

Against PaperTree's hard requirements:

- **Geometry survives — with work you must own.** `LayoutPredictor.predict()` in `docling-ibm-models` returns `[left, top, right, bottom]` **in input-image pixel space, origin top-left** (docstring, `layout_predictor.py`). PDF user space is origin bottom-left in points. The raster→PDF affine (render DPI, page rotation, MediaBox/CropBox offset) is *your* code to write and test. This is the single highest-risk integration detail and it is where silent misalignment will come from.
- **Stable block identity: not provided by any model here.** Detector outputs are unordered and non-deterministic across versions. PaperTree must mint IDs from content+geometry (e.g. hash of normalised text + quantised bbox + page), never from detection index.
- **Hierarchy: not provided.** These are flat detectors. `Section-header` gives you the *anchors*; building the tree (nesting by font size / numbering / reading order) is downstream. PP-DocLayoutV2/V3 are the only ones that also predict **reading order** natively (RT-DETR + pointer network), which is a genuine advantage if you go the PaddleOCR route.
- **Equations as LaTeX: two-stage, and that is the right shape.** The layout model gives a `Formula` region; LaTeX recovery needs a separate recogniser (UniMERNet, Apache-2.0; or texify). Keeping them separate means the **source region is retained by construction** — which is exactly PaperTree's requirement, and a structural advantage over end-to-end VLM parsers that emit LaTeX with no provenance box.
- **Vector figures: this is the strongest argument for a layout detector.** Detectors run on a *rendered raster*, so a vector architecture diagram is detected as a `Picture` region identically to a raster one — no dependence on embedded XObjects. You then get a clip rectangle you can use to re-render that region from the PDF at arbitrary resolution, or to extract the vector operators inside it. Text-layer-only parsers cannot do this at all. Caveat from arXiv:2606.06242: **multi-panel figures fragment**, so plan a merge pass (union adjacent `Picture` boxes that share a single `Caption`).
- **Captions linked: nearest-neighbour, not free.** `Caption` is a class; the figure↔caption *association* is your geometry heuristic (vertical adjacency within column, caption below figure / above table for most venues).
- **No hallucination:** object detectors cannot rewrite content — they only propose boxes with scores. Confidence is natively representable (per-box score, and Docling's `base_threshold`). This is materially safer than a VLM parser.
- **Cost on CPU is acceptable.** `egret-medium` at **0.334 s/page** on 4 EPYC threads means a 12-page paper in ~4 s single-threaded-ish; `heron` at 0.643 s/page ≈ 8 s. Both are viable without a GPU. On Apple Silicon MPS, heron is 0.044 s/page. A later GPU worker with heron-101 at 0.028 s/page (A100, bs200) is a drop-in upgrade. An ONNX export (`docling-layout-heron-onnx`, Apache-2.0) exists for CPU deployment.

**Fallback ranking if Heron underperforms on your own 2-column corpus:** (1) `PP-DocLayout_plus-L` / `PP-DocLayoutV2` — Apache-2.0, 23 classes with the finest granularity (separate `formula number`, `chart`, `algorithm`), plus native reading order; the cost is a Paddle/PaddleX dependency and unverifiable benchmark numbers. (2) Fine-tune `egret-medium` or an Apache-2.0 RT-DETRv2 on **DocBank** (Apache-2.0, arXiv-derived, has `Equation`+`Caption`) — this is the only route that directly targets the two-column LaTeX domain. (3) Surya, *only* while under the $5M cap, and only if you accept re-licensing later; its label set is the richest for papers (`Equation`, `Figure` vs `Picture` vs `Diagram`, `ChemicalBlock`, `Bibliography`).

**Do not use:** LayoutLMv2/v3 (non-commercial), LayoutParser+Detectron2 (abandoned, broken downloads, 5-class zoo), DocLayout-YOLO (AGPL + dormant since 2025-04-14) unless you buy an Ultralytics licence.

---

## 8. What I could not verify

- **No benchmark measures what PaperTree actually needs.** I found *no* published per-class mAP for `Caption`/`Formula`/`Picture` restricted to **two-column academic PDFs** for Heron, egret, or PP-DocLayout. The closest proxies are DocLayNet per-class (mixed domains, arXiv:2206.01062 Table 2) and DocLayout-YOLO's DocStructBench *Academic* subset (81.8 mAP / 95.8 AP50 — but only 402 test images, and evaluated by the model's own authors). **You will have to build your own 100-page labelled arXiv set to decide this properly.** I would treat that as a prerequisite, not a nice-to-have.
- **Heron's per-class breakdown is not published.** arXiv:2509.11720 Tables 3–5 give only aggregate mAP/AP-50/AP-75 and size-stratified AP. I could not find `Formula`-specific or `Caption`-specific AP for any Docling model.
- **DocLayNet's exact category percentages.** The paper's Figure 2 shows the distribution but I could not extract numeric percentages from the PDF or the ar5iv HTML; the commonly quoted "~17% scientific articles" is **not** something I verified from a primary source. The paper text confirms only that Financial Reports and Manuals are the two largest.
- **DiT weight licence.** `microsoft/unilm` root is MIT and `unilm/dit/README.md` contains *no* licence section (verified by grep against the raw file via the GitHub API), so DiT presumably inherits MIT — but `huggingface.co/microsoft/dit-base` declares no licence field at all. **Unresolved.** Given DiT's PubLayNet-only 5-class head and 6.0 FPS, it is not worth chasing.
- **DocLayout-YOLO parameter count.** The paper does not state params for any method; I have only the artefact size (40.7 MB `.pt`). I did not convert that to a parameter count because the dtype is unstated.
- **Surya v2's layout accuracy in isolation.** The 83.3% olmOCR-bench figure is a whole-pipeline OCR score, self-reported, not a layout mAP. `datalab-to/surya_layout2`'s card carries no benchmark numbers and does not name its architecture; I inferred **RF-DETR** from a source comment in `surya/settings.py` (*"Checkpoint may be a local dir (rf-detr .pth + config.json)"*), which is suggestive but not an official statement.
- **PP-DocLayoutV2/V3 numbers.** Neither HF card publishes mAP, size, or latency. The V3 paper is cited as accepted to ECCV 2026 but I did not locate the camera-ready text.
- **PP-DocLayout's 90.4 mAP@0.5** is on a vendor-built private test set with no public split — it is not comparable to DocLayNet numbers and should not be put in the same column as one.
- **CPU latency for DocLayout-YOLO and Surya layout** is not published by either project; I found no trustworthy independent measurement.
- **The COTe paper's DocLayNet rows** report mAP ≈ 0.01 for all five models, which I believe indicates a bug or class-mapping mismatch in their evaluation rather than a real result. I have not been able to confirm either way.
