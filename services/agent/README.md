# @papertree/agent

The small Node service that runs PaperTree's AI through the **Pi SDK** (ADR-002 §3.4): Node 22, Pi
pinned exactly, MiniMax-M3, and four read-only paper tools served back by `services/api` under a
per-run token. `services/api` is the only public edge; this service binds `127.0.0.1` and is called
only by the API (`POST /v1/runs`, SSE). The contract is `contracts.md` §3 and §4 in the reader-release
architecture pack.

**Status: manifest only.** S0 adds this package, its exact pins and this README so the lockfile is
settled before the parallel slices start. There is **no source yet**; S5 writes it. Until then:

```sh
pnpm --filter @papertree/agent start   # prints "S5 implements this" and exits 0; starts nothing
pnpm --filter @papertree/agent test    # prints "S5 implements this" and exits 0; runs 0 tests
```

## Pins

| Package                           | Version  | Why exact                                                             |
| --------------------------------- | -------- | --------------------------------------------------------------------- |
| `@earendil-works/pi-coding-agent` | `0.87.1` | Pi is pre-1.0; a faux-provider suite guards every bump (S5).          |
| `@earendil-works/pi-ai`           | `0.87.1` | Bumped together with pi-coding-agent, never alone (spike §11).        |
| `typebox`                         | `1.3.27` | The tool-parameter schemas; the version Pi itself pins.               |
| `ajv` (dev)                       | `8.20.0` | Validates emitted events against `contracts/agent/*.schema.json`.     |

`engines.node` is `>=22.19` (Pi's own floor); the repo pins Node 22.23.

## Install check (S5 acceptance item 1), measured in S0

Measured on `s0/web-foundations` after `pnpm install`, Node 22.23.0, pnpm 10.15.1:

- `pnpm --filter @papertree/agent ls --depth 3 @earendil-works/pi-ai` lists pi-ai **0.87.1** three
  times (direct, under pi-coding-agent, under pi-agent-core), and all three resolve to **one**
  directory in the store (`@earendil-works+pi-ai@0.87.1_ws@8.21.3_zod@3.25.76`, same realpath). So:
  exactly one pi-ai 0.87.1.
- Importing the installed package's `.` export under a network-denying `sandbox-exec` profile, with
  no key and `PI_OFFLINE=1`, exits 0 and finds `createAgentSession`, `ModelRuntime.create`,
  `SettingsManager.inMemory` and `SessionManager.inMemory`; `~/.pi` was not modified.
- **pnpm ignores the `npm-shrinkwrap.json` that pi-coding-agent publishes** (npm honours it). Against
  that shrinkwrap: every `@earendil-works/*` package, `@anthropic-ai/sdk`, `openai`, `undici`,
  `typebox`, `@google/genai`, `jiti`, `yaml` and `esbuild` resolve to the **same** versions, but 26
  deeper transitive packages drift by patch versions (mostly the AWS Bedrock client's `@aws-sdk/*`,
  plus `ws` 8.21.0 → 8.21.3, `gaxios`, `google-auth-library`, `lru-cache`). None is on the
  MiniMax/Anthropic-messages path the service uses, but it is not byte-for-byte the spike's tree.
- pnpm blocks two install scripts in this tree, `@google/genai` and `protobufjs`; the import check
  above passed with them blocked.

Whether that drift is acceptable, or the fallback is taken (a standalone `npm ci` with its own
`package-lock.json`, `services/agent` excluded from the pnpm workspace; contracts.md §3.1), is **S5's
decision**, recorded here when it is made.

## Configuration (contracts.md §7; the agent's rows)

| Variable                                               | Default                 | Notes                                                        |
| ------------------------------------------------------ | ----------------------- | ------------------------------------------------------------ |
| `PAPERTREE_AGENT_PORT`                                 | `8200`                  | binds `127.0.0.1` only                                       |
| `PAPERTREE_AGENT_SECRET`                               | **required**            | shared with the API (`X-PaperTree-Agent-Secret`)             |
| `PAPERTREE_MINIMAX_API_KEY`                            | **required**            | agent only; never `MINIMAX_API_KEY`, which is deleted at boot |
| `PAPERTREE_API_INTERNAL_URL`                           | `http://127.0.0.1:8000` | tool base (the API also sends `tool.base_url` per run)       |
| `PI_OFFLINE=1`, `PI_TELEMETRY=0`, `PI_CODING_AGENT_DIR` | set by the start script | defence in depth                                             |
