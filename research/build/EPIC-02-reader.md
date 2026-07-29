# EPIC 2 — Reader & Anchoring

**Wave 1 · parallel with Epic 1 · depends on Epic 0 fixtures only**

> Goal: a calm, touch-capable reading workspace where a highlight survives zoom, resize,
> reload and a parser upgrade.

**This epic never waits for Epic 1.** It builds entirely against
`packages/document-ir/fixtures/`. If you find yourself blocked on the parser, you are
doing it wrong — add a fixture.

---

## Features

- [ ] **F2.1 — PDF renderer.** `pdfjs-dist` directly (drop `react-pdf`). Virtualised page list, canvas + text layer, worker bundled locally (**not** from a CDN — the current app loads it protocol-relative from a third party). Real zoom, not a CSS width slider.
- [ ] **F2.2 — Anchor model + resolver.** W3C multi-selector: block id → content hash → text-quote (prefix/exact/suffix) → geometric overlap → **loud failure**. Per `research/synthesis-10-highlight-and-qa.md` T0–T6 ladder. Shared package, used by web and API.
- [ ] **F2.3 — Highlight capture & overlay.** Selection → quads in **PDF user space** against `getViewport({scale:1, rotation:0})`. Painted via a `transform: scale(z)` overlay. Never `getClientRects()/window.innerWidth` — that is the current bug that makes every highlight unrecoverable.
- [ ] **F2.4 — Navigator.** One panel, six tabs: Outline · Pages · Highlights · Notes · Questions · Chapters. Replaces `OutlinePanel`, `SmartOutlinePanel`, `HighlightsPanel`, `PDFMinimap`. Outline comes from PaperIR's **section tree**, never from page numbers.
- [ ] **F2.5 — Guided view.** Reflowed prose derived from PaperIR. Visually distinct register, `⊙` marker, every block carries `derived_from` block IDs and a "show source" affordance. **It never replaces the paper.**
- [ ] **F2.6 — Split mode.** Source ‖ Guided, scroll-linked **by block ID**, not by page or scroll ratio.
- [ ] **F2.7 — Touch & iPad.** Pointer Events throughout. `touch-action` discipline. Custom selection handles over the native text layer. `visualViewport` for keyboard. 44pt minimum targets. **Nothing hover-only** — the current app has zero touch handlers and every action is hover-gated.
- [ ] **F2.8 — Library & system states.** Grid/list, upload with progress, and the designed states: parsing, partial, uncertainty, failure, offline, empty.

F2.4/F2.5/F2.8 are parallel-safe once F2.1–F2.3 land.

---

## Owns (exclusive)

```
apps/web/src/**            (except canvas/** and audio/**)
packages/anchoring/**
packages/ui/**
```

## Acceptance criteria

| Test | Asserts |
|---|---|
| `anchoring/zoom.spec` | Highlight centroid drift <1pt across zoom 50/75/100/150/200/400%. |
| `anchoring/resize.spec` | Drift <1pt across 5 viewport widths incl. iPad portrait and landscape. |
| `anchoring/reparse.spec` | **≥99% of highlights re-anchor** when block IDs change under a perturbed parse. Every failure is surfaced to the user, never silently dropped. |
| `anchoring/cross-mode.spec` | A highlight made in Source resolves in Guided, or explicitly reports "not available in this view". |
| `anchoring/targets.spec` | Anchors resolve for: PDF text, Guided paragraph, equation, **part of an equation**, figure, region inside a figure, table row, table cell, algorithm, citation. |
| `reader/perf.spec` | A 55-page PDF scrolls at 60fps; memory stable; only visible pages ± 2 are mounted. |
| `reader/touch.spec` | Every interactive element ≥44×44pt. Zero hover-only actions (automated audit). |
| `reader/a11y.spec` | axe clean at WCAG 2.2 AA. Full keyboard operation. Every AI-derived region is announced as AI-derived. |
| `reader/provenance.spec` | No Guided block renders without a visible derived marker and a working source link. |

## Non-goals

No canvas. No audio. No AI question flow (Epic 3 — but leave the Inspector slot for it).
Do not build against the live parser; use fixtures.

## Must delete

`components/reader/{SmartOutlinePanel,OutlinePanel,SearchResults,PDFMinimap,ExplanationModal,InlineExplanation}.tsx`
· `hooks/useCanvas.ts` · `globals.css:49-148` · `Mermaid.tsx` + `MermaidRenderer.tsx`
· the second API client in `lib/api.ts`.

---

# WORKFLOW PROMPT

