# RESEARCH R2: ink, hatching and the notebook (PaperTree v0.2, Ex Libris)

> **Licence verdicts here are superseded by ADR-004 §4** (the owner's ruling of 2026-10-16: any OSI open-source
> code may be used, whole or in part). "Owner's call" below now means: allowed if open source (elkjs is); still out if
> not open source (tldraw, React Flow Pro examples).


Date read: 2026-10-16. Status: COMPLETE. Author: research agent R2 (unattended). Prototype files (not in the repo): `PaperTree-research/v0.2/prototypes/r2/` on the SSD (`geom.mjs`, `geom.test.mjs`, `store.mjs`, `bench1.mjs`, `r1.mjs`).

## Summary

1. **Ink = `perfect-freehand` 1.2.3 (MIT, 2 KB gz) + our own code.** Same library Excalidraw ships; render the outline as a filled `<path>`; copy the 20-line `getSvgPathFromStroke` from its README with the MIT notice (Copyright (c) 2021 Stephen Ruiz Ltd) kept. Pass `last:true` at commit, `simulatePressure:false` only for real pen pressure (README and code defaults differ for `size` and `last`).
2. **Plate hatching = hand-written SVG `<pattern>`, not rough.js.** rough.js (MIT, 8-9 KB gz, no release since Nov 2023) at `roughness 0` only reproduces ruled lines, at 5.7 KB of path text per hatched box; it also returns non-deterministic output with its default `seed: 0`. Keep it as an optional later "sketch" style (seed non-zero, `disableMultiStroke`).
3. **Drawably: do not adopt.** MIT, zero deps, 5.5 KB gz + 2.9 KB CSS, claims verified (23 pieces, SVG not canvas), but it is a 0.x, 2-month-old, one-maintainer pen-doodle control kit with a 1.2 s "boil" and a random sketch per mount: against "calm, exact", and it breaks screenshot stability unless `seed` is pinned and `boil:0`.
4. **Pointer Events:** use `pointerType`, `pressure`, `setPointerCapture`, `touch-action:none`, rAF-batched live path, commit on `pointerup`. `getCoalescedEvents` exists on Chrome 58+, Firefox 59+, Safari/iOS 18.2+ (HTTPS or localhost only; tldraw still disables it on iOS), so feature-detect with fallback. Palm rejection = explicit/auto "pen mode" (touch scrolls, pen inks), as both Excalidraw and tldraw do.
5. **Storage:** one SQLite row per stroke, raw points (never outlines) as a binary blob: varint zigzag deltas at 1/16 page unit + u8 pressure, about 3.4 B/pt, 274 B per 80-point stroke, about 53 KB per 200-stroke page (modelled on synthetic strokes; JSON would be 288 KB to 1.2 MB). Page units, not screen px; colour stored as a token name so the lamp-lit scheme re-maps.
6. **Selection:** polygon lasso with RDP-simplified path, bbox pre-filter, non-zero winding point-in-polygon; strokes selected when at least half their points are inside, DOM blocks when their centre is inside; 3.2 ms for 500 strokes at 50 vertices. **Stroke eraser** (whole stroke, segment-vs-polyline distance, 0.04 ms) for v0.2; partial eraser is v0.3. All are pure functions with a tested prototype (section 7).
7. **Licence gate:** all adopted pieces are MIT. **tldraw is NOT MIT** (custom licence: no production use without a licence key, watermark enforcement): "owner's call, not adopted"; read for ideas only. Excalidraw (MIT) read for reference only.
8. **Top risks:** (a) iPad Safari specifics are only partly verified from docs and bug reports, not a device (hover tilt, coalesced events on LAN-IP http, Scribble); plan a real-iPad test pass. (b) ink is absolute while typed blocks reflow: decide the fixed-width page coordinate model early. (c) SVG-pattern hatching may moire at fractional zoom: check in a browser at DPR 1/2/3 (NOT CONFIRMED here).
9. Everything unverified is marked **NOT CONFIRMED** in its section.

## 1. Drawably

Paths are under `/Volumes/Mrigesh SSD/PaperTree-research/v0.2/src/drawably/` (clone HEAD 013c1a2 "snapshot pending work", 2026-09-19, a single commit). npm facts read 2026-10-16 with `npm view`.

**Claims verified**
- **Licence:** MIT, "Copyright (c) 2026 Daniel Belyi" (`LICENSE:1-3`; `package.json` `"license": "MIT"`). The optional pen font `font/DrawablyPen.ttf` has no separate licence file; NOT CONFIRMED separately (README just says MIT), and we would not ship it (opt-in, `package.json` `sideEffects`).
- **Zero dependencies:** verified. `package.json` has no `dependencies`; React is an optional peer `">=18 <20"` (`peerDependenciesMeta.react.optional`), so React 18.2 is supported. `AGENTS.md` invariant: "Zero runtime dependencies. Not one."
- **A control library, not a canvas:** verified. 23 attach functions, not 25: 11 controls (button, checkbox, radio, toggle, input, textarea, select, divider, card, badge, list), 4 text decorations (underline, highlight, circle, arrow), 8 composites (chip, tabs, tooltip, alert, steps, kbd, quote, pager) (`src/controls.ts`, `src/composites.ts`, `README.md:60-160`).
- **How it draws:** SVG, not canvas. `createSvg()` makes an `<svg aria-hidden="true">` (`src/controls.ts:46-48`) and prepends it into the REAL element (`controls.ts` `attachChrome`, ~line 118-135). Paths come from its own small jitter code, not rough.js: sampled lines every 8 px, jittered, joined with quadratic curves, drawn twice ("double stroke") (`src/rough.ts:1-72`). The only fill is `scribbleFill`, a zigzag (`rough.ts` end); no hachure engine.
- **Fresh sketch per mount:** true by default: `seed = opts.seed ?? randomSeed()` (`controls.ts:132, 413, 477, 584`) and `randomSeed()` is `Math.random()` (`src/prng.ts:12-14`). Everything else runs through `mulberry32`, so a passed `seed` is fully reproducible ("Determinism. Same seed, same sketch", `AGENTS.md`).
- **Boil:** default `boil = 0.3` (`controls.ts:131`) draws 3 path frames per layer, swapped by CSS `step-end` keyframes on a 1200 ms cycle (`style.css:30-60`). `boil: 0` gives one static path (`controls.ts:68`). `prefers-reduced-motion` freezes it (`style.css:345-355`; `controls.ts:112-113`).
- **SSR:** safe but client-drawn. Wrappers attach in `useEffect` (`src/react.ts:48-57`), so the server renders the plain control and the sketch appears after hydration (no hydration mismatch, a visible pop-in; each wrapper needs a client component in Next 14). `drawablySelect` creates a `<canvas>` to measure text (`controls.ts:353`), client only.
- **Theming:** CSS custom properties only: `--drawably-stroke/-fill/-paper/-width/-ink/-error/-success` (`style.css:20-136`). Defaults are pen blue `#2724d1`, easily pointed at our `#1E2A4A`.
- **A11y:** the native `<button>/<input>/<select>` stays in the DOM and does the work; the SVG is `aria-hidden`, `pointer-events: none`; focus is a sketched ring on `:focus-visible` (`style.css:152-160`). We have not checked its focus ring against our 3:1 token (`#1F4E79` ring, DESIGN.md section 2); we would override.
- **Bundle (measured 2026-10-16: esbuild `--bundle --minify`, `gzip -9`, scratch dir):** all 23 pieces from `"drawably"` 15.2 KB raw / **5.5 KB gz**; `drawablyButton` alone 2.1 KB gz; `drawably/react` (react external) 6.3 KB gz; `style.css` 9.5 KB raw / **2.9 KB gz**. So about 8-9 KB gz with CSS, matching the README's "~9 KB".
- **Maintenance:** very young: first npm publish 2026-08-15, 0.4.2 on 2026-09-10, one maintainer (danielwh2), 0.x so the API can break.

