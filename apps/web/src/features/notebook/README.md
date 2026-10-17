# notebook

The Dive-in notebook: a bound page that starts from the exchange it came from (frame 05). The pure
model is slice S5b (#207); the page is slice S5c (#208); ink tools, lasso and the nib/colour bar
are S5d (#209, through `NotebookToolbar`'s `inkTools` and `inkOptions` slots); Dive in with its
motion and the tablet and phone layouts are S5e (#210).

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
  send it). The header's Send page to board creates that card (S6a) and offers Open board; it
  reads the board again first (`freshBoard`, or the board as last read when that read fails) and
  puts the card below everything on it then, so a card added since the page opened (another
  tab, the reader's Send to board) is never covered (#218). One
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
  highlighter, stroke eraser and lasso, each a toggle with `aria-pressed`; then, after Sticky note,
  the nibs EF / F / M and the six colours of the drawing tool in the hand (or of the last one held:
  a nib or colour chosen with no pen in the hand picks it up). Keys (`hooks/useInkTools.ts`): **P**
  pen, **H** highlighter, **E** stroke eraser, **L** lasso; the same key again or **Escape** puts
  the tool down (back to typing, dragging and selecting). Keys typed into a note or a field stay the
  field's, and an Escape the Shapes menu took closes only the menu. Each nib's name starts with its
  letters ("EF, extra fine nib"), so voice control can say what is shown.
- Drawing (`hooks/useInkInput.ts`, `components/InkSurface.tsx`): while a tool is held a surface
  covers the items layer with `touch-action: none` (only then), takes one inking pointer at a time
  and keeps its samples, coalesced where the browser offers them, in a ref; the live stroke's one
  path is rewritten once per frame by perfect-freehand, in the items layer UNDER the items like the
  stored ink, and pen-up adds the stroke as one history command (a pencil stroke cancelled by a
  system gesture is kept too). Pressure is stored only for a pen that reports it
  (`hasRealPressure`); else the encoder's no-pressure flag. A scribble longer than the encoder's
  20,000 points is stored as several strokes.
- **Ink and the open answer** (`model/inkPlace.ts`): the open answer is taller than its stored box,
  and everything below the box is SHOWN that much lower. A stroke belongs to the layer it STARTS
  in: begun above the box's bottom it stays put; begun below it, it is stored where it will sit
  once the answer closes, and drawn back where it was while it is open. The band the open answer
  opened has no stored place, so a stroke cannot START there (the cursor says not-allowed there,
  and starting one says why), though one may pass through it. The page's two ink layers, the
  eraser's hit-test and a new stroke's stored place all follow this one rule.
- **Palm rejection** (`pointerRole`): a pen and a mouse always draw; a finger draws until a pen has
  touched the page, and from then on a finger scrolls the desk instead of inking. While the pen is
  down a finger does nothing at all (a palm neither inks nor scrolls), and a pen that lands on a
  resting palm takes over from it, whichever touched first. The latch belongs to the page
  (`useInkTools`): putting the tool down does not reset it.
- The highlighter is wide and translucent (`--pt-hl-*`), painted under the pen in its own group,
  multiply by day and screen by lamplight (`--pt-nb-hl-blend`). Colours are stored as token names
  (`pen`, `pen-amber`, `hl-amber`, `hl-pen`, …; `colourToken`) and drawn from `notebook.css`'s
  tokens in both schemes.
- The stroke eraser hides what it touches as SHOWN at once (`eraseStrokes` on `strokesAsShown`),
  and takes every stroke of one gesture away as ONE command at pointer-up: one undo brings them
  all back.
- Saving (`hooks/useStrokeSaver.ts`, its ledger `model/inkLedger.ts`, `model/inkSync.ts`, the
  network half `api/pushStrokes.ts`): strokes carry no version (immutable, and the create is
  idempotent on `stroke_id`), so the saver compares ids: what only the page has is POSTed (one
  batch per round trip, at most 200 strokes and 2 MiB; strokes drawn while one is in flight join
  the next), what only the server has is DELETEd, and so is a stroke whose failed POST may have
  reached the server (no answer, a 5xx) once it leaves the page, so it never comes back on reload.
  A failure counts only while its stroke is still owed: undoing a stroke that never landed clears
  it. Failures, refusals ("A stroke could not be saved: …", said once, never resent) and a deleted
  page go to the same `SaveNotice` as the items'; Try again re-sends.
- Leaving: while hidden the saver sends with keepalive, within what is left of ONE budget shared
  with the item saver (`api/keepalive.ts`). On `pagehide` every owed request starts inside the
  event, with keepalive for what the items left of the budget and best effort for the rest; a last
  command's sync waits for that flush (`isLeaving`). `beforeunload` warns when what the two savers
  owe together is more than keepalive can still carry (a long note plus owed ink, or one stroke too
  big on its own).
- The lasso (`hooks/useLasso.ts`, `model/lasso.ts`, `components/LassoLayer.tsx` + `LassoMenu.tsx`):
  a loop drawn over the items is tested against the page as SHOWN (`shown`, by the same rule as the
  ink layers) with S5b's `lassoSelect`; its dashed loop stays and the menu opens under it with the
  keyboard on its first action (arrows, Home, End; Escape closes it and keeps the lasso). Its name
  counts what it holds by kind ("Lasso selection: 1 note, 7 strokes", `selectionName`). On a phone
  (600 px and below) the menu sits at the foot of the screen, wrapping, since the page is wider
  than the screen there. The AI cannot read handwriting, so **Ask about this**, **Make sticky**,
  **Send to board** and **Copy** take only the typed notes and stickies inside the loop; an action
  whose need is missing stays in place, disabled, and says why: to a screen reader with it
  (`aria-describedby`), and on screen under the menu while it has the keyboard or the pointer. **Ask about this** hands the words to the reader in this tab's
  `sessionStorage` under a short key (`model/askHandoff.ts`; only when storage is blocked do they
  travel in the URL), and the reader (`components/AskFromNotebook.tsx`) takes them once: it drops
  the key from the URL, starts a NEW ask (`startFresh`) with the words as the explain controller's
  draft (`setDraft`, S4d), puts the keyboard at the end of the question box, and says once, in a
  note, why the words are there: the ask API takes a passage of the paper as context, never
  notebook text. Sent, cleared or not, the words never come back on a reopen or a reload. Make
  sticky (the notes go, one sticky with their words takes the first's place) and **Delete**
  (strokes and the person's items; never the exchange or a quote card) are each ONE history
  command (`batch`), so one undo puts everything back. Send to board makes one note card from the
  words, below everything on the board when it is sent (read again first with `freshBoard`, as
  Send page to board does, #218; ink is not sent); Copy puts them on the clipboard.
- Ink latency (`model/latency.ts`, probe `apps/web/scripts/ink-latency.mjs`): pointer-event times
  paired with the frame that wrote the live path and with the next frame; measured in a production
  build by scripted 200-point strokes. The probe's header says what each number does and does not
  include; the numbers, load averages and what a real tablet still needs are in
  `research/build/v0.2-ui/shots/S5d/README.md`.

## Dive in and the layouts (S5e)

- **Dive in** (`hooks/useDiveIn.ts`, the panel's half; `hooks/useDiveArrival.ts`, the page's;
  `model/diveIn.ts`, pure): the AI slip's footer has **Dive in** before Send to board
  (`features/explain/components/AnswerParts.tsx`'s `DiveIn`). One press POSTs S5a's Dive-in route
  under a page id DERIVED from the answer (`diveInPageId`: `np_` + the message id's suffix), so a
  second press, a second tab or a Back-then-Dive-in sends the same id and the idempotent route
  answers with the page already there: one answer, one page. A press while one is under way joins
  it. Meanwhile the exchange lifts (`data-dive="lift"`, `--pt-dur-quick`); then the screen boxes of
  its call slip, AI slip and trace rows go into a one-shot hand-off (`diveHandoff`, ten seconds
  fresh) and the route changes. The page waits unseen (`data-dive="arriving"`) until it is drawn and
  has stopped changing size, then slides in from the right for `--pt-dur-open` minus
  `--pt-dur-quick` (120 → 360) while each card the panel showed flies to its place on the page
  (FLIP, translate only: paper is not stretched; a card only flies when it was on screen in the
  panel and lands on screen). Reduced motion: no lift, one `--pt-dur-quick` fade, nothing travels.
  Durations are read from the live tokens at run time. A page opened from a link just appears.
  A sample paper (no server) has no Dive in. Page ids are global keys on the server (S5a's create
  looks the id up per owner, then inserts it), so if another account ever holds the derived id
  (it would need this answer's message id) the 422 "page_id: already in use" makes the answer dive
  into a fresh id instead of failing on every press. A reader still on screen 1.5 s after the
  route was asked for settles its lifted cards and its button.
- **Back to the paper** carries `?thread=<the page's source thread>` (`readerHref`); the reader's
  `hooks/useThreadFromNotebook.ts` opens the explain panel on that thread and then takes `thread`
  out of the URL (`router.replace`), so closing the panel and reloading does not reopen it;
  `?nb=&item=` still flashes the passage the question came from.
- **Layouts** (`model/layoutMode.ts`, `hooks/useLayoutMode.ts`, `data-layout` on `.pt-nb`):
  phone below 768 px (the explain panel's sheet breakpoint, so Dive in on a phone lands on the
  phone notebook), tablet 768–1279 (frame 05b), desktop from 1280 (frame 05). `allows` says what
  each may use: everything on the tablet and desktop; on the phone typed notes, stickies and the
  highlighter, the pen only once switched on, never the eraser, lasso, shapes or templates.
- **The tablet** (05b): the tool bar becomes a vertical rail on the left (`aria-orientation`), the
  same tools in the same order; the nib and the colour are one button each showing what the drawing
  tool holds, opening a flyout with S5d's choices (`components/RailInkOptions.tsx`; a choice,
  Escape, a press elsewhere or the keyboard leaving closes it, and Escape never puts the tool down).
  Up and Down move along the rail (Left and Right along the desktop bar), wrapping, Home and End to
  its ends. The bar names the page and its controls are 44 px; the page is full-bleed
  (`usePageScale` with no gutter) and the side panel follows it down the desk, as a region rather
  than a landmark beside it. Pen input is S5d's (palm rejection; one finger scrolls the desk once a
  pen has touched it). **Pinch zoom is not supported**: the page's scale follows the desk's width
  only (#292).
- **The phone** (08c; `components/PhoneStack.tsx`, `PhoneBar.tsx`, `phone.css`, `model/phone.ts`):
  with no drawing tool in the hand the page reads as a stack: "From your question…", the exchange
  (`ExchangeBlock` with `phone`: "Read the whole answer" and "N more paragraphs" in the slip's foot,
  no margin echoes), the coverage line, the trace as one 44 px index-card row per numbered quote
  card ("Abstract · cited 5×", S4's touch `TraceList`) that opens its passage in the paper, then
  "Your ink · view only" (the strokes cropped to where they are, `inkCrop`; a picture, never a
  surface), the stickies and the typed notes (`NoteItem` with `flow`: one tap edits, Escape or blur
  saves through the same saver; never moved). There is no × on a note in the stack, nor on any touch
  screen (CSS `hover: none`): a hidden button a stray tap finds would delete it. Delete is the
  editor's own 44 px button (`NoteEditor`'s `onDelete`), and every delete on the phone, whatever is
  in the hand, leaves a toast with Undo (`hooks/useDeleteUndo.ts`) while it is still the last thing
  done. The answer's markers take the shared 44 px touch target. The bar at the foot says "Lasso, shapes and
  templates: on a tablet or computer" and offers exactly Text, Sticky, Highlight and "Pen: off".
  Highlight and switching the pen on put that tool in the hand, and the page itself is shown (scaled
  to the screen's width, `usePageScale`'s floor is 0.3 for it) so drawing works as on a tablet;
  Undo joins the bar while a tool is held; switching it off returns to the stack. Keys never pick
  up the eraser or the lasso there, and the pen only through its switch (`useInkTools`'
  `keyAllowed`, `useLayoutInkTools`); a tool the layout leaves out is put down when the window
  becomes a phone, while a pen or highlighter already in the hand stays, so a tablet turned into a
  phone with the pen held opens on the page with "Pen: on". The bar
  names the page and keeps Back, Send page to board and Open board as 44 px icons. There is no
  side panel: templates are not offered, and search and the counts are the tablet's and desktop's.

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
- `model/tools.ts` (tools, keys, colour tokens, palm rejection), `model/inkPlace.ts` (where ink
  sits while the answer is open), `model/inkSync.ts` (what the server lacks, the batching rule),
  `model/inkLedger.ts` (the saver's bookkeeping), `model/lasso.ts` (what the lasso picked up, what
  each menu action needs, its commands), `model/askHandoff.ts` (Ask about this's hand-off to the
  reader), `model/latency.ts`: S5d's pure ink model.
- `model/wire.ts`: API rows ↔ model items. `model/save.ts`: what to send for one item.
  `model/exchange.ts`: passage numbers, labels, the usage line. `model/layout.ts`: page height,
  where a new note lands, the five template paints. `model/links.ts`: reader and page URLs.
- `api/notebookApi.ts`: typed client and react-query keys (all under `['notebook', paperId]`).
  `api/pushItem.ts`: one save, with the 409 reported as a conflict and never retried.
  `api/pushStrokes.ts`: one strokes POST or DELETE, and what became of each stroke.
  `api/keepalive.ts`: the keepalive budget, the "being left" flag and what the savers owe.
- `hooks/useNotebookPage.ts`: load once, edit locally. `useItemSaver`: the background saves and
  their honest status. `usePageEditing`: the editing session, focus and shortcuts.
  `usePageTemplate`: the template, saved with `version`. `useBoardCard`: the page's board card and
  Send page to board. `usePointerDrag`: drags in page units without a render per move.
  `useInkTools`, `useInkInput`, `useStrokeSaver`, `useLasso`: the tool in the hand, the pointer,
  the ink's saves, the lasso's menu. `useAskFromNotebook`: the reader's half of Ask about this.
- S5e: `model/layoutMode.ts`, `model/diveIn.ts`; `hooks/useLayoutMode`, `useDiveIn`,
  `useDiveArrival`, `useThreadFromNotebook`, `useSendPage` (Send page to board's toast) and
  `usePageLinks` (the page's links), both moved out of the view; `components/RailInkOptions.tsx`,
  `PhoneStack.tsx`, `PhoneBar.tsx`, `PageToast.tsx` (the screen's one toast), `phone.css`;
  `model/phone.ts`.
- `components/NotebookView.tsx` (the screen; `NotebookBar.tsx` its top bar, `SaveNotice.tsx`'s
  `PageSaveNotice` its one saving notice), `NotebookPage.tsx` (the bound page),
  `ExchangeBlock.tsx` + `AnswerProse.tsx`, `QuoteCard.tsx`, `NoteItem.tsx` + `NoteEditor.tsx`,
  `ShapeItem.tsx`, `InkLayer.tsx`, `InkSurface.tsx`, `InkTools.tsx`, `LassoLayer.tsx`,
  `LassoMenu.tsx`, `NotebookToolbar.tsx`, `SaveNotice.tsx`, `NotebookPanel.tsx` (+
  `TemplatePicker.tsx`, `NotebookSearch.tsx`), `NotebookPageList.tsx`, `notebook.css` (the page)
  and `panel.css` (the side panel).

Colours are token names (`pen`, `hl-amber`) mapped to `--pt-*`, never hex, so the lamp-lit scheme
re-maps them; the page's own template inks are `--pt-nb-*` in `notebook.css`, for both schemes.
