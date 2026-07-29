# 07 — Formula / Math Recognition Systems

**Research date:** 2026-07-29. Most recent primary evidence found: [arXiv:2512.09874v2, revised 2026-05-05](https://arxiv.org/abs/2512.09874) and GitHub repo state queried 2026-07-29.

---

## 0. Bottom line

Equation→LaTeX is **three separable problems**, and conflating them is the main architectural mistake available here:

1. **Region detection** — find the equation, get a page number + bbox. *Cheap, permissively licensed, solved-enough.*
2. **Crop → LaTeX (MER proper)** — the thing all the papers benchmark. *Solved for display math on printed/rendered input; ~0.92 BLEU / ~0.96 CDM.*
3. **Inline math recovery** — genuinely unsolved in open source; most benchmarks *exclude it by construction*.

For PaperTree the decisive filter is not accuracy — the top open models are within a few points of Mathpix — it is **licence**. Nougat's weights are CC-BY-NC. Texify is archived and GPL-3.0. Surya's weights carry a $5M cap *plus a non-compete clause plus share-alike on the model's output*. MinerU2.5's weights are AGPL-3.0. DocTron-Formula has **no licence file at all**. After that filter, the field narrows to **PaddleOCR's PP-FormulaNet family** and **UniMERNet**, both Apache-2.0 end-to-end.

---

## 1. Comparison table

| System | Code licence | **Weight licence** | Params / size | Reported accuracy (source) | Speed | Maintenance (last push, checked 2026-07-29) |
|---|---|---|---|---|---|---|
| **UniMERNet-B** | Apache-2.0 | **Apache-2.0** ([HF](https://huggingface.co/wanderkid/unimernet_base)) | 325M / 1.3 GB | BLEU SPE .915 / CPE .925 / SCE .626 / HWE .895; CDM 0.9680, ExpRate@CDM 0.8110 ([paper](https://arxiv.org/html/2404.15254v2), [CDM paper](https://arxiv.org/html/2409.03643v2)) | 5.06 FPS (self-reported); 8288 ms/formula CPU ([PaddleX](https://paddlepaddle.github.io/PaddleX/3.3/en/module_usage/tutorials/ocr_modules/formula_recognition.html)) | 2025-09-28, 38 open issues (mostly CDM-tooling bugs) |
| **PP-FormulaNet_plus-S** | Apache-2.0 | **Apache-2.0** ([HF](https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-L)) | 248 MB | En-BLEU 88.71%, Zh-BLEU 53.32% (vendor self-reported) | **261 ms CPU**, 179 ms GPU (T4) | PaddleOCR pushed 2026-07-22 |
| **PP-FormulaNet_plus-L** | Apache-2.0 | **Apache-2.0** | 698 MB | En-BLEU 92.22%, Zh-BLEU 90.64% (vendor) | 3126 ms CPU, 1476 ms GPU (T4) | active |
| **pix2tex / LaTeX-OCR** | MIT | MIT | ~99 MB (PaddleX repack) | BLEU 0.88, norm-edit 0.10, token-acc 0.60 (author self-reported [README](https://github.com/lukas-blecher/LaTeX-OCR)); CDM **0.6360** | 1089 ms (T4) | **2025-01-18**, 159 open issues — dormant |
| **Texify** | GPL-3.0 | GPL-3.0 | 312M | BLEU SPE .906 / CPE .900 / SCE .599 / HWE .888; CDM 0.7550 | 4.16 FPS | **ARCHIVED** 2025-01-29 |
| **Surya LaTeX-OCR** | Apache-2.0 | **modified AI-Pubs OpenRAIL-M** — see §3.3 | 650M | 83.3% olmOCR-bench (whole-page, not formula-specific) | 5.35 pg/s RTX 5090; **0.108 pg/s** CPU/Metal | 2026-07-23, active |
| **Nougat** | MIT | **CC-BY-NC-4.0** ([HF](https://huggingface.co/facebook/nougat-base)) | 250M / 350M | Math: edit-dist 0.117, BLEU 56.0, F1 76.9 (small) | ~3.25 s/page (A10G 24 GB) | 2025-02-21, 143 open issues — dormant |
| **MinerU2.5** | Apache-2.0 + thresholds | **AGPL-3.0** ([HF](https://huggingface.co/opendatalab/MinerU2.5-2509-1.2B)) | 1.2B | OmniDocBench formula **CDM 88.46** | 2.12 pg/s (A100-80G, vLLM) | 2026-07-29, active |
| **DocTron-Formula** | **none** | none | Qwen2.5-VL 3B/7B SFT | CSFormula avg CDM **0.873** vs UniMERNet 0.524 | not reported | 2025-08-05 |
| **Mathpix Convert API** | closed | closed | n/a | CDM 0.9510, ExpRate@CDM 0.5000; OmniDocBench CDM 86.6 | API | commercial |
| **Azure DI `ocr.formula`** | closed | closed | n/a | not published | API | GA (2024-11-30 API) |
| **Google Doc AI Math OCR** | closed | closed | n/a | not published | API | RC v2.1.1-2025-01-31 |
| **im2markup** | MIT | MIT | LSTM enc-dec | historic baseline ([arXiv:1609.04938](https://arxiv.org/abs/1609.04938)) | — | 2023-10-27 — abandoned |

---

## 2. The metric question: BLEU is broken, CDM is better but not settled

**Why BLEU fails.** `\frac{a}{b}` and `\dfrac{a}{b}`, or `x^{2}` vs `x^2`, render identically but score differently. The CDM authors state plainly that BLEU/EditDistance "overlook the fact that the same formula has diverse representations and is highly sensitive to the distribution of training data" ([arXiv:2409.03643](https://arxiv.org/abs/2409.03643), CVPR 2025).

**How CDM works.** Render both prediction and ground truth to images, colouring each LaTeX token in a unique RGB value (a fixed-interval colour list giving ~5,832 distinguishable colours), extract per-token bounding boxes by colour, then Hungarian-match tokens using a cost combining token identity (0 / 0.05 for visually-equivalent / 1), L1 positional distance, and reading-order similarity; RANSAC prunes geometrically inconsistent matches; the score is F1. `ExpRate@CDM` is the fraction of formulas with CDM = 1.

**The number that matters most.** On UniMER-Test the ordering flips depending on metric: Mathpix beats UniMERNet on SCE BLEU (0.8182 vs 0.6160) but *loses* on SCE CDM (0.9238 vs 0.9461) — the BLEU gap was training-distribution artefact, not quality. Likewise on OmniDocBench, [Mathpix scores CDM 86.6 but ExpRate@CDM only **2.8**](https://github.com/opendatalab/OmniDocBench) — because Mathpix systematically omits trailing punctuation, an ExpRate-fatal but semantically-irrelevant difference.

**CDM's own failure modes** (stated by its authors): unrenderable LaTeX is scored 0, conflating "wrong" with "syntactically broken" — render-failure rate was 1.05% for UniMERNet vs **13.83% for pix2tex**; visually-identical distinct tokens (`\mathcal{E}` vs `\varepsilon`); line-breaking misalignment on multi-line formulas; and hallucinated-but-structurally-similar output from VLMs scoring 0.6–0.9. The authors report 96% agreement with human preference on 1,008 samples — **self-reported**.

**Counter-evidence from 2026.** Horn & Keuper ([arXiv:2512.09874v2](https://arxiv.org/abs/2512.09874), rev. 2026-05-05) ran a 30-evaluator human study (250 formula pairs, 750 ratings) and found Pearson **r = 0.78 for LLM-as-a-judge, r = 0.34 for CDM, r ≈ 0 for text-similarity metrics**. That is a meaningfully weaker endorsement of CDM than the CDM paper's own study. Treat CDM as a good *regression gate*, not as ground truth.

---

## 3. System notes

### 3.1 UniMERNet — the reference open model
Swin-style encoder with Fine-Grained Embedding (two 3×3/stride-2 convs) + depthwise Convolutional Enhancement, mBART decoder with Squeeze Attention; UniMERNet-B is 325M params, encoder depth [6,6,6,6], hidden 1024. Trained on **UniMER-1M (1,061,791 samples)** — SPE 725,246 / CPE 110,332 / HWE 83,338 (CROHME 8,836 + HME100K 74,502) — plus a 16M image-text pre-training corpus from arXiv, on 8×A100-80GB for 300k iterations at **max sequence length 1536**. UniMER-Test is 23,789 samples. Apache-2.0 code and weights. Repo effectively in maintenance mode: last commit 2025-09-28, and the open-issue character is telling — most are about the *CDM tooling* (NaN scores, Chinese-formula render bugs), not the model.

### 3.2 pix2tex / LaTeX-OCR — MIT but hard-capped
ViT-with-ResNet-backbone encoder + transformer decoder, trained on arXiv/Wikipedia + IM2LATEX-100K. Its shipped config is the real limitation: `max_seq_len: 512`, `max_width: 672`, `max_height: 192` ([config.yaml](https://github.com/lukas-blecher/LaTeX-OCR/blob/main/pix2tex/model/settings/config.yaml)). Anything wider than 672px is downscaled, and long multi-line derivations exceed 512 tokens. This shows in the numbers: SCE BLEU 0.092, HWE BLEU 0.012 on UniMER-Test, and a 13.83% LaTeX render-failure rate. Licence is ideal, quality is not.

### 3.3 Texify / Surya — licence traps
Texify is **archived** (GPL-3.0, last push 2025-01-29); its README redirects to Surya's `surya_latex_ocr`. Surya's *code* is Apache-2.0, but [MODEL_LICENSE](https://github.com/datalab-to/surya/blob/master/MODEL_LICENSE) is a modified AI-Pubs OpenRAIL-M with three separate problems for a commercial product: (a) Attachment A §2(a)/(b) bar use if you exceed **$5M gross revenue or $5M raised equity/debt**; (b) §2(c) bars use "if You … provide … any product or service that competes with any product or service offered by … Licensor or any of its affiliates" — Datalab sells document-parsing products; (c) §8 **Share-a-Like applies the licence to "the Output and any derivatives … of the Output."** That last clause would arguably attach to every LaTeX string PaperTree stores. **Reject unless dual-licensed.**

### 3.4 Nougat — non-commercial weights, and the repetition problem
Code MIT, weights **CC-BY-NC-4.0**. Per-modality results on the arXiv test set: Nougat-small (250M) Math edit-distance 0.117, BLEU 56.0, F1 76.9; Nougat-base (350M) Math edit 0.128, BLEU 56.9, F1 76.5. For contrast, GROBID+LaTeX-OCR scored Math BLEU **0.3** and F1 9.7. Speed: A10G 24 GB, 6 pages in parallel, ~19.5 s/batch ≈ 3.25 s/page. The paper's own §5.4 documents degeneration into repetition loops on **1.5% of test pages**, higher out-of-domain, with non-Latin scripts producing "instant repetitions." That is exactly the *silent hallucination* PaperTree must not ship. Dormant (last push 2025-02-21).

### 3.5 PP-FormulaNet — the CPU-viable Apache-2.0 option
PP-FormulaNet-L = Vary-ViT-B encoder + 512-dim mBART decoder; -S = PP-HGNetV2-B4 encoder (15.6M) + 384-dim decoder, with knowledge distillation and multi-token prediction ([arXiv:2503.18382](https://arxiv.org/abs/2503.18382)). Vendor-reported on the paper's own arXiv-4M set: PP-FormulaNet-L beats UniMERNet on CPE-BLEU (0.9392 vs 0.8659) and Hard-BLEU (0.9213 vs 0.8613); PP-FormulaNet-S runs 202 ms vs UniMERNet's 2267 ms at batch=1. The PaddleX table (T4 GPU, Xeon Gold 6271C CPU, FP32, no TensorRT) gives **PP-FormulaNet_plus-S: 88.71% En-BLEU, 248 MB, 261 ms CPU** versus UniMERNet's 8288 ms CPU. All numbers are vendor self-reported on an internal test set — treat as directional, verify locally.

### 3.6 Commercial APIs
- **Mathpix**: $0.002/image (0–1M), $0.0015 (1M+); $0.005/PDF-page (0–1M), $0.0035 (1M+); $19.99 one-time setup, $29 test credit ([pricing](https://mathpix.com/pricing/api)). Gotcha: images with >12 rows of text bill at PDF rates.
- **Azure Document Intelligence** `features=formulas`: returns per-formula `{kind: "inline"|"display", value: <LaTeX>, polygon, span, confidence}` — the only turnkey system found that classifies inline vs display *and* gives polygons ([docs](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/add-on-capabilities?view=doc-intel-4.0.0)). **Critical caveat, stated in the docs: "The `confidence` score is hard-coded."** Pricing verified 2026-07-29 against the Azure Retail Prices API (eastus): `S0 Layout Pages` **$10/1K**, `S0 Add-on for Pages` **$6/1K** → **$0.016/page**, 3.2× Mathpix. Free tier 500 pages/month.
- **Google Document AI**: `ProcessOptions.ocrConfig.premiumFeatures.enableMathOcr` emits `visualElements` of `type: "math_formula"` with LaTeX and bounding boxes; supported on `pretrained-ocr-v2.0-2023-06-02`, `v2.1-2024-08-07`, `v2.1.1-2025-01-31` (RC). Mutually exclusive with selection-mark detection ([docs](https://docs.cloud.google.com/document-ai/docs/enterprise-document-ocr)).

### 3.7 TrOCR-based MER
TrOCR is a poor base for LaTeX: its text tokenizer is not adapted to LaTeX syntax, and fine-tuned handwritten-MER results reported around 25% exact match. **This figure is from a secondary summary of a paper I could not retrieve** (HAL/Springer, access-blocked) — do not cite it without verification. TexTeller builds on TrOCR with 7.5M pairs but published no evaluation metrics.

---

## 4. Detecting equation regions

This is the part that actually delivers PaperTree's geometry requirement, and it is cheap.

- **PaddleOCR PP-DocLayout (Apache-2.0)** — categories explicitly include **`formula` and `formula_number`**, plus `abstract`. On T4/Xeon-Gold-6271C: PP-DocLayout-L mAP@0.5 **90.4**, 123.76 MB, 33.6 ms GPU / 251–503 ms CPU; **PP-DocLayout-S mAP@0.5 70.9, 4.83 MB, 6.3–18.5 ms CPU** ([module docs](https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/docs/version3.x/module_usage/layout_detection.en.md)). The separate `formula_number` class is the single most useful thing here — it gives equation numbering as a *sibling attribute* rather than contaminating the LaTeX.
- **DocLayout-YOLO** — mAP 79.7 (DocLayNet) / 70.3 (D4LA), but **AGPL-3.0**. Reject.
- **PDF-Extract-Kit** (UniMERNet MFR + YOLOv8 MFD) — repo-level **AGPL-3.0** because of YOLO and PyMuPDF dependencies. Reject as a whole; the constituent UniMERNet weights remain Apache-2.0 and can be used directly.
- **Born-digital shortcut**: for arXiv-style PDFs, math glyphs sit in identifiable font families (`cmmi`, `cmmib`, `cmsy`, `cmex`, MSAM/MSBM, STIX-Math, Cambria Math). Clustering text-layer glyphs by math font + operator vocabulary gives candidate regions with *exact* PDF coordinates and zero model cost — the right first pass, with the detector as fallback for scanned pages.

---

## 5. Inline math — the genuinely hard part

Every serious source agrees this is unsolved:

- Nougat's authors: *"it is not always possible to determine where an inline math environment ends and text begins … `$\mathrm{H}_{0}$1,` vs `H$_{0}$1,`"* — and note this ambiguity depresses **both** math and plain-text scores.
- **OmniDocBench** (1,651 pages, Apache-2.0) annotates `equation_inline` as a category but evaluates only `equation_isolated`; Horn & Keuper record that it *"must exclude inline formulas as variability in parser output formats renders regex-based matching to ground truth unreliable."*
- The 2026 benchmark's own corpus is **1,411 inline vs 641 display** formulas — inline is the majority of real math — and they had to build a two-stage LLM-matching pipeline just to *align* parser output with ground truth.
- Azure DI is the only off-the-shelf system found that returns `kind: "inline"` with a polygon; its confidence field is hard-coded, so it cannot express uncertainty.

**Practical implication:** do not attempt to OCR inline math from rasters. For born-digital PDFs, recover inline spans from the text layer via math-font + operator heuristics, store them as *math-candidate spans with an explicit low-confidence flag*, and render them as plain glyphs unless the user opts in to conversion.

---

## 6. Multi-line, matrices, equation numbering

- **Multi-line / aligned**: UniMER-Test's CPE subset is defined only as "longer, more intricate formulas" — the paper does **not** state whether `align`/`array`/`cases` are represented. Max LaTeX string length in UniMER-Test is 7,037 chars (mean 79.48), and training used max sequence length 1536, so long derivations are within scope but under-represented. CDM's own limitations section flags line-breaking as a misalignment source. **Verify empirically before trusting.**
- **Matrices**: no reviewed paper reports a matrix-specific breakdown. CSFormula (DocTron-Formula) is the only benchmark that explicitly targets paragraph- and page-level structured formulas, where UniMERNet collapses: CSFormula-Page edit-distance **0.903 for UniMERNet vs 0.251 for DocTron-Formula**. That is the clearest evidence that current single-crop MER models degrade badly on structurally complex, multi-block math.
- **Equation numbering**: no MER model handles it — the number is outside the formula crop. Handle it in the *detector* layer via PP-DocLayout's `formula_number` class.

---

## 7. Implications for PaperTree

**Adopt a detect-then-recognise pipeline, not an end-to-end page VLM.** Nougat, MinerU2.5, olmOCR and Surya emit a markdown/HTML blob with no per-element PDF coordinates. That fails PaperTree's first two hard requirements (page + bbox; stable addressable block identity) at the architectural level, and Nougat's documented 1.5% repetition-collapse rate fails the no-silent-hallucination requirement. A detector gives you the bbox *before* recognition runs, so the anchor survives even when the LaTeX is wrong or absent.

**Recommended equation path:**

1. **Region detection** — PP-DocLayout-L (Apache-2.0, 90.4 mAP, ~250 ms/page CPU) producing `formula` and `formula_number` boxes. Born-digital fast path: math-font clustering on the text layer for exact coordinates. Block ID = stable hash of (page, normalised bbox, ordinal) so re-parses re-anchor highlights.
2. **Default recogniser (no GPU)** — **PP-FormulaNet_plus-S**, Apache-2.0, 248 MB, ~261 ms/formula on a Xeon-class CPU, En-BLEU 88.71%. A dense CS paper with 40 display equations costs ~10–12 s CPU for the whole math pass. This is the no-GPU fallback and it is genuinely usable, not a token gesture.
3. **Optional GPU worker** — **PP-FormulaNet_plus-L** (92.22% En-BLEU) or **UniMERNet-B** (CDM 0.9680, ExpRate@CDM 0.8110). Both Apache-2.0 in code *and* weights. Route to it on low-confidence or long crops.
4. **Escalation for hard pages** — Mathpix at $0.005/page, used sparingly (scans, screenshots, historical PDFs). Note Mathpix's punctuation-omission habit (ExpRate@CDM 2.8 on OmniDocBench) — normalise trailing punctuation before diffing.
5. **Inline math** — text-layer heuristics only; store as flagged candidate spans. Do not OCR.
6. **Uncertainty** — store decoder sequence log-prob per formula plus a *render check* (compile the LaTeX; unrenderable ⇒ mark unverified and fall back to the cropped image). Never rewrite. The cropped source region must always be retained and displayable — this satisfies "uncertainty must be representable" better than any confidence score, and is mandatory given Azure's hard-coded confidence.
7. **Evaluation** — build an internal set from your own corpus; gate regressions on **CDM + render-failure-rate reported separately** (CDM alone conflates wrong-and-broken), and spot-check with an LLM judge given the r=0.78 vs r=0.34 finding.

**Explicitly rejected on licence:** Nougat (CC-BY-NC weights), Texify (archived + GPL-3.0), Surya weights (OpenRAIL-M: $5M revenue *and* $5M funding caps, non-compete clause, share-alike on Output), MinerU2.5 weights (AGPL-3.0), DocLayout-YOLO (AGPL-3.0), PDF-Extract-Kit (AGPL-3.0), DocTron-Formula (**no LICENSE file — legally unusable regardless of its excellent CSFormula numbers**). MinerU's *code* relicensed in 2026 to Apache-2.0 with thresholds (100M MAU / $20M monthly revenue) plus a mandatory attribution obligation for online services — acceptable in itself, but its weights are AGPL, which is what actually matters.

**Cost anchor:** Azure Layout+formulas = $0.016/page; Mathpix = $0.005/page; PP-FormulaNet_plus-S self-hosted = CPU seconds. Self-hosting wins decisively at PaperTree's expected volumes.

---

## 8. What I could not verify

- **PP-FormulaNet / PP-FormulaNet_plus accuracy figures are entirely vendor self-reported** on a "PaddleX Internal Self-built Formula Recognition Test Set" that is not public. No third-party CDM evaluation of PP-FormulaNet exists that I could find. The claim "surpasses UniMERNet by 6%" is the vendor's own.
- **CPU latency numbers in the PaddleX table** are ambiguous: the column header is "[Normal Mode / High-Performance Mode]" and the normal-mode cell rendered as "—" in every fetch I made. The 261 ms figure may be high-performance mode only. **Benchmark locally before committing.**
- **PP-FormulaNet's GPU model** for the arXiv paper's ms figures is not stated in the paper; the PaddleX table's T4 numbers may not correspond.
- **Whether UniMER-Test CPE contains `align`/`array`/`cases`/matrix environments** — the paper does not say, and I could not inspect the dataset.
- **TrOCR MER's 25% exact-match figure** — secondary source only; the HAL/Springer paper was access-blocked (Anubis challenge).
- **Google Document AI math-OCR pricing** — the official pricing page is JS-rendered and could not be parsed. Secondary sources say $1.50/1K pages Enterprise OCR + $6/1K add-ons; **unverified**. Azure's numbers, by contrast, were verified directly against the Azure Retail Prices API.
- **Surya's LaTeX-OCR accuracy on any formula benchmark** — Datalab publishes an 83.3% olmOCR-bench whole-page figure, not a formula-specific one. Moot given the licence.
- **Horn & Keuper's per-parser inline-vs-display split and CDM scores** — the paper states these are "available on the project GitHub page" but the table in the PDF reports only the combined LLM-judge score. I did not locate that repo.
- **Whether Datalab would grant PaperTree a dual licence, and at what price** — not investigated.
- **Real-scanned vs rendered robustness**: the only quantitative signal is UniMER-Test's SCE (screen-captured) subset, where *every* model is weakest (best CDM 0.9373, BLEU 0.626). No system reviewed publishes results on genuinely scanned/photocopied journal pages; Horn & Keuper explicitly list scanned documents as outside their synthetic benchmark's coverage.
