# PaperTree v1

This directory is PaperTree v1. It is retained only so a behaviour question about the deployed
product can be answered, and it is scheduled for deletion once v2 has been in production for one
month.

**Do not read it. Do not import from it. Do not fix bugs in it.** Nothing here is on any code path
v2 executes. It is excluded from every workspace, from `testpaths`, from `ruff`, from `mypy` and
from `tsconfig`. If you are here because a grep matched, the match is a false positive — go back.

The one legitimate reason to open a file here: you need to know what the v1 product *did*, because
a user is asking why v2 behaves differently. Read the one file, answer the question, leave.

---

## What is in here

| Path | What | Lines |
|---|---|---|
| `v1-api/` | The whole v1 FastAPI application — MongoDB, its own JWT, its own extractor, its own four LLM clients. Moved intact, `pyproject.toml` / `uv.lock` / `Dockerfile` included, so it still runs from here. | 4,449 Python |
| `v1-web-canvas/` | The v1 canvas surface, lifted out of `apps/web/src`. | 2,181 TS/TSX |
| `v1-audits/` | The four `research/audit-*.md` files. They document v1, so they belong beside it. | 551 Markdown |

`v1-web-canvas/` is flattened deliberately — the files came from four different places under
`apps/web/src` and preserving that shape would invite someone to move them back:

| here | was |
|---|---|
| `components-canvas/` | `apps/web/src/components/canvas/` |
| `route-paper-id-canvas/` | `apps/web/src/app/paper/[id]/canvas/` |
| `useCanvas.ts` | `apps/web/src/hooks/useCanvas.ts` |
| `canvasStore.ts` | `apps/web/src/store/canvasStore.ts` |
| `types-canvas.ts` | `apps/web/src/types/canvas.ts` |

`canvasStore.ts` and `types-canvas.ts` are **not** on #75's move list. They came anyway because
`canvasStore.ts`'s only two importers were `PaperCanvas.tsx` and `useCanvas.ts`, and leaving it
behind would have been 134 lines of new dead code under `src/store/`, which `reachable.spec` does
not scan and so would never have reported. `types-canvas.ts` was additionally imported by
`apps/web/src/lib/api.ts` for the `canvasApi` block; that block had no importer outside this
directory and was deleted with the rest.

## Two things deleted rather than archived

* **`apps/api/.venv`** — 121 MB of gitignored build output. Recreate with `uv sync` inside
  `v1-api/` if you ever genuinely need to run v1.
* **`apps/web/package-lock.json`** — 356 KB. `pnpm-workspace.yaml`'s own comment said Epic 2
  deletes it "when v1 stops being deployable from `apps/web`"; that is now.

## What still points here, and what does not

Nothing in v2 imports from this directory. Three files outside it still *name* it, and all three are
about running v1, not about building v2: `docker-compose.yml`, the root `README.md`'s backend
section, and `.gitignore`'s rule for v1's uploaded PDFs.

One test used to read `v1-api/papertree_api/config.py` — it compared v1's provider constants against
`packages/agent-tools`' copy to catch drift between two live definitions. It was removed rather
than re-pointed at this directory: **a test that reads `archive/` would make `archive/`
load-bearing, which is the one thing this file forbids.** Replacing it turned up two *further*
live copies inside `services/document-worker`, which nobody had been checking at all — that is #88,
and the replacement test pins them in a ledger.

## When this can be deleted

One month after v2 is in production. At that point `git rm -r archive/` and delete this README; the
history keeps everything, and `git log --follow` still works on any file that was moved rather than
rewritten.