**Judgement for Ex Libris: do not adopt in v0.2.**
- **It fights the brief.** DESIGN.md: "Calm, tactile, exact" and "Paper moves like paper... Nothing bounces". A doodle that boils every 1.2 s is neither calm nor exact, and the default look is whiteboard doodle, not engraved plate or bound cloth. A fresh random sketch per mount means the same button looks different each visit.
- **It conflicts with screenshots.** Without a pinned `seed` and `boil: 0`, every visual-regression capture differs; and because the SVG is added in `useEffect`, a capture taken before mount shows the bare control. Both are fixable (seed, `boil:0`, wait for the `.drawably-svg` node), but that is work to make it behave like a normal component.
- **No fit in the notebook either.** The notebook's marks are the reader's own ink (pen strokes and stickies, DESIGN.md section 4.3: "Your pen strokes and stickies are yours; the AI never uses either"). A product-drawn wobbly circle or arrow would blur the three-voices rule. Stickies are typed blocks, not sketches.
- **Only plausible niche:** a marketing page or an empty-state flourish with a pinned seed and `boil:0` (MIT; about 3-6 KB gz if tree-shaken). Not v0.2 scope. If we ever want a seeded jittered path, `src/rough.ts` is about 60 lines of idea we could write ourselves.

## 2. perfect-freehand

Clone: `/Volumes/Mrigesh SSD/PaperTree-research/v0.2/src/perfect-freehand/` (HEAD 176e00f, 2026-02-01 "Update README to link to new Rust port"). The package lives in `packages/perfect-freehand/`. Read 2026-10-16.

**Facts**
- **Version / licence / maintenance:** 1.2.3 on npm, published 2026-02-01 (previous 1.2.2 on 2024-03-07; 1.2.0 2022-09-07), MIT "Copyright (c) 2021 Stephen Ruiz Ltd" (`LICENSE:1-3`), one maintainer (steveruizok). The algorithm is stable and finished; release cadence is slow but alive, and Excalidraw and tldraw's lineage both depend on it (see section 5). Zero runtime dependencies (`package.json` has none). Bundle: `getStroke` alone **2.0 KB gz** (4.5 KB raw), esbuild minify + `gzip -9` of the npm ESM build, measured 2026-10-16 in the scratch dir.
- **API:** `getStroke(points, options): number[][]` returns the OUTLINE polygon (array of `[x, y]`), not a centreline (`src/getStroke.ts:19-25`). It is `getStrokeOutlinePoints(getStrokePoints(points, options), options)`. Both halves are exported, plus `StrokeOptions`. Input points are `[x, y, pressure?]` or `{x, y, pressure?}`; object input is converted internally (a perf hit, `README.md` note); pressure defaults to 0.5 (`DEFAULT_PRESSURE`) and first-point pressure to 0.25 (`src/constants.ts:64`).
- **Options (README table, `src/types.ts`, defaults in `getStrokeOutlinePoints.ts:~170-180`):**

| option | default (README) | what it does |
|---|---|---|
| `size` | README says 8; **code default is 16** (`getStrokeOutlinePoints.ts:171`) | diameter at pressure 1 |
| `thinning` | 0.5 | how much pressure changes width; 0 = constant width; negative = thinner with pressure |
| `smoothing` | 0.5 | softens the outline edges |
| `streamline` | 0.5 | lerps each point toward the pointer by `t = 0.15 + (1 - streamline) * range` (`getStrokePoints.ts`, `constants.ts:46`); higher = smoother and lags the pointer more |
| `simulatePressure` | true | derives pressure from speed (`src/simulatePressure.ts`, `RATE_OF_PRESSURE_CHANGE 0.275`); set false when feeding real pen pressure |
| `easing` | `t => t` | remaps pressure |
| `start`/`end` | `{cap:true, taper:0, easing}` | `taper` number (distance) or `true` (whole length); `cap` has no effect with a taper |
| `last` | README says true; **code default is false** (`getStrokeOutlinePoints.ts:175`; `getStrokePoints.ts` `last: isComplete = false`) | when true, the final input point is used as-is (not lerped), so the stroke reaches the pen tip |

  The README/code mismatch on `last` is real: pass `last: true` explicitly for committed strokes; leave it false while drawing.
- **Starting-point behaviour to know:** the first points are skipped until the stroke is `size` long (`getStrokePoints.ts`, "hasReachedMinimumLength", with a TODO about backfilling), so a tiny dot or a very short tick has special handling: 1 point is padded with a 1 px offset, 2 points are interpolated to 5 (`getStrokePoints.ts`). With tapers this keeps dots from turning into "dashes".
- **Rendering to SVG:** the README gives `getSvgPathFromStroke(points, closed = true)` (README "Rendering"; also `packages/dev/src/state/shapes/draw.tsx:234-270`): `M` first point, one `Q` to the first midpoint, then `T` smooth quadratics through midpoints of consecutive outline points, `Z`. Returns `''` for fewer than 4 points. It sits in the same MIT repo as README/example code, so if we copy it verbatim into our repo we keep the notice `Copyright (c) 2021 Stephen Ruiz Ltd` (MIT) in the file header or a THIRD_PARTY note. It is 20 lines; writing our own version of "midpoint quadratic through a polygon" is trivial and avoids the question, but the attribution is cheap, so we recommend: copy with the notice. For Canvas: `new Path2D(pathData)` then `ctx.fill`.
- **Fill, not stroke:** the path is a closed filled polygon: render with `fill: var(--pen)` and `stroke: none`. Highlighter: same polygon with `fill` colour, `opacity` .35, `mix-blend-mode: multiply` (on paper) and `thinning: 0`, bigger `size`, `simulatePressure:false`, `smoothing: .5`, no taper.

**Performance (measured here 2026-10-16, node 22.23, M-series Mac, no browser; `getStroke` + the path-string helper, `size 3`, `last:true`, real-ish pressure):**

| input points | time per stroke | path string |
|---|---|---|
| 80 | 0.046 ms | 2.8 KB |
| 400 | 0.13 ms | 8.6 KB |
| 2000 | 2.9 ms | (large) |
| 500 strokes x 80 points, cold render of a whole page | 32 ms total | 1.4 MB of path text |
| a live stroke recomputed from scratch at each of 300 pointer moves | 31 ms total (about 0.1 ms per move) | |

  Takeaways: recomputing the whole live stroke every frame is fine (O(n), 0.1 ms at 300 points). A page of 500 strokes is a one-off 30 ms cost on load; so render committed strokes once, cache the `d` string per stroke (do not recompute on pan or zoom, since transform on a `<g>` is free), and put committed strokes into one `<svg>` or one `<canvas>`. A 1.4 MB path-string total for 500 strokes (2.8 KB each) is a hint to render to Canvas `Path2D` or to reduce `toFixed(2)` to `toFixed(1)` for page-coordinate units; it is a render-cache cost, not a storage cost (section 6).
