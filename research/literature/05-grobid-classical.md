# 05 — The Classical / Non-Neural Extraction Tier

**Scope:** GROBID, Apache Tika, PyMuPDF, unstructured.io, pdfplumber, pdfminer.six
**Prepared for:** PaperTree parsing-stack replacement decision
**Date of research:** 2026-07-29. Most recent primary evidence: GROBID commits dated 2026-07-29; unstructured commit 2026-07-26; Apache Tika 3.3.2 released 2026-07-16; PyMuPDF 1.28.0 released 2026-06-29; pdfplumber 0.11.10 released 2026-06-15; pdfminer.six 20260107 released 2026-01-07.

---

## 0. Bottom line up front

This tier splits cleanly into two roles for PaperTree:

1. **A geometry engine** — PyMuPDF or pdfplumber/pdfminer.six. These give you char/span/word-level bounding boxes and (PyMuPDF only) *vector path geometry*. They give you **no** document logic: no section tree, no reading order on 2-column pages, no captions, no equations.
2. **A document-logic engine** — GROBID. It gives you a real TEI section tree, reference parsing that nothing else in this tier approaches, citation-context resolution, and optional PDF coordinates on most structural elements. It gives you **weak** tables, **very weak** equations, and **no LaTeX**.

Apache Tika and unstructured's `fast` path are, for PaperTree's requirements, non-starters as primary parsers — Tika because it emits no geometry at all, unstructured `fast` because it is a thin `pdfminer` wrapper whose useful structure only appears in the `hi_res` (neural) path, which is outside this tier.

**The single decisive licence fact in this document: PyMuPDF is AGPL-3.0 or a paid Artifex commercial licence. There is no third option.**

---

## 1. Comparison table

