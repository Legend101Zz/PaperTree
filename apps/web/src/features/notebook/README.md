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
  (read-only). `/paper/<id>/notebook` lists the paper's pages or says how one starts.
- The three voices stay apart: `data-voice="you"` (call slip, notes, stickies), `paper` (quoted
  passages), `ai` (the AI slip). Quote card `n` is passage `n` of the answer: numbers run in the
  order the answer first cites each passage (`model/exchange.ts`), the order Dive in seeded them.
- "Open source" and every marker leave for the reader at `?nb=<page>&item=<item>`; the reader reads
  that item back and flashes its STORED Anchor (`hooks/useFocusFromNotebook.ts`).
- Typed notes and stickies: create (tool bar), move (drag; arrow keys, Shift for 24), edit in
  place (Enter, double-click), delete (Delete key or the × button), undo/redo (Ctrl/Cmd+Z,
  Shift+Ctrl/Cmd+Z, Ctrl+Y). A 409 shows "changed somewhere else, reload" and stops saving.

## Data flow

UI gesture → one S5b history `Command` (`execute` / `undo` / `redo`) → local `NotebookState` →
`useNotebookPage` asks `saveOp` (model/save.ts) per touched item what the server lacks → `pushItem`
(api/) sends ONE create, patch-of-changed-fields (with `version`) or delete → `routers/notebooks.py`
→ `papertree_db.notebook` → SQLite (migration 0007). Saves run one at a time per item and read the
latest local state when they run, so a burst of nudges is one PATCH.

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
- `hooks/useNotebookPage.ts`: load once, edit locally, save in the background.
- `components/NotebookView.tsx` (the screen), `NotebookPage.tsx` (the bound page),
  `ExchangeBlock.tsx` + `AnswerProse.tsx`, `QuoteCard.tsx`, `NoteItem.tsx`, `ShapeView.tsx`,
  `InkLayer.tsx`, `NotebookToolbar.tsx`, `NotebookPageList.tsx`, `notebook.css`.

Colours are token names (`pen`, `hl-amber`) mapped to `--pt-*`, never hex, so the lamp-lit scheme
re-maps them; the page's own template inks are `--pt-nb-*` in `notebook.css`, for both schemes.
