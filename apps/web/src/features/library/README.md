# library

The signed-in library at `/dashboard` (#195, frames 00 and 01): the papers stand as cloth spines on one walnut
plank, a row per group, each row under a brass label holder. A spine shows its state: a red ribbon while you are
reading it, a kraft wrap while we read it, a torn red label when we could not. A click or Enter on a spine opens
its catalogue card in the band above the shelf, with Read, Retry (failed papers) and Delete (confirmed inline).

The shelf is one tab stop: ←/→ walk along it, Home and End jump to its ends. A search (wired in the header,
part 2 of #195) dims what does not match and lights what does, without reordering anything.

## Data flow

`LibraryView` → `useLibrary` (TanStack Query, key `['papers']`) → `papersApi` (`lib/api/papers.ts`) →
`GET /papers`, `POST /papers`, `POST /papers/{id}/retry`, `DELETE /papers/{id}` (services/api) → SQLite.
The list is polled every 2 s only while a paper is queued or being read. Each row becomes a `LibraryBook`
(the v0.1 view model plus S2a's `year`, `reading` and `arxivCategory`); `model/shelf.ts` turns books into
rows and spines. Nothing is invented: no topic puts a paper under "Unshelved", no reading state means no
ribbon, no year means no year on the spine.

## Choices the owner may change

- **Cloth without a topic** (`clothFor`): cs.CL → transformers, cs.CV → vision, cs.LG and stat.ML →
  generative, math.OC and cs.NE → optimization, cs.IR → language, cs.AI / cs.RO / cs.MA → reinforcement;
  another category takes a stable cloth by hash, no category the slate cloth.
- **Spine width**: `26 + 0.85 × pages` px (fitted to frame 01), capped at 48; 40 while the page count is
  unknown or the paper is still being read, so the count arriving mid-parse does not reflow the shelf.
- **Order within a row**: shelving order (when added) for Topic; Year rows by title; Title A–Z; Recently
  opened most recent first.

## Key files

- `model/shelf.ts`: arrangements, spine width, height, title, author line, state, name, cloth, search
  matching, the arrow-key step (pure; tested in `model/shelf.spec.ts`).
- `hooks/useLibrary.ts`: the data layer (query, polling, upload, cancel, retry, delete).
- `components/Shelf.tsx`, `Spine.tsx`, `ShelfPlank.tsx`: the shelf; `CatalogueCard.tsx`: the card;
  `LibraryView.tsx`: the page; `library.css`: their styles, from the tokens.
- Tests: `apps/web/test/library-shelf.spec.tsx`, `s3-library-states.spec.tsx`, `w2ui-library.spec.tsx`.
