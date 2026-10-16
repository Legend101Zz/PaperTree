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
| `group`       | a frame: dashed outline, paper tag with its name (S6d)     | you (the name)                 |

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
that thread.") and saves nothing; a good drop opens "Link as" (below) and the thread is saved with
`from_port` / `to_port`. Pins are named buttons. A pointer click on a brass pin, then on an open
pin, is xyflow's click-to-connect; Enter (or Space) on a brass pin starts the keyboard walk below
instead, which reaches every open pin too. Escape or a click on the empty board cancels either.
The toolbar's Link takes
its pins from the table (`resolvePorts`) and refuses a pair no pin can hold. A stored thread with
no pins is drawn between the pins the table names, or two hidden fallback handles every card and
frame carries (`edgeHandles`), so no stored thread is ever invisible. The seven threads draw their colour token and the cue `THREAD_LINES`
(`@papertree/ui`) gives each kind, with a paper tag (glyph and words) beside the line; the legend
strip uses the same `ThreadSwatch`.

## Link as, and linking by keyboard (S6c, #213)

`LinkAsPicker` is frame 06's picker: no scrim, it settles in at the thread's midpoint (240 ms,
the settle curve; at once under reduced motion), a header naming both ends (`endName`: a passage by
its page tab, other cards by kind and first words) and the seven kinds in a 4 + 3 grid (two
columns on a phone), each drawn by `ThreadSwatch` with its key. Keys 1–7 choose, Enter or a click
chooses the focused kind. The grid is one Tab stop that the arrows walk (a roving grid), so Tab
goes grid ↔ "Add a label", which unfolds the optional label field; Enter there saves the kind
focused last. No key pressed inside the picker reaches the board (`nokey`, and every key is
stopped), so Delete in it never deletes a card or a thread.

- **Escape keeps a plain link** (`relates`, "7 = plain link"): v0.1's Escape saved nothing, and
  that changed on purpose (frame 06, DESIGN.md §3.9).
- **A press outside the picker saves nothing**, for a new thread as for a change of kind. This is
  the coordinator's default for #213; the owner may still decide otherwise (the alternative was
  "an outside press keeps a plain link, with Undo").
- **Every new thread offers Undo** for 8 s in the shared toast ("Linked as supports.", which is
  also its announcement); Undo deletes it.

Focus goes back to where the thread started: the source pin after a drag, the card after L, the
button that asked otherwise. Kinds are enabled from the server's pin table (`kindChoices`). That
table limits pins, not kinds, so every way into the picker (a drop, a click-to-connect, the walk,
the toolbar's Link, a saved thread) arrives with all seven enabled; the disabled state, which says
why on focus, is a guard, and Escape never saves a pair the table refuses. The selected-thread
bar's Kind button (`ThreadBar`) opens the same picker on the saved thread; there Escape changes
nothing. A request whose thread or cards are gone (deleted, then put back by Undo) is dropped,
never reopened.

Keyboard linking (`useKeyboardLink`; xyflow has none, ADR-004 §2.8) reuses the click-to-connect
state: **L** on a focused card starts a thread from its first brass pin (as does Enter on a brass
pin). Every card and open pin that can take it is a target (`linkTargets`): a card with two such
pins is visited once per pin, the pin of the same shape first, so a claim still reaches a question
card's "question in" by keyboard. Targets are walked in reading order (rows of card tops within
96 px, top to bottom, then left to right) starting at the card nearest the source; Tab, → and ↓
step forward, Shift+Tab, ← and ↑ back, wrapping. Focus follows the highlight (xyflow pans to it),
a dashed navy thread (`ThreadPreview`) shows where it would go, Enter opens the picker, and Escape
cancels with nothing saved and focus back where it started.

The walk is scoped to the board: it takes keys only from inside the stage, never from a text
field, and ends with nothing saved when focus leaves the stage, on a press anywhere but a pin (a
pin may still finish it by pointer), or when another thread starts. While it runs, a card's
description says the walk's keys instead of "the arrow keys to move it", and no arrow reaches
xyflow. Each thing is said once: focus says the card's name; the live region says "Linking from
…" and then "Target 2 of 5, question in."; a refusal ("… has no brass pin …") is the notice line
(an alert) only; "Linked as …" is the Undo toast.

A numbered marker opens `/paper/<id>/read?focus=<card>&cite=<citation>`; the reader's
`useFocusFromCanvas` reads the citation's anchor from the thread and flashes the passage.

## Around the cards: header, tools, frames, minimap, empty board (S6d, #214)

The header says "Board _paper title_ · 11 cards · 7 threads · 2 frames" (`model/chrome`'s
`countsLine`: cards always, threads and frames once there are some; the title is one
`GET /papers/{id}`). The tools are frame 06's: Select (area selection), Add note, Add frame (an empty
frame centred on the view, its name selected for typing), Thread (L) (one selected card starts
the keyboard walk from its brass pin, as L does; two are linked first to second, v0.1's Link; a
thread being drawn is put away), Fit all and the zoom (− 100% +, off at 20 % and 200 %). "More
board tools" keeps v0.1's Frame selected cards (Group), Remove frame (Ungroup) and Delete. Under
1100 px the tools are icons with their names kept; on a phone Select and the zoom move into More so
the bar is one row beside "Board".