- **Points per stroke:** at 60-240 Hz pen sampling, a one-second stroke is 60 to 240 points before decimation; 80 is a sensible mean for handwriting strokes (section 6).
- **Risks:** (1) outline is O(n) in points and produces roughly 2x as many outline points, so very long scribbles (2000+ points) cost about 3 ms and should be split or simplified; (2) with `streamline > 0` the live stroke trails the pen tip, so use `streamline` about .3-.5 live and `last:true` at commit; (3) the stroke outline is non-deterministic across versions only if the library changes. Pin the version, since stored raw points get re-rendered through it forever (store points, not outlines, section 6).

## 3. rough.js vs SVG pattern hatching

Clone: `/Volumes/Mrigesh SSD/PaperTree-research/v0.2/src/rough/` (HEAD 56a2762, merge of PR #222 "fraction-gap", 2023-11-19). Read 2026-10-16. Experiments below were run with `roughjs@4.6.6` from npm in the scratch folder (generator in Node, no DOM).

**Facts**
- **Licence / version / maintenance:** MIT, "Copyright (c) 2019 Preet Shihn" (`LICENSE:1-3`). 4.6.6 published 2023-11-20; the repo HEAD is the 2023-11-19 merge, so **no commit or release for about 3 years**. It is feature-complete and widely used (Excalidraw uses it, section 5), so "stale" is low risk, but nobody is fixing bugs. Dependencies (all MIT, same author): `hachure-fill` 0.5.2, `path-data-parser` 0.1.0, `points-on-curve` 1.0.1, `points-on-path` 0.2.1 (`package.json:42-47`, `npm view` 2026-10-16). Last releases of those: 2022-2023.
- **Bundle (measured 2026-10-16, esbuild minify + gzip -9):** `import rough from "roughjs"` 27.4 KB raw / **9.2 KB gz**; `RoughGenerator` only (`roughjs/bin/generator`) 23.3 KB / **8.2 KB gz**. Including the four deps. The prebuilt `bundled/rough.esm.js` is 8.9 KB gz.
- **Fill styles** (`src/core.ts:25`, `src/fillers/`): `hachure` (default, `hachure-filler.ts`), `cross-hatch` (`hatch-filler.ts`: the hachure plus a second pass at `hachureAngle + 90`), `zigzag`, `zigzag-line`, `dots`, `dashed`, `solid`. Options: `hachureGap` (px, default -1 meaning `strokeWidth * 4`, `scan-line-hachure.ts:7-10`), `hachureAngle` (default -41, `generator.ts` defaults), `fillWeight` (default -1 meaning half the stroke width), `fillStyle`.
- **Seed and determinism (important):** `seed` default is **0**, and in `Random.next()` a falsy seed means `Math.random()` (`src/math.ts:13-17`). So with defaults the output is NOT deterministic; confirmed: `seed:0, roughness:1` gives different paths on two calls; `seed:42` or `seed:7` gives identical output (tested). Always pass a non-zero seed (derive from a stable id, e.g. a hash of the diagram part id). Also, at `roughness >= 1` the hachure may randomly skip lines via `Math.random()` when no randomizer is attached (`scan-line-hachure.ts:11-16`), so use `roughness < 1` for the engraved look anyway.
- **Roughness near 0:** `roughness: 0` makes the hachure perfectly straight and parallel and strokes straight (output paths are cubic Beziers with control points on the line, e.g. `M0 0 C24.0 0, 48.0 0, 120 0`, tested). Pass `disableMultiStroke: true` and `disableMultiStrokeFill: true` or each line is drawn twice (at roughness 0 the two passes coincide and double the bytes, tested). `preserveVertices: true` keeps corners joined. Result at `roughness 0`: an exact, mechanical hatch; it does not look hand-drawn, which is what an engraved plate wants, but then rough.js adds nothing a pattern would not do.
- **SVG without a DOM:** use the generator: `rough.generator()` (or `new RoughGenerator()`), `gen.rectangle(...)`/`polygon`/`path` return a `Drawable`; `gen.toPaths(drawable)` returns `[{d, stroke, strokeWidth, fill}]` for plain `<path>` elements (`src/generator.ts:253-293`). `rough.svg(svgElement)` needs a real SVG node (`svg.ts:17`, `ownerDocument || window.document`), so in React use the generator route. No `window`/`document` use in `generator.ts`, `renderer.ts`, `math.ts` (grepped), so server rendering works.
- **Gotchas:** (1) in Node native ESM, `import "roughjs/bin/rough.js"` fails (`ERR_MODULE_NOT_FOUND ... roughjs/bin/canvas`, extensionless imports inside the package); bundlers (Next/webpack) handle it, plain-Node tests need the CJS entry (`require("roughjs")`). (2) Size of output: the `hachure` fill of one 120x40 rectangle at gap 3 is 5.7 KB of path text; `cross-hatch` 11.6 KB; `zigzag-line` 42 KB; `dots` 2.1 MB (a pathological case, do not use). A diagram with 6 hatched shadows is under 15 KB of DOM. (3) Speed: 500 hatched rectangles took 63 ms (0.13 ms each), fine.

**Alternative: hand-written SVG `<pattern>` hatching**
```svg
<defs>
  <pattern id="plate-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="3" stroke="var(--ink)" stroke-width="0.6"/>
  </pattern>
</defs>
<rect x="4" y="4" width="120" height="40" fill="url(#plate-hatch)"/>   <!-- the hatched shadow, offset behind the box -->
<rect x="0" y="0" width="120" height="40" fill="var(--paper)" stroke="var(--ink)" stroke-width="1" vector-effect="non-scaling-stroke"/>
```
- **Pros:** zero dependency; about 200 bytes, no per-shape path text; perfectly regular, which is what an "engraved plate" shows (machine-ruled hairlines); deterministic by construction (no seed to forget); themeable via CSS custom properties (the pattern inherits from where it is defined, so define it inside the SVG that has the `--ink` variable; in the lamp-lit scheme the hatch colour follows); trivially SSR-safe; one pattern can be reused across all parts with a different density by using a second pattern (`plate-hatch-light`).
- **Cons / care:** (1) `id`s must be unique per document (use `useId` or a fixed `plate-hatch` defined once per SVG; duplicate ids across two inline SVGs usually still work but break if one SVG is `display:none`, a known browser gotcha). (2) Browsers rasterise patterns per tile, so at fractional zoom or CSS transforms a fine 3 px hatch can show moire or uneven lines; keep the pattern in `userSpaceOnUse` units, avoid scaling the whole plate with a CSS `transform: scale`, and test at DPR 1, 2 and 3. NOT CONFIRMED in a real browser here (no browser rendering was done in this pass). (3) A pattern fill cannot taper or stop at a custom edge like a drawn hatch, so the hatched shadow must be a shape (a polygon strip L-shaped around the box) whose edge defines where the hatch ends; that is what real engraved plates do anyway. (4) No hand-wobble, which is by design.
- **Decision: use hand-written SVG patterns for the plate; do not take rough.js for v0.2.** The design brief ("hairline boxes, hatched shadows, lettered parts", 07c) is exact, ruled and quiet; rough.js at `roughness 0` reproduces that with 8-9 KB gz of code and kilobytes of path text per shape, and at `roughness >= 1` produces the sketchy look the brief rejects. Reserve rough.js (MIT, fine under the licence gate) for an optional "sketch" style later; it would be a client-side lazy import (`next/dynamic`), seeded with a hash of the part id, with `roughness <= 0.4`, `disableMultiStroke: true`. For dashed "inferred, no passage" boxes use `stroke-dasharray`, no library.

## 4. Pointer Events for ink

Sources read 2026-10-16: caniuse pages (via fetch), MDN (`PointerEvent.getCoalescedEvents`, `HTMLCanvasElement.getContext`), WebKit Bugzilla 217430 and 296943, and the tldraw/excalidraw clones. Items with no source are marked.

**Event fields and how to use them**
- **`pointerType`** is `'mouse' | 'pen' | 'touch'`. Draw with `pen` and `mouse`; treat `touch` as scroll/zoom/select (never ink) once a pen has been seen. tldraw: `isPen: e.pointerType === 'pen'` (`tldraw/packages/editor/src/lib/utils/getPointerInfo.ts:23`).
- **`pressure`** is 0-1. For `mouse` while a button is down it is a constant 0.5 (that is why Excalidraw tests `event.pressure === 0.5` to decide `simulatePressure`, `excalidraw/packages/excalidraw/components/App.tsx:8248`). Pen: real values; hover has pressure 0. tldraw treats a pen whose first point has `z === 0` as broken and falls back to mouse behaviour (`tldraw/packages/tldraw/src/lib/shapes/draw/toolStates/Drawing.ts:216-224`). Our rule: `usePressure = pointerType === 'pen' && first.pressure > 0 && first.pressure !== 0.5`, else `simulatePressure: true`.
- **`tiltX`/`tiltY`** (degrees, -90..90) and `twist`: available on Chrome and Safari for pens, we do not need them for v0.2 (no shading brush). Apple Pencil Pro barrel roll is NOT exposed: WebKit bug 296943 (status NEW; a commenter on iPadOS 26.4.1 says `twist` is always 0). Do not store them.
- **`getCoalescedEvents()`:** caniuse (read 2026-10-16): Chrome 58+, Firefox 59+, **Safari desktop 18.2+, iOS Safari 18.2+**; MDN lists it as "Limited availability" and secure contexts only (HTTPS or `localhost`). So on current iPadOS it exists, but tldraw still disables it on iOS: "Sometimes getCoalescedEvents isn't present on iOS... in non-https mode iOS does not `useCoalescedEvents`... The intent here is to have `useCoalescedEvents` disabled for iOS" (`tldraw/packages/editor/src/lib/hooks/useCanvasEvents.ts:274-283`). Recommendation: feature-detect and use it, but test on a real iPad on HTTPS; our app is local (`http://localhost` counts as secure, a LAN IP over http does not, so an iPad reaching the app over a LAN IP will NOT get coalesced events: that matters for a "local web app" opened from a tablet). Always keep the fallback `[e]`.
- **`getPredictedEvents()`:** caniuse (2026-10-16): Chrome 77+, Firefox 89+, Safari/iOS Safari 18.2+. Predicted points are drawn tentatively and thrown away on the next event; useful but optional. NOT CONFIRMED that Safari's predictions are good in practice; skip in v0.2 (extra complexity, visible overshoot on direction changes).
- **`touch-action: none`** on the ink surface (and `user-select: none`, `-webkit-touch-callout: none`) so the browser does not pan or zoom during a stroke: tldraw sets it on the canvas (`tldraw/packages/editor/editor.css:322, 370`), Excalidraw on the canvas in `excalidraw/packages/excalidraw/css/styles.scss:106`. For a page that scrolls, set `touch-action: pan-y` on the page and `none` only when the pen tool is armed (see palm rejection); once a touch pointer has started, the browser decides at pointerdown and cannot be changed mid-gesture.
- **`setPointerCapture(e.pointerId)`** on pointerdown so moves and the up arrive even if the pen leaves the element; tldraw does `setPointerCapture(e.currentTarget, e)` (`useCanvasEvents.ts:49`). Release is automatic on up/cancel. Handle `pointercancel` as "abort the stroke" (tldraw has a test for it, `tldraw/packages/tldraw/src/test/pointercancel-dom.test.tsx`).
- **Track pointerId:** keep one active ink pointer id; ignore other ids during the stroke.

**Palm rejection (strategies, in order of preference)**
1. **Pen mode (explicit):** a toggle on the notebook toolbar; when on, ink tools accept only `pointerType === 'pen'` and `touch` is used only for scroll/zoom. tldraw: `if (isPenMode && !isPen) return` before any state is touched (`tldraw/packages/editor/src/lib/editor/Editor.ts:11231-11234`) and auto-enables pen mode on the first direct-display pen (`isDirectDisplayPen` = pen on a touch device, `pointer.ts:22-25`; `Editor.ts:11285-11292`). Excalidraw: `penDetected`/`penMode` set once on the first `pen` pointerdown, toggleable (`App.tsx:7634-7643`), and in pen mode touch is allowed only for selection/lasso/text/image tools (`App.tsx:7770-7777`).
2. **Pen-first latch:** once any `pen` pointerdown is seen in the session, treat `touch` as non-drawing for N minutes. This is what both libraries effectively do.
3. **Contact-size heuristics** (`width`/`height` of a touch pointer, large = palm): unreliable on Safari (NOT CONFIRMED); do not depend on it.
4. **Phone:** DESIGN.md says the pen is opt-in and ink is view-only on a phone: on phones we would not attach ink handlers at all unless the user turns the pen on; with the pen on, finger drawing is allowed (no palm issue on a phone with a finger).
- **Pen and finger simultaneously on iPad Safari:** a WebKit-forum developer reports that Pencil contact blocks touch until lifted (and vice versa) (found via search, `developer.apple.com/forums` 2024-25; NOT CONFIRMED by a spec or WebKit statement). Good for palm rejection, bad if we wanted pinch-zoom while holding the pen. No action.

**Apple Pencil on iPad Safari (specifics)**
- Pressure, tilt: supported via pointer events with `pointerType: 'pen'` (WebKit "pen" events since 2019, WebKit bug search results; Excalidraw and tldraw both rely on it).
- **Hover:** Apple Pencil hover (M2 iPad Pro and later) dispatches `pointermove` with `pressure: 0` while hovering: WebKit developers say "hover events are already dispatched" (WebKit bug 296943 thread). A commenter reports tilt/roll missing during hover (not confirmed fixed). We can use hover only to draw a nib preview, and must not start a stroke on hover (check `e.buttons & 1` or pressure > 0 on move).
- **Scribble interference:** Scribble (handwriting into text inputs) could drop `pointerdown`s on iPadOS 14 (WebKit bug 217430, RESOLVED FIXED; a Feb 2022 comment says the fix shipped). The forum workaround was a non-passive `touchmove` listener calling `preventDefault()`. Keep ink on a `<canvas>`/`<svg>` that is not inside a focused `<input>`/`contenteditable`, and set `-webkit-user-select: none`; still test on a real iPad with Scribble on.
- **Double-tap and squeeze on Pencil 2 / Pro:** these are OS/app (native) gestures; per the brief they are not exposed to web pages (no event found in the WebKit bug threads read; NOT CONFIRMED beyond that). Do not design features that depend on them; eraser-by-button is only available for styluses that report `button 5` (tldraw handles "button 5 is the eraser", `Editor.ts:11292-11296`), which Apple Pencil does not.
- **Latency:** Safari on iPad does not offer `desynchronized`; see below. Expect about 1-2 frames (16-33 ms at 60 Hz, ProMotion 120 Hz iPads help) of visible lag.
- **Prediction/rendering:** NOT CONFIRMED that iPad Safari delivers 240 Hz coalesced Pencil samples; a 2020-21 forum thread says it did not then (pre-18.2); retest.

**Latency techniques**
1. **Live stroke in one element, updated once per `requestAnimationFrame`:** on each `pointermove` push all `getCoalescedEvents()` points to an array and mark dirty; in the rAF callback recompute `getStroke(points)` and set one `<path d>` (or redraw a small overlay canvas). We measured 0.1 ms per update at 300 points (section 2), so a whole-stroke recompute per frame is fine.
2. **Commit on `pointerup`:** call `getStroke(..., {last:true})`, store the raw points (section 6), move the path into the committed layer (a separate `<svg>`/`<canvas>`), clear the live layer. Never re-render committed strokes while drawing.
3. **Separate layers:** committed ink SVG (static, cached `d` strings) + live overlay (canvas or one path) so the browser repaints only the small live layer. `will-change: transform` on the static layer only if panning.
4. **`getContext('2d', { desynchronized: true })`:** a hint that lets the canvas present without waiting for the main thread's compositing (MDN, read 2026-10-16: "boolean hint ... may be ignored; attributes are fixed at first `getContext`"). caniuse had no entry I could fetch. NOT CONFIRMED for 2026: from general knowledge it is a Chromium feature (best on ChromeOS/Windows/Android with overlay support) and Safari/Firefox ignore it. It can tear. Use as progressive enhancement on the live canvas only; do not rely on it.
5. **Do not do React state per move:** `setPoints([...points, p])` at 120-240 Hz (as in the perfect-freehand README example) triggers a React render per event; keep points in a ref and write the `<path>` through the DOM in rAF.
6. **Hit-test cheaply while drawing:** nothing; do not run lasso/eraser tests inside the draw tool.

## 5. Excalidraw and tldraw

Clones read 2026-10-16 (read-only): Excalidraw `4c37956` (2026-10-15, `packages/excalidraw` 0.18.0, MIT "Copyright (c) 2020 Excalidraw") and tldraw `1304f95` (2026-10-16, `packages/tldraw` 5.5.2). Paths are relative to `/Volumes/Mrigesh SSD/PaperTree-research/v0.2/src/`.

**Licence gate for these two (important)**
- **Excalidraw: MIT** (`excalidraw/LICENSE:1-3`). Fine to read for ideas; we are not embedding it (R1 covers canvas choice).
- **tldraw: NOT MIT.** `tldraw/LICENSE.md` is a custom licence: "Not to use the Software in Production Environments", License Key required, "technical measures to verify License Key validity ... ensure proper watermark display", telemetry possible; alternative commercial licence from tldraw.dev. Per our gate this is "owner's call, not adopted". We read its code only as a reference for ideas; we copy nothing from it (copying code from that repo would carry the same licence).

| Topic | Excalidraw | tldraw |
|---|---|---|
| **Freehand pipeline** | Uses the `perfect-freehand` npm package, pinned `1.2.0` (`excalidraw/packages/excalidraw/package.json:106`). `getVariableWidthFreedrawOutline` calls `getStroke(points+pressure, {simulatePressure, size: strokeWidth*SIZE_FACTOR, thinning, smoothing, streamline, easing: easeOutSine, last: true})` (`excalidraw/packages/element/src/shape.ts:1222-1245`). A constant-width mode uses its own `@excalidraw/laser-pointer` (`shape.ts:1250-1262`). The outline is cached as a Path2D/SVG path on the element. | Ships its own fork/rewrite of perfect-freehand inside `tldraw/packages/tldraw/src/lib/shapes/shared/freehand/` (`getStroke.ts`, `getStrokePoints.ts`, `core.ts`, `svgInk.ts`), tuned per mode: simulated-pressure options (`thinning .5`, `smoothing .62`, `streamline` 0.64-0.74 by stroke width) vs real-pressure (`thinning .62`, `simulatePressure:false`) vs `thinning 0` for highlighter (`tldraw/packages/tldraw/src/lib/shapes/draw/getPath.ts:16-41`). Path from `getSvgPathFromPoints` (`tldraw/packages/editor/src/lib/utils/getSvgPathFromPoints.ts`). |
| **Pressure** | `simulatePressure = event.pressure === 0.5` at stroke start (`excalidraw/packages/excalidraw/components/App.tsx:8248`); real pressures are appended per point only when not simulated, and not persisted when simulated (`App.tsx:8275-8277, 9290-9298`). Element has `pressures: number[]` and `simulatePressure: boolean` (`excalidraw/packages/element/src/types.ts:430-436`). | `z = pressure`; "pen or stylus" if `(isPen && z !== 0) || (0 < z < 0.5) || (0.5 < z < 1)` (`Drawing.ts:216-224`); real pressure is multiplied by 1.25 (`Drawing.ts:233`); non-pressure devices drop z entirely (`DIM_2D`, `Drawing.ts:231`). |
| **Coalesced events** | Not used (`rg getCoalescedEvents` finds nothing in `excalidraw/packages`). It adds one point per `pointermove`, discarding exact duplicates (`App.tsx:9280-9285`). | Yes, only for the draw tool (`static useCoalescedEvents = true`, `DrawShapeTool.ts:10`) and **disabled on iOS** (`useCanvasEvents.ts:274-283`). Pen input also drops points closer than `1/zoom` from the last (`Drawing.ts:90-100`). |
| **Palm rejection / pen mode** | `penMode`/`penDetected` state, auto-on at the first `pen` pointerdown (`App.tsx:7634-7643`); in pen mode touch only works with selection, lasso, text, image tools (`App.tsx:7770-7777`); freedraw+penMode treated specially at `App.tsx:8068`. | `isPenMode` instance state; `if (isPenMode && !isPen) return` at the top of pointer handling (`Editor.ts:11231-11234`); auto-enabled only for direct-display pens, not for a desktop tablet (`pointer.ts:22-25`, `Editor.ts:11285-11292`); hover is allowed only for `mouse`/`pen` (`useCanvasEvents.ts:138, 145`). |
| **Touch/capture** | `touch-action: none` on the canvas (`excalidraw/packages/excalidraw/css/styles.scss:106`), `pan-x pan-y` / `auto` on some panels (lines 784-804). | `touch-action: none` (`tldraw/packages/editor/editor.css:322, 370`) and `setPointerCapture` (`useCanvasEvents.ts:49`, helper `utils/dom.ts:46`). |
| **Lasso** | A dedicated `lasso` tool: `LassoTrail` collects the path and re-evaluates each pointer move (`excalidraw/packages/excalidraw/lasso/index.ts`). `getLassoSelectedElementIds` (`lasso/utils.ts:~35-130`): simplify the path with `points-on-curve` RDP at `5 / zoom` px; cache each visible element's line segments per scroll/zoom; **bbox pre-filter** (`doBoundsIntersect`); mode `contain` (default: element bounds fully inside the lasso bounds, then polygon enclosure test with non-zero winding `polygonIncludesPointNonZero`, and no edge intersection) or `overlap` (enclosed OR path intersects the element) from `state.boxSelectionMode`; groups completed; locked and bound-text excluded. | No polygon lasso. Selection is by marquee (`Brushing.ts`) or an alt-drag "scribble brush" that selects shapes touched by the scribble line (`SelectTool/childStates/ScribbleBrushing.ts`: bbox reject then `geometry.hitTestLineSegment(A, B, 0)`). The polygon helper `pointInPolygon` is a winding-number test (`tldraw/packages/editor/src/lib/primitives/utils.ts:322-347`). |
| **Stroke storage** | JSON in the scene: `points: LocalPoint[]` relative to `x, y` plus `pressures: number[]` (`types.ts:430-436`); no compression in the element itself (the `.excalidraw` file is JSON, optionally deflated for share links). | `TLDrawShape.segments[]`, each `{type: 'free'|'straight', path: string, dim?: 2|3}`; `path` is **delta-encoded base64**: first point 3 x Float32 (12 bytes), each next point 3 x Float16 deltas (6 bytes = 8 base64 chars), 2D omits pressure (`tldraw/packages/tlschema/src/shapes/TLDrawShape.ts:12-27`, `tlschema/src/misc/b64Vecs.ts:1-17`). A migration converts legacy `points: VecModel[]` into this (`TLDrawShape.ts:203-242`). |
| **Eraser hit-testing** | `EraserTrail` tests each new pointer segment against elements: bbox pre-filter with `threshold = 15` for freedraw, then segment-to-segment distance against the stroke OUTLINE segments with `tolerance = max(2.25, 5/zoom)`, plus a point-in-polygon test of one end (`excalidraw/packages/excalidraw/eraser/index.ts:200-295`). It erases whole elements (stroke eraser); the elements are only marked then deleted on pointer-up. | `Erasing.ts`: take the segment between the previous and current page point, expand by the hit-test margin, query a spatial index `getShapeIdsInsideBounds`, transform the segment into shape space, bbox reject, then `geometry.hitTestLineSegment(A, B, minDist)`; the whole shape (outermost group) is marked as "erasing" and deleted on up (`tldraw/packages/tldraw/src/lib/tools/EraserTool/childStates/Erasing.ts:85-150`). Also whole-shape. |

**Takeaways**
- Both erase whole strokes (a stroke eraser), both pre-filter by bounding box first, both decide hits against the stroke geometry with a zoom-dependent tolerance (`5/zoom` in Excalidraw). That is exactly what we recommend in section 7.
- Excalidraw's lasso default is "contain" (select only what is fully inside); partial overlap is a mode. For a notebook, the more forgiving rule is better (section 7).
- tldraw's storage format is the most considered (delta + Float16, 6 bytes per point); Excalidraw's is plain JSON arrays. Both store points in page coordinates (relative to a shape origin), never screen coordinates.
- `perfect-freehand` 1.2.0 is what Excalidraw ships in production today, which supports pinning to `1.2.3` ourselves.

## 6. Ink storage format

**Method.** Sizes below come from a script in the scratch folder (`store.mjs`, 2026-10-16) that generates 200 synthetic handwriting-like strokes of 80 points each (smooth turning, step 0.5-8 units, pressure arc, 8-10 ms between samples) and encodes them each way. Real handwriting will differ; treat the numbers as a model, accurate to about +/-30 %, not a measurement of real pen data. NOT CONFIRMED with real Apple Pencil traces.

| Format | per stroke (80 pts) | per point | page of 200 strokes | gzip of the page | notes |
|---|---|---|---|---|---|
| A. JSON `[[x,y,p,t],...]`, raw floats | 6.1 KB | 76 B | 1185 KB | 567 KB | what pointer events give you; absurdly big |
| B. JSON `[x,y,p]`, x/y 1 decimal, p 2 decimals, no t | 1.5 KB | 18 B | 288 KB | 98 KB | readable; fine as an export |
| B2. JSON flat int array, deltas in 1/16 unit, pressure u8 | 0.84 KB | 10.6 B | 165 KB | 62 KB | easy to debug, still 3x the binary |
| **C. binary: varint zigzag deltas at 1/16 unit + u8 pressure** | **274 B** | **3.4 B** | **53 KB** | 50 KB | **recommended** |
| C2. same, no pressure (mouse) | 194 B | 2.4 B | 38 KB | 33 KB | |
| D. tldraw style (Float32 first point, Float16 deltas, 3 dims) | 486 B | 6.1 B | 95 KB | n/a | 8.1 B/pt as base64 (127 KB per page); `tldraw/packages/tlschema/src/shapes/TLDrawShape.ts:12-27` |
| E. SVG outline path string | 2.8 KB (section 2) | 35 B | 560 KB | | derived data, never store |

**Recommendation: raw points, binary, one SQLite row per stroke (format C), plus a few queryable columns.**
- **Store points, not outlines.** The outline from `getStroke` depends on `size/thinning/smoothing/streamline` and on the library version; the centreline points plus `size` and `tool` re-render identically under any later look (dark scheme, a new nib, high-zoom redraw). It is also 10x smaller (section 2: 2.8 KB path vs 274 B).
- **Row:**
  ```sql
  CREATE TABLE ink_stroke (
    id         TEXT PRIMARY KEY,         -- ulid, time-ordered
    page_id    TEXT NOT NULL,            -- the notebook page
    z          INTEGER NOT NULL,         -- paint order within the page
    tool       TEXT NOT NULL,            -- 'pen' | 'highlighter' | 'shape'(v0.3)
    color      TEXT NOT NULL,            -- token name ('pen','amber',...), NOT hex: the lamp-lit scheme remaps it
    size       REAL NOT NULL,            -- nib diameter in page units at pressure 1
    x0 REAL, y0 REAL, x1 REAL, y1 REAL,  -- bbox in page units, padded by size/2 (lasso/eraser pre-filter)
    n          INTEGER NOT NULL,         -- point count
    pts        BLOB NOT NULL,            -- format C v1
    t0 INTEGER, dur INTEGER,             -- start epoch ms, duration ms (stroke level only)
    deleted_at INTEGER                   -- soft delete so Undo/redo of erase is cheap
  );
  CREATE INDEX ink_stroke_page ON ink_stroke(page_id, z);
  ```
- **Blob v1 layout** (prototype tested round trip, max coordinate error 0.031 unit = 1/32): `u8 version=1, u8 flags (bit0 = has pressure), u16 n`, then first point as `i32 x, i32 y` (units x 16) `[+ u8 pressure]`, then for each further point `zigzag-varint dx, zigzag-varint dy [+ u8 pressure]`. Typical dx, dy fit in one byte each (a step of up to 4 units). Quantisation 1/16 unit is far below a pixel even at 4x zoom. Optionally gzip the blob (only about 7 % gain at this size: skip).
- **Timestamps per point:** dropped (saves about 1.5-2 B/pt and JSON bulk). Nothing in v0.2 replays strokes in time; `t0` and `dur` at stroke level suffice for "write order" and sync. If replay is ever wanted, add a flag bit and a per-point varint dt.
- **Per page:** 200 strokes x 80 points = about 53 KB (about 38 KB without pressure); a dense page of 1000 strokes is about 270 KB. A SQLite page cache or a `GET /pages/:id/ink` returning all rows for the page is fine; no need for chunking. If we sync to a server later, base64 over JSON adds 33 %.
- **Alternatives rejected:** (1) one JSON column per page: rewrites the whole page on every stroke, and undo/erase/sync become whole-page diffs; (2) SVG path strings: lossy and 10x larger; (3) storing pressure as float: no gain, 255 levels are plenty for width mapping; hardware reports more (Apple documents about 4096 levels natively, NOT CONFIRMED for Safari).

**Page coordinates, not screen coordinates**
- Define the notebook page as a fixed logical coordinate space: **page units = CSS px at 100 % zoom of a page of fixed logical width W** (e.g. 800, the dot-grid page in `05-notebook-1440.png` is a single bound page at that scale). Pointer input converts once: `p = (clientXY - svgRect.topLeft) / scale` where `scale = svgRect.width / W`, and `size` is also in page units. Rendering is then `<svg viewBox="0 0 W H">` and everything (resize, zoom, tablet vs phone) is a viewBox scale; the phone's view-only ink is the same SVG at a smaller scale (DESIGN.md 08c: "your ink as view-only").
- Both references store in shape-local page coordinates (tldraw: points relative to the shape origin; Excalidraw: `points` relative to `x, y`, `types.ts:430-436`); neither stores screen px.
- **Layout risk to decide at design time:** typed blocks (call slip, AI slip, quote cards, stickies) are laid out by the browser (flow or fixed width), while ink is absolute. If typed content reflows (font load, window width), ink drawn "next to" a block drifts. Mitigations: (a) the page has a fixed logical width W and blocks are positioned in the same units (as the board and the design's free-form notebook imply), or (b) ink carries an optional `anchor_block_id` + offset and is translated with its block. Recommend (a) for v0.2. NOT CONFIRMED against the real block model, which was not in scope here.
- **Search/accessibility:** DESIGN.md's right rail says "Handwriting is not searchable"; no OCR is needed, so the store does not keep text.

## 7. Lasso hit-testing and eraser

**Design rules (all coordinates in page units, section 6)**

*Lasso selecting strokes*
1. Collect the lasso as raw points while dragging; every ~1 frame (rAF) run `simplify(lasso, 2 / scale)` (Ramer-Douglas-Peucker, same idea as Excalidraw's `simplify(lassoPath, 5 / zoom)`, `excalidraw/packages/excalidraw/lasso/utils.ts`) so the polygon has at most about 50 vertices. Measured: a 300-vertex raw lasso costs 17 ms per test over 500 strokes, a 50-vertex one 3 ms (below).
2. **Bounding-box pre-filter** against the lasso's bbox using the stored per-stroke bbox columns (section 6) so most strokes cost nothing (Excalidraw: `doBoundsIntersect(lassoBounds, elementBounds)` first; tldraw does the same for its scribble brush).
3. **Rule: a stroke is selected when at least half of its points are inside the polygon (`'majority'`)**, with `'any'` (touching) as a Shift-modifier and `'all'` (fully enclosed) available. Reasons: `'all'` is what Excalidraw defaults to and it is the most annoying on a phone or tablet (a loose loop misses a long tail of one stroke); `'any'` grabs neighbouring handwriting whenever the loop grazes it; `'majority'` matches what the hand means. Strokes are small, so the test is O(points) with an early exit for `'any'`.
4. **Point-in-polygon: non-zero winding number** (the same family as tldraw's `pointInPolygon`, `tldraw/packages/editor/src/lib/primitives/utils.ts:322-347`, and Excalidraw's `polygonIncludesPointNonZero`). Unlike ray-casting even-odd, a self-intersecting loop (a figure-8 or an over-closed circle) keeps both lobes selected. The test file below proves the bow-tie case.
5. The path is implicitly closed from the last point to the first when the pen lifts; require at least 3 vertices.

*Lasso selecting DOM blocks (call slip, AI slip, quote cards, stickies, images)*
- Blocks are rectangles in the same page units (`getBoundingClientRect` minus the page origin, divided by `scale`, measured once at lasso start, not per move).
- **Rule: a block is selected when its centre is inside the polygon (`'center'`),** with `'corners-any'` / `'corners-all'` available. Centre is the best default for large cards because a loop around a big card plus a note otherwise has to enclose the whole card; centre is stable when the loop is drawn loosely, and does not select a huge AI slip that merely touches the loop. Do not use rect-polygon intersection for blocks (it selects anything near).
- Selecting a block should not start a text selection: set `user-select: none` on the page while the lasso is active.
- Mixed selection: return `{strokeIds, blockIds}`; moving the selection translates strokes (add dx, dy to the first point only, since later points are deltas in the binary format) and blocks together; `Ask about this` / `Make sticky` (from `05-notebook-1440.png`) act on the union.

*Eraser: stroke eraser for v0.2*
- **Recommend stroke eraser** (touch the stroke, the whole stroke goes), **not** a partial/pixel eraser. Why: (1) it keeps the data model one-row-per-stroke with undo = clear `deleted_at`, while a partial eraser must split strokes into new rows (each cut makes two new strokes with new points, and undo has to restore the original); (2) both reference apps do exactly this (Excalidraw marks hit elements and deletes on pointer-up, `eraser/index.ts`; tldraw `Erasing.ts:85-150`), so users already know it; (3) the hit test is a cheap segment-vs-polyline distance (0.04 ms for 500 strokes, below); (4) a partial eraser also needs sub-stroke hit tests on every pointer move and a new rendering path; (5) the design's notebook is typed-first, ink as a layer, and corrections are mostly "remove that scribble", for which the stroke eraser is the quick fix. Partial erase is a defensible v0.3 item once the stroke model is proven.
- **Algorithm:** for each `pointermove`, take the segment (previous point -> current point), pad it by `tol = max(2.25, 5 / scale)` (Excalidraw: `Math.max(2.25, 5 / zoom)`, `eraser/index.ts`) plus half the stroke's nib, bbox-reject, then test `segSegDist(strokeSegment, eraserSegment) <= tol` for each stroke segment. Highlight "will erase" strokes (reduced opacity) during the drag and commit the deletion on pointer-up as one undoable action. Continuous segments avoid missing fast sweeps.
- Pen hardware eraser (button 5) is not delivered by Apple Pencil; provide the eraser as a toolbar tool (DESIGN.md toolbar icons).

**Pure functions (tested; prototype in the scratch folder `geom.mjs` + `geom.test.mjs`, plain ESM, no DOM, written for this note, no third-party code). Portable to TypeScript in `lib/ink/geometry.ts` with the same tests.**
```js
// Pure functions, no DOM. Points are [x,y]; polygons are arrays of [x,y] (implicitly closed).
export const bboxOf = (pts) => { let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; for (const p of pts){ if(p[0]<x0)x0=p[0]; if(p[0]>x1)x1=p[0]; if(p[1]<y0)y0=p[1]; if(p[1]>y1)y1=p[1]; } return {x0,y0,x1,y1}; };
export const bboxesIntersect = (a,b) => a.x0<=b.x1 && a.x1>=b.x0 && a.y0<=b.y1 && a.y1>=b.y0;
// Non-zero winding number (handles self-intersecting lassos the way a hand-drawn loop expects: figure-8 selects both lobes).
export function pointInPolygon(pt, poly) {
  const [px,py]=pt; let wn=0;
  for (let i=0,n=poly.length;i<n;i++){
    const a=poly[i], b=poly[(i+1)%n];
    const cross=(b[0]-a[0])*(py-a[1])-(px-a[0])*(b[1]-a[1]);
    if (a[1]<=py) { if (b[1]>py && cross>0) wn++; }
    else if (b[1]<=py && cross<0) wn--;
  }
  return wn!==0;
}
// Ramer-Douglas-Peucker, to thin the lasso path to <= ~50 vertices before testing.
export function simplify(pts, eps) {
  if (pts.length<3) return pts.slice();
  const keep=new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1;
  const stack=[[0,pts.length-1]];
  while(stack.length){ const [s,e]=stack.pop(); let dmax=0,idx=-1; const a=pts[s],b=pts[e];
    for(let i=s+1;i<e;i++){ const d=distPointSeg(pts[i],a,b); if(d>dmax){dmax=d;idx=i;} }
    if(dmax>eps && idx>0){ keep[idx]=1; stack.push([s,idx],[idx,e]); } }
  return pts.filter((_,i)=>keep[i]);
}
export function distPointSeg(p,a,b){ const dx=b[0]-a[0],dy=b[1]-a[1]; const l2=dx*dx+dy*dy; let t=l2?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2:0; t=Math.max(0,Math.min(1,t)); return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy)); }
/** strokes: [{id, bbox, pts:[[x,y],...]}]. mode: 'any' | 'majority' | 'all'. Returns ids. */
export function lassoSelectStrokes(strokes, lasso, mode='majority') {
  if (lasso.length<3) return [];
  const lb=bboxOf(lasso), out=[];
  for (const s of strokes) {
    if (!bboxesIntersect(lb, s.bbox)) continue;           // cheap reject
    let inside=0; const n=s.pts.length;
    for (let i=0;i<n;i++){ if(pointInPolygon(s.pts[i], lasso)) { inside++; if(mode==='any') break; } }
    if (mode==='any' ? inside>0 : mode==='all' ? inside===n : inside >= n/2) out.push(s.id);
  }
  return out;
}
/** blocks: [{id, x,y,w,h}] in page units. mode 'center' | 'corners-any' | 'corners-all'. */
export function lassoSelectBlocks(blocks, lasso, mode='center') {
  if (lasso.length<3) return [];
  return blocks.filter(b=>{
    const cs=[[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]];
    if (mode==='center') return pointInPolygon([b.x+b.w/2,b.y+b.h/2], lasso);
    const k=cs.filter(c=>pointInPolygon(c,lasso)).length; return mode==='corners-all'? k===4 : k>0;
  }).map(b=>b.id);
}
/** Stroke eraser: ids of strokes whose polyline passes within tol (+half nib) of segment A-B (page units). */
export function strokesHitBySegment(strokes, A, B, tol) {
  const sb={x0:Math.min(A[0],B[0])-tol,y0:Math.min(A[1],B[1])-tol,x1:Math.max(A[0],B[0])+tol,y1:Math.max(A[1],B[1])+tol}; const out=[];
  for (const s of strokes){ if(!bboxesIntersect(sb,s.bbox)) continue; const t=tol+(s.size??0)/2;
    let hit=false; const p=s.pts;
    if(p.length===1) hit=distPointSeg(p[0],A,B)<=t;
    for(let i=0;i<p.length-1&&!hit;i++){ if(segSegDist(p[i],p[i+1],A,B)<=t) hit=true; }
    if(hit) out.push(s.id); }
  return out;
}
function segsCross(a,b,c,d){ const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]); return o(a,b,c)*o(a,b,d)<0 && o(c,d,a)*o(c,d,b)<0; }
export function segSegDist(a,b,c,d){ if(segsCross(a,b,c,d)) return 0; return Math.min(distPointSeg(a,c,d),distPointSeg(b,c,d),distPointSeg(c,a,b),distPointSeg(d,a,b)); }
```

**Tests (assertions that pass in the prototype, to port to vitest)**
- `pointInPolygon` inside / outside / above the square; the self-intersecting bow-tie `[[0,0],[10,10],[10,0],[0,10]]` selects both lobes `[8,5]` and `[2,5]` but not the pinch gap `[5,1]`.
- `lassoSelectStrokes`: a fully inside stroke is selected in all three modes; a stroke with 2 of 4 points inside is selected by `'any'` and `'majority'` but not `'all'`; a stroke with 3 of 4 points inside is selected by `'majority'`; a stroke far outside is never selected; a 2-vertex lasso selects nothing.
- `lassoSelectBlocks`: `'center'` selects only the block whose centre is inside; `'corners-any'` also selects the block with a single corner inside; `'corners-all'` only the fully enclosed block.
- `strokesHitBySegment`: hits a stroke crossed by the segment, misses a far stroke; `segSegDist` of an X crossing is 0; `simplify` collapses a nearly straight 4-point line to 2 points.

**Performance (measured here 2026-10-16, node 22, pure JS, no DOM)**
| scenario | time |
|---|---|
| lasso with 50 vertices (after RDP of 300 raw points), 500 strokes x 80 points, `'majority'` (135 selected of 500) | 3.2 ms |
| same, `'any'` (early exit; 200 selected) | 1.0 ms |
| same lasso unsimplified (300 vertices), `'majority'` | 17 ms |
| eraser segment vs 500 strokes (bbox prefilter + segment distance) | 0.04 ms |

So a live "what would be selected" preview on each frame is affordable at 50 vertices (3 ms) but not at raw 300 vertices (17 ms): simplify first, and for 2000+ strokes keep a grid or R-tree on the bboxes (NOT needed for v0.2; a page rarely has more than 1000 strokes, about 6 ms).

## Package table

Bundle sizes: minified with esbuild, `gzip -9`, ESM, tree-shaken, measured 2026-10-16 in the scratch folder from the npm tarballs.

| package | version | licence | bundle (min+gz) | last release / maintenance | what we'd use it for | what we'd build ourselves | risks |
|---|---|---|---|---|---|---|---|
| perfect-freehand | 1.2.3 | MIT (Stephen Ruiz Ltd, 2021) | 2.0 KB | 2026-02-01; prior 2024-03-07; one maintainer, stable | `getStroke` outline for pen and highlighter | path-string helper (copied from README, notice kept), live-stroke layer, point recorder | README/code default mismatch (`size`, `last`); pin version so stored points re-render the same |
| roughjs | 4.6.6 | MIT (Preet Shihn, 2019) | 9.2 KB full / 8.2 KB generator | 2023-11-20; no commits since; deps `hachure-fill`, `path-data-parser`, `points-on-curve`, `points-on-path` (all MIT, 2022-23) | NOT adopted for v0.2; optional later "sketch" diagram style | SVG `<pattern>` hatching, dashed "inferred" boxes | `seed: 0` is non-deterministic; Node-ESM import path issue; 5.7 KB path text per hatched box; stale |
| drawably | 0.4.2 | MIT (Daniel Belyi, 2026) | 5.5 KB all + 2.9 KB CSS (button alone 2.1 KB) | first publish 2026-08-15, 0.4.2 on 2026-09-10; one maintainer; 0.x | NOT adopted; possible marketing flourish with pinned seed | n/a | young 0.x; random per mount and 1.2 s boil vs "calm, exact"; sketch added in `useEffect` (screenshot timing) |
| hachure-fill / path-data-parser / points-on-curve / points-on-path | 0.5.2 / 0.1.0 / 1.0.1 / 0.2.1 | MIT | included in roughjs | 2022-2023 | not used directly | our own RDP `simplify` (15 lines, tested) instead of `points-on-curve` | n/a |
| @excalidraw/excalidraw (reference) | 0.18.0 | MIT | not bundled | active (HEAD 2026-10-15) | design reference only (lasso, eraser, pen mode) | everything | copying code needs the MIT notice; we copy none |
| tldraw (reference) | 5.5.2 | **custom, not MIT**: no production use without licence key, watermark/telemetry enforcement | not bundled | active (HEAD 2026-10-16) | **owner's call, not adopted**; ideas only (Float16 delta storage, pen-mode rule) | everything | licence; copy nothing |
| Pointer Events API, `getCoalescedEvents` | web platform | n/a | 0 | Chrome 58+, Firefox 59+, Safari/iOS 18.2+ | live ink input | recorder, pen-mode state machine | iPad behaviour needs a device test |
| SQLite blob format C (ours) | v1 | ours | about 60 lines of encode/decode | n/a | stroke storage | all | no migration tooling yet; version byte included |
