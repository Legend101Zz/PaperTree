# board

The linen board (frame 06, lamp-lit 09c): index cards and AI-slip cards that a person sends from
the paper, joined by typed threads. v0.2 slices: S6a (#211, backend), S6b (#212, cards, pins,
threads), S6c (#213, Link as and keyboard linking), S6d (#214, frames, minimap, toolbar, empty
board, the Board wording), S6e (#215, undo and 500 cards).

## The cards

| Wire kind     | Card                                                       | Voices                         |
| ------------- | ---------------------------------------------------------- | ------------------------------ |
| `excerpt`     | passage: page tab from the anchor, hung quote, Open source | paper                          |
| `explanation` | call slip with the question, AI slip with numbered markers | you (the ask), ai (the answer) |
| `note`        | ruled index card in Courier, M stamp, edit in place        | you                            |
| `question`    | call slip alone, "question" tag                            | you                            |
| `notebook`    | miniature of the page's items, counts, Open page           | none (a pointer to a page)     |
| `diagram`     | AI slip with an empty plate and the title until S7 lands   | ai                             |
| `group`       | the v0.1 dashed frame (S6d redraws it)                     | none                           |

Every number a card prints is read from the API: the page tab from `source_anchor`, the notebook
counts from the board read's `counts`, the explanation footer from the message's `coverage` and
`run`. When a read fails the card shows its own words and leaves the number out. A body that does
not fit fades and offers "more", which grows the card in place (GAP-A3 §7).

## Pins and threads

Each card offers the brass port pins of `model/pins.ts`'s `PIN_TABLE` (a copy of the server's;
`pins.spec.ts` reads `papertree_db/canvas.py` and fails when they differ): open circle = evidence
in (left), open diamond = question in (top), brass circle = claim out (right), brass diamond =
answer out (bottom). A thread is dragged from a brass pin (a dashed navy line); every open pin it
can land on lights; a drop the server would refuse shows its sentence ("That pin does not take
that thread.") and saves nothing; a good drop opens the kind picker (v0.1's until S6c) and the
thread is saved with `from_port` / `to_port`. Pins are named buttons; Enter presses one, which is
xyflow's click-to-connect. The seven threads draw their colour token and the cue `THREAD_LINES`
(`@papertree/ui`) gives each kind, with a paper tag (glyph and words) beside the line; the legend
strip uses the same `ThreadSwatch`.

A numbered marker opens `/paper/<id>/read?focus=<card>&cite=<citation>`; the reader's
`useFocusFromCanvas` reads the citation's anchor from the thread and flashes the passage.

## Data flow

UI (`BoardView`, the cards) → `useBoardController` (local first, then one request per explicit
gesture; a settled board makes no request) → `lib/api/boards` → `routers/boards.py` →
`papertree_db.canvas` (SQLite rows, migration 0008). The cards' extras come from
`useCardSources` → `lib/api/threads` and `api/notebook.ts` (`GET /notebook/pages/{pid}`), read once
per set of cards.

## Key files

- `components/BoardView.tsx`: the page: header, toolbar, the xyflow board, the empty state.
- `components/CardPins.tsx`, `ThreadEdge.tsx`, `ThreadLegend.tsx`: pins, threads, legend;
  `hooks/useThreadDrawing.ts`: drawing a thread (validity, lit pins, refusal, the pending thread).
- `model/pins.ts`: the pin table and `canConnect`. `model/threads.ts`: wire kind → design kind,
  the curve between two pins, where the cue marks and the tag go.
- `components/cards/`: one file per card family, `CardShell` (stock, handles, the clip) and
  `index.ts` (`nodeTypes`).
- `hooks/useBoardController.ts`: the only module that writes.
- `hooks/useCardSources.ts`: the thread and notebook reads behind the cards, once per id.
- `model/flow.ts`: wire rows ↔ xyflow nodes and edges, names. `model/cards.ts`: what each card
  shows (pure). `model/clip.ts`: the fade and "more" rule.
- `components/cards.css`: the cards' stock and type, from `--pt-*` tokens.

The reader-side helpers (`components/canvas/sendToCanvas.ts`, `toast.tsx`, `duplicate.ts`,
`useFocusFromCanvas.ts`) stay where the reader imports them until the Board wording sweep (S6d).
