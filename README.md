# PaperTree

A research-paper reader. Upload a PDF, read the real pages, highlight passages, ask questions that an AI
answers from the paper with citations that jump back to the exact passage, and keep a canvas for your own
thinking.

This is v0.1: a local, single-machine app. There is no hosted version and no Docker setup.

## How it fits together

- **Web** (`apps/web`): Next.js 14. The browser talks to the API and to nothing else.
- **API** (`services/api`): FastAPI, the only public edge. Accounts, uploads, the paper store, the AI runs.
  Data lives in one SQLite file plus a few folders under the data root.
- **Worker** (`python -m papertree_api.worker`): parses uploaded PDFs with PyMuPDF into the paper's
  structure (sections, blocks, figures, tables, equations) while you wait. It shares the API's data root.
- **Agent** (`services/agent`): a small Node service that runs the AI through the Pi SDK against MiniMax.
  It binds `127.0.0.1`, is called only by the API, and is the only process that ever holds the MiniMax key.

## Prerequisites

- Node.js 22.x (CI pins 22.23.0; see `.nvmrc`)
- pnpm, through Corepack: `corepack enable` (the version is pinned by `packageManager` in `package.json`)
- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- A MiniMax API key for the AI features. Without one you can still upload, read, highlight and use the
  canvas; every AI request fails visibly.
- A current Chromium-based browser or Firefox

## Quick start

Run these from the repository root. You need four terminals, one per process; use the default ports
(8000, 8200, 3000) unless something else on your machine already uses them.

**1. Clone and install** (once):

```sh
git clone https://github.com/Legend101Zz/PaperTree.git
cd PaperTree
git checkout v0.1.0   # the release this README describes
corepack enable
uv sync --locked --all-packages
pnpm install --frozen-lockfile
```

**2. Configure** (once):

```sh
cp .env.example .env
echo "PAPERTREE_AGENT_SECRET=$(openssl rand -hex 32)" >> .env
cp apps/web/.env.example apps/web/.env.local
```

`.env` holds everything except the model key; the API, the worker and the agent each load it with the
`source` line below. The key is never put in this file.

**3. Start the four processes**, one per terminal:

```sh
# terminal 1: API (http://127.0.0.1:8000)
set -a; source .env; set +a
uv run python -m papertree_api
```

```sh
# terminal 2: worker (parses uploads; same data root as the API)
set -a; source .env; set +a
uv run python -m papertree_api.worker
```

```sh
# terminal 3: agent (http://127.0.0.1:8200). The key goes to this process only.
set -a; source .env; set +a
read -rs MINIMAX_KEY        # paste your MiniMax key, press Enter (nothing is echoed)
PAPERTREE_MINIMAX_API_KEY="$MINIMAX_KEY" pnpm --filter @papertree/agent start
```

```sh
# terminal 4: web (http://127.0.0.1:3000)
pnpm --filter papertree-web dev -H 127.0.0.1
```

(`-H 127.0.0.1` keeps the dev server off your network; without it Next.js listens on every interface.)

