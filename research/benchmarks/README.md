# PaperTree Understanding Benchmark (PTUB) v0.1

**Purpose.** No production parser may be selected before this evaluation. PTUB exists to
turn "which parser is best?" from a taste question into a measurement.

**Design principle.** PaperTree does not need the best *text* extractor. It needs the best
*addressable, geometry-preserving, hierarchy-aware* extractor. Those are different
objectives and standard OCR benchmarks (edit distance on a text blob) actively mislead
here — a parser can win on text similarity while destroying every property PaperTree
depends on. PTUB therefore measures four separate things, and a candidate must pass all
four to be viable.

---

## 1. Corpus design

### 1.1 Two tiers, and why

Hand-annotating one page of a research paper with reading order, hierarchy, equation
LaTeX, figure regions, caption links and table cells takes **20–40 minutes**. A
600-page gold set would cost 200–400 hours of expert time. That is the binding
constraint, and pretending otherwise produces a benchmark that never gets built.

PTUB therefore splits into:

| Tier | Size | Annotation | Answers |
|---|---|---|---|
| **A — Robustness** | 44 papers, ~640 pages | **None** (automatic proxies only) | Does it crash? Time out? Silently return nothing? How does cost scale? |
| **B — Gold** | 12 papers, **120 pages** (10 per paper, stratified) | Full manual annotation | Is it actually correct? |
| **C — Task** | 12 papers × 10 questions = 120 Q&A | Manual answers + evidence spans | Does correctness survive to the user? |

Tier A is cheap and catches the failure modes that kill products (a parser that is 3%
better on average but hangs on 1 paper in 20 is not better). Tier B is expensive and
catches the failure modes that kill trust. Both are necessary.

### 1.2 Why 44 / 12 / 120 and not "30–50"

