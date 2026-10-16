# notebook

The Dive-in notebook: a bound page that starts from the exchange it came from (frame 05). The pure
model is slice S5b (#207); the page is slice S5c (#208); ink tools, lasso and the nib/colour bar
are S5d (#209, through `NotebookToolbar`'s `inkTools` and `inkOptions` slots); the Dive-in motion
and the tablet and phone layouts are S5e (#210).

## What the page does (S5c)

- `/paper/<id>/notebook/<page>` shows one page: the binding edge, the template (blank, dot grid,
  lined, Cornell, derivation grid) drawn as a CSS background, the title with "From your question on
  p. 1 ¶1 · 15 Oct" linking back to the passage, the exchange block (call slip → AI slip → coverage
  line), the trace as numbered quote cards, typed notes, stickies, shapes, and stored ink
  (read-only). "Show all N paragraphs" opens the answer and moves everything below the exchange
  down by the height it outgrew its box (`exchangeShift`, display only, never saved).
  `/paper/<id>/notebook` lists the paper's pages or says where one comes from.
- The three voices stay apart: `data-voice="you"` (call slip, notes, stickies), `paper` (quoted
  passages), `ai` (the AI slip). Quote card `n` is passage `n` of the answer: numbers run in the
  order the answer first cites each passage (`model/exchange.ts`), the order Dive in seeded them.
- "Open source" and every marker leave for the reader at `?nb=<page>&item=<item>`; the reader reads
  that item back and flashes its STORED Anchor (`hooks/useFocusFromNotebook.ts`).
- Typed notes and stickies: create (tool bar), move (drag; arrow keys, Shift for 24), edit in
  place (Enter, double-click), delete (Delete key or the × button), undo/redo (Ctrl/Cmd+Z,
  Shift+Ctrl/Cmd+Z, Ctrl+Y). Whatever takes an item away (a delete, undoing an add, redoing a
  delete) moves the keyboard to the next item, else the previous, else the page title; whatever
  brings one back gives it the keyboard. What is being typed is committed on blur, Escape, unmount
  (Back, a route change), a hidden tab and `pagehide`, and is capped at the API's 100,000
  characters with a count near the limit.
- Saving never stops silently (`hooks/useItemSaver.ts`, `components/SaveNotice.tsx`): a 409 (a
  PATCH, or a DELETE sent with `?version=`, over an edit made elsewhere) is a bar that cannot be
  dismissed, recounts what is not saved here as saves land, and stays until Reload; a failure is a
  notice with Try again that, once dismissed, stays as a "Not saved" chip until the save succeeds,
  and comes back for the next failure; an item deleted elsewhere (404) that held changes is
  created again from this page and says so; a page deleted elsewhere (a create's 404) is a bar with
  "Copy text"; a refusal (422) is said once and never retried.
- Leaving (`model/leave.ts`, `hooks/pageLeave.ts`): a hidden tab sends with `keepalive` within the
  browser's 64 KiB budget; on `pagehide` every open editor commits, then everything owed goes out in
  chunks under the budget, one request per item, a write queued behind one in flight included
  (sent with the version it will have); a write too big for any keepalive request makes the page
  warn before it closes ("A long note has not been saved yet"), and only then.
- Shapes (rectangle, ellipse, arrow) from the Shapes tool: move by drag or arrow keys, resize from
  the two corner handles or Alt+arrows (history's `resize` command), delete.
- The side panel: **Paper** (the five templates; a choice saves `template` with the page's
  `version`), the notebook search (S5a's search; matches on this page are lit with the wash and a
  focus ring), **On this page** (the server's counts; ink is "yours", never a number), and **On the
  board** (the page's `notebook` card with a miniature and "4 quotes · 1 sticky", or the offer to
  send it). The header's Send page to board creates that card (S6a) and offers Open board. One
  page, one card: the card's id is derived from the page id (`cardIdFor`), so a second tab sends
  the same id and the idempotent create returns the card already there; the button waits while a
  send is in flight or the board is unknown, and a page already on the board opens it instead.
  The panel's counts are re-read after every burst of saves, and the board too while it holds the
  page's card. A failed template save is in the same "Not saved" notice, and its Try again sends
  the template too; choosing the saved template back clears it; a 404 is the page-gone bar.
  Search matches are lit and named ("matches your search"), the exchange included; the title's
  words after "Dive in: " carry the paper's voice.
- Performance: items are memoised and their callbacks stable, stroke outlines are cached per stroke
  object, and a drag restyles one element; a 200-item, 500-stroke page drags at the frame rate.

## Ink (S5d)

- The tool bar's ink group (`components/InkTools.tsx`, the state machine in `model/tools.ts`): pen,
  highlighter and stroke eraser, each a toggle with `aria-pressed`; then, after Sticky note, the
  nibs EF / F / M and the six colours of the drawing tool in the hand (or of the last one held: a
  nib or colour chosen with no pen in the hand picks it up). Keys (`hooks/useInkTools.ts`): **P**
  pen, **H** highlighter, **E** stroke eraser, the same key again or **Escape** puts the tool down
  (back to typing, dragging and selecting). Keys typed into a note or a field stay the field's.
- Drawing (`hooks/useInkInput.ts`, `components/InkSurface.tsx`): while a tool is held a surface
  covers the items layer with `touch-action: none` (only then), takes one pointer at a time and
  keeps its samples, coalesced where the browser offers them, in a ref; the live stroke's one path
  is rewritten once per frame by perfect-freehand, in the items layer UNDER the items like the
  stored ink, and pen-up adds the stroke as one history command. Pressure is stored only for a pen
  that reports it (`hasRealPressure`); else the encoder's no-pressure flag. A scribble longer than
  the encoder's 20,000 points is stored as two strokes.
- **Palm rejection** (`pointerRole`): a pen and a mouse always draw; a finger draws until a pen has
  touched the page, and from then on a finger scrolls the desk instead of inking, until the page is
  left. Other pointers are ignored while one is drawing.
- The highlighter is wide and translucent (`--pt-hl-*`), painted under the pen in its own group,
  multiply by day and screen by lamplight (`--pt-nb-hl-blend`). Colours are stored as token names
  (`pen`, `pen-amber`, `hl-amber`, `hl-pen`, …; `colourToken`) and drawn from `notebook.css`'s
  tokens in both schemes.
- The stroke eraser hides what it touches at once (`eraseStrokes`), and takes every stroke of one
  gesture away as ONE command at pointer-up: one undo brings them all back.
- Saving (`hooks/useStrokeSaver.ts`, `model/inkSync.ts`): strokes carry no version (immutable, and
  the create is idempotent on `stroke_id`), so the saver compares ids: what only the page has is
  POSTed (one batch per round trip, at most 200 strokes and 2 MiB; strokes drawn while one is in
  flight join the next), what only the server has is DELETEd. Failures, refusals and a deleted page
  go to the same `SaveNotice` as the items', and the "not saved" count names strokes; Try again
  re-sends them. While hidden and on `pagehide` it sends with keepalive, from ONE budget shared
  with the item saver (`api/keepalive.ts`), and `beforeunload` warns while a stroke too big for
  keepalive is unsaved.
- Ink latency (`model/latency.ts`): pointer-event times paired with the frame that wrote the live
  path and the frame that showed it; measured in a production build by a scripted 200-point stroke
  (the numbers and the load average are in the S5d PR).

## Data flow

UI gesture → one S5b history `Command` (`execute` / `undo` / `redo`) → local `NotebookState` →
`useNotebookPage` asks `saveOp` (model/save.ts) per touched item what the server lacks → `pushItem`
(api/) sends ONE create, patch-of-changed-fields (with `version`) or delete (with `?version=`) →
`routers/notebooks.py` → `papertree_db.notebook` → SQLite (migration 0007). Saves run one at a time
per item and read the latest local state when they run, so a burst of nudges costs one PATCH per
round trip (10 quick nudges measured 3); while the page is hidden or being left they go out with
`keepalive` when they fit its budget.

Reading: `GET /notebook/pages/{id}` → `wire.ts` (`itemFromWire`, `strokeFromWire`: base64 →
`decodeStroke` → `strokeToPath`) → the page; the exchange's citations, locators and usage come from
the stored thread (`hooks/useExchange.ts`, `GET /papers/{id}/threads/{tid}`).

## Key files

- `model/page.ts`, `stroke.ts`, `outline.ts`, `hitTest.ts`, `history.ts`: S5b's pure model (page
  units, stroke encoding, perfect-freehand outlines, lasso and eraser, undo/redo).
- `model/tools.ts` (tools, keys, colour tokens, palm rejection), `model/inkSync.ts` (what the
  server lacks, the batching rule), `model/latency.ts`: S5d's pure ink model.
- `model/wire.ts`: API rows ↔ model items. `model/save.ts`: what to send for one item.
  `model/exchange.ts`: passage numbers, labels, the usage line. `model/layout.ts`: page height,
  where a new note lands, the five template paints. `model/links.ts`: reader and page URLs.
- `api/notebookApi.ts`: typed client and react-query keys (all under `['notebook', paperId]`).
  `api/pushItem.ts`: one save, with the 409 reported as a conflict and never retried.
- `hooks/useNotebookPage.ts`: load once, edit locally. `useItemSaver`: the background saves and
  their honest status. `usePageEditing`: the editing session, focus and shortcuts.
  `usePageTemplate`: the template, saved with `version`. `useBoardCard`: the page's board card and
  Send page to board. `usePointerDrag`: drags in page units without a render per move.
  `useInkTools`, `useInkInput`, `useStrokeSaver`: the tool in the hand, the pointer, the ink's saves.
- `components/NotebookView.tsx` (the screen), `NotebookPage.tsx` (the bound page),
  `ExchangeBlock.tsx` + `AnswerProse.tsx`, `QuoteCard.tsx`, `NoteItem.tsx` + `NoteEditor.tsx`,
  `ShapeItem.tsx`, `InkLayer.tsx`, `InkSurface.tsx`, `InkTools.tsx`, `NotebookToolbar.tsx`, `SaveNotice.tsx`, `NotebookPanel.tsx`
  (+ `TemplatePicker.tsx`, `NotebookSearch.tsx`), `NotebookPageList.tsx`, `notebook.css` (the
  page) and `panel.css` (the side panel).

Colours are token names (`pen`, `hl-amber`) mapped to `--pt-*`, never hex, so the lamp-lit scheme
re-maps them; the page's own template inks are `--pt-nb-*` in `notebook.css`, for both schemes.
