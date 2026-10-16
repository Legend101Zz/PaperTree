# diagram

The engraved plate (#217, frames 07a–07c, DESIGN.md §1 "Diagrams", ADR-004 §2.9): "Explain with a diagram" on
a selection draws a small figure of lettered parts A–L in the explain panel, each part with the passage it
stands on. The backend is S7a (#216): a `diagram` thread, the `diagram-v1` prompt, parts streamed as SSE
`plate` / `part` / `link` events with each quote already resolved to an Anchor.

## Data flow

UI (the selection toolbar's "Explain with a diagram" → `components/reader/SourcePane` →
`ReaderActions.explainWithDiagram`) → controller (`components/explain/useExplainActions`: `openDiagram`, the
stream reader, `redraw`; the plate rides on the panel's message as `diagram`) → `lib/api/threads` →
`POST /papers/{id}/threads {kind: "diagram", anchor}` and, for a Redraw,
`POST /papers/{id}/threads/{tid}/messages {question, redraw_of}` (`services/api` `routers/threads.py`) → DB
(`ai_diagram_parts` rows, one per part as it arrives; `ai_messages.diagram_json` for the title and links;
migration 0011). The stored read (`GET /papers/{id}/threads/{tid}`, each message's `diagram`) replaces the live
plate once it settles (`features/explain/model/messages.mergeStored`), keyed by letter, so nothing moves.

- **Slots never move.** A part's slot is a function of its letter alone (`model/layout.slotOf`): row A, B, … L
  in one column, so the plate only grows downward. An arrow runs straight down when no part stands between its
  ends, else along a lane to the right; feedback `link`s use their own lanes from the right edge in, so a link
  never moves an arrow and a later part never moves a link. Lanes are assigned first-fit in row order, so a new
  part never reroutes an old arrow. Arrows come only from earlier, placed letters.
- **A dropped letter keeps its row.** The API keeps the agent's letters; a part it dropped leaves an empty row
  ("Part C not drawn: its line could not be read"), never renumbered.
- **Every part says where it stands** (DESIGN.md §4): **cited** (the quote is word for word in the passage:
  marker, solid tab, the quote in the paper's voice), **not verified** (near a passage: dashed marker and tab;
  or found nowhere: no marker, "not verified · not found in the paper"; either way the quote is the AI's, never
  shown in the paper's voice), or **inferred** (no quote: a dashed box, "Inferred, no passage", the AI's own
  line). The readout counts them from the data: "6 parts · 5 cited · drawn by AI from p. 4" ("so far" while it
  draws; a not-verified part is counted in words).
- **Passage numbers** are the thread's (`model/plate.numberPlatePassages`): 1..k in the order the plates first
  stand on a passage (keyed by the Anchor's block), so two parts on one paragraph share a marker and a Redraw's
  plate keeps the same numbers.
- **Tap a part** (its box or its key row) and the reader flashes its passage (`ReaderActions.focusAnchor`, with
  `from.part`, so the margin tab says "from part C, Scale ÷ √dk"). A part with nothing to flash says so in a
  polite live region instead.
- **What the run left out** (the API's writing-phase `status` labels: a skipped line, a dropped arrow) is listed
  under the plate. It is live only: a stored read does not carry it.
- **Stop** freezes the plate: the run is cancelled, the parts that arrived stay ("Stopped. The parts that arrived
  are kept."), nothing is "arriving…" any more. A plate that ended with no part is never drawn empty: the
  exchange shows the failure (or the daily-cap card) with Try again.
- A diagram thread has no composer: its only next turn is a Redraw (the API answers 422 to a typed follow-up).

## On screen

- `components/DiagramExchange.tsx`: one exchange of a diagram thread: the call slip, the plate, the lines under
  it (notes, usage "(estimate)", stopped / cut short, failure), the tap → flash wiring.
- `components/DiagramPlate.tsx`: the AI tab with "Thinking…" / "Drawing the diagram…" and Stop (the model line
  once done), the empty plate of 07a, then "Plate 1", the title, the drawing beside the key, the readout.
- `components/PlateDrawing.tsx`: the SVG: hairline boxes by kind (input italic, step plain, output double-ruled,
  concept rounded; inferred dashed), hatched shadows from one `<pattern>`, letter circles, arrows, the part
  arriving. `aria-hidden`: the key is the accessible content.
- `components/PlateKey.tsx`: the key rows (buttons), the empty row of a dropped letter, the part arriving.
- `components/plate.css`: tokens only; parts settle in over 180 ms and simply appear with reduced motion.

## Key files

- `model/layout.ts`: the slot grid. Pure, tested (`layout.spec.ts`: stability under streaming on the recorded
  run, determinism, arrows only from earlier letters, gaps kept, a 12-part plate in well under 16 ms).
- `model/plate.ts`: events → plate, verdicts, readout, passage numbers, tabs, the phase. Pure, tested on the
  recorded faux runs (`plate.spec.ts`).
- `apps/web/test/s7b-plate.spec.tsx`: the panel on recorded SSE frames (`test/fixtures/diagram-plate*.sse`).
