# RESEARCH R3 — diagrams, layout, motion, scale, 3D (PaperTree v0.2)

Date read: 2026-10-16. Status: complete.

## Summary (10 lines)

1. **Spec**: NDJSON, one object per line (`plate`, `part`, `link`, `end`); `after` may only name earlier letters (DAG by construction); `cite` is a required, nullable verbatim quote that the server resolves to an Anchor (null = "inferred, no passage"). Validate with the existing zod 3 in `services/agent`; stream over the existing SSE writer. Zero client bundle.
2. **Layout**: build our own slot grid (156×44 boxes, 72 px pitch, layer = 1 + max(layer(after)), gutter lane for skip edges). It reproduces the 07b/07c drawing; ELK/dagre move the main column.
3. **ELK**: npm licence is `EPL-2.0 OR GPL-3.0-or-later`; 440 KB gz, pure GWT JS (not WASM). **Owner's call, not adopted.** dagre (MIT, 16.9 KB gz) and d3-hierarchy (ISC, 1.8 KB gz, trees only) are not needed.
4. **Streaming**: slots are final on arrival, ghost slot dashed below, plate grows downward only, edges ink in when both ends exist, Stop freezes, optional single 240 ms centring settle at `end`.
5. **Motion**: CSS transitions for state (marker↔trace, search dim), **WAAPI** for choreography (pull out as one 400 ms animation with offsets, flash as one 1680 ms animation), FLIP for Dive in, rAF tween for the 240 ms scroll. Read durations from the existing CSS tokens; reduced motion is already in `tokens.css:187-189`.
6. **Motion library**: skip Motion in v0.2 (+33 to +47 KB gz measured; v14.3.0 supports React 18). Fall back to `motion/mini` (3.4 KB gz) if FLIP moves multiply. No `layoutId` for spine → book → reader.
7. **Shelf**: do not virtualise (≈1,600 elements for 400 spines built in 7-12 ms raw); use `content-visibility:auto` per row; matches in "+n more" must be counted from data.
8. **Table**: ship non-virtualised with `content-visibility:auto` rows at 400; when needed use `@tanstack/react-virtual` (10.3 KB gz) with aria-rowindex/roving focus/`rangeExtractor` for the focused row.
9. **3D**: perspective on a stage parent, `preserve-3d`, cover hinge `transform-origin:left` with `rotateY(-160deg)`, back face = endpaper, shadows as pseudo-element opacity, reduced motion = 120 ms cross-fade. Sketch in Q6.
10. **Not verified**: model's NDJSON reliability (no model call), React/paint cost of the shelf, Safari 3D behaviour, View Transitions support today, Motion's async-feature initial size.


## Q1. Diagram spec schema

**Context found in the repo.** The agent service already streams over SSE (`/Volumes/Mrigesh SSD/PaperTree/services/agent/src/sse.ts:8`, `AgentEventName = 'run' | 'status' | 'text' | 'usage' | 'done'`), `zod ^3.24.1` is already a dependency of `packages/document-ir` (`package.json:25`), and the `Anchor` record (`packages/anchoring/src/types.ts:179`) is built by our code, not by the model. So: the model never emits an Anchor. It emits a **verbatim quote**; the server resolves that quote to an Anchor with the existing lexical checker. A part whose quote does not resolve gets the "not verified" tab; a part with `cite: null` is dashed, "inferred, no passage" (DESIGN.md §4 items 6-7).

**Prior art: mermaid-to-excalidraw (v2.1.1, read 2026-10-16, clone at `/Volumes/Mrigesh SSD/PaperTree-research/v0.2/src/mermaid-to-excalidraw`).** It does NOT lay anything out. It asks Mermaid to render an SVG in the DOM and then scrapes the geometry:
- `src/parser/flowchart.ts:260` `parseVertex` reads each node's position/`getBBox()` (lines 266-285); `:339` `parseEdge` reads the edge path and its `reflectionPoints` (type `Edge`, `:36-49`: `start`, `end`, `text`, `startX/startY/endX/endY`, `reflectionPoints`).
- `src/converter/types/flowchart.ts:278-292` turns each edge into an Excalidraw skeleton `{type:"arrow", x, y, points, label:{text}}`; `src/converter/transformToExcalidrawSkeleton.ts:103-115` is the same for a generic arrow with label.
- Lessons we take: (1) keep three layers separate: *semantic spec* (what the model wrote) → *geometry* (x,y,w,h, edge points) → *drawing* (our SVG plate). (2) Do not make the model write a DSL that needs a browser to render: Mermaid needs a DOM and a full render just to know where things go, and a text model gets Mermaid syntax wrong in ways that fail the whole parse. One JSON object per line fails one line, not the plate.

### Proposed schema (zod 3 style; validated in `services/agent`, so the web bundle only gets the TypeScript types — zero client cost)

