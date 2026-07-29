# PDF-to-Tree (Findings of EMNLP 2024) — Deep Dive

**Reviewed:** 2026-07-29. **Most recent primary evidence:** repo issue comment dated 2025-07-16; last code commit 2024-11-29.
**Verdict up front:** **Adopt the ideas, reject the system.** The paper is a genuinely useful formulation of "document → tree", but the artifact is not deployable: no pretrained weights are released, the repo has **no licence at all**, the best-scoring configuration depends on **CC BY-NC-SA 4.0 (non-commercial)** backbone weights, and the model operates only over **text blocks** — it never sees figures, vector diagrams, equations-as-glyphs, or table geometry.

---

## 1. Identity and provenance

| Field | Value |
|---|---|
| Title | PDF-to-Tree: Parsing PDF Text Blocks into a Tree |
| Authors | Yue Zhang, Zhihao Zhang, Wenbin Lai, Chong Zhang, Tao Gui, Qi Zhang, Xuanjing Huang (Fudan University: School of CS; Institute of Modern Languages and Linguistics; Shanghai Key Lab of Intelligent Information Processing) |
| Venue | Findings of ACL: EMNLP 2024, pp. 10704–10714 |
| DOI | 10.18653/v1/2024.findings-emnlp.628 |
| Paper licence | CC BY 4.0 ([ACL Anthology](https://aclanthology.org/2024.findings-emnlp.628/)) |
| Code | https://github.com/yuezh000/PDF-to-Tree |
| Citations | 6 (Semantic Scholar, `influentialCitationCount` = 0), queried 2026-07-29 via `api.semanticscholar.org/graph/v1/paper/DOI:10.18653/v1/2024.findings-emnlp.628` |

Citing work is downstream RAG-chunking research (e.g. *MultiDocFusion*, *M3DocDep*, *ChunkNorris*) — nobody appears to have re-implemented or benchmarked the parser independently.

## 2. Problem definition, and why linear reading order is insufficient

Prior work frames PDF structure recovery as **reading-order prediction**: assign a global rank to every text block and link them into one sequence (LayoutParser, LayoutReader, ERNIE-Layout, cited in §1 of the [paper](https://aclanthology.org/2024.findings-emnlp.628.pdf)). The paper's argument against this, stated in §1, is twofold:

1. **Independent elements pollute the sequence.** Footnotes, captions, headers and page numbers "should have their own reading order"; forcing them into the main text stream "might lead to confusion."
2. **Downstream indexing needs nesting.** RAG "require[s] breaking down long documents into sections, subsections and table rows" — a flat rank cannot express that a paragraph belongs to a subsection which belongs to a section.

This maps directly onto PaperTree's own thesis: a single linear stream is the wrong primitive for a reading environment.

## 3. Tree representation

Figure 1(c) shows the target: `root → {title, abstract → paragraph → token, section → subsection → {paragraph, table → table row → cell}, footnote → annotation}`.

**Node labels.** The paper says "18 categories of labels" (§3.1). The released code confirms the inventory in [`p2t/parser/tree.py`](https://github.com/yuezh000/PDF-to-Tree/blob/main/p2t/parser/tree.py) — 18 semantic labels plus one structural relation:

> `paragraph, other, meta, content, title, reference, table_text, annotation, page_num, header, equation, caption, footer, figure_text, answer, question, person_info, section` — plus `sibling`.

Note what is **absent**: no `figure`, no `table`, no `table_row`, no `cell`, no `subsection`, no `abstract`. Figure 1(c)'s `table → table row → cell` is an illustration of the *annotation numbering scheme* (Appendix A describes labels like `table-5-3-1` = first cell, third row, fifth element), not of the released label vocabulary. Row/cell addressability, if present in the data at all, must be recovered from tree **nesting depth** of `table_text` nodes, not from typed labels.

**Edge labels.** Labels live on arcs, not nodes: an arc is `(head, tail, label)` and the label is the node type of the dependent, e.g. `ARC(ROOT, T1, title)`, `ARC(T1, T2, abstract)` (Figure 2). The tree itself is stored as a **left-child / right-sibling binary structure** — each `TreeNode` has exactly one `child` and one `sibling` pointer, and `append_child` raises `ValueError("Too many children")` on a second child (`tree.py`). So sibling chains encode the reading order *within* a container, and child links encode descent. That is an elegant unification of "hierarchy" and "independent reading orders" in one structure.

## 4. Transition-based parsing formulation

Configuration `c = (s, b, A)`; initial state `A = ∅`, `s = [ROOT]`, `b = [T1…Tn]` (§2.1).

**Action set per the paper (§2.1):**
- `SHIFT` — pop the first buffer element, push onto the stack.
- `ARC(label, stack_ptr)` — create an arc from *any element of the stack* to the first buffer element, and predict the arc label.

**Action set per the released code** ([`p2t/parser/state.py`](https://github.com/yuezh000/PDF-to-Tree/blob/main/p2t/parser/state.py)) is richer, and the paper does not describe it:
- `shift`, `reduce(label, stack_ptr)` where `label == "sibling"` attaches as a sibling (no stack push) and any other label attaches as a child (pushes onto stack), and
- **`reverse`** — flips the stack back into the buffer.

`ParserState.predict()` runs **two passes**: a forward `predict_one_pass()`, then `reverse`, then a second `predict_one_pass()`, then `connect_orphans()` which attaches every still-unparented node to the end of the document with the label `"unknown"`. That is ~2n classifier calls per document, not n.

**Window sizes are hard limits.** `DEFAULT_STACK_WINDOW_SIZE = 3`, `DEFAULT_BUF_WINDOW_SIZE = 1` (`state.py`), and `configs/example.json` sets `stack_win_size: 3`. An arc can therefore only attach to one of the **top 3 stack elements**. The training oracle even prints `WARNING: stack_win_size=3 is too small, required: {n}` when gold structure demands a deeper attachment — i.e. some gold arcs are unreachable by construction. Deeply nested hierarchies are structurally capped.

**Prediction head (§2.2.4).** For each stack node a special token `[S#i]` is inserted into the encoder input; its hidden state goes through a bi-linear module producing `label_[S#i]` and `score_[S#i]`; `arc_start = argmax_i score_[S#i]` (Eqs. 4–5). Predicting label `other` for all stack slots is effectively a SHIFT.

## 5. Features

- **Text embedding (§2.2.1).** Concatenate the text of stack and buffer nodes into one sequence with separators: `S = [CLS], [S#0], t₀, [S#1], t₁, …, [SEP], [B#0], tₙ`. Encoders tried: **BERT** (base/large, text-only) and **LayoutLM v1/v2/v3** (base/large, multimodal), all from HuggingFace, PyTorch (§3.3).
- **Layout embedding (§2.2.2, Eq. 3).** Four components: absolute bbox `(x₀,y₀,x₁,y₁)`; **relative** position `bbox_i − bbox_b0` (relative to the first buffer node); size `(w,h)`; **font size** `fs`. All coordinates normalised to 0–1000.
- **Visual embedding (§2.2.3).** Delegated to LayoutLM: v1/v2 use ResNet, v3 uses transformer image patches. All page images resized to **512 × 512**.
- **Bounding box representation.** A single 4-tuple per text block plus a separate page number; Figure 4's dataset sample shows `{"id": 99, "text": "2 MATERIA…", "bbox": [50, 83, 124, 97], "font_size": 12}` and `"arcs": [[96, 99, "section"], [99, 100, "paragraph"], …]`. So **integer block IDs + bbox + page + font size are first-class in the data format** — good news for PaperTree's provenance model.

**Caveat that materially weakens the "multi-modal" claim:** the shipped `configs/example.json` sets `use_font_size: false`, `use_wh: false`, `use_rel_pos: false` — three of the four layout components in Eq. 3 are **disabled in the only released config**. It also sets `n_epochs: 30` against the paper's stated 6.

## 6. Cross-page relations

Two mechanisms (§2.2.2, §2.2.3):
1. If `bbox_i` and `bbox_b0` are on different pages, "based on the page number, the model will add the corresponding page height to the y-coordinate of the bounding box below" — i.e. pages are virtually stacked into one tall canvas so relative geometry stays meaningful.
2. For arcs spanning pages, "page images are concatenated" and then resized to 512×512 — meaning a two-page concatenation is squashed to the same 512×512 budget, roughly halving effective visual resolution.

This is genuinely better than the baselines, which the paper notes "ignore all arcs cross pages due to not being able to fit the entire document into memory" (§4.5).

## 7. Complexity

The paper's claim (§1): transition-based parsing "scales linearly with the length of the document", vs. minimum-spanning-tree or pairwise-linking approaches which are quadratic. The code supports this asymptotically — the encoder input is bounded by a fixed window (3 stack + 1 buffer nodes), so each step is O(1) in document length and there are O(n) steps (2n with the reverse pass). **Memory is likewise O(window), not O(document)** — that is the real architectural win. No VRAM figure is reported anywhere in the paper.

The *constant* is brutal: one transformer forward (plus a vision encoder pass for v2/v3) **per text block**. Figure 6 plots inference cost from ~1 s at 1 page to ~21 s at 16 pages; the paper calls this linear, and the plotted curve is roughly linear with mild early convexity.

## 8. Dataset

| Property | Value (§3.1, Table 1) |
|---|---|
| Documents / pages | 1,290 documents, 9,310 pages (text); Table 1 lists 1,040 / 129 / 129 = **1,298** — an internal inconsistency of 8 documents |
| Pages by split | Train 7,554 · Test 786 · Dev 970 (sums exactly to 9,310) |
| Split | 80 / 10 / 10 |
| Document types | **All born-digital (rendered) PDFs from the public domain**: product manuals, public technical reports, white papers. Explicitly *not* an academic-paper corpus |
| Doc length | 1 to 85 pages |
| Labels | 18 categories |
| Annotation | PDFMiner auto-extraction of blocks, manual correction, then multi-level numbering (`paragraph-3-2`, `table-5-3-1`) converted to arcs; ≥2 crowdsourced annotators per document, all college students, paid **$0.20 per page** |
| Scanned documents | **Zero** (§7 Limitation: "In theory, our method could also be applied to scanned documents. However, due to resource constraints, it has not been used on the PDF-to-Tree dataset yet.") |

No inter-annotator agreement figure is reported.

## 9. Metrics and results

Metrics (§3.4, Eqs. 6–7) are borrowed from dependency parsing, with tokens replaced by text blocks:
**UAS** = blocks with correct link / all blocks. **LAS** = blocks with correct link *and* label / all blocks. **Label F1** = entity-labelling F1.

### Table 2 — PDF-to-Tree dataset (all numbers from the [paper PDF](https://aclanthology.org/2024.findings-emnlp.628.pdf), self-reported)

| Model | Modality | Params | UAS | LAS | Label F1 |
|---|---|---|---|---|---|
| StrucTexTv1_base | T+L+V | 110M | 0.8046 | 0.7636 | 0.8899 |
| BROS_base | T+L+V | 110M | 0.8384 | 0.7800 | 0.8722 |
| **BROS_large** | T+L+V | 340M | 0.8721 | **0.8210** | **0.8925** |
| LayoutLMv2-RE_base | T+L+V | 220M | 0.8419 | 0.7530 | 0.8007 |
| LayoutLMv2-RE_large | T+L+V | 426M | 0.8451 | 0.8020 | 0.8592 |
| PDF-to-Tree_bert | T+L | 110M | 0.9158 | 0.7900 | 0.8609 |
| PDF-to-Tree_layoutlm | T+L | 160M | 0.9229 | 0.7551 | 0.8342 |
| PDF-to-Tree_layoutlmv2 | T+L+V | 220M | 0.9338 | 0.7994 | 0.8678 |
| PDF-to-Tree_layoutlmv3 | T+L+V | 133M | 0.9385 | 0.8020 | 0.8709 |
| PDF-to-Tree_bert-large | T+L | 340M | 0.9189 | 0.7757 | 0.8532 |
| PDF-to-Tree_layoutlm-large | T+L | 390M | 0.9233 | 0.7836 | 0.8547 |
| PDF-to-Tree_layoutlmv2-large | T+L+V | 426M | 0.9363 | 0.8070 | 0.8757 |
| **PDF-to-Tree_layoutlmv3-large** | T+L+V | 368M | **0.9393** | 0.8166 | 0.8817 |

**Read the headline carefully.** The abstract's "accuracy of 93.93%, … improvement of 6.72%" is **UAS only** (0.9393 − 0.8721 vs BROS_large). On **LAS — the metric that actually matters if you need correct labels *and* correct structure — PDF-to-Tree loses**: BROS_large scores 0.8210 vs PDF-to-Tree's best 0.8166. The paper concedes this in §4.1 ("BROS … achieving a 0.44 higher LAS score"; entity-level F1 89.25% vs 88.17%). So the true claim is: *better at finding the right parent, slightly worse at naming it*.

**The baseline comparison is also handicapped by construction.** §3.2: because baselines cannot fit long documents, "we preprocess the dataset, dividing documents into blocks of no more than 500 tokens each … and ignore the arcs between blocks. This simplification will affect approximately 5% arcs in test set." The baselines are additionally denied all cross-page arcs. Some fraction of the 6.72% gap is a windowing artefact, not modelling superiority.

### Table 3 — FUNSD (transfer check)
BERT_base 0.6092 / 0.2765 · LayoutLM_base 0.7854 / 0.4586 · LayoutLMv2_base 0.8189 / 0.4291 · **StrucTexT_base 0.8309** / 0.4410 · BROS_base 0.8305 / 0.7146 · **PDF-to-Tree_layoutlmv3 0.8012 / 0.7261** (Label F1 / Link F1). Same pattern: best at linking, mid-pack at labelling.

### Table 4 — Ablation
P2T_layoutlmv3 (T+L+V) 0.9393 / 0.8166 · P2T_bert (T+L) 0.9158 / 0.7900 · **P2T_bert-wo-layout (T only) 0.8833 / 0.7280**. Removing layout costs **3.25 UAS / 2.52 LAS**. Layout matters more than vision.

### Table 5 — Inference speed (sec/page)
BROS_base 0.362 · LayoutLMv2-RE_base 0.528 · StrucTexT_base 0.262 · **P2T_layoutlmv3 1.138**. (§4.5's prose says the baselines "only need 0.511 and 0.262 seconds", which does not match its own table — a second internal inconsistency.)

### Per-label accuracy (Figure 5)
LAS correlates strongly with label frequency. `paragraph`, `table_text`, `reference`, `figure_text` score highest; `meta`, `header`, `footer`, `question`, `answer` are far worse — the paper attributes this to their "varied forms". I could not read exact per-label values off the bar chart.

## 10. Training and inference requirements

- **Hardware (§3):** "one to eight NVIDIA Tesla A800 80GB GPUs." **No training wall-clock hours are reported anywhere.** No VRAM figure. The A800 80GB baseline implies this was not built for modest hardware.
- **Hyperparameters (§3.3):** AdamW, linear warmup over first 10% of steps, cross-entropy on both label and position. LR: BERT-base 4e-5, BERT-large 2e-5; LayoutLM v1/2/3 base 2e-5, large 1e-5. Dropout 0.1, batch size 32, **6 epochs**. (Released config: batch 8 × accumulation 4 = 32 ✓, but 30 epochs ✗.)
- **Inference:** 1.138 s/page for the v3 configuration on the paper's hardware; ~21 s for a 16-page document (Figure 6). **No CPU numbers exist.** Given the code performs ~2 transformer forwards per text block, a CPU-only path for a 20-page paper with several hundred blocks would plausibly land in the minutes range — my extrapolation, not a measured figure.

## 11. Repository audit (verified 2026-07-29 via GitHub API)

| Check | Finding |
|---|---|
| Repo | https://github.com/yuezh000/PDF-to-Tree — created 2024-09-25 |
| Commits | **Exactly one**: `83db9c3` "Init commit", 2024-11-29T09:42:55Z. No commits in ~20 months |
| Releases / tags | None |
| **LICENCE** | **None.** `GET /repos/yuezh000/PDF-to-Tree/license` → 404; `"license": null` in the repo object. **No licence = all rights reserved.** |
| **Pretrained weights** | **Not released.** `weights/` contains only a `.gitignore` (`*` / `!.gitignore`). Total repo size: 19 KB |
| Data in repo | `data/` likewise contains only a `.gitignore` |
| Code volume | ~68 KB Python: `p2t/{model.py, model_entry.py, metric.py, callback.py, utils.py}`, `p2t/parser/{data.py, state.py, tree.py}`, plus `train.py`, `predict.py`, `preprocess.py` |
| Dataset links | Three OneDrive links in the README (Tree / Image / Preprocessed). All three resolved HTTP 200 to `onedrive.live.com` on 2026-07-29. I did not download or verify contents |
| Dataset licence | **None stated** in README or paper. Source PDFs described as "public domain"; the *annotations* carry no licence |
| Open issues | 2, both open, **neither answered by the author**. [#1](https://github.com/yuezh000/PDF-to-Tree/issues/1) (2024-12-30) requests the annotation tool — 0 comments. [#2](https://github.com/yuezh000/PDF-to-Tree/issues/2) "Request for model weights" (2025-07-03), one +1 from a third party 2025-07-16, no author reply |
| Dependency staleness | `requirements.txt` pins `transformers==4.20.1` (Jun 2022), `torchvision==0.12.0`, `Pillow==9.5.0`, `fastNLP==1.0.1`, `numpy==1.24.4`, with `--extra-index-url .../whl/cu113` and a commented `torch==1.11.0+cu113`. A CUDA-11.3-era stack; will not install cleanly on current Python/PyTorch or Apple Silicon without a port |
| End-to-end PDF path | **Absent.** `predict.py` consumes `test.jsonl` + `test_images.pkl` from a preprocessed directory and a `workdir` containing a trained checkpoint. There is no "point at a PDF, get a tree" entrypoint, and the README documents no prediction step at all |

**Not a stub — but not runnable either.** The code is a real, coherent implementation. It is unusable off the shelf because the two things you cannot reconstruct cheaply — trained weights and a licence — are both missing.

## 12. Licence analysis (decisive for a commercial product)

| Component | Code licence | Weight licence | Commercial use |
|---|---|---|---|
| PDF-to-Tree repo | **None declared → all rights reserved** ([API](https://api.github.com/repos/yuezh000/PDF-to-Tree)) | n/a — none released | ❌ Cannot legally use or redistribute without author permission |
| PDF-to-Tree dataset | — | No licence stated | ❌ Unclear; do not train on it commercially without written permission |
| Paper text | CC BY 4.0 | — | ✅ Ideas and formulation are free to reuse |
| `microsoft/layoutlmv3-base` / `-large` (best config) | MIT (unilm repo) | **CC BY-NC-SA 4.0** ([HF card](https://huggingface.co/microsoft/layoutlmv3-base)) | ❌ **Non-commercial + ShareAlike** |
| `microsoft/layoutlmv2-*-uncased` | MIT | **CC BY-NC-SA 4.0** ([HF](https://huggingface.co/microsoft/layoutlmv2-base-uncased)) | ❌ Non-commercial |
| `microsoft/layoutlm-base-uncased` (v1) | MIT | **MIT** ([HF](https://huggingface.co/microsoft/layoutlm-base-uncased)) | ✅ |
| `microsoft/layoutlm-large-uncased` | MIT | **No licence declared on HF** | ⚠️ Unverified |
| `bert-base-uncased` | Apache-2.0 | **Apache-2.0** ([HF](https://huggingface.co/google-bert/bert-base-uncased)) | ✅ |
| BROS (baseline) | Apache-2.0 ([repo](https://github.com/clovaai/bros)) | No licence tag on the HF weights | ⚠️ Code clean, weights unverified |

**Consequence:** the 93.93% UAS headline is unreachable commercially. Every configuration ≥0.9338 UAS is built on CC BY-NC-SA weights. The best commercially-clean variants are `PDF-to-Tree_bert` (0.9158 UAS / 0.7900 LAS, Apache-2.0) and `PDF-to-Tree_layoutlm` (0.9229 / 0.7551, MIT) — and both still require training from scratch, on a dataset with no licence, using code with no licence.

## 13. Paper ↔ code discrepancies found

1. `reverse` action and the **two-pass** parse are in the code, absent from the paper.
2. Released config disables `use_font_size`, `use_wh`, `use_rel_pos` — 3 of 4 layout features in Eq. 3.
3. Released config: 30 epochs vs paper's 6.
4. Table 1 documents sum to 1,298; text says 1,290.
5. §4.5 prose speed figures (0.511 s) contradict Table 5 (0.362 / 0.528 / 0.262).
6. Paper's Figure 1(c) implies `table/table row/cell` node types; released `NODE_LABELS` has only `table_text`.

## 14. Production-readiness verdict

**Not production-ready for PaperTree.** Scored against PaperTree's hard requirements:

| Requirement | PDF-to-Tree |
|---|---|
| Page + bbox on every element | ✅ Native to the data format (`bbox`, `page_no`, `font_size` per block) |
| Stable addressable block identity | ⚠️ Integer `index` per block, stable only within one PDFMiner extraction run — not re-parse-stable |
| Section hierarchy, not flat text | ✅ This is the paper's entire contribution |
| Equations as LaTeX + source region | ❌ `equation` is only a *label on a text block*; no math OCR, no LaTeX |
| Figures/plots with linked captions, incl. vector | ❌ Only text blocks are nodes. `figure_text`/`caption` are labels on text; figure regions are never detected |
| Tables with row/cell addressability | ⚠️ Annotation scheme supports it; released label set does not; would come from nesting only |
| No hallucination; uncertainty representable | ✅ Structurally strong — it re-orders and links existing extracted blocks, it never generates text. Orphans get an explicit `"unknown"` label. But there is no calibrated confidence output |
| Runs without a GPU | ❌ 1.138 s/page on an A800; ~2 transformer forwards per text block; no CPU path measured |

---

## 15. Implications for PaperTree

### (a) Ideas to adopt

1. **Adopt the tree-as-arcs data model wholesale.** Represent the document as `blocks[] = {id, page, bbox, font_size, text}` plus `arcs[] = (head_id, tail_id, label)`. It is simple, diffable, serialisable, and separates geometry from structure. The paper's Figure 4 format is a good starting schema.
2. **Adopt left-child/right-sibling encoding.** One `child` pointer + one `sibling` pointer gives you hierarchy *and* per-container reading order in a single structure, which is exactly what "independent reading orders for footnotes, captions, and body text" requires. Use `sibling-<label>` composition (as `label_siblings()` in `model_entry.py` does) so a sibling chain still carries its element type.
3. **Adopt the "independent reading orders" principle.** Footnotes, captions, headers, page numbers must be siblings in their own subtree, not spliced into body flow. This is the single most transferable idea.
4. **Adopt an explicit `unknown` / orphan escape hatch.** `connect_orphans()` guarantees a well-formed tree even when the model fails, with failures visibly labelled rather than silently dropped. Do the same, and surface it in the UI as "unstructured".
5. **Adopt layout features over visual features for hierarchy.** The ablation is unambiguous: removing layout costs 3.25 UAS, while moving from text+layout to text+layout+vision buys only ~2.3 UAS. **Font size, indentation and relative bbox offsets do most of the work.** For a CPU-first product this is excellent news — a cheap heuristic/gradient-boosted model over font size + x-indent + vertical gap + numbering regex will get you a long way before any transformer.
6. **Adopt bounded-window incremental parsing for cost control.** O(1)-memory-per-step parsing over a 100-page PDF is the right shape for a worker that must not OOM. But raise the window above 3 and beam it, rather than greedy top-3.
7. **Adopt UAS/LAS as your internal structure metrics** — they cleanly separate "right parent" from "right label", which is exactly the distinction that matters when debugging a section tree.
8. **Adopt multi-level numbering as the annotation interchange format** (`section-130-10`, `table-5-3-1`, with gaps so labels can be inserted). It is human-editable and converts deterministically to arcs — useful if you ever build a correction UI.

### (b) What PDF-to-Tree does not solve

- **Math OCR.** No equation → LaTeX. `equation` is a class label on a PDFMiner text block; the glyph soup inside is not interpreted.
- **Figure detection or figure semantics.** Figures are not nodes. There is no bbox for a figure region, so **vector diagrams — the dominant form of CS architecture figures — are entirely invisible** to this pipeline.
- **Plot/chart interpretation and diagram understanding.** Out of scope entirely.
- **Equation-to-paragraph relations.** No notion of "equation (3) is referenced by this sentence".
- **Caption→figure linking.** It can label a block `caption` and place it in the tree, but it cannot link it to a figure object because no figure object exists.
- **Table structure.** No cell grid recovery, no spanning cells, no header rows. `table_text` blocks only.
- **Scanned reliability.** Explicitly untested (§7 Limitation) — the entire dataset is born-digital.
- **Highlight anchoring / stable IDs across re-parses.** Block IDs are positional indices from the extractor; any change to the extractor renumbers everything. PaperTree must define its own content-hash-based stable IDs.
- **Semantic comprehension.** It is a structure parser. It does not summarise, explain, or answer.
- **Academic-paper domain fit.** The corpus is manuals, technical reports and white papers — **not research papers**. Two-column academic layout, dense math, floats, and multi-column figure spans are under-represented. Expect a meaningful domain gap.

### Recommendation

**Do not build on this repo.** Reimplement the *representation* (blocks+arcs, LCRS tree, independent reading orders, explicit unknowns) inside PaperTree's own parser, and get hierarchy from a cheap layout-feature model first — the ablation says that captures most of the signal at a fraction of the cost. Treat PDF-to-Tree as the citation for *why* the tree formulation is right, not as a component. If you ever want to benchmark, the dataset links are alive but unlicensed; ask the authors for written permission before touching it commercially, and note they have not answered a GitHub issue since the repo was published.

Everything PaperTree actually needs beyond a section tree — equations as LaTeX, vector figure extraction, caption linking, table cells — must come from elsewhere. PDF-to-Tree solves roughly one of PaperTree's eight hard requirements outright.

---

## 16. What I could not verify

- **Dataset contents.** I confirmed all three OneDrive links return HTTP 200 (2026-07-29) but did not download them. I cannot confirm file sizes, that the archives are intact, whether row/cell nesting is actually present in the tree annotations, or whether the released split matches Table 1.
- **Whether the code actually runs.** I read every relevant source file but did not install or execute it. My "not runnable off the shelf" claim rests on: no released weights, a 2022-era pinned dependency stack, and `predict.py` requiring a pre-existing trained `workdir`. I did not attempt a port.
- **Training wall-clock time and VRAM.** Not reported by the authors anywhere. Any figure I gave for CPU inference is my extrapolation from the code's per-block forward-pass structure, not a measurement.
- **Exact per-label LAS values** (Figure 5) — read qualitatively off a bar chart, no numeric table is given.
- **The 18-label list.** Taken from `p2t/parser/tree.py`'s `NODE_LABELS`; I matched it to the paper's "18 categories" by excluding the structural `sibling` relation. The paper never enumerates the list.
- **BROS and LayoutLM-large weight licences.** `naver-clova-ocr/bros-base-uncased` and `microsoft/layoutlm-large-uncased` carry **no licence metadata** on their HuggingFace cards. BROS's *code* is Apache-2.0; the weights' terms are undetermined.
- **Whether the authors would grant a licence.** No response to either GitHub issue; I did not email them.
- **Independent reproduction.** None found. 6 citations, all downstream RAG-chunking work that cites the formulation rather than reusing the model.
