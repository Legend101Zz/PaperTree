# Progress Log

## Session 1 — 2026-07-29

### Done

**Stage 1 — Repository audit: COMPLETE.**
- Inventoried the repo: ~6.1k lines Python, ~9.0k lines TS/TSX/CSS.
- Read the core backend first-hand; dispatched 4 parallel subsystem audits for the rest.
- Built and ran 3 empirical probes against the **real repo modules** (not reimplementations):
  - `.audit/probe_extractor.py` — 8 PDFs × 6 measurements
  - `.audit/probe_math_mechanism.py` — root-caused the math misclassification
  - `.audit/probe_page_summary_bug.py` — page-slicing path
- Verified all 4 critical security claims by reading the code directly rather than trusting the agents.

**Stage 2 — Research: 16/20 reports (~64k words).**
- 14 document-intelligence topics + durable workflows + memory/injection.
- Agent-runtime and stack reports still running.

**Part C — Benchmark: designed + partially built.**
- `research/benchmarks/README.md` — PTUB v0.1: 3-tier corpus with power justification,
  gold annotation schema, 11 parsing metrics, 5 grounding metrics, 6 UI-anchor metrics,
  disqualification rule.
- Seeded 8-paper corpus; built `harness/compare_parsers.py`; installed Docling and ran
  a real CPU comparison.

### Key numbers

| | |
|---|---|
| Audit findings | ~100, of which **17 critical** |
| Lines of unreachable "document intelligence" | **1,698** (`extraction.py` 1016 + `papers/services.py` 682) |
| Lines that actually do extraction in production | **13** |
| Math classifications driven by font rather than mathematics | **100%** (707/707 across 3 papers) |
| Figures found by current code in the all-vector ResNet paper | **0** (Docling: 7) |
| Table cells recovered by current code | **0** (Docling: 342) |
| DB queries missing an ownership filter | **33 call sites** |

### Errors / corrections

| Issue | Resolution |
|---|---|
| Hypothesised `[Page N]` markers were never written, breaking page slicing | **Wrong** — `routes.py:34` does write them, via a *third* extractor I had not yet found. Correcting this led to the much larger finding that the two big extractors are dead code. |
| `python3 -c "import fitz"` failed | PyMuPDF is genuinely undeclared in both manifests; created `.audit/venv` for probing. |
| Docling `eq+LaTeX = 0` | Default config — `do_formula_enrichment` is off. Recorded as a floor, not a ceiling. |

### Next

1. Finish agent-runtime + stack research.
2. Synthesise the parser comparison matrix (§5 of required output).
3. Design PaperIR (§7) — the stable-ID strategy is the critical decision.
4. Remaining synthesis §1–28.
5. Stage 4: Claude Design brief → 3 directions → canvas redesign → token/component handoff.

### Recommendation issued out-of-band

Security findings F1–F4 in `findings.md` are live and unrelated to the redesign.
Flagged to the user for immediate action (credential rotation + ownership filters).

## Session 1 close — 2026-07-29

**Stages 1-3 complete.** Stage 4 brief written (§20); exploration (§21-24) pending.

Deliverables:
  - research/architecture-decisions/ADR-001-canonical-document-representation.md
  - research/audit-backend-highlights-explanations-canvas-auth.md
  - research/audit-backend-routes-llm.md
  - research/audit-frontend-canvas-dashboard-shared.md
  - research/audit-frontend-reader.md
  - research/benchmarks/README.md
  - research/design/IA-wireframes-and-design-brief.md
  - research/literature/01-pdf-to-tree.md
  - research/literature/02-docling.md
  - research/literature/03-mineru.md
  - research/literature/04-marker.md
  - research/literature/05-grobid-classical.md
  - research/literature/06-nougat-olmocr.md
  - research/literature/07-formula-recognition.md
  - research/literature/08-table-recognition.md
  - research/literature/09-layout-detection.md
  - research/literature/10-reading-order-hierarchy.md
  - research/literature/11-visual-retrieval.md
  - research/literature/12-sci-doc-benchmarks.md
  - research/literature/13-highlight-anchoring.md
  - research/literature/14-audiobook-tts.md
  - research/literature/20-agent-runtimes.md
  - research/literature/21-durable-workflows.md
  - research/literature/22-memory-and-injection.md
  - research/literature/30-database-and-storage.md
  - research/literature/31-language-and-architecture.md
  - research/literature/32-frontend-canvas-pdf-tech.md
  - research/REPORT.md
  - research/ROADMAP-AND-CHANGE-MAP.md
  - research/synthesis-05-parser-comparison.md
  - research/synthesis-10-highlight-and-qa.md
  - research/synthesis-13-memory.md
  - research/synthesis-14-stack-monorepo.md
  - research/synthesis-17-audiobook.md