```ts
// One NDJSON line = one event. The Nth part line IS letter N (A,B,C…): the model only counts,
// and the SERVER assigns the real letter by arrival order, so a miscount is corrected, not trusted.
const Kind = z.enum(['input', 'step', 'output', 'concept']);   // input = bare box-less letters (Q K V); step = ruled box; output = double rule; concept = plain

const Cite = z.object({
  quote: z.string().min(8).max(240),        // VERBATIM from the paper; server resolves to an Anchor
  page: z.number().int().positive().optional(), // hint only; the resolver never trusts it
});

const Part = z.object({
  t: z.literal('part'),
  label: z.string().min(1).max(28),         // "MatMul", "Scale ÷ √dk"   (fits 156 px box at 15 px Caslon)
  text: z.string().max(110).default(''),    // one short line for the key
  kind: Kind.default('step'),
  after: z.array(z.string().regex(/^[A-L]$/)).max(3).default([]),  // edges INTO this part, from EARLIER parts only
  edge: z.array(z.string().max(18)).max(3).optional(),             // optional label per `after` entry, same order
  cite: Cite.nullable(),                    // null = "inferred, no passage" (required key: forces the decision)
});

const Link = z.object({                     // only for a link that cannot be expressed as `after` (a feedback edge)
  t: z.literal('link'),
  from: z.string().regex(/^[A-L]$/), to: z.string().regex(/^[A-L]$/), label: z.string().max(18).optional(),
});

const Head = z.object({ t: z.literal('plate'), title: z.string().max(60) });   // first line
const Done = z.object({ t: z.literal('end') });                                  // last line (absence = Stopped/cut)
export const Line = z.discriminatedUnion('t', [Head, Part, Link, Done]);
```

Limits that match the design: ≤ 12 parts (letters A-L; the plate in the design uses A-F), ≤ 20 links (≤ 3 `after` per part = ≤ 36 theoretically, so cap at 20 total on the server and drop the rest with a note), `label` 28 chars, `text` 110 chars (the key shows 2 lines at 13 px).

**Why this shape is easy for a text model**
1. The **only back-reference direction is backwards** (`after` names earlier letters). The graph is a DAG by construction, no ids to invent, no dangling `to`. A cycle needs an explicit `link` line, which the server may drop.
2. The model never chooses an id, coordinate, colour or marker number, and letters are just "count the part lines so far". The server assigns letter, marker numbers (dedupe by resolved Anchor, as the mock does: part C has markers 1 and 2) and `Plate N`.
3. `cite` is required but nullable, so "I did not find a passage" is one explicit token, not a silent omission. The prompt says: quote exactly, or `null`; never paraphrase.
4. Flat objects, short enums, no nesting deeper than one level, no optional-vs-required puzzles beyond `edge`.
5. Prompt carries one complete 4-line example (the Q/K/V → MatMul → Scale → Softmax one from 07c) and "emit one JSON object per line, no prose, no code fence".

**Example (what the model emits, 07c data)**
```
{"t":"plate","title":"Scaled dot-product attention"}
{"t":"part","label":"Q, K, V","text":"queries, keys, values","kind":"input","after":[],"cite":{"quote":"queries and keys of dimension dk, and values of dimension dv","page":4}}
{"t":"part","label":"MatMul (Q · Kᵀ)","text":"dot products of the query with all keys","kind":"step","after":["A"],"cite":{"quote":"compute the dot products of the query with all keys"}}
{"t":"part","label":"Scale ÷ √dk","kind":"step","after":["B"],"cite":{"quote":"divide each by √dk"}}
{"t":"part","label":"Weights sum to 1","kind":"concept","after":["D"],"cite":null}
{"t":"end"}
```

