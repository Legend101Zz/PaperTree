/**
 * Real fences of the 2026-11-20 round-3 stress test (mermaid@12.2.0), verbatim, that PARSED but
 * LOOKED wrong in the app (v0.3 W6 look defects): mindmap nodes drawn with literal quotes, and a
 * quadrant point printed over a quadrant title. Evidence: fences-r3.jsonl and the screenshots
 * app-mmd-*.png.
 */

/** Bare quoted nodes, and one node wrapped in apostrophes by the old repair. */
export const MINDMAP_QUOTED_NODES_ODE =
  'mindmap\n  root["Neural ODE adjoint method"]\n    "Analogy to backpropagation"\n      "Gradient chains through layers"\n    "Adjoint ODE"\n      "da/dt = -a df/dz"\n    "Boundary condition"\n      n7["\'a(tN) = dL/dz at tN\'"]\n    "Backward integration"\n      "Gradient wrt initial value"\n    "Gradients wrt parameters"\n      "Theta treated as a state"\n    "Loss at many time points"\n      "Repeat adjoint per interval"';

/** Every child is a bare `"text"` node. */
export const MINDMAP_QUOTED_NODES_TRANSFORMER =
  'mindmap\n  root["Transformer"]\n    "Encoder and decoder stacks"\n      "Self-attention sub-layer"\n      "Feed-forward sub-layer"\n      "Masking in decoder"\n    "Attention"\n      "Scaled dot-product"\n      "Multi-head"\n      "Three uses"\n    "Position encoding"\n    "Residual and layer norm"';

/** "Restricted self-attention" at y = 0.5 sits on the title "Parallel and close". */
export const QUADRANT_ON_TITLE =
  'quadrantChart\n  title Trade-offs by sequential ops and path length\n  x-axis "Fewer sequential ops" --> "More sequential ops"\n  y-axis "Shorter path length" --> "Longer path length"\n  quadrant-1 "Sequential and distant"\n  quadrant-2 "Parallel and distant"\n  quadrant-3 "Parallel and close"\n  quadrant-4 "Sequential and close"\n  "Self-attention": [0.1, 0.1]\n  "Restricted self-attention": [0.25, 0.5]\n  "Convolutional": [0.3, 0.35]\n  "Recurrent": [0.85, 0.85]';
