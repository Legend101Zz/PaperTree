# RESEARCH R1 - Canvas engines for the notebook and the board (PaperTree v0.2)

All evidence read 2026-10-16. Clone paths are under `/Volumes/Mrigesh SSD/PaperTree-research/v0.2/src/` (abbreviated `src/`). Clone heads: excalidraw `4c37956` (2026-10-14), tldraw `1304f95` (2026-10-16), xyflow `654ba5a` (2026-10-16), blocksuite `5cb5cb6` (2025-07-07). Bundle numbers I measured myself by `npm pack` + `gzip -9` of the published files (scratch folder, not in the repo); a real Next build was NOT run, so treat them as upper-bound estimates. Anything I could not verify is marked **NOT CONFIRMED**.

## Summary (recommendation first)

1. **Recommendation: two surfaces, one new engine only where we must.** Board = `@xyflow/react` 12 (already in v0.1, MIT, ~59 KB gz measured). Notebook = our own React-DOM page (typed blocks, quote cards, stickies, shapes as SVG) with a pointer-events ink layer drawn by `perfect-freehand` (MIT, ~2 KB gz). This is option (i). DESIGN.md section 7's "two canvases" holds, and the evidence says the notebook is a *page*, not a canvas.
2. **Why not Excalidraw/tldraw for the notebook:** both are canvas-first with their own element models. Our notebook is typed-first with real React content (AI slip with clickable citation markers, three typefaces, `Anchor` objects). Excalidraw renders to canvas 2D and can only host React via the `renderEmbeddable` overlay; it ships ~1.05 MB gz (measured, upper bound) plus 13 MB of fonts. tldraw can host React in shapes, but its licence forbids production use without a key (see below).
3. **Licence flag (owner's call, not adopted): tldraw.** `LICENSE.md` says "Not to use the Software in Production Environments"; production needs a License Key; the free hobby tier shows a "made with tldraw" watermark and is "discretionary", non-commercial only.
4. **Licence flag: BlockSuite/AFFiNE.** `@blocksuite/blocks`/`presets` are MPL-2.0 (fine if unmodified) but the standalone repo's last commit is 2025-07-07 and it is Lit web components; not adopted. `@blocksuite/store` is MIT but pointless without the block UI.
5. **Licence flag: React Flow Pro.** The library is MIT; the undo/redo example (`useUndoRedo`) is a Pro example under the "xyflow Pro License". We must NOT copy it; we write our own history stack (small).
6. **What we build:** ink layer (pointer capture, stroke store, eraser, lasso hit-test, lasso menu), typed block model + editor, quote cards, stickies, shapes, 5 paper templates (CSS/SVG backgrounds), the notebook JSON model with `Anchor` citations, board undo (patch stack), "Link as" picker + keyboard linking, frames/tags, paper-themed node/edge components.
7. **Biggest technical risks:** (a) ink feel (latency, palm rejection, pressure, tablet browsers) in a DOM/SVG layer; (b) board at 500 nodes when every AI-slip card holds rich text; (c) a11y/keyboard: xyflow gives focus + arrow-move but no keyboard connect, and our ink is inherently non-accessible (typed content must carry the accessible meaning).
8. **Excalidraw stays a documented fallback** for ink only, never for the board (see Q5).
9. **Bundle cost of the recommendation:** +2 KB gz (perfect-freehand) on top of what v0.1 already ships. Nothing new on the board.
10. **Not verified:** Excalidraw hiding all its UI with an API-only mode; tldraw gz size; whether the GitHub blocksuite repo is formally archived.

---

## Q1. Excalidraw (`excalidraw/excalidraw`, MIT)

**Licence and version.** `src/excalidraw/LICENSE` = MIT (Copyright 2020 Excalidraw). `@excalidraw/excalidraw` npm `0.18.1`, MIT, modified 2026-10-12 (`npm view`, 2026-10-16). Peer deps `react ^17 || ^18.2 || ^19` (from the packed package.json), so React 18.2 works.

**Element and scene model.**
- Elements are flat, readonly JSON objects: `_ExcalidrawElementBase` (`packages/element/src/types.ts:40`), with `customData?: Record<string, any>` (`types.ts:86`) which is where an AI-made marker or Anchor id could ride. Types: `ExcalidrawEmbeddableElement` (:115), `ExcalidrawIframeElement` (:131), `ExcalidrawFrameElement` (:178), `ExcalidrawMagicFrameElement` (:183), `ExcalidrawFreeDrawElement` (:430).
- `Scene` class (`packages/element/src/Scene.ts:108`, `replaceAllElements` :271) holds the ordered element array; z-order uses fractional indexing (`packages/fractional-indexing`).
- There is no "block" or "document" concept. Text is a canvas element, not DOM; typed content is therefore a drawing primitive, not an accessible document.

**Rendering.** Canvas 2D with rough.js. Two stacked canvases: static (`packages/excalidraw/renderer/staticScene.ts:526` throttled by RAF, `renderStaticScene` :535) and interactive (selection, handles, lasso trail; `renderer/interactiveScene.ts:2158`). Per-element drawing in `packages/element/src/renderElement.ts:963`. Hand-drawn look is built in (roughjs `4.6.4` pinned in `packages/excalidraw/package.json`), which fights the "bone paper, serif, typed" look unless every element is forced to roughness 0.

**Freehand.** `packages/element/src/shape.ts:2` imports `getStroke`/`getStrokePoints` from `perfect-freehand` (pinned 1.2.0); comment at `shape.ts:1222` calls it "the original Excalidraw freedraw look". So its ink quality is perfect-freehand; we can get the same by using the library directly.

**Undo/history.** Delta-based: `Store` (`packages/element/src/store.ts:78`), `CaptureUpdateAction` (:38) decides whether an update is undoable, `History`/`HistoryDelta` (`packages/excalidraw/history.ts:15, :90`, `undo` :139, `redo` :148). Good design; it is internal to its scene and does not cover our app state.

**Frames.** `ExcalidrawFrameElement` plus `packages/element/src/frame.ts` (`elementOverlapsWithFrame` :174, `isElementInFrame` :843). Frames clip children; label is a text title, not a paper tag.

**Selection and lasso.** `lasso` is a tool type (`packages/excalidraw/types.ts:153`, selection tool variant :438); `LassoTrail` at `packages/excalidraw/lasso/index.ts:41`. The lasso selects elements; there is no hook for our menu ("Ask about this", make sticky, send to board) other than rendering our own React toolbar from `onChange` state (possible, not free).

**Zoom/pan, export.** Built-in. `exportToCanvas` / `exportToSvg` / `exportToBlob` at `packages/utils/src/export.ts:42,170,106` and `packages/excalidraw/scene/export.ts:180,293`. Handy for the notebook thumbnail card.

**Performance.** Two-canvas design with RAF throttling; no official element-count guarantee found. **NOT CONFIRMED** at 500+ elements (we did not run it).

**Embedding in Next.** The repo's own example (`examples/with-nextjs`, Next 14.1 + React 19) wraps it with `dynamic(..., { ssr: false })` (`examples/with-nextjs/src/app/page.tsx:6-11`). So: client-only, no SSR. Fonts are fetched at runtime (the package ships `dist/prod/fonts` 13 MB and `locales` 1.7 MB; measured by unpacking 0.18.1); the host app must copy/serve them (`examples/with-nextjs/package.json` `copy:assets`).

**Restyling.** CSS variables on `.excalidraw` and `.excalidraw.theme--dark`; docs say "most of them will not make sense to override" (`dev-docs/docs/@excalidraw/excalidraw/customizing-styles.mdx`), variables listed in `packages/excalidraw/css/theme.scss` (e.g. `--island-bg-color` :24, `--color-primary` :86). Canvas content colours and the built-in fonts (Excalifont/Virgil) are not CSS-driven; text is drawn on canvas in whatever font loads. A full paper theme (Caslon/Alegreya/Courier faces inside elements) would need custom font registration. Light/dark via `theme` prop. The toolbar can be replaced/hidden partially: `UIOptions` (`types.ts:1142`, `canvasActions` :1144, `tools` :1145), `viewModeEnabled` prop (:936), `zenModeEnabled`, `renderTopRightUI` (:931). **NOT CONFIRMED:** a single switch that removes all chrome; driving it purely through `excalidrawAPI` with our own toolbar looks possible (`excalidrawAPI` prop; `activeTool.type === "custom"` is host-implemented, `types.ts:172-180, :788-790, :997`) but we did not test it.

**Hosting custom React content.** Yes, but as an overlay: `renderEmbeddables()` (`packages/excalidraw/components/App.tsx:1783`) maps embeddable elements to absolutely positioned DOM wrappers (`excalidraw__embeddable__outer/content`, :2015-2025) and calls `this.props.renderEmbeddable?.(el, this.state)` (:2030) before falling back to an `<iframe>`. Validation is via `validateEmbeddable` (:1760). So an AI slip can be a React component positioned by Excalidraw, and clickable markers will work inside it. Limits: one element = one fixed rectangle; its content does not flow with the page; text in it is not part of the scene's undo; pointer-events interplay with canvas gestures (see `css/styles.scss:127-147`) **NOT CONFIRMED** in practice.

**Bundle size (measured 2026-10-16).** `@excalidraw/excalidraw@0.18.1` `dist/prod`: `index.js` 502 KB raw / 154 KB gz, shared chunks `chunk-EIO257PC.js` 1.82 MB / 742 KB gz and `chunk-K2UTITRG.js` 439 KB / 151 KB gz, CSS 145 KB / 23 KB gz. Sum about 1.05 MB gz if everything is loaded (some chunks may be lazy, **NOT CONFIRMED** without a Next build analyzer). `npm view` unpacked size 46.8 MB.

**Verdict for us:** excellent drawing app, wrong shape for a typed-first page, heavy, canvas text is not accessible, hand-drawn aesthetic by default. Good as a reference for ink + lasso behaviour.

---

## Q2. tldraw (SDK `tldraw` 5.5.2)

**SDK model.**
- Shapes: `abstract class ShapeUtil` (`packages/editor/src/lib/editor/shapes/ShapeUtil.ts:109`) with `abstract getGeometry` (:210) and `abstract component(shape)` (:218) returning React, so shapes can hold arbitrary React (AI slip with clickable markers is feasible), plus `canEdit` (:303), `canResize` (:312).
- Tools: state machine, `class StateNode` (`packages/editor/src/lib/editor/tools/StateNode.ts:32`). Built-in tools under `packages/tldraw/src/lib/tools` (Eraser, Hand, Laser, Select, Zoom) and shapes `arrow, bookmark, draw, embed, frame, geo, highlight, image, line, note, text, video` (`packages/tldraw/src/lib/shapes`).
- Bindings (arrows attach to shapes): `abstract class BindingUtil` (`packages/editor/src/lib/editor/bindings/BindingUtil.ts:131`, `onAfterChangeFromShape` :237). Typed ports would be custom binding `props` (terminal + kind) validated by us; no built-in "handle type" validation like xyflow's `isValidConnection`.
- Freehand: draw shape (`packages/tldraw/src/lib/shapes/draw/DrawShapeUtil.tsx`, `getPath.ts:12` imports its own `shared/freehand` stroke options) with a highlighter shape. Quality is high and pressure-aware (**NOT CONFIRMED** against perfect-freehand side by side).
- Dev scaffolding includes UI (`packages/tldraw/src/lib/ui`), `hideUi` prop (`Tldraw.tsx:178`), a Minimap component, and a license layer (`packages/editor/src/lib/license/LicenseManager.ts`, `Watermark.tsx`).
- Requirements: packed `tldraw@5.5.2` peers `react ^18.2 || ^19.2.1`; ships Tiptap 3 and radix-ui as dependencies; `engines.node >= 22.12` (dev).
- Bundle: ESM is shipped unbundled (`dist-esm`, 5.9 MB + editor 3.9 MB on disk incl. sourcemaps); gz size **NOT CONFIRMED** (no bundler run).

**Licence, quoted exactly.**
- `src/tldraw/LICENSE.md` (read 2026-10-16): "Alternative licenses are available from tldraw for commercial and non-commercial use." "Not to use the Software in Production Environments." "Production Environment means any production deployment of the Software that operates on servers, cloud platforms, web applications, or where the software is used to provide functionality to end users, customers, or the public." Permitted: "Use the Software in Development Environments." Also: "Not to disable, change, or interfere with the Software's License Key enforcement." and "Technical enforcement: ... ensure proper watermark display. The Software may collect and transmit usage data to tldraw for license compliance purposes."
- Trial: "In the case that tldraw makes the Software available to you on a trial basis, you are permitted to use the Software in Production Environments for the specified period..."
- tldraw.dev/community/license (WebFetch, 2026-10-16): "To use the tldraw SDK in production, you need one of the following"; the default license "permits use only in development"; "The SDK will work in production only when provided with a valid and active license key"; under a hobby licence "the 'made with tldraw' watermark must be shown on the canvas"; "For non-commercial projects, we also provide a discretionary hobby license"; commercial licence by form and sales team; trial is 100 days and "The license key will stop working when the trial ends".
- tldraw.dev/pricing (WebFetch, 2026-10-16): "Start with a 100-day free trial" ... "Get a free hobby license" ... "Commercial license for production use ... Value-based pricing." No fixed prices published. `tldraw.dev/legal/license` and `/legal/hobby-license` returned HTTP 404 on that date.
- The npm `license` field is "SEE LICENSE IN LICENSE.md" (not an OSI licence).

**Verdict:** technically the strongest all-in-one SDK for a canvas, but it requires a licence key in production, a watermark on the free tier, usage telemetry, and is not MIT. PaperTree is MIT, local-first. **Flagged: owner's call, not adopted.**

---

## Q3. React Flow / xyflow 12 (`@xyflow/react` 12.12.0, MIT)

**Licence.** `src/xyflow/LICENSE` = MIT (Copyright 2019-2025 webkid GmbH); `packages/react/package.json` `"license": "MIT"`, version 12.12.0; npm modified 2026-10-11. `README.md:27-29` asks commercial users for sponsorship, "under an MIT License". Pro (paid) = Pro examples/templates ("This is a Pro example", licence "xyflow Pro License": reactflow.dev/examples/interaction/undo-redo, WebFetch 2026-10-16). Peers `react >=17`. Our v0.1 already uses it.

**Custom nodes, multiple typed handles.** `Handle` takes `id`, `type`, `isConnectableStart`, `isConnectableEnd`, and a per-handle `isValidConnection` (`packages/react/src/components/Handle/index.tsx:36, :92-95`). Four pins = four `<Handle id="evidence-in" ...>` with our brass pin graphics; typing rules in `isValidConnection(connection)` (prop on `<ReactFlow>`, `types/component-props.ts` near :667 says prefer the ReactFlow-level prop for performance; example `examples/react/src/examples/Validation/index.tsx:33,:106`).

**Picker at midpoint.** `onConnectEnd` (`types/component-props.ts:228`; type `OnConnectEnd` at `packages/system/src/types/general.ts:138` receives event + connection state with `fromHandle/toHandle/isValid`). `useConnection()` (`hooks/useConnection.ts:55`) exposes in-progress state for the dashed navy thread and ringing compatible pins; `connectionLineComponent`/`CustomConnectionLine` example exists. Pattern for "settles at the midpoint": on a valid `onConnect`, add an edge with kind `pending` and open our picker positioned at the screen midpoint of the two handles (via `useReactFlow().flowToScreenPosition`). Esc = commit a plain link. Example for drop-to-create: `examples/react/src/examples/AddNodeOnEdgeDrop/index.tsx:46`.

**Edges.** Custom edge types with `BaseEdge` and path helpers `getBezierPath`, `getSmoothStepPath`, `getStraightPath`, `getSimpleBezierPath` (`packages/react/src/index.ts:7-9,:131-136`); `EdgeLabelRenderer` (`components/EdgeLabelRenderer/index.tsx:54`) portals HTML (our paper tag with glyph) onto the viewport. SVG markers/dashes/doubled lines (two stacked paths for "compares with", chevrons via custom marker) are plain SVG. Edge `ariaRole`, `domAttributes` exist (`types/edges.ts:72`).

**Frames / sub-flows.** `parentId`, `extent: 'parent' | [[x,y],[x,y]]`, `expandParent` (`packages/system/src/types/nodes.ts:60,:65`; example `Subflow/index.tsx:64-88`). A frame is a group-type node with dashed border and a paper tag; children use `parentId`. `NodeResizer` exists (`additional-components/NodeResizer/`).

**MiniMap.** `nodeColor`, `nodeStrokeColor`, `nodeComponent`, `maskColor`, `pannable` (`additional-components/MiniMap/types.ts:17-76`); CSS vars `--xy-minimap-*` (`packages/system/src/styles/init.css:14-19`). Per-kind colours via `nodeColor` callback.

**Performance at 500+.** Stress example builds a 25x25 = 625-node grid with `minZoom={0.2}` (`examples/react/src/examples/Stress/index.tsx:18` `getNodesAndEdges(25, 25)`, :229). `onlyRenderVisibleElements` prop (`types/component-props.ts:387`). Official guidance (reactflow.dev/learn/advanced-use/performance, WebFetch 2026-10-16): memoise custom nodes/edges (`React.memo` or define outside), `useCallback` for handlers, `useMemo` for object props, do not read `nodes`/`edges` in components (keep derived selection in a store), collapse large trees with `hidden`, simplify heavy CSS (shadows, gradients, animation). That page does not mention `onlyRenderVisibleElements`. Implication: paper textures and drop shadows on 500 cards are the real cost; use a CSS-class level-of-detail at low zoom (render a plain card when zoom < ~0.5).

**Keyboard accessibility.** `nodesFocusable` (`component-props.ts:411`), `disableKeyboardA11y` (`container/ReactFlow/index.tsx:132`), node focus + arrow-key moves for selected nodes (`components/NodeWrapper/index.tsx:128-157`), `ariaLabelConfig` with defaults in `packages/system/src/constants.ts:53-60` (including the live-region message used by `NodeWrapper` :149), `role="application"` on the pane (`ReactFlow/index.tsx:178`). Example: `examples/react/src/examples/A11y/index.tsx:22,:64`. **Gap:** I found no keyboard way to start/finish a connection in `Handle` or `XYHandle` (grep for key handling found nothing; **NOT CONFIRMED** in docs). We build one: focused node + `L` opens a target chooser, then the same Link-as picker.

**Undo.** No built-in undo/redo: no hit for undo in `packages/react/src` apart from an unrelated comment (`ReactFlow/index.tsx:160`). Their only worked example is the Pro one (snapshot-based `useUndoRedo`). We write our own: a command/patch stack over our board store (zustand 4 already in app), capturing node/edge changes with immer-style patches, coalescing drags, limit ~200 steps.

**Theming.** `--xy-*` variables incl. `--xy-edge-stroke-default`, `--xy-minimap-*`, `--xy-background-*` (`packages/system/src/styles/init.css:1-52`), `.xy-flow.dark` block (:27), and `colorMode` prop (example `ColorMode/`). Cards/edges are our own components, so the paper look is complete; Background supports dots/lines/cross, we use CSS linen texture instead.

**Bundle (measured).** `@xyflow/react@12.12.0` `dist/umd/index.js` 188 KB raw / 59.5 KB gz; `dist/style.css` 18.6 KB / 3.0 KB gz. Already in v0.1.

**Verdict:** adopt for the board, keep. Do not copy any Pro example code.

---

## Q4. AFFiNE / BlockSuite

- Repo `src/blocksuite` (MPL-2.0: `LICENSE` header "Mozilla Public License Version 2.0", read 2026-10-16). Last commit `5cb5cb6` 2025-07-07: "chore: sync affine blocksuite to packages (#9149)" meaning the code is now synced from the AFFiNE monorepo into this repo. AFFiNE Community Edition is MIT (github.com/toeverything/AFFiNE, WebFetch 2026-10-16: "free for self-host under the MIT license"; the page did not state the licence of its `blocksuite` directory). npm: `@blocksuite/blocks`, `presets` 0.19.5 MPL-2.0 (modified 2025-06-09); `@blocksuite/store` 0.22.4 MIT (modified 2025-07-01). Whether the GitHub repo is formally archived: **NOT CONFIRMED** (no API access in this session); evidence of de-facto inactivity: no commit since July 2025 and no npm release since July 2025.
- Architecture worth learning from: one Yjs-backed block tree rendered as either a `page` or an `edgeless` view. The surface holds free elements in `elements: Boxed<Y.Map<Y.Map<unknown>>>` (`packages/framework/std/src/gfx/model/surface/surface-model.ts:33`, `SurfaceBlockModel` :53), controlled by `GfxController` (`packages/framework/std/src/gfx/controller.ts:33`), drawn by `CanvasRenderer` (`packages/affine/blocks/surface/src/renderer/canvas-renderer.ts:43`); `note` blocks sit on the edgeless surface and contain page blocks. The lesson: **one data model, two views**. For us: the notebook page is the document; the board card is a derived view (thumbnail + counts), exactly as DESIGN.md section 7 says.
- Embedding practicality: Lit web components + Yjs + `@preact/signals-core` (`packages/framework/std/package.json`: `lit ^3.2.0`, `yjs ^13.6.21`), `blocks` unpacked 12.5 MB. Heavy, a second reactive/state system next to zustand/react-query, no React-first API, and a stale project. Not adopted.

---

## Q5. The decision

### Evidence shaping it
- The notebook frames (`05-notebook-1440.png`, 1440 wide) show a **flowing bound page**: title, call slip, AI slip with numbered margin tabs, trace of quote cards in a row, then free ink, a dashed lasso, a sticky and typed text lying on dot-grid paper. Typed blocks are the spine; ink is an overlay; right rail has templates and counts. The tablet/phone variants (390px) collapse to a column with ink view-only (DESIGN.md section 10: "The pen is opt-in. Lasso, shapes and templates need a tablet or computer").
- The board frame (`06-board-1440.png`) is a node editor: cards with typed pins, "Link as" 4+3 grid, frames, minimap, legend.
- DESIGN.md section 4: three voices (Caslon / Alegreya Sans / Courier Prime) and every AI claim carries a marker; section 5: seven threads, each with a second cue and a paper tag; section 7: "Two."; section 8: "Same graph, paper materials ... Graph structure lives on the board; handwriting lives in the notebook."

### Options scored (0 = poor, 3 = excellent; my judgement from the evidence above)

| Criterion | (i) xyflow + custom notebook | (ii) Excalidraw notebook + xyflow | (iii) tldraw both | (iv) Excalidraw both | (v) one custom engine |
|---|---|---|---|---|---|
| Paper theme, light/dark | 3 (all DOM/SVG/CSS vars) | 1 (canvas fonts, hand-drawn look, own chrome) | 2 (CSS vars, custom shapes; its UI to replace) | 1 | 3 |
| Typed-first React blocks, AI slip, clickable markers | 3 | 1 (embeddable overlays only) | 2 (React in ShapeUtil) | 1 | 3 |
| Three voices (fonts) | 3 | 1 | 2 | 1 | 3 |
| `Anchor` citations stored | 3 (our schema) | 2 (`customData`) | 2 (shape props) | 2 | 3 |
| Ink quality | 2 (perfect-freehand, our pointer code) | 3 | 3 | 3 | 2 |
| Lasso + menu | 1 (we build) | 2 | 3 | 2 | 1 |
| Templates (5 papers) | 3 (CSS/SVG backgrounds) | 1 | 2 | 1 | 3 |
| Phone view-only ink | 3 (SVG renders anywhere, no editor) | 1 | 1 | 1 | 3 |
| a11y / keyboard | 3 typed content is real DOM; xyflow focus | 1 canvas text | 2 | 1 | 2 (we own it all) |
| Bundle cost (Next 14 client) | 3 (+2 KB gz) | 0 (~1.05 MB gz + 13 MB fonts) | 1 (not measured, large dep tree incl. Tiptap) | 0 | 3 |
| Licence | 3 MIT | 3 MIT | 0 key + watermark | 3 MIT | 3 |
| Maintenance risk | 3 (xyflow active; perfect-freehand stable) | 2 | 3 (active, but commercial) | 2 | 1 (all ours) |
| Board features (ports, typed links, picker, minimap) | 3 xyflow | 3 xyflow | 1 (build typed ports on bindings) | 0 | 0 |
| **Total (13 criteria, max 39)** | **35** | **20** | **24** | **20** | **28** |

### Recommendation (one answer)
**Option (i): xyflow for the board, a custom React-DOM notebook page with a `perfect-freehand` SVG ink layer.** Two surfaces, no shared canvas engine, one shared data model and one shared card component set.

Arguments against "one canvas":
1. The notebook's authority is typed text and quotes with real citation markers; making them canvas elements loses accessibility, search, copy, and font fidelity (Q1: canvas text).
2. The board's authority is typed ports and kinds; xyflow does this natively (Q3) and tldraw/Excalidraw do not (Q2: no handle validation; Q1: arrows are not typed).
3. Licence: only tldraw offers both in one engine and it is not usable under MIT without a key (Q2). Excalidraw offers both but not typed ports and weighs about 1 MB gz.
4. A notebook on the board is one card (DESIGN.md section 7). A thumbnail from our own SVG/DOM is trivial; from Excalidraw it would need `exportToSvg`.

What would change my mind: if ink testing on real tablets shows our pointer-event layer cannot reach acceptable latency or palm rejection, adopt `@excalidraw/excalidraw` **only** as a lazy-loaded ink mode (still MIT), or swap our ink layer for canvas-2D drawing while keeping the typed DOM. This is a risk to prototype first (spike: 200 strokes on an iPad Safari/Chrome Android tablet).

---

## Q6. Concrete APIs per requirement, and what we build

### Board (xyflow 12.12)
| Requirement | API we use | We build |
|---|---|---|
| Index-card nodes (passage, note, question, notebook page, diagram) + AI-slip cards | `nodeTypes` custom React nodes; `React.memo` | 6 node components in paper style, three-voice typography, `Anchor`-backed markers on AI slips, level-of-detail at low zoom |
| Typed brass pins (evidence in, question in, claim out, answer out) | `<Handle id type isConnectableStart/End>`; ReactFlow `isValidConnection` | The legality table (claim out to evidence in etc.), pin glyphs (circle/diamond), hover/dragging states |
| 7 relation kinds with colour + second cue + paper tag | custom `edgeTypes`, `BaseEdge`, `getBezierPath`, `EdgeLabelRenderer`, SVG markers | 7 edge renderers (solid+, dashed with crosses, chevrons, arrowhead, doubled line, dotted, fine line), tag component with glyph, tokens from DESIGN.md section 5 |
| Drag a thread, "Link as" picker (4+3 grid, keys 1-7, Esc = plain link) | `onConnect`, `onConnectEnd`, `useConnection`, `connectionLineComponent`, `useReactFlow().flowToScreenPosition` | Picker listbox with focus trap, number keys, midpoint settle animation, pending-edge state |
| Keyboard reachable | `nodesFocusable`, `ariaLabelConfig`, arrow-key moves, `onSelectionChange`/`useOnSelectionChange` | Keyboard "start link" command, roving focus over pins, live-region text, Delete/undo shortcuts |
| Frames | group node with `parentId`, `extent: 'parent'`, `expandParent`, `NodeResizer` | Dashed outline + paper tag, drop-into-frame logic (`getIntersectingNodes`), frame rename |
| Minimap | `<MiniMap nodeColor nodeComponent pannable>` + `--xy-minimap-*` | Per-kind colours, paper skin |
| Deep multi-step undo | none built in (Pro example only, not to be copied) | Patch/command history over our board store (zustand), drag coalescing, undo covers add/delete/link/kind-change/frame ops |
| 500 nodes | `onlyRenderVisibleElements`, memo, `minZoom` | LOD card render, texture-free low zoom, benchmark against the 625-node Stress example method |
| Theme light/dark | `colorMode`, `--xy-*` variables | Token mapping from DESIGN.md |
| Persistence | existing v0.1 persistence | Migration of v0.1 edge kinds to the 7 kinds |

### Notebook (custom)
| Requirement | Tool | We build |
|---|---|---|
| Page that starts from an exchange | React DOM page; reuse the call-slip/AI-slip/trace components from the reader | Notebook document model: ordered blocks + positioned objects; seed from exchange |
| Typed blocks, quote cards, stickies, shapes | DOM blocks, SVG shapes, pointer-drag for stickies/shapes (`@use-gesture/react` MIT 10.3.1 optional) | Block editor (contenteditable or Tiptap 3.32 MIT, optional, not evaluated in depth), quote card, sticky, shape set (rect, ellipse, arrow, line; rough look optional via roughjs MIT), snapping |
| Ink | `PointerEvent` (`getCoalescedEvents`, `pointerType`, `pressure`), `perfect-freehand` `getStroke` to an SVG `<path>` (live stroke on a canvas or one path) | Stroke store (points compressed), pen/highlighter (blend multiply), eraser (stroke hit-test), palm rejection (pen-only mode on `pointerType==='pen'`), tablet testing, pointer-capture cleanup |
| Lasso + menu | `PointerEvent` path, point-in-polygon on stroke bounds then points | Lasso selection of strokes + blocks, menu: "Ask about this", make sticky, send to board, copy, delete |
| AI content stays visibly AI-made | AI slip component (Alegreya Sans, tinted stock, "AI" tab) | Immutable AI blocks (provenance field, no editing of AI text), marker component |
| Citations as `Anchor` objects | existing `Anchor` type from the app (v0.1 shape **NOT re-verified here**) | Marker nodes embed an `Anchor` (not a bare block id); trace rows are Anchors; round-trip tests |
| Templates (blank, dot grid, lined, Cornell, derivation grid) | CSS/SVG backgrounds | 5 templates, per-page template switch |
| Phone: ink view-only, pen opt-in | render strokes as static SVG; pen-mode toggle | Gesture gating, 44 px targets |
| Page as one card on the board | existing DOM/SVG | Thumbnail renderer (SVG snapshot) + counts ("4 quotes, 1 sticky") |
| Undo (notebook) | none | Per-notebook command stack (separate from board's), ink strokes as single steps |

Share across both: one card/slip component library, one token set, one undo pattern (a small `history` helper used twice), one `Anchor` utility.

---

## Package table

Bundle sizes: "meas." = my gzip -9 of the published file from `npm pack` on 2026-10-16 (not a full Next build). Last release = `npm view time.modified` (2026-10-16).

| Package | Version | Licence | Bundle (min+gz) | Last release / maintenance | Use for | We build ourselves | Risks |
|---|---|---|---|---|---|---|---|
| `@xyflow/react` | 12.12.0 | MIT | 59.5 KB JS + 3.0 KB CSS (meas., `dist/umd/index.js`, `dist/style.css`) | 2026-10-11, very active (clone head 2026-10-16) | Board: nodes, handles, edges, minimap, frames | Undo, picker, keyboard link, paper nodes/edges, LOD | No keyboard connect; undo example is Pro; 500 rich nodes need LOD |
| `perfect-freehand` | 1.2.3 | MIT | 2.0 KB (meas., `dist/esm/index.mjs`) | 2026-02-01; stable, small | Ink stroke outlines | Pointer capture, store, eraser, lasso | Latency/pressure/palm on tablets |
| `zustand` | 4.x in app (5.0.15 latest) | MIT | already in app | 2026-08-13 | Board/notebook stores, history | patch stack | none |
| `@excalidraw/excalidraw` | 0.18.1 | MIT | about 1.05 MB gz across chunks (meas., upper bound) + 23 KB CSS gz + 13 MB fonts on disk | 2026-10-12 | **Not adopted**; fallback for ink only | n/a | Size, canvas text, hand-drawn style, SSR-off only |
| `roughjs` (optional) | 4.6.6 | MIT | not measured | 2023-11-20; stable | Optional sketchy shape outlines | n/a | not needed unless design wants wobble |
| `@use-gesture/react` (optional) | 10.3.1 | MIT | not measured | 2024-03-21 | Drag/pinch for stickies | n/a | extra dep, can be avoided |
| `@tiptap/react` (optional) | 3.32.0 | MIT | not measured | n/a | Possible typed block editor | block schema, AI-block read-only | extra weight; evaluate separately |
| `tldraw` | 5.5.2 | tldraw licence (`LICENSE.md`): no production use without key; watermark on hobby | NOT CONFIRMED (unbundled ESM) | 2026-10-16, active | **Owner's call, not adopted** | n/a | Key/watermark/telemetry, not OSI |
| `@blocksuite/blocks`, `presets` | 0.19.5 | MPL-2.0 | NOT measured (12.5 MB unpacked) | 2025-06-09, stale | **Not adopted** (study only) | n/a | Lit, stale, heavy |
| `@blocksuite/store` | 0.22.4 | MIT | NOT measured | 2025-07-01 | Not adopted | n/a | Yjs model without our UI |
| `@xyflow` Pro examples | n/a | xyflow Pro License | n/a | n/a | **Do not use** (undo/redo example etc.) | n/a | Licence breach if copied |

### Sources
- Clones listed above; npm registry (`npm view`, `npm pack`) on 2026-10-16.
- https://tldraw.dev/community/license and https://tldraw.dev/pricing (WebFetch 2026-10-16); https://tldraw.dev/legal/license and /legal/hobby-license returned 404 on 2026-10-16.
- https://reactflow.dev/learn/advanced-use/performance, https://reactflow.dev/examples/interaction/undo-redo (WebFetch 2026-10-16); https://reactflow.dev/pricing returned 404.
- https://github.com/toeverything/AFFiNE (WebFetch 2026-10-16).