**4. Open the app** at **http://127.0.0.1:3000** (not `localhost`; see Troubleshooting). Register an
account, then "Choose PDFs" to upload one. When its card shows "Ready", open it, select a sentence and use
the toolbar: Highlight, Ask (opens the Explain panel; its citation chips jump back to the passage) or
Send to canvas (puts the passage on that paper's canvas, reachable from the "Canvas" link in the reader).

Check that everything is up: `curl http://127.0.0.1:8000/healthz` and `curl http://127.0.0.1:8200/healthz`
(the agent's reply names the model per kind and says `key_present: true`).

Start the web app with `pnpm`, not `next dev` directly. Its `predev` step copies the pdf.js worker into
`apps/web/public/`; without it every PDF fails with "This PDF could not be opened".

Your data is in `~/.papertree` (SQLite, uploaded PDFs, extracted figures). Delete that folder to start
clean; set `PAPERTREE_DATA_ROOT` to keep it elsewhere.

## Configuration

Exactly the variables below exist (`.env.example` and `apps/web/.env.example` are this table; the contract
is `research/build/reader-release/contracts.md` section 7). Everything is optional except the secret and
the key.

| Variable                                                    | Read by        | Default                 | Notes                                                                                          |
| ----------------------------------------------------------- | -------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `PAPERTREE_DATA_ROOT`                                       | api, worker    | `~/.papertree`          | SQLite plus `uploads/ assets/ staging/`; the API and the worker must share it                  |
| `PAPERTREE_HOST`, `PAPERTREE_PORT`                          | api            | `127.0.0.1`, `8000`     |                                                                                                |
| `PAPERTREE_SESSION_HOURS`                                   | api            | `24`                    | login lifetime                                                                                 |
| `PAPERTREE_MAX_UPLOAD_MB`                                   | api            | `100`                   | larger uploads are refused with 413                                                            |
| `PAPERTREE_SIGNING_SECRET`                                  | api            | random per boot         | asset URL signing; a restart invalidates open asset URLs unless you set it                     |
| `PAPERTREE_AGENT_URL`                                       | api            | `http://127.0.0.1:8200` | where the API reaches the agent                                                                |
| `PAPERTREE_AGENT_SECRET`                                    | api, agent     | **required for AI**     | shared secret; the API answers 503 `not_configured` without it and the agent refuses to boot   |
| `PAPERTREE_DAILY_BUDGET_USD`                                | api            | `1.00`                  | per-user AI spend cap over a rolling 24 h, from `ai_runs.cost_usd_est`                         |
| `PAPERTREE_CORS_ORIGINS`                                    | api            | empty                   | extra browser origins beyond `http://localhost:*` and `http://127.0.0.1:*`                     |
| `PAPERTREE_AGENT_PORT`                                      | agent          | `8200`                  | binds `127.0.0.1` only                                                                         |
| `PAPERTREE_API_INTERNAL_URL`                                | agent          | `http://127.0.0.1:8000` | the API origin the agent fetches paper tools from                                              |
| `PAPERTREE_MINIMAX_API_KEY`                                 | **agent only** | **required**            | read once, then removed from the agent's environment; never `MINIMAX_API_KEY`                  |
| `PAPERTREE_MODEL`                                           | agent          | per kind, see below     | one model for every kind: `MiniMax-M3` or `MiniMax-M3.1-Flash-Preview`                         |
| `PAPERTREE_MODEL_EXPLAIN`, `_ASK`, `_SUMMARY`               | agent          | `PAPERTREE_MODEL`       | the model for one kind                                                                         |
| `PAPERTREE_MODEL_EFFORT` (+ `_EXPLAIN`, `_ASK`, `_SUMMARY`) | agent          | `low`                   | Flash only: `low`, `medium` or `high`                                                          |
| `PAPERTREE_AGENT_LOG_LEVEL`                                 | agent          | `info`                  | `debug` adds raw provider error text; keys and tokens are never logged                         |
| `PAPERTREE_AGENT_FAUX`                                      | agent          | unset                   | `1` = a scripted test model with canned answers (the e2e suite uses it); not for real use      |
| `PI_OFFLINE`, `PI_TELEMETRY`, `PI_CODING_AGENT_DIR`         | agent          | set by the agent        | defence in depth; do not set them                                                              |
| `NEXT_PUBLIC_PAPERTREE_API_URL`                             | web            | `http://localhost:8000` | the API origin as the browser reaches it; `apps/web/.env.example` sets `http://127.0.0.1:8000` |
| `NEXT_PUBLIC_PAPERTREE_FIXTURES`                            | web            | `off`                   | `on` only in tests and demos                                                                   |

To use a different port for the web app, set `PORT` (for example `PORT=3001 pnpm --filter papertree-web dev`).
If you move the API, change `PAPERTREE_PORT`, `PAPERTREE_API_INTERNAL_URL` and
`NEXT_PUBLIC_PAPERTREE_API_URL` together; if you move the agent, change `PAPERTREE_AGENT_PORT` and
`PAPERTREE_AGENT_URL`.

## Model policy

The agent decides which MiniMax model answers which kind of request (ADR-003). Shipped defaults:
**explain** runs on `MiniMax-M3.1-Flash-Preview` at effort `low` (first text in about 2 s at the median in
our A/B); **ask** (and its follow-ups) and **summary** run on `MiniMax-M3` (in the v0.1 quality panel
Flash's ask follow-ups cited a wrong passage nine times against none for M3, and Flash's summaries came
out with uncited bullets). `PAPERTREE_MODEL=MiniMax-M3` puts every kind on M3, and
`PAPERTREE_MODEL_ASK=MiniMax-M3.1-Flash-Preview` puts ask back on Flash. MiniMax publishes no price for Flash, so
the cost figures recorded in `ai_runs` for Flash runs are an estimate on M3's rates, and the agent's
`/healthz` says so (`cost_basis`). Every AI run records its model, tokens, estimated cost, latency and code
path in the `ai_runs` table. The evidence, including what is worse about Flash, is in
`research/architecture-decisions/ADR-003-model-policy.md` and `docs/release/v0.1/MODEL-AB.md`.

## Tests and gates

The commands CI runs (from the repository root; `.github/workflows/ci.yml` is authoritative):

| Gate          | Command                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codegen drift | `pnpm run codegen`, then the working tree must be unchanged                                                                                               |
| TypeScript    | `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`                                                                                                    |
| Python        | `uv run pytest`, `uv run ruff check packages services`, `uv run ruff format --check packages services`, `uv run mypy packages/*/python services/*/python` |
| Prettier      | `pnpm exec prettier --check .`                                                                                                                            |
| Web build     | `pnpm --filter papertree-web build`                                                                                                                       |
| End to end    | `pnpm e2e` (Playwright; starts its own API, worker, web and a faux agent on free ports)                                                                   |

Some gates need the benchmark PDFs, which are fetched rather than committed:
`./research/benchmarks/fetch_corpus.sh` and `./research/benchmarks/fresh/fetch_fresh.sh`. That includes the
web build: its `prebuild` step copies fixtures made from the corpus and fails without them. `pnpm e2e` also
needs a Chromium: `pnpm exec playwright install chromium`. The live journey (real MiniMax) is a separate CI
job gated on the `run-live` label; it is not part of a normal run. A few timing tests (`test_30k_*`) are
wall-clock bounds and can flake on a loaded machine: re-run them alone before diagnosing.

## Troubleshooting

- **The page is zoomed or looks wrong on `localhost`.** Chrome keeps a saved zoom level per host name.
  Browse `http://127.0.0.1:3000` instead.
- **"This PDF could not be opened".** The web app was started with `next dev` instead of
  `pnpm --filter papertree-web dev`, so the pdf.js worker was never copied. Restart it with pnpm.
- **Port already in use.** Something else owns 8000, 8200 or 3000 (3000 is a common one). Pick other ports
  as described under Configuration; the four processes only need to agree with each other.
- **Uploads stay "processing".** The worker is not running, or it was started with a different
  `PAPERTREE_DATA_ROOT` than the API. Both load `.env`; do not override one of them.
- **Explain answers "AI explanations are not configured" (503).** `PAPERTREE_AGENT_SECRET` is missing in the
  API's environment. Re-run the `echo ... >> .env` line, then restart the API and the agent.
- **The agent exits at boot** with one `agent.boot.refused` line naming the problem: usually
  `PAPERTREE_AGENT_SECRET` or `PAPERTREE_MINIMAX_API_KEY` is unset. An ambient `MINIMAX_API_KEY` is not
  used: the agent deletes it at boot and reads only `PAPERTREE_MINIMAX_API_KEY`.
- **Where the key goes.** To the agent process only, inline on its start command. If you put it in `.env` it
  is also loaded into the API and the worker, which must not hold it.
- **Daily budget reached.** AI requests are refused once your estimated spend in the last 24 h passes
  `PAPERTREE_DAILY_BUDGET_USD`; the refusal says so.
- **Reset everything.** Stop the four processes, delete the data root (`~/.papertree` by default).

## Docs that matter

- `research/architecture-decisions/ADR-002-reader-release.md`: the architecture and why
- `research/architecture-decisions/ADR-003-model-policy.md` and `docs/release/v0.1/MODEL-AB.md`: models
- `research/build/reader-release/contracts.md`: the normative wire, database and environment contracts
- `contracts/README.md`: the generated JSON schemas
- `services/agent/README.md`: the agent service
- `AGENTS.md`: working rules and hazards for contributors and coding agents
- `docs/release/v0.1/PLAN.md`: the v0.1 release plan
- `archive/README.md`: the retired v1 code, kept for reference and not part of the build
