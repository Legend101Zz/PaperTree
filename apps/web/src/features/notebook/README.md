# notebook

The Dive-in notebook: a bound page that starts from the exchange it came from (frame 05). The pure
model is slice S5b (#207); the page is slice S5c (#208); ink tools, lasso and the nib/colour bar
are S5d (#209, through `NotebookToolbar`'s `inkTools` slot); the Dive-in motion and the tablet and
phone layouts are S5e (#210).

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
  send it). The header's Send page to board creates that card (S6a) and offers Open board.
- Performance: items are memoised and their callbacks stable, stroke outlines are cached per stroke
  object, and a drag restyles one element; a 200-item, 500-stroke page drags at the frame rate.

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
- `model/wire.ts`: API rows ↔ model items. `model/save.ts`: what to send for one item.
  `model/exchange.ts`: passage numbers, labels, the usage line. `model/layout.ts`: page height,
  where a new note lands, the five template paints. `model/links.ts`: reader and page URLs.
- `api/notebookApi.ts`: typed client and react-query keys (all under `['notebook', paperId]`).
  `api/pushItem.ts`: one save, with the 409 reported as a conflict and never retried.
- `hooks/useNotebookPage.ts`: load once, edit locally. `useItemSaver`: the background saves and
  their honest status. `usePageEditing`: the editing session, focus and shortcuts.
  `usePageTemplate`: the template, saved with `version`. `useBoardCard`: the page's board card and
  Send page to board. `usePointerDrag`: drags in page units without a render per move.
- `components/NotebookView.tsx` (the screen), `NotebookPage.tsx` (the bound page),
  `ExchangeBlock.tsx` + `AnswerProse.tsx`, `QuoteCard.tsx`, `NoteItem.tsx` + `NoteEditor.tsx`,
  `ShapeItem.tsx`, `InkLayer.tsx`, `NotebookToolbar.tsx`, `SaveNotice.tsx`, `NotebookPanel.tsx`
  (+ `TemplatePicker.tsx`, `NotebookSearch.tsx`), `NotebookPageList.tsx`, `notebook.css`.

Colours are token names (`pen`, `hl-amber`) mapped to `--pt-*`, never hex, so the lamp-lit scheme
re-maps them; the page's own template inks are `--pt-nb-*` in `notebook.css`, for both schemes.
