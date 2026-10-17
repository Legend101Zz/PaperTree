# apps/web/src/features

One folder per feature of the v0.2 UI (library, book, reader, explain, notebook, board, diagrams…). Each
has `components/`, `hooks/`, `model/` (pure, unit-tested logic), `api/`, an `index.ts` that is its public
surface, and a `README.md` with what it does, its data flow (UI → store → API → DB) and its key files.

Everything here is linted at the strictest level (`apps/web/.eslintrc.cjs`): docs on every export, import
order and accessibility are errors. Shared primitives and tokens live in `packages/ui`, not here. See
[`CONTRIBUTING.md`](../../../../CONTRIBUTING.md#code-layout).
