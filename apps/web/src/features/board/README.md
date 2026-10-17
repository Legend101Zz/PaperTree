# board

The linen board (frame 06, lamp-lit 09c): index cards and AI-slip cards that a person sends from
the paper, joined by typed threads. v0.2 slices: S6a (#211, backend), S6b (#212, cards, pins,
threads), S6c (#213, Link as and keyboard linking), S6d (#214, frames, minimap, toolbar, empty
board, the Board wording), S6e (#215, undo and redo; 500 cards).

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

## Undo and redo (S6e, #215)

Every gesture that writes records ONE step (`model/history`'s `BoardCommand`, plain data): a move
(a drag of any number of cards, a frame and the cards it carries, a run of arrow-key nudges, the
frame a dropped card joins), a resize (with the cards a frame takes in or lets go), a note's text or
a frame's name, a new note or frame, Frame selected cards, a delete (cards, threads, or both), a new
thread, and a thread's kind or label. Cmd/Ctrl+Z undoes the newest, Shift+Cmd/Ctrl+Z (or Ctrl+Y)
redoes; the toolbar's Undo and Redo say what they take back ("Undo move of 3 cards"; on a phone they
are the first two entries of More). No history key acts while a text field or the Link-as picker
has focus (`useUndoKeys`), so a note keeps the browser's own undo of its text.

- **Replay, not snapshots of the board.** Undo replays the step's inverse and redo the step through
  the controller's own writes (`replay` → PATCH, DELETE, POST), local first, with the `version` the
  board holds when it runs. A card changed somewhere else answers 409: the board reloads, says
  "Couldn't undo move of “…”. The card “…” was changed somewhere else. The latest version is
  shown.", drops that step and forgets every other step that would write over that card (a PATCH
  of it, or a DELETE of it), so no later undo or redo overwrites the other change without a word.
  A step that only creates the card again (undoing its delete) is kept: it overwrites nothing, so a
  deleted card stays restorable. Any other refusal also drops the step and reloads. A card that is
  gone says so ("That card is no longer on the board."), not in the server's words.