> Paste into a fresh Claude Code session in ultracode mode. Requires Epic 0 merged.
> Safe to run at the same time as Epic 1.

---

You are building **Epic 2 — Reader & Anchoring** for PaperTree v2.

**Repo:** `/Volumes/Mrigesh SSD/PaperTree` (quote the path — it contains a space).
Branch: `epic-2-reader`.

**You build against `packages/document-ir/fixtures/` — hand-checked PaperIR for 3 papers.
You do not wait for the parser epic.** If a fixture lacks something you need, add it to
the fixture (and note it in your result file), rather than blocking.

## Read first

- `research/design/IA-wireframes-and-design-brief.md` — §18 information architecture, §19 text wireframes. **This is the design you are implementing.**
- `research/synthesis-10-highlight-and-qa.md` — the anchor schema and the T0–T6 resolver ladder
- `research/literature/13-highlight-anchoring.md` — W3C selectors, PDF coordinate spaces, Hypothesis's lessons
- `research/literature/32-frontend-canvas-pdf-tech.md` — pdf.js specifics, iPad/Pointer Events, KaTeX
- `research/audit-frontend-reader.md` — every failure of the current reader
- `findings.md` §G — the provenance and touch findings

## Context

PaperTree is an open-source hobby project — "Goodnotes for understanding research papers".
The current reader has 12 competing surfaces, 3 of them dead, and zero touch handlers.
Every stored highlight is unrecoverable because capture divides `getClientRects()` by
`window.innerWidth` and rendering treats the result as a fraction of the page element.

The organising rule of the new IA: **one document, one navigator, one inspector, one
transport.** The paper is the only permanent object on screen. Everything else is
summoned, does its job, and leaves.

## Your scope

Eight features — full list in `research/build/EPIC-02-reader.md`. In short: a virtualised
pdf.js renderer, the multi-selector anchor model and resolver, highlight capture in PDF
user space, a single six-tab Navigator, the Guided view, Split mode, full touch/iPad
support, and the library with its system states.

## The criterion that matters most

**`anchoring/reparse.spec`: ≥99% of highlights must re-anchor when block IDs change under
a perturbed parse, and every failure must be visible to the user.**

If this cannot be met, stop and say so rather than lowering the bar — the whole
architecture rests on annotations surviving parser upgrades, and it is far better to
learn that here than after users have a year of highlights.

## Hard rules

- Highlight geometry is **quads in PDF user space** against `getViewport({scale:1, rotation:0})`, painted through a `transform: scale(z)` overlay. Never viewport pixels, never fractions of a DOM element. Note `convertToViewportRectangle` no longer exists in current pdf.js — convert per point with `convertToPdfPoint`. Handle `userUnit` and page rotation.
- **Guided content is never presented as the paper.** Distinct type register, a reserved `⊙` marker used nowhere else, `derived_from` block IDs on every block, and a working "show source" on each. There must be a test that fails if a Guided block renders without these.
- **No fabricated diagrams.** Mermaid rendering is deleted, not restyled. If a derived section wants to show structure, it shows the paper's own figure crop.
- The outline is PaperIR's **section tree**. Never a page list. (The current "SmartOutline" is one entry per page titled by an LLM.)
- Pointer Events, not mouse events. Nothing hover-only. 44pt minimum targets.
- Bundle the pdf.js worker locally; do not fetch it from a CDN.

## Acceptance

Zoom/resize drift <1pt · **≥99% re-anchor on reparse with loud failure** · anchors resolve
for all 10 target types including *part of an equation* and *a table cell* · 55-page PDF
at 60fps with windowed mounting · zero hover-only actions · axe clean at WCAG 2.2 AA ·
no Guided block without provenance.

## Non-goals

No canvas, no audio, no AI question flow (leave the Inspector slot; Epic 3 fills it).

## Must delete

`SmartOutlinePanel`, `OutlinePanel`, `SearchResults`, `PDFMinimap`, `ExplanationModal`,
`InlineExplanation`, `hooks/useCanvas.ts`, `Mermaid.tsx`, `MermaidRenderer.tsx`,
`globals.css:49-148`, and the duplicate API client.

## How to work

F2.1–F2.3 are the spine of this epic and should be sequential. F2.4, F2.5 and F2.8 are
parallel-safe afterwards — use worktrees.

One PR per feature. When done, write `research/build/EPIC-02-RESULT.md` with the measured
re-anchor rate, any fixture gaps you had to fill, and the component inventory Epic 5
(canvas) should reuse.
