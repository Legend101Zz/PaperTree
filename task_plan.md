# PaperTree — Audit, Research, Planning & Redesign Program

**Goal:** Take PaperTree from an MVP "AI PDF chat" into a premium research-reading
environment — "Goodnotes for understanding research papers, enhanced by trustworthy
document intelligence, contextual AI, an infinite knowledge canvas and a guided audiobook."

**Repo:** `/Volumes/Mrigesh SSD/PaperTree` (github.com/Legend101Zz/PaperTree), branch `main`.

**Hard rule for this pass:** research + evidence + design only. No production
implementation until Stages 1–3 are documented. Benchmarks before parser selection.

---

## Deliverable layout

| Path | Contents |
|------|----------|
| `research/literature/` | External research reports, one per topic |
| `research/benchmarks/` | Golden corpus manifest, annotation schema, harness |
| `research/architecture-decisions/` | ADRs |
| `research/experiment-results/` | Empirical runs against the current code |
| `research/design/` | Design brief, directions, canvas spec, token/component handoff |
| `research/REPORT.md` | The 28-section required output, assembled |

---

## Phases

### Phase 1 — Repository & product audit (STAGE 1)  — `COMPLETE`
- [x] Repo inventory, line counts, dependency manifests
- [x] Read `papers/extraction.py`, `papers/services.py`, `config.py`, `main.py`, `database.py`, `papers/models.py`, `papers/routes.py`, `llm_service.py`, `highlights/models.py`
- [x] Subsystem audits: backend routes+LLM, highlights/explanations/canvas/auth, frontend reader, frontend canvas/dashboard/shared → `research/audit-*.md` (~100 findings, 17 critical)
- [x] Empirically ran the current extractor on 8 PDFs → `research/experiment-results/current-extractor-probe.json`
- [x] Proved both structured extractors are unreachable dead code
- [x] Diagnosed the math-classification mechanism (100% font-driven)
- [x] Verified the 4 critical security claims by hand
- [x] Mapped the real flow → `findings.md` §C

### Phase 2 — External technical research (STAGE 2) — `COMPLETE`
- [x] Document-intelligence literature review — 14/14 topics → `research/literature/01-14`
- [x] Durable workflows + memory/prompt-injection → `research/literature/21,22`
- [x] Agent-runtime comparison → `literature/20-agent-runtimes.md`
- [x] Stack research: DB/storage, language boundaries, frontend tech → `literature/30,31,32`
- [x] Parser comparison matrix → `synthesis-05-parser-comparison.md`
- [x] **Measured** capability comparison rows 1/2/3/5 incl. a real Docling run → `research/experiment-results/ptub-capability-matrix.json`

### Phase 3 — Benchmark (PART C) — `DESIGN COMPLETE · gold annotation is the open critical path`
- [x] Corpus design + justified size (44 / 12 / 120 with power reasoning) + 8-paper seed
- [x] Annotation schema + rules → `benchmarks/README.md` §2
- [x] Harness + adapter interface + 4 working adapters → `benchmarks/harness/compare_parsers.py`
- [x] Ran current PaperTree extractor, dead extractor, PyMuPDF and Docling
- [ ] **Tier B gold annotations (~60 expert-hours) — BLOCKS final parser selection**
- [ ] Expand corpus 8 → 44 (scanned, non-English, plot-heavy, table-heavy categories missing)

### Phase 4 — Design (STAGE 3) — `COMPLETE`
- [x] PaperIR canonical representation → `architecture-decisions/ADR-001-…md`
- [x] Parsing pipeline options ×4 + recommendation → `synthesis-05-parser-comparison.md`
- [x] Highlight + contextual Q&A architecture → `synthesis-10-highlight-and-qa.md`
- [x] Agent runtime decision → `REPORT.md` §12 · memory → `synthesis-13-memory.md`
- [x] Stack recommendation + ADRs + monorepo shape → `synthesis-14-stack-monorepo.md`
- [x] Audiobook architecture → `synthesis-17-audiobook.md`
- [x] Product IA + text wireframes → `design/IA-wireframes-and-design-brief.md` §18–19
- [x] Phased roadmap, file-level change map, first milestone, top-ten decisions → `ROADMAP-AND-CHANGE-MAP.md`

### Open reconciliation
- [ ] Stable-block-ID formula: ADR-001 (blake2s, 2pt) vs synthesis-05 (sha256, 0.5pt).
      Resolve by measurement in the first milestone, not by preference. See `REPORT.md`.

### Phase 5 — Claude Design (STAGE 4) — `pending`
- [ ] Distilled design brief
- [ ] 3 distinct directions + evaluation + selection
- [ ] Required screens (library / reader / audio / responsive / system states)
- [ ] Infinite canvas redesign (10 scenes)
- [ ] Design tokens + component inventory + handoff

---

## Standing constraints (from the brief)

1. Research before choosing the stack; benchmark before replacing the parser.
2. Extraction ≠ comprehension. Agent memory ≠ document storage.
3. No coding agent as an unrestricted production backend; no shell/FS for user-facing agents.
4. Raw extracted text must not be the canonical representation.
5. One flat vector index is not a retrieval system.
6. PDF page boundaries are not semantic section boundaries.
7. Never discard geometry; never lose provenance; never silently repair source.
8. AI-generated content must be visually distinguishable from source content.
9. Untrusted PDF content must never write into trusted long-term memory.
10. No tool selection from GitHub stars. No rewrite without evidence.
11. Preserve working functionality until a tested replacement exists.

> External/web content goes in `findings.md` and `research/`, never in this file.

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |
