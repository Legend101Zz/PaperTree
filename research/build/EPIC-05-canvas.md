# EPIC 5 — Infinite Canvas

**Wave 3 · parallel with Epic 4 · depends on Epics 1–3**

> Goal: a spatial research notebook where every source-backed node returns to its exact
> region — not a React Flow demo.

---

## What is being replaced

The current canvas, measured against its own naming:

- `populate_canvas` creates **one node per PDF page, unbidden**, on first open, plus one per highlight and one per explanation, then re-runs a server-side layout over everything.
- **"Go to source" is a dead deep link.**
- Provenance is **one integer** (a page number); all geometry is discarded.
- An auto-save ⇄ invalidate loop rewrites the canvas continuously.
- Edges are decoration: `edge_type` maps to a stroke colour and is never read semantically.
- Every node action is **hover-only** — unusable on touch.
- Five node types are registered but four components exist, so the paper root renders as an AI answer.
- The whole document is PUT back as one blob on a 3s timer.

Every one of these is an explicit non-goal of the replacement.

---

## Features

- [ ] **F5.1 — Data model.** `canvas_nodes` and `canvas_edges` as **rows**, not one JSON blob. A drag updates one row. Optimistic local state, debounced per-node persistence.
- [ ] **F5.2 — Node family.** Excerpt · section · equation · figure · table · AI explanation · user note · question · answer · claim · evidence · contradiction · related-paper · group/frame. Distinct visual hierarchy — **not identical boxes**.
- [ ] **F5.3 — Provenance & return-to-source.** Every source-backed node carries a full PaperIR anchor (reusing `packages/anchoring`). Actions: open source · preview source · highlight source · play corresponding audio · ask about node · branch explanation · collapse · group · duplicate as note · export.
- [ ] **F5.4 — Edge semantics.** Edges carry **meaning** and a visible label: supports · contradicts · derives-from · answers · compares · references. Never decorative colour alone.
- [ ] **F5.5 — Interaction.** Selection, multi-select, marquee, zoom, minimap, frames, grouping, auto-layout **as an explicit user action only**, keyboard shortcuts, undo/redo.
- [ ] **F5.6 — Touch.** Pointer Events, long-press context menu, two-finger pan, pinch zoom, drag-from-paper-to-canvas. **Zero hover-only actions.**
- [ ] **F5.7 — Creation flows.** Drag a selection from the reader onto the canvas; branch a question from a node; create a note. **No bulk auto-generation, ever.**
- [ ] **F5.8 — Empty state & onboarding.** A canvas that teaches itself in one screen without generating anything.

F5.4/F5.5/F5.8 are parallel-safe once F5.1–F5.3 land.

## Owns

```
apps/web/src/components/canvas/**   packages/canvas/**
apps/api/.../canvas/**              (rewritten)
```

## Acceptance

| Test | Asserts |
|---|---|
| `canvas/no-autogen.spec` | Opening a canvas for a paper with 50 pages, 30 highlights and 20 explanations creates **zero nodes**. Nodes appear only from explicit user action. |
| `canvas/provenance.spec` | Every source-backed node resolves to its exact region; "open source" navigates correctly for 100% of nodes. |
| `canvas/persistence.spec` | Dragging one node writes one row. No full-document rewrite. No auto-save loop (assert a settled canvas issues zero writes over 30s). |
| `canvas/undo.spec` | Undo/redo across create, move, delete, group, edge-create — 50 operations deep. |
| `canvas/perf.spec` | 500 nodes at 60fps pan/zoom. |
| `canvas/touch.spec` | Every action reachable by touch. Zero hover-only. Automated audit. |
| `canvas/edges.spec` | Every edge has a semantic type and renders a readable label. |

## Non-goals

No real-time collaboration (leave the data model collaboration-*ready*: per-node rows,
stable IDs). No AI-driven auto-arrangement. No cross-paper canvases yet — but do not
design the schema in a way that forecloses them.

## Must delete

`components/canvas/**` (all of it) · `canvas/services.py` legacy node generation ·
the second `canvas_router` in `main.py` · `types/canvas.ts` **or** the canvas types in
`types/index.ts` — the two contradictory systems collapse to one.

---

# WORKFLOW PROMPT

You are building **Epic 5 — Infinite Canvas** for PaperTree v2.
**Repo:** `/Volumes/Mrigesh SSD/PaperTree` (quote the path). Branch: `epic-5-canvas`.
Epics 0–3 merged. Safe to run alongside Epic 4.

## Read first
- `research/design/IA-wireframes-and-design-brief.md` — canvas behaviour and the ten scenes it must support
- `research/audit-frontend-canvas-dashboard-shared.md` — every failure of the current canvas, with line numbers
- `research/literature/32-frontend-canvas-pdf-tech.md` — xyflow vs alternatives, touch, performance
- `findings.md` §G3 — the auto-generation and provenance findings

## Context
Open-source hobby project. Stack: `@xyflow/react` (MIT), SQLite, Next.js.

The purpose is a **spatial research notebook**: place excerpts, equations, figures and
tables; ask branching questions; connect claims; compare methods; build argument maps;
collect unresolved questions; and always return to the exact source.

## The rule that defines this epic

**No node is ever created without explicit user intent.**

The current canvas generates one node per PDF page on first open, plus one per highlight
and one per explanation, then auto-lays-out over the user's arrangement. The replacement
must open **empty** and stay empty until the user puts something on it. There is a test
for this and it is the most important test in the epic.

## Design constraints (from the brief)
Avoid: identical boxes for every concept · excessive connector lines · arbitrary rainbow
colours · permanently visible handles · unclear edge semantics · automatic graph
explosions · chat transcripts dumped into nodes.

Do: distinct visual hierarchy per node kind · edges that carry labelled meaning ·
provenance visible on every source-backed node · detail revealed on zoom and selection,
so 500 nodes stay readable and fast.

## Hard rules
- Nodes and edges are **rows**, not one JSON blob. A drag updates one row.
- Every source-backed node carries a full PaperIR anchor via `packages/anchoring` and can open, preview and highlight its source, and play the corresponding audio.
- Auto-layout is an explicit user action that is undoable. It **never** runs on load.
- Edges have semantic types with visible labels — never colour-coded decoration.
- Pointer Events. Zero hover-only actions. Long-press for context menus.
- AI-generated node content is visually distinct from source-derived content, using the same `⊙` marker as the reader.
- Undo/redo across everything, 50 deep.

## Acceptance
**Opening a canvas for a 50-page paper with 30 highlights creates zero nodes** · 100% of
source-backed nodes navigate to their exact region · one drag = one row write, and a
settled canvas issues zero writes over 30s · undo/redo 50 operations deep · 500 nodes at
60fps · zero hover-only actions · every edge semantically typed and labelled.

## Non-goals
No real-time collaboration (but keep the schema collaboration-ready: per-node rows,
stable IDs). No AI auto-arrangement. No cross-paper canvases yet — don't foreclose them.

## Must delete
All of `components/canvas/**`, the legacy node generation in `canvas/services.py`, the
second `canvas_router` in `main.py`, and one of the two contradictory canvas type systems.

## How to work
F5.1–F5.3 are the spine — sequential. F5.4, F5.5, F5.8 are parallel afterwards; use
worktrees. Build the ten canvas scenes from the design brief as acceptance scenarios, not
illustrations.

One PR per feature. Finish with `research/build/EPIC-05-RESULT.md`: measured node-count
performance, provenance coverage, and anything the design system should absorb.
