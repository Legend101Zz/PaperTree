# highlights

What v0.2 adds around the reader's highlights. The highlights themselves (load, create, colour, note, delete,
the resolution cache) are still `components/reader/useHighlights.ts`; moving them here is a later split.

## Data flow

UI (`HighlightCard` → Delete) → `useHighlights.remove` → `DELETE /papers/{id}/highlights/{hid}` → DB (the row,
its anchors and their cache entries cascade). The hook keeps the deleted highlight as `removed` while
`HighlightUndoToast` ("Highlight deleted", Undo) is up. **Undo** (`restore`) re-POSTs it from what the page
held: the same `highlight_id`, colour, note and stored Anchors (so it paints from the same quads), with the
current parse's resolutions. A failed restore stays on the page "not saved" with Retry, like any create. A
delete of a highlight whose create is still in flight offers no Undo (it is deleted when the create answers).
The server gives a restored row a new `created_at`, so it keeps its id, colour, note and Anchors but moves to the
end of the creation order. Only the last delete can be undone.

Focus moves to Undo when the toast appears (the card that held Delete is gone), which also holds the toast
until the reader acts or moves on; when it goes, focus returns to where it was, else to the paper's pages. The
toast sits above the explain sheet on a phone (`bottomInset`, measured) and beside the drawer on a wide screen,
and a reader notice shown at the same time lifts above it (CSS in `packages/ui`).

## Key files

- `components/HighlightUndoToast.tsx`: the toast, mounted once by `ReaderWorkspace`.
