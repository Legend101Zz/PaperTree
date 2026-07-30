/**
 * @papertree/ui — the reader's shared components.
 *
 * The package exists for one reason that is not "somewhere to put components": `DerivedBlock` is
 * the ONLY way to render derived content anywhere in the product, so "is every AI-derived region
 * marked?" reduces to "did it go through this package?" — a question `reader/provenance.spec` can
 * answer mechanically. Adding a second path to the screen for derived content defeats that, and no
 * amount of care in the calling code substitutes for it.
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