**Streaming + validation pipeline (server)**
- Buffer text deltas; split on `\n`; for each complete line: `JSON.parse` in try/catch → `Line.safeParse` → on success resolve the quote (anchoring) → emit an SSE frame (extend `AgentEventName` with `'diagram'`, payload = the part plus `letter`, `markers`, `verified`). Tolerate and strip a leading ```` ```json ```` fence and lines that do not start with `{`.
- Invalid line → skip it, send a `status` frame ("one part skipped"), keep going. A part whose `after` letter does not exist yet → drop that edge, keep the part. More than 12 parts → ignore the rest and say so.
- Prefer NDJSON over "a JSON array parsed incrementally": an array needs a streaming JSON parser (bundle + failure on any malformed byte) while NDJSON needs `indexOf('\n')`. Cost of NDJSON: none we found. If a model refuses NDJSON and emits an array, a 20-line brace-depth splitter (track string/escape state, emit each depth-1 object) recovers it; NOT built or tested here.
- Whole-plate fallback: if the stream ends with zero valid parts, show the existing error state (DESIGN 04c) and a Retry; never draw a partial garbage plate.
- Model: MiniMax M3.1 Flash, text only (task context). Whether it reliably emits strict NDJSON is NOT CONFIRMED here (no model call was made); acceptance test needed: 30 papers × 3 asks, measure % lines valid and % quotes resolving.

## Q2. Layout engine

**How measured.** `npm i` into the scratch folder (`PaperTree-research/v0.2/prototypes/r3` on the SSD), then `esbuild <entry> --bundle --minify --format=esm --platform=browser --define:process.env.NODE_ENV="production"` with react/react-dom external, `gzip -9` on the output. Entry files in `.../r3/e/`. Layout timings: Node on this Mac (Darwin 25.3), one cold + warm call, `bench.mjs`; they show relative cost, not browser numbers. Date read: 2026-10-16.

| | elkjs | @dagrejs/dagre | d3-hierarchy | own slot grid |
|---|---|---|---|---|
| Version / last release | npm `0.12.0`, modified 2026-07-17; clone HEAD says 0.13.0 (last commit 2026-10-06, unreleased) | npm `3.1.1`, 2026-08-08; clone `3.1.2-pre`. Old unscoped `dagre@0.8.5` is dead (2022); dagre README says only the `@dagrejs` one is updated | `3.1.2`, 2022-06-14 (stable, feature-complete) | n/a |
| Licence | **`EPL-2.0 OR GPL-3.0-or-later`** (`package.json:25` in npm tarball and in clone; `LICENSE.md` in clone is the EPL-2.0 text) | MIT | ISC | ours (MIT) |
| Size, min+gz | `elk.bundled.js` **439.6 KB gz** (1.46 MB min). Split build: `elk-api.js` **2.2 KB gz** on the main thread + `elk-worker.min.js` **461.6 KB gz** loaded in a Web Worker | **16.9 KB gz** (48.5 KB min) | **1.8 KB gz** (4.3 KB min; `tree`+`hierarchy`) | ~0.6 KB gz (est.; `slot.mjs` is 15 lines) |
| Runtime | GWT-compiled **pure JS**, not WASM (README line 65: "generated from ELK's Java code base using GWT"). Async API (`elk.layout()` returns a Promise). Web Worker supported out of the box (README ~138-157, `workerUrl` / `workerFactory`); in Next/webpack the worker URL needs a static asset copy, a known friction (README ~31-33 lists "Can't resolve web-worker") | sync, main thread | sync | sync, O(parts) |
| What it does | layered (Sugiyama) + many others; ports (`portConstraints`, 78 hits in the worker), orthogonal routing (`elk.edgeRouting`), edge labels (`edgeLabels.placement`), interactive/pinned positions (`elk.position`, `crossingMinimization.semiInteractive`, `layering.layerConstraint`: all present in the 0.12.0 worker bundle) | layered, edges as polylines (not orthogonal), no ports, edge labels via label dummy nodes | trees only (one parent per node) | one column of layers + a gutter lane for skip edges |
| Timing (Node, 156×44 nodes) | 6 parts+1 skip: 46 ms cold; 12 parts+8 extra edges: 29 ms; 12-node tree: 9 ms | 5 / 8 / 2.4 ms | < 1 ms | < 0.1 ms |

**Layout quality on our case (the 07c plate: A→B→C→D→E→F plus A→E "V" bypass).** Both ELK and dagre *move the main column* to make room for the bypass: ELK puts the nodes at x = 12 / 38 / 38 / 38 / 12 / 12 (206×428, 4 bends); dagre at x = 78 / 132 / 132 / 132 / 78 / 78 (210×404). The design draws a **straight spine of boxes at x = 98, pitch 72 px, boxes 156×44 with hatched shadow offset +5/+5, letter circles at x = 16 and the skip edge in the right gutter** (from `07b-diagram-building-1440.dc.html`: `.pt` at `left:98 top:60/132/204/276`, `.co` at `left:16`, `.hs` at `left:103`). Neither engine reproduces that without per-node constraints, and dagre/ELK output is a different shape every time a part is added. 12 parts / 20 links with random cross-edges: ELK 32 bends, dagre 103 interior polyline points: both legible but busier than a hand plate.

**Licence (elkjs): flag to owner.**
- npm ships it as `EPL-2.0 OR GPL-3.0-or-later`; we would choose EPL-2.0 (GPL-3 is incompatible with an MIT app's distribution in practice).
- EPL-2.0 is *weak copyleft at the file/module level*: bundling it **unmodified** inside a larger work under another licence is permitted; the obligations are to keep the EPL notice/licence text, and that anyone receiving the object code is told where the elkjs source is (npm + GitHub; PaperTree is open source, so that is easy). Modifying elkjs files would make those files EPL. A minified bundle that merges elkjs into our chunk is "combining", and is generally accepted for EPL-2.0 file-level scope, but I am not a lawyer and this was not checked against counsel.
- Per the gate: **owner's call**. It is not needed if the recommendation below is adopted, so: **not adopted**.

**Recommendation: hand-written slot grid (no dependency).** For ≤ 12 parts the plate is a *drawing with a house style*, not a graph-layout problem; the design's coordinates are a slot grid. Algorithm (tested, `.../r3/slot.mjs`, reproduces 07b's y = 60 + 72k for the sample): `layer(part) = 1 + max(layer(after))` (0 if none), column = arrival order inside the layer, `x = x0 + col × (156 + 40)`, `y = y0 + layer × 72`; edges: straight vertical segment layer→layer when adjacent and in the same column; elbow (down, across, down) between columns; **skip edges (layer gap > 1) run in a gutter lane** at `x = plateRight − 24 + 8k`, entering the target from the side with the arrowhead (as in 07c "V"). Fallback if a plate is ever too tangled (≥ 3 columns with several crossings): lazy-load ELK in a worker **only then**; that decision, and its EPL question, is deferred. d3-hierarchy is out: it cannot draw a part with two inputs (E in 07c).

## Q3. Streaming placement

**The constraint.** Parts arrive one by one; the Stop button can end the stream at any moment; nothing already drawn may move (the design's 07b shows the ghost of the next part, D, dashed at 55% opacity, already sitting in its slot, with "3 parts so far · 3 cited" and the key row "D · Softmax · arriving…" with a skeleton bar).

**Options compared**
| Option | Jumps? | Cost | Verdict |
|---|---|---|---|
| Re-run a layout engine (dagre/ELK) on every arrival, animate to new positions | Yes: whole column re-centres, edges re-route | engine + FLIP code | no |
| Incremental ELK with `elk.position` pinned for placed nodes (`interactive` strategies exist in 0.12.0) | Mostly not, but pinning interacts with layering/crossing options | 440 KB + worker + EPL question | no |
| Reserve a grid, fill as parts arrive | No | tiny | yes |
| Layout once at the end with a settle animation | Everything is in the wrong place while streaming, then moves | needs FLIP | only as an optional polish |

**Recommended: deterministic slot grid, decided at arrival, never revisited.**
1. `place(part)` is a pure function of the part's `after` list and the parts already placed (`slot.mjs`). A part can only point backwards, so its layer is known the moment its line is parsed. The slot is final.
2. **Reserve**: the plate has a fixed width (container width) and a fixed number of columns (3 at 1440 / 1 at phone 390); its height grows downward only, so nothing above ever shifts. Draw the **next ghost slot** (dashed, 55%) directly below the last placed part in the same column; a part that arrives in a different slot makes the ghost *fade* (120 ms) and the new box *lift in* (opacity + translateY 6 → 0, 180 ms, `--ease-lift`), never slide across the plate.
3. **Edges** are drawn the moment both ends exist (stroke-dashoffset ink 120 ms), so a skip edge appears when its target arrives. Edge labels sit at the midpoint of the vertical run, on a paper-colour plate to keep the hairlines readable.
4. **Key rows** (right column) append in arrival order; each row's height is fixed (quote clamped to 2 lines, as `.kq` does in the mock), so appended rows never push earlier ones.
5. **Stop** (or a cut stream: the `end` line is absent): freeze. Remove the ghost, footer says "5 parts so far · 5 cited · stopped", offer Redraw. No re-layout needed because placement was already final.
6. **At `end`**: *no* re-layout. Optional polish (decide after seeing it): if any layer holds more than one part, centre that layer's row once, 240 ms `--ease-settle`, via a WAAPI transform on the group (FLIP not needed: x delta is known); under reduced motion apply instantly. The plate height is trimmed to content at the same time.
7. The geometry is exported unchanged to the board and notebook cards (xyflow nodes take `{x, y}` directly; no second layout run).
8. A11y: the plate is `role="img"` with an `aria-label` listing the parts; the key list is the accessible, ordered representation (`aria-live="polite"` on the key list, throttled so each part is announced once).

**Why not the "reserve then re-layout" variants:** because the schema forces `after` to point backwards, final layer indices never change when later parts arrive, which is the property that makes a streaming layout stable. The only unstable thing is horizontal centring, which is why centring is left to the single optional end-of-stream settle.

## Q4. Motion

**Facts (read 2026-10-16).**
- Current `motion` = **14.3.0**, published 2026-10-15 (npm); `framer-motion` 14.3.0 is the same code (the clone `/Volumes/Mrigesh SSD/PaperTree-research/v0.2/src/motion/packages/` has `framer-motion`, `motion`, `motion-dom`, `motion-utils`; `motion/dist/es/react-m.mjs` is `export * from 'framer-motion/m'`). MIT. **peerDependencies: `react ^18.0.0 || ^19.0.0`**, so React 18.2 is supported; Next 14.1 needs `'use client'` (or `motion/react-client`, shipped in the package exports).
- Measured (esbuild min + gzip -9, react external): `motion/react` `motion` + `AnimatePresence` **46.9 KB gz**; `LazyMotion`+`domAnimation`+`m`+`AnimatePresence` imported statically **32.9 KB gz**; with `domMax` (layout animations, `layoutId`, drag) **47.1 KB gz**; `useAnimate` from `motion/react` **24.6 KB gz**; `useAnimate` from `motion/react-mini` **3.5 KB gz**; vanilla `animate` from `motion` **24.1 KB gz**, from `motion/mini` **3.4 KB gz**. For comparison react+react-dom client is 45.6 KB gz.
- Official figures (https://motion.dev/docs/react-reduce-bundle-size, fetched 2026-10-16): `motion` component 43 kb; `m`+`LazyMotion`+`domAnimation` ≈ 5 kb initial + 24 kb when loaded; `domMax` adds 38 kb and is the one that includes **layout animations**; `useAnimate` mini 3.3 kb; features may be loaded async by passing `LazyMotion` a dynamic-import function. My esbuild split-chunk experiment did not separate the feature chunk (features are in a shared chunk), so the "5 kb initial" is **NOT CONFIRMED by me**; the static numbers above are measured.
- `layoutId` shared layout and `layout` props require `domMax` (docs figure above). They animate by measuring and applying `transform: scale()/translate`, which distorts text and does not suit a 3D object turning (spine → book is not a morph of the same box: the spine is a *different object* that turns out of the row, per 11-motion).
- Web Animations API: `element.animate()`, `Animation.finished`, `commitStyles()` are Baseline "widely available" since July 2020 (MDN fetched 2026-10-16). `commitStyles()` writes the current computed values to `style` and should be called after `finished`; per the spec it throws `InvalidStateError` for an unrendered element (not on the MDN page I fetched: NOT CONFIRMED there). `finished` **rejects with AbortError** when the animation is cancelled: always `.catch(() => {})`. `composite: 'add'` lets an animation layer on top of a hover transform without overwriting it.
- Scroll offset is **not animatable** with WAAPI/CSS transitions; `scrollIntoView({behavior:'smooth'})` has browser-chosen duration. The design needs "scroll 240 ms", so it needs a 15-line rAF tween.
- View Transitions API (`document.startViewTransition`, `view-transition-name`): same-document support in Chrome/Edge 111, Safari 18, Firefox 144 by my knowledge; the MDN page I fetched did not include the compatibility table, so **NOT CONFIRMED** for today. Optional progressive enhancement only.
- The design tokens already encode reduced motion: `tokens.css:32-40` defines `--dur-quick 120`, `--dur-sheet 240`, `--dur-pull 320`, `--dur-open 480`, `--dur-flash-in 180`, `-hold 900`, `-out 600`, `--ease-out .2,.7,.3,1`, `--ease-settle .2,.8,.2,1`, `--ease-lift .3,0,.2,1`; `tokens.css:187-189` overrides them under `prefers-reduced-motion: reduce` (sheet/pull/open → 120 ms, flash in/out → 0, settle/lift → linear). JS should **read these CSS variables**, not hard-code numbers, so reduced motion and tuning live in one place.

**Per moment (approach · reduced motion).** Timings from DESIGN.md §6 and the 11-motion frames.

| Moment | Build with | Detail | Reduced motion |
|---|---|---|---|
| Pull out (lift 120 → turn 200 → settle 80; Esc runs back in 240) | **WAAPI**, one `Animation` with offsets | one `animate()` of 400 ms on the book element, keyframes at offsets 0 / .3 / .8 / 1 (lift translateY(-10px) + shadow layer opacity, then rotateY 0→16deg and translate to centre, then settle); the shelf veil is a separate CSS opacity transition. Esc: `anim.playbackRate = -400/240; anim.play()` (reverse, interruptible, no new keyframes) | no turn: book cross-fades in 120 ms (`opacity` only) |
| Open (cover swings 480 → cross-fade to reader 120) | **CSS transition** on a class (`.is-open .cover{transform:rotateY(-160deg)}`, 480 ms `--ease-lift`) then WAAPI opacity 120 | the book overlay lives in the root layout so it survives the route change; `router.push` after 480, fade overlay out once the reader has mounted | one 120 ms cross-fade, cover does not rotate |
| Dive in (cards lift 120 → page slides 360, carrying them) | **WAAPI FLIP** | measure slips/cards (`getBoundingClientRect`) in the reader, mount the notebook page, measure again, `animate({transform:[from,'none']},{duration:360,easing:lift})` per item (≤ ~8 items, staggered 0); first 120 ms: `translateY(-4px)` + shadow | page replaces reader in a 120 ms cross-fade; items do not travel |
| Thread connecting (drag → picker 240 → ink 120) | **xyflow** drags (it already follows the pointer); CSS for the picker (`opacity`/`translateY(4px)`, 240 ms settle); WAAPI `stroke-dashoffset` on `pathLength=1` for the ink | drawn once on release | no settle: picker and wire appear at once |
| Citation flash (scroll 240 → in 180 → hold 900 → out 600, faint outline stays) | **rAF tween** for scroll + **one WAAPI animation** 1680 ms, offsets 0 / .107 / .643 / 1, on a highlight overlay (opacity + `outline-color`), then add `.has-flashed` class (the faint outline) | one `Animation` per flash; calling flash again `cancel()`s the previous one so there is never a stuck ring | no scroll animation (`scrollTo` auto); ring + wash appear (in/out durations 0) and clear on the next action |
| Marker ↔ trace light (120 / 120) | **CSS only**: `transition: background-color, outline-color 120ms var(--ease-out)`; a tiny zustand `litAnchorId` sets `data-lit` on both ends | no JS timing | unchanged (colour only) |
| Search lights the shelf (120 per keystroke) | **CSS only**: `.shelf[data-searching] .spine:not([data-hit]){opacity:.33}` with `transition: opacity 120ms` | one attribute write on the shelf container, no per-spine React re-render; compute `data-hit` once per query change | transition removed (instant) |

**Recommendation: CSS + WAAPI, no Motion in v0.2.**
- Seven moments, only three are choreography (pull out, flash, dive in) and none need springs, gestures, or layout projection; paper "lifts, slides and settles" on fixed bezier curves already in tokens. WAAPI runs on the compositor for `transform`/`opacity`, which is exactly what the 3D book needs.
- Cost: ≈ 1 KB of our own helper (`lift(el, frames, {dur, ease})` that reads the CSS tokens, honours `matchMedia('(prefers-reduced-motion: reduce)')`, swallows AbortError, and returns the `Animation`) versus **+33 KB gz minimum** (`LazyMotion`/`domAnimation`, static) or **+47 KB gz** (`domMax`, needed for `layoutId`) on top of a bundle that already carries React, Next and xyflow. The reader route is where users spend time; the shelf is first paint.
- What we give up: `AnimatePresence` exit animations (we handle exits manually: keep the node mounted until `anim.finished`) and automatic FLIP/`layoutId`. If, during the build, more than ~4 FLIP-style moves appear, take **`motion/react-mini` `useAnimate` (3.5 KB gz) or `motion/mini` `animate` (3.4 KB gz)**: same WAAPI engine with timeline/stagger sugar, almost free. Full `m`+`domMax` only if the owner wants shared-layout transitions for the spine → book → reader trio, which I advise against (distortion, 47 KB, a 3D object that is not a morph).
- Cross-route continuity (book → reader) comes from the overlay-in-layout pattern, not from `layoutId`.

## Q5. Scale (shelf and table)

**Measured DOM cost** (plain DOM, no React, headless Chrome `--headless=new`, innerHTML build + forced layout via `offsetHeight`; **paint and React reconcile not included**; file `.../r3/dom.html`, two runs):
| Case | Elements | Build + layout |
|---|---|---|
| 400 spines in ONE sideways row (4 elements each: wrapper, ribbon/band, label, spacer) | 1,601 | 6.6 - 11.7 ms |
| 10 rows × 40 spines (the DESIGN §9 cap) | 1,610 | 2.6 - 2.8 ms |
| Table, 400 rows × 7 cells (+ button) | 3,602 | 13.8 - 16.8 ms; a width change re-layout 5.4 - 5.7 ms |
These are tiny. Real cost will be dominated by (a) React mounting a few thousand elements (expect several × the raw number, still well under 100 ms; NOT MEASURED), and (b) **paint**: the spines in 01f use cloth `repeating-linear-gradient` layers, inset shadows, gilt rules and a rotated title, so per-element decoration cost, not element count, is what to watch.

### Shelf (DESIGN §9: per-topic rows, ≤ ~40 spines then "+n more" bookend, spine width capped 48 px)
- **Do not virtualise the shelf.** Row count × cap bounds the DOM: 400 papers in ~10-12 topics is ~400-480 spines ≈ 2,000 elements. Rows beyond the viewport are skipped for free with **`content-visibility: auto` + `contain-intrinsic-size: auto 256px`** on each row (row pitch in 01f ≈ 256 px at 1440); it keeps content in the accessibility tree and find-in-page working (from my knowledge of the spec; verify in Safari, NOT CONFIRMED here).
- Each row is a plain `overflow-x: auto` scroller with `role="list"` and spines as `role="listitem"` buttons; arrow keys move focus between spines (roving tabindex), Home/End go to the ends.
- **"+n more" bookend**: expand in place by appending the next chunk (40 spines) on click or when focus reaches the bookend. Even a 200-paper topic is ~800 elements. Only if one topic could exceed ~1,000 would a horizontal `useVirtualizer({horizontal:true})` be worth its 10.3 KB gz and the loss of find-in-page.
- **Search lights the shelf**: compute matches from *data*, not DOM, so hidden spines count. The bookend must say "+8 more · 3 match" and the topic holder label should show the match count; a match hidden in "+n more" must be reachable (Enter on the bookend jumps to and lights it).
- Perf hygiene for spines: one shared background layer per topic colour (CSS custom properties), no per-spine `filter`/`backdrop-filter`, no animating shadows; `will-change: transform` only on the spine being pulled out.

### Table (01d: 56 px rows, two-line titles, popover for authors, state cell may wrap to 3 lines)
- **Recommendation: ship v0.2 non-virtualised with `content-visibility: auto; contain-intrinsic-size: auto 56px` on rows**: 400 rows ≈ 3.6k elements builds in ~15 ms raw; native `<table>` keeps full semantics, Ctrl+F, selection, copy, and sticky `<thead>` (`position: sticky; top: 0`). Build the row component so a virtualiser can wrap it later. Revisit at ~1,000+ rows or if profiling the real page shows > 50 ms scripting on sort/filter.
- **If/when virtualising: `@tanstack/react-virtual` 3.14.20** (MIT, modified 2026-10-15, **10.3 KB gz** incl. `virtual-core`; peer `react ^16.8 … ^19`). Facts from the clone (`/Volumes/Mrigesh SSD/PaperTree-research/v0.2/src/virtual`):
  - `useVirtualizer({count, getScrollElement, estimateSize: () => 56, overscan: 8})`; variable heights via `measureElement` (`packages/virtual-core/src/index.ts:270`, ResizeObserver box sizes) on each rendered row.
  - `rangeExtractor` (docs/api/virtualizer.md:143; `defaultRangeExtractor` exported) can add indexes that must stay mounted: **always include the focused/active row index** so focus is not destroyed when it scrolls out, and index 0 if the header is a row.
  - The official table example (`examples/react/table/src/main.tsx:82-136`) uses a `<table>` with each `<tr>` positioned by `transform: translateY(...)` and a spacer of `getTotalSize()`.
  - A11y recipe when virtualised: `role="grid"` (or `table` if rows are not interactive) with `aria-rowcount={total + 1}`, `aria-colcount`; every rendered row gets `aria-rowindex` (1-based, header = 1) because the DOM no longer shows the true position; header is `position: sticky` outside the translated body; one row/cell in the tab order (roving `tabindex`), Up/Down/PageUp/PageDown/Home/End call `virtualizer.scrollToIndex(i)` then focus the row after the next paint; Enter opens the paper (the row's arrow button is also tabbable); the sort headers are real `<button>`s with `aria-sort`. **Costs:** browser find-in-page cannot see unmounted rows (the app's own search takes over), screen-reader "table navigation" shows only mounted rows (hence aria-rowindex), and row-selection ranges across unrendered rows need to be data-based.
- Sorting/filtering: `useDeferredValue` on the filter string and `React.memo` rows; keep the "2 need a look" filter on data, not DOM.

## Q6. 3D CSS

**Mechanics (from the design + spec knowledge; measurements of the design's own values from the mocks).**
- The design uses `perspective(1600px) rotateY(16deg) rotateZ(-1deg)` for the pulled book and `rotateY(-90deg)` with `transform-origin: right center` for the spine edge (`02a-book-pulled-1440.dc.html`); the motion board uses `perspective(300-500px)` for the small key frames (`11-motion.dc.html`).
- Put `perspective` on a **stage parent** (not on the moving book) so the vanishing point is fixed while the book moves; the book is `transform-style: preserve-3d`; faces are children.
- **Anything that "flattens" a 3D chain**: `overflow` other than visible, `opacity < 1`, `filter`, `clip-path`, `mask` or `backdrop-filter` on an element *between* the stage and the faces forces `transform-style: flat`. Keep those on the stage ancestor or on leaf faces, never on the book/hinge wrapper. (Spec rule; matters because the design's veiled shelf and `clip-path` tabs sit nearby.)
- `backface-visibility: hidden` on each face so the cover's back (the bookplate endpaper) is a *separate face* rotated 180deg, not a mirrored front. Safari older than 15.4 wanted `-webkit-backface-visibility`; autoprefixer in the Tailwind 3 chain adds it (NOT CONFIRMED which Safari versions need it today).
- **Compositor-only**: animate only `transform` and `opacity`. Do not animate `box-shadow` (repaints every frame): draw the shadow as a pseudo-element (`::after`, blurred radial) whose `opacity`/`transform` you animate. Do not animate `filter: blur` or `backdrop-filter` on the veil: fade a flat veil (`rgba`) during motion and swap in the blurred version once settled; check on Safari (NOT PROFILED here). Keep ≤ 3 promoted layers (book, cover, shadow); add `will-change: transform` on `pointerenter`/just before starting and remove it after `finished` so the browser does not keep layers for 400 spines.
- Text on a rotating face blurs mid-turn (rasterised at start scale); that is fine for a 480 ms swing, and the settled spread is re-rasterised crisp when `will-change` is removed.

**Sketch (original; tokens from tokens.css; ~30 lines)**
```css
.stage      { perspective: 1600px; perspective-origin: 50% 40%; }          /* fixed vanishing point */
.book       { position: relative; width: 300px; height: 430px;
              transform-style: preserve-3d; transform-origin: left center;
              transition: transform var(--dur-open) var(--ease-lift); }
.book.is-open { transform: translateX(50%);}                              /* centre the spread as the cover leaves */

.face       { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.pages      { /* right-hand page = the details */ }

.cover      { position: absolute; inset: 0; transform-style: preserve-3d;
              transform-origin: left center;                              /* the hinge */
              transition: transform var(--dur-open) var(--ease-lift); }
.cover > .front { /* class .face too */ }                                  /* cloth, gilt title */
.cover > .back  { transform: rotateY(180deg); }  /* also .face; bookplate on endpaper */
.book.is-open .cover { transform: rotateY(-160deg); }                      /* not -180: leaves a hint of overlap/depth */

.book::after { content: ""; position: absolute; inset: auto -6% -4% -6%; height: 10%;
               background: radial-gradient(closest-side, rgba(58,40,24,.35), transparent);
               opacity: .9; transition: opacity var(--dur-pull) var(--ease-out); } /* shadow = opacity, never box-shadow */

/* pull-out: one WAAPI animation (see Q4), not a transition */
/* element.animate([
     {transform:'translateY(0) perspective(1600px) rotateY(0)',            offset:0},
     {transform:'translateY(-10px) perspective(1600px) rotateY(0)',        offset:.30, easing:'cubic-bezier(.3,0,.2,1)'},
     {transform:'translate(var(--cx),var(--cy)) perspective(1600px) rotateY(16deg) rotateZ(-1deg)', offset:.80},
     {transform:'translate(var(--cx),var(--cy)) perspective(1600px) rotateY(16deg) rotateZ(-1deg) scale(1.005)', offset:1}
   ], {duration:400, fill:'both'}) */

@media (prefers-reduced-motion: reduce) {
  .book, .cover { transition: none; }
  .book .cover  { transform: none; opacity: 1; transition: opacity 120ms linear; }
  .book.is-open .cover { opacity: 0; }                                    /* cover cross-fades to the spread */
  .book.is-open { transform: none; }
}
```
Note the keyframe sketch puts `perspective()` in the transform list (as 02a does) so that one element can carry its own foreshortening; for the open spread use the `.stage` perspective instead. The tokens already collapse `--dur-open` to 120 ms under reduced motion, so the second `@media` block only removes the rotation. Both the cover and the right page are real DOM, so text on the spread stays selectable and accessible; the 3D back face is `aria-hidden`.

## Package table

Sizes are min+gz, measured by `npm i` into `PaperTree-research/v0.2/prototypes/r3` on the SSD and `esbuild --bundle --minify --format=esm` (react/react-dom external), `gzip -9`. "Official" = docs figure, not measured by me. Versions and dates from `npm view` on 2026-10-16.

| Package | Version | Licence | Bundle (min+gz) | Last release / maintenance | Use for | Build ourselves | Risks |
|---|---|---|---|---|---|---|---|
| elkjs | 0.12.0 (npm); clone 0.13.0 unreleased | **EPL-2.0 OR GPL-3.0-or-later** — owner's call, **not adopted** | 439.6 KB bundled; 2.2 KB api + 461.6 KB worker | 2026-07-17 release; commits to 2026-10-06; active (kieler) | nothing in v0.2 (possible lazy fallback for tangled plates) | slot grid + gutter lane | EPL notice/source-offer duty, worker bundling friction in Next, GWT-JS size, layouts move columns |
| @dagrejs/dagre | 3.1.1 | MIT | 16.9 KB | 2026-08-08; active again (old `dagre@0.8.5` dead since 2022) | not needed | slot grid | polyline (not orthogonal) edges, shifts columns on each re-run, no ports |
| d3-hierarchy | 3.1.2 | ISC | 1.8 KB | 2022-06-14, stable | not needed | slot grid | trees only; cannot draw two-input parts |
| zod | zod 3.24.x already in `packages/document-ir`; npm latest 4.6.7 | MIT | zod 4 classic 92.5 KB, `zod/mini` 5.2 KB (v4 numbers; v3 not measured) | 2026-10-12 | diagram line validation **server-side only** (`services/agent`) | — | do not import into web bundle; v3↔v4 API differences if upgraded |
| motion (= framer-motion 14.3.0) | 14.3.0, React peer `^18 \|\| ^19` | MIT | `motion` comp 46.9 KB; `LazyMotion`+`domAnimation` 32.9 KB (official: ≈5 KB + 24 KB async); `domMax` 47.1 KB (official +38 KB); `motion/react-mini` `useAnimate` 3.5 KB; `motion/mini` `animate` 3.4 KB | 2026-10-15; very active | **not adopted for v0.2**; `motion/mini` only if FLIP moves multiply | WAAPI helper (~1 KB), rAF scroll tween, FLIP | layout/`layoutId` needs `domMax` and scale-distorts; 3D book is not a morph |
| @tanstack/react-virtual | 3.14.20 | MIT | 10.3 KB | 2026-10-15; active | **deferred**: Table if > ~1,000 rows or profiling demands | `content-visibility:auto` row skipping | a11y recipe needed (aria-rowindex, roving focus), find-in-page loses unmounted rows |
| @xyflow/react | 12.12.0 (already used) | MIT | not re-measured | 2026-10-11 | board; takes `{x,y}` from our slot grid for diagram cards | — | — |
| mermaid-to-excalidraw | 2.1.1 | MIT | not measured, not adopted | 2026-03-24 | prior art only (parse → skeleton separation) | our own spec → geometry → SVG | needs a rendered Mermaid DOM; fragile model syntax |
| Web Animations API, CSS 3D, View Transitions | platform | n/a | 0 KB | WAAPI Baseline since 2020 (MDN); View Transitions same-document support NOT CONFIRMED today | all motion in §6 | helper `lift()` | Safari 3D/`backface` quirks; test on Safari |
