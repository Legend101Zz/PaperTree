# Contributing to PaperTree

This file covers setup, the dev ports, the gate, the lint and format rules, and how to add a component.
The process contract for agent sessions (issues, worktrees, honesty rules, repo traps) is
[`AGENTS.md`](AGENTS.md); read it too. Where the two disagree, `AGENTS.md` wins.

## Setup

You need Node.js 22, pnpm through Corepack (`corepack enable`), Python 3.12 and
[uv](https://docs.astral.sh/uv/). From the repository root:

```sh
uv sync --locked --all-packages     # BOTH installs are needed; see AGENTS.md §3
pnpm install --frozen-lockfile      # also installs the pre-commit hook (lefthook)
./research/benchmarks/fetch_corpus.sh
./research/benchmarks/fresh/fetch_fresh.sh
cp .env.example .env && echo "PAPERTREE_AGENT_SECRET=$(openssl rand -hex 32)" >> .env
cp apps/web/.env.example apps/web/.env.local
```

The corpus PDFs are fetched, not committed. Without them the reader shows nothing, `next build` fails on
purpose, and the corpus-gated tests skip loudly.

## Running the app

Four processes: the API, the worker, the agent and the web app. The README's
[Quick start](README.md#quick-start) has the exact commands.

| Process | Default port       | Variable                                                |
| ------- | ------------------ | ------------------------------------------------------- |
| web     | 3000               | `next dev -p <port>`                                    |
| API     | 8000               | `PAPERTREE_PORT`, and `NEXT_PUBLIC_PAPERTREE_API_URL`   |
| agent   | 8200               | `PAPERTREE_AGENT_PORT`, and `PAPERTREE_AGENT_URL`       |
| data    | `$HOME/.papertree` | `PAPERTREE_DATA_ROOT` (the API and the worker share it) |

**On the maintainer's machine** ports 3000, 3100, 8000, 8788 and 27018 belong to other apps. Dev servers
there use **127.0.0.1:18900–18909** (for example web 18901, API 18902, agent 18903) and a throwaway data
root. Signal only the processes you started, by PID.

Set `PAPERTREE_AGENT_FAUX=1` on the agent to use the scripted test model: no key, no network, no cost.

## The gate

CI runs every check below on every PR, uncached. Run the same before you push. `pnpm test` alone is not a
gate: turbo caches, and a cache hit reprints a pass it did not run.

```sh
pnpm exec turbo run lint --force        # oxlint (packages), next lint (apps/web), doc lint (packages/ui)
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force
pnpm exec prettier --check .
uv run ruff check packages services
uv run ruff format --check packages services
uv run mypy packages/*/python services/*/python
tools/check-docstrings.sh               # docstrings on Python modules added since v0.2
uv run pytest
pnpm --filter papertree-web build
pnpm e2e                                # Playwright journeys against a faux agent
```

## Lint and format

- **Prettier** formats everything it understands outside `.prettierignore` (`.prettierrc.json`: 100 columns,
  single quotes, trailing commas). Run `pnpm format` to fix. `apps/` is still in the ignore list at the start of
  v0.2; #187 removes it in one mechanical pass.
- **TypeScript packages** (`packages/*`, `services/agent`) lint with **oxlint**. `packages/ui` also runs
  ESLint with `eslint-plugin-jsdoc`, because every export there is shared and must be documented.
- **`apps/web`** lints with **`next lint`** (`apps/web/.eslintrc.cjs`):
  - `next/core-web-vitals`, `jsx-a11y/recommended`, `import/order`, and `jsdoc/require-jsdoc` on exports;
  - `@typescript-eslint/no-explicit-any` is a warning;
  - exported constants (for example Next's `metadata`) are not required to carry a doc comment; functions,
    components, hooks, classes, interfaces and types are;
  - inside `src/features/` every rule is an **error**: docs on every export (with `@param` and
    `@returns` in `.ts` files), import order and accessibility. Outside it, the docs and import rules are
    warnings, so the v0.1 code is not rewritten wholesale. Move code into a feature folder and it is held
    to the full set.
- **Python** lints with **ruff** (`E, F, I, UP, B, SIM`) and **ruff format**, and type-checks with
  **mypy --strict**. Docstrings (ruff `D`, Google convention) are required on every module that is not in
  `tools/docstring-baseline.txt`, so every new module needs them. The baseline lists the modules that
  existed before v0.2 and may only shrink: when you finish documenting one, delete its line.
- **Don't reformat files you aren't changing.** A repo-wide format or lint pass is its own mechanical PR.

### The pre-commit hook

`pnpm install` installs a [lefthook](https://lefthook.dev) pre-commit hook (`lefthook.yml`). It runs
Prettier (and re-stages what it fixed), ESLint, oxlint, ruff and the docstring check on the **staged**
files only. It is a fast courtesy, not the gate: CI still runs everything.

(`prepare` runs `lefthook install || true` so that installing from a copy without a `.git` directory, such as
a release tarball, still works; in a clone, a failed install shows in the `pnpm install` output.)

To bypass it in an emergency, say why in the commit or PR and use either:

```sh
LEFTHOOK=0 git commit ...
git commit --no-verify ...
```

## Code layout

- **`apps/web/src/features/<feature>/`** holds new UI work, one folder per feature:

  ```
  features/<feature>/
    components/   React components, about 250 lines each at most
    hooks/        React hooks
    model/        pure logic with unit tests (no React, no fetch)
    api/          calls to services/api
    index.ts      the feature's public surface
    README.md     what it does, its data flow (UI → store → API → DB), key files
  ```

  Keep pure logic in `model/` so it can be tested without a DOM: trace numbering, shelf layout, the
  diagram layout and lasso hit-testing are examples. Keep functions to about 60 lines.

- **`packages/ui`** holds the shared primitives and the design tokens (`src/styles.css`). Name components
  after the design system (`CallSlip`, `AiSlip`, `TraceList`, `PageTab`, `ShelfRow`, `LabelHolder`,
  `LinkAsPicker`) so the code and the design read the same.
- **Python** lives in `services/*/python` and `packages/*/python`. Schema changes are forward-only SQL
  migrations in `infrastructure/migrations/`, applied by `packages/db/python/papertree_db/migrate.py`.

### Adding a component

1. Decide where it belongs: shared and used by two or more features → `packages/ui`; otherwise the
   feature's `components/`.
2. Start the file with a 2–4 line header comment: what it owns and how it fits its feature.
3. Write a TSDoc block on the component and on its props interface: what it is for and, when usage isn't
   obvious, an `@example`.
4. Use the tokens (`var(--pt-…)`), never a raw colour. Text that is the paper's, the AI's or the person's
   must go through the provenance primitives (`PaperText`, `AiText`, …) so the three voices stay apart.
5. Test behaviour with Testing Library (roles, names, keyboard), not snapshots. Add an axe check for any
   new interactive surface.
6. Check a new component on `/design-system` (`next dev`; a production build needs
   `NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM=on`): add it there in its states.
7. Add a dependency only with a line in the PR (or the ADR) saying why it beats writing it.

### Comments

Comments explain **why**: the invariant, the trap, the issue or ADR number. They don't narrate what the
next line does. Every exported TypeScript symbol has a TSDoc block; every public Python function and
class has a Google-style docstring.

## Tests

- **vitest** for logic and **Testing Library** for components.
- **Playwright** (`e2e/`) for journeys at 1440 and 390 px, plus axe.
- **pytest** for every endpoint and migration. Where a test touches parser output, run it against a real
  parse of a corpus paper, not only a fixture you wrote (AGENTS.md §4).
- A test that needs the corpus PDFs must `describe.skipIf` (or `pytest.skip`) on their absence and say so
  on stdout, naming the fetch script. CI fetches them and fails on any unexpected skip.

## Pull requests

One issue per PR, about 600 changed lines at most. Name the issue (`Closes #NN`) and the acceptance tests
the PR meets, and attach before/after screenshots for UI changes. See AGENTS.md §1 for the rest.