A frame is the wire's `group`. It is selected and moved by its paper tag or by a band along its
outline (`FRAME_HANDLES`), so a frame whose tag lies under a card stays reachable; a press anywhere
else inside the outline reaches the board. By keyboard a frame is a node like any card: Tab, arrows
to move (its cards move and are saved with it), Delete, and its name field. The cards it holds follow it (the controller carries them). Which frame
holds a card is `model/frames`' rule: the smallest frame holding the card's centre, and a card
stays in its frame while that frame still holds it. It is applied when a card is dropped (its
`group_id` rides in the PATCH of the move) and when a frame is resized (cards it now holds join,
members it no longer holds leave), at the resize's end only: a resize from the left or top edge
does not move the cards. Add frame puts an empty frame in the clear spot nearest the middle of the
view (`spotNear`); it stays empty until something is dropped in it or it is resized over cards.
Frames never hold frames: a frame inside another one stays where it is when the outer one moves.

The minimap (`BoardMinimap`) is xyflow's `MiniMap` in board stock: cards ruled, AI cards slip,
frames dashed, the view a navy box, every edge 3:1 on its ground (`pins-contrast.spec`); captioned
"Map · 100%" or "Map · empty", bottom-right, with the legend and the Undo toast kept left of its
column. On a phone it folds behind a "Map" button at the top right. The empty board (`EmptyBoard`,
06b) is a ruled card on a brass pin with the sprout, how cards arrive, Back to the paper and two
hints. Everything sits in the `main` landmark under the header.

## Data flow

UI (`BoardView`, the cards) → `useBoardController` (local first, then one request per explicit
gesture; a settled board makes no request) → `lib/api/boards` → `routers/boards.py` →
`papertree_db.canvas` (SQLite rows, migration 0008). The cards' extras come from
`useCardSources` → `lib/api/threads` and `api/notebook.ts` (`GET /notebook/pages/{pid}`), read once
per set of cards.

## Key files

- `components/BoardView.tsx`: the page: header, the xyflow board, the notices and the Undo toast.
- `components/BoardHeader.tsx`, `BoardToolbar.tsx` (and `hooks/useBoardTools.ts`, what each tool
  does now), `BoardIcon.tsx`, `BoardMinimap.tsx`, `EmptyBoard.tsx`, `chrome.css`; `model/chrome.ts`
  (counts, zoom readout, Thread's rule) and `model/frames.ts` (which frame holds a card).
- `components/CardPins.tsx`, `ThreadEdge.tsx`, `ThreadLegend.tsx`: pins, threads, legend;
  `hooks/useThreadDrawing.ts`: drawing a thread (validity, lit pins, refusal, the pending thread).
- `components/LinkAsPicker.tsx`, `LinkAsLayer.tsx` (placement, focus back), `ThreadPreview.tsx`,
  `ThreadBar.tsx`, `linkAs.css`; `hooks/useLinkAs.ts` (which thread, the save, the live region),
  `hooks/useKeyboardLink.ts`; `model/linkAs.ts` (kinds per pin pair, keys, the Escape rule,
  placement, grid moves) and `model/keyboardLink.ts` (targets, reading order, nearest first).
- `model/pins.ts`: the pin table and `canConnect`. `model/threads.ts`: wire kind → design kind,
  the curve between two pins, where the cue marks and the tag go.
- `components/cards/`: one file per card family, `CardShell` (stock, handles, the clip) and
  `index.ts` (`nodeTypes`).
- `hooks/useBoardController.ts`: the only module that writes.
- `hooks/useCardSources.ts`: the thread and notebook reads behind the cards, once per id.
- `model/flow.ts`: wire rows ↔ xyflow nodes and edges, names. `model/cards.ts`: what each card
  shows (pure). `model/clip.ts`: the fade and "more" rule.
- `components/cards.css`, `threads.css`, `legend.css`, `linkAs.css`: the cards, the pins and
  threads, the legend, the picker, from `--pt-*` tokens.

The board lives at `/paper/<id>/board`; `/paper/<id>/canvas` redirects there with its query string,
so v0.1 bookmarks keep working (#214). The reader-side helpers keep their v0.1 names and home
(`components/canvas/sendToCanvas.ts`, `toast.tsx`, `duplicate.ts`, `useFocusFromCanvas.ts`), as do
the API, the tables and the wire types (`CanvasNode`); everything they show a person says "board"
("Send to board", "Passage added to your board.", "Open board"), and `test/board-wording.spec.tsx`
and `chrome.spec.tsx` fail on a "canvas" in any text, name or tooltip they render.
