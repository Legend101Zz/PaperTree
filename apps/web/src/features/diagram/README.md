# diagram

The engraved plate (#217, frames 07a–07c, DESIGN.md §1 "Diagrams", ADR-004 §2.9): a small figure of lettered
parts A–L in the explain panel, each part with the passage it stands on. The reader no longer starts one from a
selection ("Explain with a diagram" left the selection menu in #346: diagrams live inside answers, #339); a
`diagram` thread stored by v0.2 still renders in the panel, and its plate can be redrawn. The backend is S7a
(#216): a `diagram` thread, the `diagram-v1` prompt, parts streamed as SSE `plate` / `part` / `link` events with
each quote already resolved to an Anchor.

## Data flow

UI (a stored diagram thread opened in the explain panel) → controller (`features/explain/hooks/useExplainActions`:
`selectThread`, the stream reader, `redraw`; the plate rides on the panel's message as `diagram`) → `lib/api/threads` →
`GET /papers/{id}/threads/{tid}` and, for a Redraw,
`POST /papers/{id}/threads/{tid}/messages {question, redraw_of}` (`services/api` `routers/threads.py`) → DB
(`ai_diagram_parts` rows, one per part as it arrives; `ai_messages.diagram_json` for the title and links;
migration 0011). The stored read (`GET /papers/{id}/threads/{tid}`, each message's `diagram`) replaces the live
plate once it settles (`features/explain/model/messages.mergeStored`), keyed by letter, so nothing moves.

- **Slots never move.** A part's slot is a function of its letter alone (`model/layout.slotOf`): row A, B, … L
  in one column, so the plate only grows downward. An arrow runs straight down when no part stands between its
  ends, else along a lane to the right. Arrows take the even lanes and feedback `link`s the odd ones, so neither
  moves the other; lanes are assigned first-fit in row order, so a new part never reroutes an old arrow; and two
  arrows never share a lane: past the plate's width the drawing widens (nothing drawn moves). Arrows come only
  from earlier, placed letters.
- **A dropped letter keeps its row.** The API keeps the agent's letters; a part it dropped (an unreadable line, or
  one the table refused) leaves an empty row ("Part C was left out of the plate."), never renumbered. A dropped
  LAST letter leaves no row: nothing after it shows that it was ever there.
- **A part may say where it came from, quietly** (#340): when the part has a passage of the paper behind it (an
  Anchor), its key row ends in "From the paper: p. 4"; a part with none says nothing. No verdict ("cited / not
  verified / inferred"), no marker, no tab, no caption, no hatching difference: every box looks alike. The
  readout is "6 parts · drawn by AI from p. 4" ("so far" while it draws; "drawn by AI" alone when no part has a
  page).
- **The key is the plate's text alternative.** The drawing is `aria-hidden`; each key row is a button named by its
  own words (no `aria-label`), with hidden words for what only the drawing shows: "Part E: … The AI's line. From
  the paper: p. 4. Arrows in from D and A (V). Show in paper." and "Link back to B (again)." for a feedback link.
- **Tap a part** (its box or its key row) and the reader flashes its passage (`ReaderActions.focusAnchor`; the
  flash has no margin tab). A part with nothing to flash says so in a polite live region instead ("Part F has no
  passage in the paper to show.").
- **What the run left out** (the API's writing-phase `status` labels: a skipped line, a dropped arrow) is listed
  under the plate. It is live only: a stored read does not carry it.
- **Stop** (S4d's, on the tab row) freezes the plate: the run is cancelled, the parts that arrived stay
  ("Stopped. The parts that arrived are kept."), nothing is "arriving…" any more. Stop is read before anything
  else: a Stop before the first part (or switching threads, or closing the panel, mid-draw) says "Stopped before
  any part arrived." and draws no plate, never a server failure. The note is a status, and a keyboard Stop hands
  focus to its Retry. A plate that ended with no part is never drawn empty: the exchange shows the failure (or
  S4d's daily-cap card) with Retry; a Retry refused before the stream shows that refusal, and an ask refused
  before the stream is stamped "not sent".
- Plates are numbered among those drawn or drawing: one that ended with no part never takes "Plate 1".
- A diagram thread has no composer: its only next turn is a Redraw (the API answers 422 to a typed follow-up).
- **Send to board** (`ReaderActions.sendToCanvas({kind: 'diagram', messageId, title})`) creates a `diagram` card whose
  `source_diagram_id` is the plate's assistant **message id** (S7a has no separate diagram id: a plate's parts are
  keyed by its message); one plate, one card. The board's card
  (`features/board/components/cards/NotebookCard.tsx` `DiagramCard`) reads the stored plate through
  `useCardSources` (the paper's diagram threads, newest first, once per id) and draws it with `PlateMiniature`, the same
  slot grid, small; before the read lands it claims nothing. The API does not yet check that the id names a plate
  (#277).
- **Redraw** asks for a new plate in the same thread (`redraw_of` the plate): "Redraw the diagram." becomes the new
  exchange's ask and the new plate is Plate 2, with the thread's passage numbers. **Add to notebook** is left out: a
  notebook page holds no diagram item (#276).
- **07d** is information only: a crafted figure "may come later" and is not available yet, with Not now (no job is
  queued in v0.2), under the first finished plate of a thread; Not now is remembered for that plate in this browser.
- A board card says when its plate did not finish ("3 parts · 3 cited · stopped", "· cut short"). Its plate is read
  from the paper's diagram threads four at a time, newest first, once per id.
- While another plate of the thread draws, Redraw is disabled and says "Redraw waits for the plate being drawn.";
  a failed or stopped-empty plate's Retry is held back the same way. A Redraw refused before the stream keeps its
  ask (stamped "not sent") and its Retry sends that same Redraw again, never a new thread.

## The figure inside an answer (v0.3)

A ```diagram fence in an answer is NOT drawn on the slot grid. `model/layered.ts` lays it out as layers:
rank = longest path from a root via `after`, parts of one rank side by side (ordered by barycentre sweeps,
fewest crossings), an arrow that skips rows runs down a virtual lane box so it never crosses a box, arrows leave a
parent's bottom and enter a child's top at spread ports (straight when aligned, else one short elbow), a rank too
wide for the room wraps onto more rows, and a pure chain stays one column. `InlineDiagram` measures its width
(ResizeObserver: ~520 in the Explain panel, ~300 in a board card) and passes it as `maxWidth`; boxes narrow to 100
before a row wraps. `components/LayeredDrawing.tsx` draws it with the plate's classes and tokens but NO key
letters or leader lines; labels with maths (`$…$`, or bare TeX like `√d_k` marked by `model/maths.ts`) are typeset
by `lib/MathText` in a `foreignObject`; the `<svg role="img">` carries a `<title>` and a `<desc>` listing the
parts and arrows in order. The standalone plate (`PlateDrawing`, `layout.ts`) is unchanged. Tests:
`test/diagram-layered.spec.ts` (the ten reviewed fences: no overlap, every arrow parent -> child, none through a
box, fits 520 and 300), `test/diagram-inline.spec.tsx`; `test/diagram-render-fixtures.spec.tsx` writes them as SVG
when `PT_DIAGRAM_SVG_DIR` is set.

## On screen

- `components/DiagramExchange.tsx`: one exchange of a diagram thread: the call slip, the plate, the lines under
  it (notes, usage "(estimate)", stopped / cut short, failure), the tap → flash wiring.
- `components/DiagramPlate.tsx`: the AI tab with "Thinking…" / "Drawing the diagram…" and Stop (the model line
  once done), the empty plate of 07a, then "Plate 1", the title, the drawing beside the key, the readout.
- `components/PlateDrawing.tsx`: the SVG: hairline boxes by kind (input italic, step plain, output double-ruled,
  concept rounded; inferred dashed), hatched shadows from one `<pattern>`, letter circles, arrows, the part
  arriving. `aria-hidden`: the key is the accessible content.
- `components/PlateKey.tsx`: the key rows (buttons), the empty row of a dropped letter, the part arriving.
- `components/PlateActions.tsx`: Send to board (sending / on your board / failed) and Redraw.
  `components/CraftedOffer.tsx`: the 07d offer. `components/PlateMiniature.tsx`: the board card's plate.
- `components/plate.css`: tokens only; parts settle in over 180 ms and simply appear with reduced motion.

## Key files

- `model/layout.ts`: the slot grid. Pure, tested (`layout.spec.ts`: stability under streaming on the recorded
  run, determinism, arrows only from earlier letters, gaps kept, a 12-part plate in well under 16 ms).
- `model/plate.ts`: events → plate, the readout, a part's page, the phase. Pure, tested on the
  recorded faux runs (`plate.spec.ts`). `model/fit.ts`: a box label at 15 or 13 px, on one or two lines, else cut;
  an edge label cut to its lane (`fit.spec.ts`).
- `e2e/v02/stored-plate.spec.ts`: the walk on the faux agent (a stored diagram thread → plate in the panel → tap B → Send to board → the board card).
- `apps/web/test/s7b-plate.spec.tsx`: the panel on recorded SSE frames (`test/fixtures/diagram-plate*.sse`).