**Tier A = 44.** Sized to give ~4 papers per category across 11 categories. With 4
samples a category, a systematic per-category failure (e.g. "all scanned papers return
empty") shows up as 4/4 rather than as noise. It is not sized for statistical
significance on continuous metrics — Tier A is a *screen*, not a *test*.

**Tier B = 12 papers × 10 pages = 120 pages.** Justification is power, not tradition.
The primary Tier B metric is reading-order pairwise accuracy, a proportion. To detect a
5-percentage-point difference between two parsers around p≈0.85 with α=0.05 and 80%
power, a paired comparison needs roughly 250–450 *paired page observations* if pages
were independent. They are not — pages within a paper are highly correlated — so the
effective n is closer to the number of *papers*. 12 papers × 10 pages, analysed with
paper as the clustering unit, reliably detects the ~10pp differences that actually
separate these tools (the published gaps between Docling / Marker / MinerU / PyMuPDF on
layout tasks are 10–30pp, not 3pp). It will **not** resolve 2pp differences, and PTUB
should not claim to. Annotation cost: ~60 expert-hours — one focused week.

**Page sampling within a Tier B paper is stratified, not the first 10 pages.** Forced
quota per paper: 1 first page (title/author/abstract block), 2 dense two-column body,
1 equation-dense, 1 figure-dominant, 1 table-dominant, 1 references, 1 appendix, 2
random. First-10-pages sampling systematically over-weights introductions, which are the
easiest pages in any paper.

**Tier C = 10 questions per paper.** Enough to cover each question type once (§5.4);
the metric is per-question, so n=120 supports a meaningful accuracy estimate.

### 1.3 Categories (Tier A: 4 papers each)

| # | Category | Why it is in the corpus | Seeded |
|---|---|---|---|
| 1 | Ordinary two-column CS | The modal PaperTree document | ✅ ResNet, BERT, PDF-to-Tree |
| 2 | Single-column ML (NeurIPS/JMLR) | Different float behaviour, wide tables | ✅ Attention |
| 3 | Mathematics-heavy | Display math, numbered equations, aligned environments | ✅ Neural ODEs |
| 4 | Dense derivations (theory/stats) | Multi-line proofs, cross-page equation runs | |
| 5 | Plot-heavy (empirical) | Vector plots, subfigure panels, shared legends | |
| 6 | Architecture-diagram-heavy | **Vector diagrams — the failure mode that broke the current extractor** | |
| 7 | Complex tables | Spanning cells, borderless, rotated, multi-page | |
| 8 | Scanned / historical | No text layer; OCR path; the hardest tier | |
| 9 | Poorly encoded PDF | Broken ToUnicode, no spaces, ligature soup, CID fonts | |
| 10 | Algorithms & pseudocode | `algorithm2e` floats, line numbers, indentation as semantics | |
| 11 | Long with appendices & supplement | 40+ pages, appendix renumbering, supplementary sections | ✅ Shannon 1948 (55pp) |
| 12 | Non-English (Tier A only) | CJK/accented text, different typography | |

Manifest: `corpus.yaml`. Fetcher: `fetch_corpus.py` (arXiv/ACL/open-access only —
every item must be freely redistributable or fetched at run time by DOI/arXiv ID, and
the repo stores **IDs, not PDFs**, except the small seed set).

### 1.4 Corpus hygiene

- Record `sha256`, page count, producer string (`/Producer`), whether a text layer
  exists, and font census for every paper. A parser comparison where papers differ by
  producer is confounded; the manifest makes that visible.
- No paper may be in both the corpus and any candidate parser's training data where
  that is knowable (DocLayNet, PubLayNet and arXiv-derived training sets overlap
  heavily with arXiv CS — flag known-contaminated items rather than pretending
  otherwise).

---

## 2. Gold annotation schema

`schema/annotation.schema.json`. One JSON file per annotated page. Annotation is done
against the **rendered page image at 150 DPI** with PDF-space coordinates recorded, so
annotations are independent of any parser.

```jsonc
{
  "paper_id": "resnet",
  "page": 4,                       // 0-indexed
  "page_size": { "width": 612.0, "height": 792.0 },   // PDF user space
  "regions": [
    {
      "gold_id": "r04",            // stable within page
      "type": "paragraph",         // see type vocabulary below
      "bbox": [54.0, 231.5, 292.1, 402.7],   // PDF user space, origin top-left
      "reading_order": 7,          // rank within this page's MAIN flow; null if independent
      "flow": "body",              // body | caption | footnote | header | footer | margin | float
      "parent": "r02",             // gold_id of parent section/figure; null at page root
      "text": "…verbatim, hyphens resolved…",
      "continues_from": "p3:r11",  // cross-page paragraph continuation
      "continues_to": null
    },
    {
      "gold_id": "r09", "type": "equation", "bbox": [...], "reading_order": 12,
      "flow": "body", "display": true, "equation_number": "3",
      "latex": "\\mathcal{F}(\\mathbf{x}) := \\mathcal{H}(\\mathbf{x}) - \\mathbf{x}",
      "referenced_by": ["r07", "r14"]
    },
    {
      "gold_id": "r11", "type": "figure", "bbox": [...], "flow": "float",
      "figure_number": "2", "figure_kind": "diagram",
      "is_vector": true,           // critical: the current extractor cannot see these
      "caption": "r12",            // gold_id of the caption region
      "panels": [[...], [...]]     // sub-panel bboxes for multi-panel figures
    },
    {
      "gold_id": "r15", "type": "table", "bbox": [...], "flow": "float",
      "table_number": "1", "caption": "r14",
      "grid": { "rows": 6, "cols": 5,
                "cells": [ { "r": 0, "c": 0, "rowspan": 2, "colspan": 1,
                             "bbox": [...], "text": "layer", "is_header": true } ] }
    }
  ],
  "annotator": "…", "minutes_spent": 34, "notes": "Fig 3 spans both columns"
}
```

**Type vocabulary** (deliberately identical to PaperIR block types so gold data is
directly comparable to parser output): `title, author, affiliation, abstract, heading,
paragraph, list, equation, inline_equation, figure, table, table_cell, algorithm, code,
caption, footnote, citation, reference_entry, header, footer, page_number, margin_note,
unknown`.

**Annotation rules that matter** (full guide in `ANNOTATION_GUIDE.md`):
- `reading_order` ranks only the **body flow**. Captions, footnotes and page furniture
  get `reading_order: null` and their own `flow` — this operationalises PDF-to-Tree's
  "independent reading orders" idea and prevents the metric from punishing a parser for
  correctly *excluding* a footnote from body flow.
- Hyphenation is resolved in `text` but the bbox is the union of both line fragments.
- Equation LaTeX is normalised (see §5.1) before comparison; annotators write natural
  LaTeX, not canonical form.
- `is_vector` is recorded because vector-figure blindness is the single defect that
  most damages PaperTree, and it must be measurable per-figure.

**Double annotation.** 3 of the 12 Tier B papers (30 pages) are annotated
independently by two people to produce an inter-annotator agreement figure. Without
it, no metric on this set has a meaningful ceiling. Report IAA alongside every result.

---

## 3. Candidate adapters

Every candidate implements one interface (`harness/adapters/base.py`):

```python
class ParserAdapter(Protocol):
    name: str
    version: str
    def parse(self, pdf_path: str) -> ParseResult: ...   # -> PaperIR-shaped
```

Adapters normalise into **PaperIR** (see `../architecture-decisions/`), so metrics are
written once. A candidate that cannot express a metric's input (e.g. no bboxes) scores
**0 on that metric, not N/A** — inability to represent geometry is a real failure, not
a missing measurement.

Candidates to evaluate:

| Row | Adapter | Status |
|---|---|---|
| 1 | **PaperTree current** (`routes.extract_text_from_pdf`) | ✅ implemented — the baseline to beat |
| 2 | **PaperTree dead structured** (`extraction.PDFExtractor`) | ✅ implemented — measures what the unused code would have given |
| 3 | **PyMuPDF raw** (`get_text("dict")` + naive order) | ✅ implemented — the honest floor |
| 4 | PyMuPDF + XY-cut + heuristic hierarchy | to build (the proposed fast path) |
| 5 | Docling | ✅ opt-in probe venv, `docling 2.117.0` — build it with [`DOCLING.md`](DOCLING.md) |
| 6 | Marker / Surya | licence-gated — see literature |
| 7 | MinerU | licence-gated — see literature |
| 8 | GROBID | Docker |
| 9 | Nougat / olmOCR | GPU tier |
| 10 | Hybrid: fast path + specialist repair | the proposal |
| 11 | Hybrid + VLM verification | the proposal + fallback |
| 12 | **Human gold** | upper bound — establishes the ceiling every metric is read against |

Row 12 matters: reporting a parser at 0.72 is meaningless without knowing whether the
ceiling is 1.00 or 0.81.

---

## 4. Metrics

### 4.1 Parsing metrics (Tier B)

| Metric | Definition | Notes |
|---|---|---|
| **Element detection P/R/F1** | Predicted region matches gold if IoU ≥ 0.5 **and** type matches | Report per type; macro-average. Also report IoU ≥ 0.75 as a strictness check |
| **Reading-order accuracy** | Pairwise: fraction of gold body-flow region pairs (a,b) whose predicted relative order matches | Pairwise ≫ Kendall's τ here because it degrades gracefully when a parser misses regions. Also report **Spearman footrule normalised** |
| **Hierarchy accuracy (UAS/LAS)** | Borrowed from PDF-to-Tree: UAS = correct parent; LAS = correct parent **and** label | Clean separation of "right place" vs "right name" |
| **Equation transcription** | **CDM** (Character Detection Matching) primary; normalised edit distance secondary; exact-match after normalisation tertiary | BLEU is explicitly rejected — it rewards token overlap on LaTeX that renders incorrectly. See literature `07-formula-recognition.md` |
| **Table structure** | **TEDS** and **TEDS-Struct**; plus **cell-bbox F1** at IoU ≥ 0.5 | TEDS alone ignores whether cells are *addressable*, which PaperTree needs |
| **Caption association** | Fraction of gold figures/tables whose caption is correctly linked | Directional: report false links separately from missed links |
| **Bounding-box accuracy** | Mean IoU over matched regions | |
| **Cross-page paragraph reconstruction** | F1 over gold `continues_from` links | The metric nobody publishes and every reader notices |
| **Reference extraction** | Precision/recall of reference entries; field-level accuracy for author/title/year | GROBID is expected to dominate; that is a finding, not a flaw |
| **Vector-figure recall** | Recall over gold figures with `is_vector: true` | Isolated because it is PaperTree's known catastrophic gap |

### 4.2 Grounding metrics (Tier C)

Run each candidate's IR through the *same* retrieval + answer prompt, so the parser is
the only variable.

- **Block-level evidence F1** — do the cited block IDs cover the gold evidence spans?
  (Metric adapted from QASPER's evidence selection.)
- **Page accuracy** — is the cited page correct?
- **Equation/figure identification** — for equation and figure questions, is the right
  object cited?
- **Support validity** — does the cited region *actually contain* the claim? Judged by
  a rubric, adjudicated by a human on a 30-item sample to calibrate the judge.
- **Contamination rate** — fraction of answers whose evidence mixes text from two
  different columns, or a caption with unrelated body text. This directly measures the
  column-interleaving defect and is the metric the current system would fail hardest.

### 4.3 UI / anchoring metrics

Measured by an automated harness driving the real reader, not by inspection:

| Metric | Procedure | Pass bar |
|---|---|---|
| Zoom stability | Create highlight at 100%; re-render at 50/75/150/200/400%; measure centroid drift in PDF space | drift < 1pt |
| Resize stability | Same, across 5 viewport widths incl. iPad portrait/landscape | drift < 1pt |
| **Re-parse survival** | Persist highlight under parser vN; re-parse with vN+1; re-anchor | **≥ 99% re-anchor**, and every failure explicitly flagged to the user, never silently dropped |
| Cross-mode anchoring | Highlight in PDF mode → is it visible on the same content in Guided mode, and vice versa? | resolves or explicitly reports "not available in this view" |
| Explanation → region | Click a citation in an answer; does it scroll to and outline the correct region? | correct page 100%, correct region ≥ 95% |
| Replay sync | Audio timestamp → highlighted source block | within 1 block |

Re-parse survival is the metric that justifies the whole multi-selector anchor design.
If a candidate representation cannot hit 99%, users lose annotations on upgrade, which
is unrecoverable trust damage.

### 4.4 Downstream question types (Tier C, 10 per paper)

overview · methodology · equation interpretation · symbol definition · figure
interpretation · result comparison · limitation identification · citation lookup ·
cross-section reasoning · contradiction detection.

Each gold answer records: the answer text, the **gold evidence block set**, and the
gold page(s). Questions are written from the *paper*, by someone who has read it, before
seeing any parser output — to avoid writing questions that happen to suit one parser.

### 4.5 Operational metrics (Tier A, all 44 papers)

Recorded for every run, always reported next to accuracy:

`wall-clock p50/p95 per page` · `peak RSS` · `GPU VRAM` · `$ cost per 100 papers`
· `crash rate` · `timeout rate (>120 s/page)` · `empty-output rate` · `output bytes per page`

A parser is **disqualified** — regardless of accuracy — if crash+timeout+empty > 5% on
Tier A. Reliability precedes precision for a product where a failed upload is the user's
first experience.

---

## 5. Comparison protocol

1. All candidates run on identical hardware, cold cache, 3 repeats for timing.
2. Metrics computed by `harness/run.py`, results appended to
   `../experiment-results/ptub-results.jsonl` with the adapter version and corpus hash.
3. **Paired analysis clustered by paper**, with bootstrap CIs over papers (not pages).
   Report CIs, never bare point estimates.
4. Any hand-tuning of an adapter must be recorded; a tuned adapter is reported as a
   separate row, not silently improved.
5. Publish the losing configurations too. A parser that wins on text and loses on
   geometry is the most important result PTUB can produce, because it is exactly the
   trap PaperTree is trying to avoid.

### 5.1 LaTeX normalisation (before equation comparison)

Strip `\left`/`\right`, collapse whitespace, normalise `\dfrac|\tfrac→\frac`,
`\ast→*`, `{}`-redundancy, spacing commands (`\,\;\!\quad`), and `\mathrm{d}→d`.
Normalisation is applied to **both** gold and prediction, and the normaliser is
versioned — changing it invalidates prior results.

---

## 6. What PTUB deliberately does not measure

- **Aesthetic markdown quality.** Irrelevant; PaperTree never renders a parser's markdown.
- **Speed on GPUs PaperTree will not own.** Report it, do not weight it.
- **Aggregate OCR edit distance.** Actively misleading for this product (§Design principle).
- **Anything about paper *content* quality.** PTUB measures fidelity of representation,
  not whether explanations are good. That is a separate eval.

---

## 7. Status

| Component | State |
|---|---|
| Corpus tier A manifest | seeded (8 papers), 36 to add |
| Corpus tier B selection | pending — pick 12 from tier A after category coverage is complete |
| Gold annotations | **not started** — the critical path item; ~60 expert-hours |
| Annotation schema | drafted (§2) |
| Harness: adapters 1–3 | implemented |
| Harness: metrics | reading-order + element-detection implemented; rest specified |
| Baseline results | current PaperTree + PyMuPDF measured; see `../experiment-results/` |

**No parser selection is authorised until Tier B gold exists and rows 1–5 have been run.**
The recommendation in the main report is therefore stated as a *provisional* direction
with an explicit falsification condition, not a final decision.
