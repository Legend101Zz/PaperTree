/**
 * @papertree/ui — the reader's shared components.
 *
 * The package exists for one reason that is not "somewhere to put components": the renderers of
 * derived content live here and nowhere else — `AiText` for what a model wrote (the one register
 * with the reserved marker) and `DerivedBlock` for a parser's own transcriptions — beside the two
 * paper registers, `PaperText` and `ReflowedText`. So "is every AI-derived region marked?" reduces
 * to "did it go through this package?", a question `reader/provenance.spec` can answer
 * mechanically. Adding a second path to the screen for derived content defeats that, and no
 * amount of care in the calling code substitutes for it.
 *
 * S4 owns the package after S0 and added the reader's tokens and chrome to `styles.css` (the
 * highlight colours, the ink-blue accent, the reader bar, the selection toolbar, the highlight
 * card, the navigator drawer, the tray), so every reader surface draws from one set of `--pt-*`
 * tokens instead of per-component colours.
 *
 * `src/styles.css` is NOT imported here. A barrel that pulls in CSS forces every consumer — the
 * API's tests included — through a bundler that understands `.css`, and Node does not. The app
 * shell imports it once instead:
 *
 *     @import '@papertree/ui/styles.css';
 *
 * The stylesheet is decoration only: the 44px touch minimum is an inline style in `primitives.tsx`
 * and every state that matters is also an ARIA attribute, so a surface that forgets the import is
 * ugly rather than broken.
 */

export * from './provenance.js';
export * from './primitives.js';
export * from './fixtureUri.js';