| System | Code licence | Model-weight licence | Geometry out | Section tree | Vector figures | Tables | Equations | Reading order (2-col) | Last evidence of maintenance |
|---|---|---|---|---|---|---|---|---|---|
| **GROBID** | Apache-2.0 ([repo](https://github.com/kermitt2/grobid)); **but calls `pdfalto`, GPL-2.0** ([LICENSE](https://github.com/kermitt2/pdfalto/blob/master/LICENSE)) | Models ship in the Docker image; repo states docs CC-0, annotated data CC-BY ([repo](https://github.com/kermitt2/grobid)) — weight-specific terms not separately stated | Yes — `@coords` = `page,x,y,w,h` on `ref, biblStruct, persName, figure, formula, head, s, p, note, title, affiliation` ([docs](https://github.com/kermitt2/grobid/blob/master/doc/Coordinates-in-PDF.md)) | **Yes** — nested TEI `div`/`head` | Indirect only (via pdfalto SVG dump) | Weak — F1 0.23 on DocBank ([arXiv:2303.09957](https://arxiv.org/abs/2303.09957)) | `<formula>` = Unicode text, **no LaTeX**; inline formulas unmarked ([docs](https://github.com/kermitt2/grobid/blob/master/doc/training/fulltext.md)) | Good — layout-feature segmentation model | Commits 2026-07-29 |
| **Apache Tika** | Apache-2.0 ([tika.apache.org](https://tika.apache.org/)) | n/a (no ML models for PDF) | **No** ([PDFParserConfig](https://tika.apache.org/3.2.0/api/org/apache/tika/parser/pdf/PDFParserConfig.html)) | No | No | No | No (F1 0.00) | `sortByPosition` only | 3.3.2 on 2026-07-16 |
| **PyMuPDF** | **AGPL-3.0 or Artifex commercial** ([README](https://github.com/pymupdf/PyMuPDF)) | n/a | **Best in class** — block/line/span/char bboxes | `get_toc()` only (PDF outline, often absent) | **Yes — `get_drawings()`** | `find_tables()` heuristic | No | Poor with `sort=True` | 1.28.0 on 2026-06-29 |
| **unstructured** | Apache-2.0 ([LICENSE](https://github.com/Unstructured-IO/unstructured/blob/main/LICENSE.md)); `unstructured-inference` Apache-2.0 | YOLOX / Detectron2 weights pulled at runtime; licence not stated in repo README | Yes, `metadata.coordinates` | Weak — `parent_id` only | No | `hi_res` only, `text_as_html` | `Formula` element type exists (text only) | Depends on strategy | Commit 2026-07-26 |
| **pdfplumber** | **MIT** ([LICENSE](https://github.com/jsvine/pdfplumber/blob/stable/LICENSE.txt)) | n/a | **Char-level** + line/rect/curve | No | Curves exposed as objects, not composed | **Best classical** — `.cells` with bboxes | No | Content-stream order | 0.11.10 on 2026-06-15 |
| **pdfminer.six** | **MIT** ([PyPI](https://pypi.org/project/pdfminer.six/)) | n/a | Char/line/box | No | No | No | No | Content-stream order + LAParams | 20260107 on 2026-01-07 |

---

## 2. GROBID

### What it is and what it recovers

GROBID is "a machine learning library for extracting, parsing and re-structuring raw documents such as PDF into structured XML/TEI encoded documents" ([repo README](https://github.com/kermitt2/grobid)). Architecturally it is **a cascade of sequence-labelling models** operating not on plain text but on *Layout Tokens* — Unicode text plus font, style and bounding box — produced by `pdfalto`, an Xpdf-4.05-based PDF-to-ALTO converter ([Principles.md](https://github.com/kermitt2/grobid/blob/master/doc/Principles.md)). Bounding boxes stay synchronised through the whole labelling cascade, which is why coordinate output is possible at all.

The cascade covers segmentation (title page / header / body / footnotes / bibliography), header, fulltext, figure, table, citation, name, date, affiliation-address, funding-acknowledgement, and reaches **"more than 55 final labels"** ([Introduction.md](https://github.com/kermitt2/grobid/blob/master/doc/Introduction.md)).

### Coordinates — the important part for PaperTree

Coordinates are opt-in via the `teiCoordinates` request parameter. Supported elements: `ref`, `biblStruct`, `persName`, `figure`, `formula`, `head`, `s`, `p`, `note`, `title`, `affiliation` ([Coordinates-in-PDF.md](https://github.com/kermitt2/grobid/blob/master/doc/Coordinates-in-PDF.md)). Format is `@coords="page,x,y,w,h"`, semicolon-separated for multi-box elements (paragraphs spanning columns/pages). Origin is **upper-left**, y grows downward, abstract PDF units, **page index starts at 1**.

Two caveats the docs state explicitly: pages may differ in size so scaling must be per-page; and **CropBox/MediaBox mismatch causes coordinate offsets**. PaperTree would need to normalise against the same box the renderer uses.

Note `s` (sentence) coordinates combined with `segmentSentences=1` — this is genuinely useful, giving sentence-granular anchors rather than paragraph-granular.

### Reference and citation parsing — its real differentiator

Self-reported by the project ([Introduction.md](https://github.com/kermitt2/grobid/blob/master/doc/Introduction.md)):
- Reference extraction **0.87 F1** on 1,943 PubMed Central PDFs containing 90,125 references; **~0.90** on a 2,000-doc bioRxiv set, using the Deep Learning citation model.
- Reference parsing in isolation: **>0.90 F1 instance-level, 0.95 F1 field-level** (DL model).
- Citation *context* resolution (callout identified AND linked to the right reference): **0.76–0.91 F1** depending on collection.
- DOI/PMID resolution from PDF: **>0.95 F1**.

Independently corroborated: on DocBank, GROBID scored the **best reference F1 of all ten tools tested, 0.79**, vs CERMINE 0.74, Science Parse 0.49, RefExtract 0.49, PdfAct 0.15 ([Meuschke et al., iConference 2023, arXiv:2303.09957](https://arxiv.org/abs/2303.09957), Table 6 / Fig. 7). That paper tested GROBID 0.7.0 in **default CRF mode**, i.e. without the DL models — so the vendor's DL numbers and this independent CRF number are not directly comparable, but both point the same way.

### Official benchmarks — the honest picture

From GROBID 0.9.0's own benchmark files ([PLOS](https://github.com/kermitt2/grobid/blob/master/doc/benchmarks/Benchmarking-plos.md), [eLife](https://github.com/kermitt2/grobid/blob/master/doc/benchmarks/Benchmarking-elife.md); BidLSTM_ChainCRF_FEATURES for header/reference-segmenter/citation, CRF Wapiti elsewhere):

| Metric | PLOS (1,000 docs) | eLife (984 docs) |
|---|---|---|
| Header, instance-level, strict | 12.2% | — |
| Header, instance-level, Levenshtein | 73.8% | 38.82% |
| Title F1 (Levenshtein) | 99.05% | — |
| Authors F1 (Levenshtein) | 99.38% | — |
| Abstract F1 (Levenshtein) | 76.47% | — |
| Citation instance-level (Levenshtein) | 51.69% | 81.14% |
| Section titles (soft) | 75.0% | 80.96% |
| Figure captions (soft) | 61.43% | 24.34% |
| Table captions (soft) | 13.12% | 42.99% |
| Reference citations/markers (soft) | — | 92.04% |

Read this carefully. **Header instance-level strict F1 of 12.2% on PLOS** means getting an *entire* header block byte-perfect is rare; individual fields are excellent (title 99%). And **figure/table caption F1 swings between 13% and 61%** across two corpora — caption linking is not reliable enough to be PaperTree's only mechanism.

Third-party DocBank numbers for GROBID ([arXiv:2303.09957](https://arxiv.org/abs/2303.09957), Table 6): Title 0.91, Abstract 0.82, Author 0.52, Reference 0.79, Paragraph 0.90, Section 0.74, Caption 0.49, **Table 0.23**, **Equation 0.25**. The paper's own summary: *"All tools struggle to extract lists, footers, and equations."* GROBID was the *only* tool of the ten that attempted equations at all.

### Equations — the disqualifying gap

GROBID marks block-level equations as `<formula>`, with the equation number as a nested `<label>`. **"Inline formulas integrated into paragraphs receive no special markup"** ([fulltext.md](https://github.com/kermitt2/grobid/blob/master/doc/training/fulltext.md)). The `<formula>` content is the Unicode text pdfalto pulled from the PDF, not LaTeX and not MathML. On the 2026 formula benchmark ([arXiv:2512.09874](https://arxiv.org/abs/2512.09874), 100 synthetic docs / 2,000+ formulas with LaTeX ground truth, LLM-as-judge 0–10), **GROBID scored 5.70** — the lowest of the 21 systems ranked — against PyMuPDF4LLM 6.67 and MinerU2.5 9.17. GROBID does give you a `formula` bounding box, which is the useful part: it can *localise* the equation region for a downstream LaTeX model.

### Performance and deployment

Self-reported ([Introduction.md](https://github.com/kermitt2/grobid/blob/master/doc/Introduction.md)), on 16 threads / 32 GB RAM / no SSD:
- Header only: 4,000 PDFs in 2 min = **36 PDF/s** via REST.
- Full structuring (header + body + references): 4,000 PDFs in 26 min = **~2.5 PDF/s**.
- Sustained: **10.6 PDF/s (~915,000 PDF/day, ~20M pages/day)** over a week on one 16-CPU machine.
- Memory: <2 GB header-only, ~3 GB citations, ~4 GB full structures; 6–8 GB for batch.

The eLife benchmark file records **1.15 s/PDF** on Ubuntu 22.04, 16 CPU cores, with GPU.

Docker ([Grobid-docker.md](https://github.com/kermitt2/grobid/blob/master/doc/Grobid-docker.md)): `grobid/grobid:0.9.0-crf` is **~500 MB**, CRF only, best runtime/memory profile; `grobid/grobid:0.9.0-full` is **~8 GB**, needs ≥4 GB GPU memory, "recommended to run with a GPU", GPU support Linux-only. **This is the key operational fact for a no-GPU PaperTree v1: the 500 MB CRF image is the deployable artifact**, and DL models are "up to 50 times slower than CRF" on CPU ([Deep-Learning-models.md](https://github.com/kermitt2/grobid/blob/master/doc/Deep-Learning-models.md)). The DL citation model buys **+3 to +5 F1 points**, and the header DL model only "slightly better results than CRF" — a poor CPU trade.

### Maintenance

Actively maintained. Commits on **2026-07-29** (pdfalto 0.6.2 bump, release automation), 2026-07-26, 2026-07-23 ([commits](https://github.com/kermitt2/grobid/commits/master)). Release cadence: 0.7.3 (2023-05), 0.8.0 (2023-11), 0.8.1 (2024-09), 0.8.2 (2025-05), **0.9.0 (2026-04-07)** — roughly annual majors, with 0.9.0 adding ARM64 support, conflict-of-interest extraction, and figure/table/equation extraction from back matter ([releases](https://github.com/kermitt2/grobid/releases)).

### The licence footnote nobody mentions

GROBID itself is Apache-2.0. But it shells out to **`pdfalto`, which is GPL-2.0** (forked from pdf2xml, based on the Xpdf library) ([pdfalto LICENSE](https://github.com/kermitt2/pdfalto/blob/master/LICENSE), [pdfalto README](https://github.com/kermitt2/pdfalto/blob/master/Readme.md)). GROBID invokes it as a separate process, which is the classic "mere aggregation / separate program" arrangement, and consuming GROBID over HTTP from a Docker container puts a further process and network boundary between PaperTree and the GPL code. **This is almost certainly fine for a commercial SaaS, but it is a real fact that should reach counsel before PaperTree bundles pdfalto into a desktop binary.**

---

## 3. Apache Tika

Tika "detects and extracts metadata and text from over a thousand different file types" ([tika.apache.org](https://tika.apache.org/)), Apache-2.0, currently 3.3.2 (2026-07-16), with 4.0.0-beta-1 (2026-07-03) switching the default content handler to Markdown. For PDFs it uses **Apache PDFBox** ([arXiv:2303.09957](https://arxiv.org/abs/2303.09957), Table 4).

`PDFParserConfig` exposes `sortByPosition`, `enableAutoSpace`, `suppressDuplicateOverlappingText`, `extractInlineImages`, `ocrStrategy` (NONE/AUTO/ALWAYS), `extractBookmarksText`, `extractAnnotationText` and similar ([API docs](https://tika.apache.org/3.2.0/api/org/apache/tika/parser/pdf/PDFParserConfig.html)). **None of these emits coordinates or bounding boxes.**

Empirically: on DocBank, Tika could extract **only paragraphs, at F1 0.52**, and scored **0.00** on sections, captions, lists, footers, equations and tables ([arXiv:2303.09957](https://arxiv.org/abs/2303.09957), Fig. 9 / Table 6).

**Verdict: reject for PaperTree.** Tika is a format-detection and text-firehose layer for search indexing. It violates the geometry requirement absolutely. Its only conceivable PaperTree role is non-PDF ingest (DOCX, EPUB), which is out of scope here.

---

## 4. PyMuPDF

### Capabilities

`get_text()` accepts `"text" | "blocks" | "words" | "dict" | "rawdict" | "html" | "xhtml" | "xml"` ([recipes-text.rst](https://github.com/pymupdf/PyMuPDF/blob/main/docs/recipes-text.rst)):
- `"words"` — one entry per word **with bbox**.
- `"blocks"` — text blocks with position.
- `"dict"` — block → line → span hierarchy, bbox at every level, plus font/size/flags/colour per span.
- `"rawdict"` — as `dict` plus **per-character bboxes**.
- `sort=True` sorts top-left → bottom-right; **ignored for HTML/XHTML/XML**.
- `clip=` restricts extraction to a rectangle.

`get_drawings()` is the standout for PaperTree ([page.rst](https://github.com/pymupdf/PyMuPDF/blob/main/docs/page.rst)). It returns vector line-art as path dicts with `type` (`f`/`s`/`fs`), `color`, `fill`, `width`, `dashes`, `lineCap`/`lineJoin`, opacities, `rect` (path bbox), `layer` (OCG name), `level`, and `items` — a command list of `("l", p1, p2)` lines, `("c", p1..p4)` cubic Béziers, `("re", rect, orientation)` rectangles, `("qu", quad)` quads. With `extended=True` you additionally get `clip` and `group` dicts organised by nesting level. `get_cdrawings()` is the same thing "significantly faster" with tuples instead of objects.

**This is the only tool in this tier that gives you the actual geometry of a vector architecture diagram.** Combined with `get_pixmap(clip=...)` you can crop and rasterise an inferred figure region at arbitrary DPI. `Document.get_toc()` returns the PDF outline where one exists (frequently absent in arXiv PDFs).

### Speed

Self-reported ([app1.rst](https://github.com/pymupdf/PyMuPDF/blob/main/docs/app1.rst)): the most detailed method, RAWDICT, processes **all 1,310 pages of the Adobe Manual in under 5 seconds**; plain TEXT under 2 seconds. Relative cost, TEXT = 1.00: WORDS 1.02, DICT 3.93 (1.04 without images), RAWDICT 4.50 (1.68 without images). The README claims "10–50× speed improvements for text extraction and 100× or more for page rendering" versus pure-Python libraries — **vendor-self-reported, no corpus stated**.

Order-of-magnitude for PaperTree: **a 12-page digital-born paper at rawdict granularity is comfortably sub-100 ms on a laptop CPU.** That is fast-path territory.

### Reading order — the weakness

`sort=True` sorts blocks by `(bbox.y1, bbox.x0)`, which **interleaves the two columns of an academic paper** ([PyMuPDF Discussion #1901](https://github.com/pymupdf/PyMuPDF/discussions/1901), [#965](https://github.com/pymupdf/PyMuPDF/discussions/965)). PyMuPDF ships no column detection in the core API. `pymupdf4llm` adds layout-aware multi-column reconstruction, and is **the same dual AGPL/Artifex licence** ([PyPI](https://pypi.org/project/pymupdf4llm/), currently 1.28.0). The multi-column detection is documented as supporting horizontal LTR text and failing on non-disjoint/overlapping blocks.

Third-party: on DocBank, PyMuPDF extracted **paragraphs at F1 0.51** and **0.00 for sections, captions, lists, footers, equations, tables** ([arXiv:2303.09957](https://arxiv.org/abs/2303.09957), Table 6). That is a fair characterisation — PyMuPDF is a geometry engine, not a document-understanding engine, and the benchmark measured document understanding.

### Licence — the decision point

PyMuPDF is **"Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License"** ([PyPI metadata](https://pypi.org/project/pymupdf/), [README](https://github.com/pymupdf/PyMuPDF)). AGPL-3.0's §13 network clause means that if PaperTree's *server* uses PyMuPDF and PaperTree is offered over a network, **the entire PaperTree server source must be offered to users under AGPL**. There is no "we only link to it" escape. The only lawful commercial paths are: (a) buy an Artifex commercial licence, price not published — must be negotiated; (b) open-source PaperTree's server under AGPL; (c) don't use PyMuPDF.

PyMuPDF 1.28.0 shipped 2026-06-29, with a steady cadence (1.26.5 Oct 2025 → 1.27.x Feb–Apr 2026 → 1.28.0 Jun 2026). Maintenance is not the issue. The licence is.

---

## 5. unstructured.io

Code is **Apache-2.0** (`unstructured`, [LICENSE.md](https://github.com/Unstructured-IO/unstructured/blob/main/LICENSE.md); `unstructured-inference` 1.6.13, Apache classifier on [PyPI](https://pypi.org/project/unstructured-inference/)). The open-core split is explicit in the README: the free library, versus "Unstructured Pipelines" (enterprise, low-code UI/API, adds chunking, embedding, table enrichment) and an MCP/SaaS tier at **15,000 free pages/month then $0.03/page** ([README](https://github.com/Unstructured-IO/unstructured)). The most accurate table/layout work sits behind the paid tier; the OSS library gets the commodity path.

`partition_pdf` strategies ([docs](https://docs.unstructured.io/open-source/core-functionality/partitioning)):
- **`fast`** — extracts text with **pdfminer**, then runs `partition_text`. This is the fast path, and it is literally pdfminer plus classification heuristics.
- **`hi_res`** — layout analysis with `detectron2_onnx` (or YOLOX); required for table extraction and image-block extraction. Falls back to `ocr_only` if unavailable. *This is the neural tier, not this document's scope.*
- **`ocr_only`** — Tesseract.
- **`auto`** — picks between them.

Element types include `Title`, `NarrativeText`, `ListItem`, `Table`, `Image`, `FigureCaption`, **`Formula`**, `Header`, `Footer`, `PageNumber`, `CodeSnippet`, `Address`, `PageBreak`, `UncategorizedText`, `CompositeElement` ([docs](https://docs.unstructured.io/api-reference/partition/document-elements)). Metadata carries `coordinates` (points + coordinate system), `page_number`, `parent_id`, `element_id`, `text_as_html` (tables only), `languages`.

**Element identity — read this closely.** `element_id` defaults to "a SHA-256 hash of the element's text, its position on the page, page number it's on, and the name of the document file" ([docs](https://docs.unstructured.io/api-reference/partition/document-elements)). It is deterministic for identical input+version, but it is **content- and position-derived**, so any change in the extractor's segmentation (a version bump, a different strategy) changes the ID. It is a *cache key*, not a stable anchor. `unique_element_ids=True` gives UUIDs, which are worse for this purpose.

Hierarchy is `parent_id` only — a flat list with parent pointers, not a section tree with depth semantics. It is reconstructible but weaker than TEI `div` nesting.

Maintenance: active, commits 2026-07-26, 2026-07-15, 2026-07-13, including a stored-XSS fix (GHSA-v5mq-3xhg-98m9) on 2026-07-11 ([commits](https://github.com/Unstructured-IO/unstructured/commits/main)). Latest PyPI 0.24.1, requires Python `>=3.11,<3.14`.

**Verdict for the fast path: no advantage.** `fast` = pdfminer + heuristics; PaperTree can call pdfminer directly under MIT with fewer dependencies and more control. The value of unstructured is `hi_res`, which is a different tier.

---

## 6. pdfplumber and pdfminer.six

**pdfminer.six** (MIT, 20260107, released 2026-01-07, [PyPI](https://pypi.org/project/pdfminer.six/)) is the pure-Python PDF interpreter everything else in the Python ecosystem sits on — including unstructured's `fast` strategy and Camelot's Stream mode. It gives `LTChar`/`LTTextLine`/`LTTextBox` objects with bboxes and font info, with `LAParams` controlling line/word/box grouping. It has no notion of sections, captions, or reading order beyond LAParams heuristics. Maintenance is real but low-volume: recent commits 2026-03-13 (OOM fix in `apply_png_predictor`, circular xref detection, ICCBased colour-space type check), 2026-02-24 ([commits](https://github.com/pdfminer/pdfminer.six/commits/master)) — a maintenance-mode project with an engaged maintainer, not an actively growing one.

**pdfplumber** (MIT, Jeremy Singer-Vine, 0.11.10 released 2026-06-15, [repo](https://github.com/jsvine/pdfplumber)) wraps pdfminer.six and is the strongest *classical* table extractor available:
- Char-level objects with `x0, x1, top, bottom, doctop, width, height`, `fontname`, `size`, stroking/non-stroking colour, and the transformation matrix.
- `lines`, `rects`, `curves` (with path descriptions, bbox, fill/stroke), `images`, `annots`, `hyperlinks`.
- `.find_tables()`, `.extract_tables()`, `.extract_table()`; **`Table.cells` exposes per-cell bounding boxes** — this satisfies PaperTree's "row/cell addressability with geometry" requirement in a way GROBID does not.
- Table settings: `vertical_strategy`/`horizontal_strategy` ∈ {`lines`, `text`, `explicit`}, snap/join tolerances, edge filters.

Stated limits: "Works best on machine-generated, rather than scanned, PDFs"; no OCR; no PDF generation/modification.

Curves are exposed as individual path objects — so pdfplumber *does* see vector primitives — but it does not compose them into figure regions or give you the grouping/clipping hierarchy that PyMuPDF's `get_drawings(extended=True)` does.

Speed is the tradeoff: pure Python on top of pdfminer.six. I did not find a reliable published pdfplumber-vs-PyMuPDF timing benchmark (see §8).

---

## 7. Implications for PaperTree

**Against the hard requirements:**

| Requirement | Best classical answer |
|---|---|
| Page + bbox on every element | PyMuPDF `rawdict` (char-level) or pdfplumber (char-level). GROBID gives bboxes on structural elements via `teiCoordinates` but *only on the listed element types*. |
| Stable, addressable block identity across re-parses | **Nothing in this tier provides it.** GROBID's `generateIDs` produces *random* `xml:id`s per run. unstructured's `element_id` is a content+position hash that shifts when segmentation shifts. **PaperTree must own identity itself** — e.g. content-hash + geometric-centroid + section-path fingerprint with fuzzy re-anchoring. Treat this as a PaperTree-layer problem, not a parser feature. |
| Section tree | **GROBID only.** TEI nested `div`/`head`, section-title F1 0.74–0.81. Everything else is flat. |
| Equations as LaTeX with source region | **Nobody.** GROBID localises display formulas (`<formula>` with `@coords`) and scores 5.70/10 on formula content; it explicitly does not mark inline formulas. The realistic architecture is *GROBID/layout for the region, a neural model for the LaTeX*. |
| Figures with linked captions, **including vector** | **PyMuPDF `get_drawings()` is the only real vector answer.** GROBID caption F1 swings 0.24–0.61. pdfalto can dump vector paths as SVG (`-vectorCoordsOnly`, `-vectorBoxes`, `-vectorLimit`), which is an underused route if you already run GROBID. |
| Tables with row/cell addressability | **pdfplumber**, decisively. GROBID table F1 0.23 on DocBank and table-caption F1 13.1% on PLOS. |
| No hallucination; uncertainty representable | **This whole tier is a strength here.** These are deterministic/CRF systems that transcribe rather than generate. GROBID emits nothing where it labels nothing; pdfplumber returns raw chars. Zero rewriting risk. This is the single strongest argument for keeping a classical tier at all. |
| Runs without a GPU | Yes for all. GROBID CRF Docker image is ~500 MB and does ~2.5 PDF/s full-structure on 16 CPUs; PyMuPDF/pdfplumber are library calls. |

**Recommended shape.** A two-engine classical tier:

1. **Geometry + vector: pdfplumber (MIT) as default; PyMuPDF only if the AGPL question is resolved.** pdfplumber gives char-level provenance, cell-addressable tables, and curve objects, at zero licence risk. PyMuPDF is meaningfully better (composed vector paths with clip/group hierarchy, `clip`-based rendering, 10×+ faster) but costs either an Artifex negotiation or AGPL'ing the PaperTree server. **Budget the Artifex conversation early; do not let PyMuPDF creep into the codebase before it happens.**
2. **Document logic: GROBID 0.9.0-crf via Docker, `teiCoordinates` on `p,s,head,figure,formula,ref,biblStruct`, `segmentSentences=1`.** Take its section tree, its reference graph, its citation contexts, and its formula/figure *regions*. Do not take its tables or its formula *content*.

**What is genuinely FAST-PATH viable for digital-born pages:** PyMuPDF (`rawdict` ≈ 1,310 pages in <5 s), pdfplumber/pdfminer.six (slower, pure Python, but MIT and char-exact), and GROBID's CRF path at ~2.5 PDF/s full-structure or 36 PDF/s header-only. Tika and unstructured `fast` add nothing PaperTree cannot get more directly and more cheaply.

**Reject outright:** Apache Tika (no geometry). **Reject as primary:** unstructured OSS (its `fast` path is pdfminer wearing a hat; its value is in the neural `hi_res` tier and its paid pipelines).

---

## 8. What I could not verify

- **Whether GROBID's TEI `<figure type="table">` contains structured `<row>`/`<cell>` markup or only zone-level content.** The `doc/training/table.md` file 404s on GitHub raw and readthedocs rate-limited me repeatedly. The DocBank table F1 of 0.23 and the PLOS table-caption F1 of 13.12% strongly suggest cell structure is not reliably recovered, but I did not see the label list. **Verify by running GROBID on a real paper before relying on this.**
- **GROBID model-weight licensing as distinct from code licensing.** The repo states Apache-2.0 code, CC-0 docs, CC-BY annotated training data. I found no separate statement covering the trained CRF/DL weight files shipped in the Docker images. Probably Apache-2.0 by inheritance; not confirmed.
- **Licences of the YOLOX / Detectron2 weight files that `unstructured-inference` downloads at runtime.** The package is Apache-2.0 and both upstream architectures are Apache-2.0, but the README does not state terms for the specific checkpoints hosted by Unstructured. If unstructured is ever adopted, this needs checking.
- **Artifex commercial licence pricing for PyMuPDF.** Not published; quote-based.
- **PyMuPDF's "10–50× faster text extraction" claim** is vendor self-reported in the README with no corpus or methodology. The internal `app1.rst` numbers (1,310 pages RAWDICT in <5 s) are also self-reported but at least specify the document.
- **A head-to-head pdfplumber vs PyMuPDF timing benchmark on academic PDFs.** I found none from a primary source. pdfplumber is pure Python over pdfminer.six and will be substantially slower, but I have no number.
- **Per-parser scores for pdfplumber, pdfminer, unstructured, Marker, Nougat or Docling in the formula benchmark** ([arXiv:2512.09874](https://arxiv.org/abs/2512.09874), v1 Dec 2025, revised May 2026) — those systems were not among the 21 ranked. Only GROBID (5.70), PyMuPDF4LLM (6.67) and MinerU2.5 (9.17) were extractable from the results table.
- **GROBID's exact behaviour on inline (in-paragraph) math coordinates.** Docs say inline formulas get no markup; I did not verify whether their glyphs are silently dropped or merged into paragraph text. (They appear to be merged, but I did not test.)
- **Whether GROBID 0.9.0's new "figure/table/equation extraction from back sections" changes caption-linking quality** — the 0.9.0 benchmark files above already reflect 0.9.0, so the numbers quoted are post-change.
- **Apache Tika 4.0's Markdown content handler** — whether it preserves any structural signal (heading levels) that 3.x's XHTML handler did not. 4.0.0-beta-1 released 2026-07-03; I did not test it. It still will not produce coordinates.