- **A reload keeps the versions it holds** for every card a step writes (`holds`): a change made in
  another tab is shown, but an undo of that card still carries this tab's version and answers 409
  rather than overwriting it. (A new gesture on that card is refused the same way once, then the
  board takes the server's version.) A card whose DELETE is on its way stays off the board even if
  a reload's read raced it.
- **Threads carry no version on the server (#283), so a thread step is guarded on the client
  only**: before an undo or redo of a change of kind or label, the board reads the board and
  refuses ("The thread was changed somewhere else. The latest version is shown.") when the thread
  is not as the step left it. The window left open is the one round trip between that read and
  the PATCH: a change made in another tab inside it is overwritten. #283 adds the version (a
  migration and a 409, like cards). One write per thread is in flight at a time (`edgeWrite`), as
  one PATCH per card is, so a re-kind and its immediate undo reach the server in order.
- **Deleted rows come back with their ids**, words, anchors, message and page ids, frame and
  threads (POST with the old `node_id` / `edge_id`: the server accepts it once the row is gone,
  and returns the row it still has if its DELETE has not landed). NodeCreate has no `z`, so a card
  comes back at z 0 (every card v0.2 makes is z 0), with a new `created_at` and version 1; the
  board is read in `z, created_at` order, so **a restored card moves to the end**: it is drawn
  over the others and is the last card Tab reaches, also after a reload. A frame's cards rejoin it
  by PATCH; the server's ungroup trigger does not bump their versions (0008), so no fresh read is
  needed and a member changed elsewhere 409s (and is left out of its frame). A thread whose other
  card was deleted elsewhere is not brought back, and the board says so.
- **One stack, one toast.** The Undo toast after a delete or a new thread names its own step (its
  `key`) and takes back that step or nothing: when another step is newer it says "That was not
  undone: the board changed after it." and leaves the stack alone. Any other step puts the toast
  away, and so does forgetting its step; after its 8 s the step can still be undone from the
  keyboard or the toolbar. A nudge still in its 400 ms debounce is newer than the toast's delete
  but does not block it: the card comes back and the nudge is recorded after.
- **One replay at a time, in order** (`useBoardHistory`): an undo or redo takes its step only once
  the replays before it settled, and a gesture made while a replay is saving is recorded after it,
  so the stacks keep the order things happened in and a newer gesture always clears Redo. One
  order is still the page's, not the server's: Cmd/Ctrl+Z pressed while a new note's or thread's
  POST is on its way undoes the step before it, and the new step, once saved, clears that undo's
  Redo.
- **The cap is 100 steps** (`HISTORY_CAP`); the oldest is forgotten past it. The history belongs to
  the page: a reload starts it empty. The viewport (pan and zoom) is not a step.

## 500 cards, and the lamp-lit board (S6e, #215)

- **A big board (150 nodes or more, `bigBoard`) is drawn for scale.** Only the cards in view are
  in the page (xyflow's `onlyRenderVisibleElements`), and under the low-zoom switch
  (`model/glance`: below 45 %, back above 55 %, the band between keeps what was drawn so a zoom
  that hovers does not flicker) every card is a glance: its kind (a passage with its page) and
  its first words, large and in their voice's face, on flat stock, with its pins drawn but not
  targets (a few pixels on screen there: zoom in to draw a thread; L still starts one by
  keyboard), so its threads stay drawn (`CardGlance`). A note being typed in stays full. A smaller board keeps every card in the page and in full at any zoom, so
  Tab reaches each one and v0.1's in-card targets hold (W2UI #141: 44 px on screen whatever the
  zoom); glances there (they would read better on a phone after Fit all) would need that rule
  changed first. One subscription to the zoom (`useGlanceZoom` in `BoardView`) tells every card,
  through `GlanceProvider`, only when the zoom crosses the switch.
- **Memoised cards and threads.** Each card kind is wrapped by `withGlance`, memoised on its row,
  its selection and its type (`sameCard`): the moves of its own drag (xyflow hands a card its
  position every frame) do not redraw it. A thread is memoised and works out its curve, its marks
  and its head only when an end or the kind moves.
- **On a big board a card out of view is out of the page**: it is reached by panning, or by Fit
  all, which shows the whole board again (as glances); Tab walks the cards in view. The keyboard
  thread walk (L) centres the board on a target that is out of the page before focus moves to it,
  so its name is said and its ring is seen (`useKeyboardLink`). Below the switch the legend's hint
  is "Zoom in to draw a thread, or press L on a card." (a glance's pins are not targets). While the
  first fit (or Fit all) is on its way a big board draws glances, so it never draws 500 full cards
  for a frame first.
- **The zoom the stylesheet reads** (`--pt-cv-zoom`, the phone's tap targets and the frame's band)
  is published in 0.05 steps inside 20–100 % (`publishedZoom`), since each write restyles every
  card under the stage.
- **A settled 500-card board makes 0 requests** (nothing above polls or saves on a timer;
  `e2e/v02/board-scale.spec.ts`).
- **Lamp-lit (09c).** Every colour is a token; the board's own tints (the linen's threads, the
  index card's red rule and blue ruling, the header's laid lines) are lit by lamplight in
  `cards.css`'s dark block (09c-board-other.dc.html's values), which follows the three mechanisms
  of `styles.css`; the call slip's ruling (`--pt-call-slip-rule`) is lit in `@papertree/ui`'s own
  dark blocks, so a call slip reads the same on the board, in the reader and in the notebook. A
  glance draws its own edge (`--pt-frame-outline`: by day `--pt-card-edge` is transparent).
  `lamplit.spec.ts` holds every thread colour, pin and glance edge to 3:1 and the words on cards,
  glances, tags and the legend to 4.5:1, in both schemes.

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
- `components/cards/`: one file per card family, `CardShell` (stock, handles, the clip),
  `CardGlance` (the far-off card and `withGlance`) and `index.ts` (`nodeTypes`); `model/glance.ts`
  (the switch, what a glance says, when a card draws again, the published zoom).
- `hooks/useBoardController.ts`: the only module that writes; it records each gesture's step.
- `model/history.ts` (steps, inverse, replay, keys, names), `hooks/useBoardHistory.ts` (the stack
  as React state, one replay at a time), `hooks/useUndoKeys.ts` (the keys).
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
