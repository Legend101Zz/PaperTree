# @papertree/agent

The small Node service that runs PaperTree's AI through the **Pi SDK** (ADR-002 §3.4; contracts.md
§3–§4): Node 22, Pi pinned exactly, MiniMax-M3, and four read-only paper tools served back by
`services/api` under a per-run token. `services/api` is the only public edge; this service binds
`127.0.0.1` and is called only by the API (`POST /v1/runs`, SSE).

```sh
pnpm --filter @papertree/agent start   # node --experimental-strip-types src/server.ts
pnpm --filter @papertree/agent test    # the offline suite (network denied) + the M5/M6 mutants
pnpm --filter @papertree/agent test:mutants   # every mutant (M5, M6, G1–G13), ~4 min
```

## Configuration (contracts.md §7, the agent's rows)

| Variable                     | Default                 | Notes                                                                                   |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `PAPERTREE_AGENT_SECRET`     | **required**            | shared with the API (`X-PaperTree-Agent-Secret`); boot refuses without it              |
| `PAPERTREE_MINIMAX_API_KEY`  | **required**            | unless faux mode; read once, then removed from `process.env`; never `MINIMAX_API_KEY`  |
| `PAPERTREE_AGENT_PORT`       | `8200`                  | binds `127.0.0.1` only                                                                  |
| `PAPERTREE_API_INTERNAL_URL` | `http://127.0.0.1:8000` | a run's `tool.base_url` must be on this origin, so a run token is never sent elsewhere |
| `PAPERTREE_AGENT_FAUX`       | unset                   | `1` = the scripted test model (below); the key is not read                              |
| `PAPERTREE_AGENT_LOG_LEVEL`  | `info`                  | `debug` adds raw provider error text (§3.3); keys and tokens are never logged          |

Set by the service itself before any Pi code runs: `PI_OFFLINE=1`, `PI_TELEMETRY=0`,
`PI_CODING_AGENT_DIR` = a new empty directory it owns (mode 0700, removed at exit), and
`MINIMAX_API_KEY` deleted (Pi's ambient key fallback, which the in-memory credential store does not
block — spike-verify S4a).

Boot refuses to start (exit 1, one `agent.boot.refused` log line naming the problem, never a value)
unless: the secret (and the key, outside faux mode) is set; the environment is the one above; the
installed pi-coding-agent and pi-ai are both 0.87.1; and a probe session built by the same
`createPaperSession()` every run uses has exactly the tools
`get_outline, get_section, get_passage, search_passages` (registered AND active), `defaultTools: []`,
compaction off, cache warming off, telemetry off and the §3.1 retry settings.

## HTTP

| Route                     | What                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST /v1/runs`           | secret required; body = `contracts/agent/run-request.schema.json`, validated against that FILE at runtime; `200 text/event-stream` |
| `DELETE /v1/runs/{id}`    | abort; `204`, idempotent (a finished run is `204` too); `404` for a run id never seen                   |
| `GET /healthz`            | `{ok, sdk, pi_ai, model, key_present, wiring_ok, active_runs, faux}`; no auth, no secrets              |

Errors before the stream starts are the §0 envelope `{detail, code, retryable}`: 401 `auth_required`,
413 `payload_too_large` (a body over 8 MB; the answer is delivered — the rest of the body is read
and thrown away — and an `Expect: 100-continue` client gets it instead of the 100), 422
`validation_failed` (the detail names the field), 409 `busy` (a run is
live on this thread, or the run id was already used), 404/405 `not_found`.

## What a run does

`src/session.ts` — `createPaperSession()`, the ONLY `createAgentSession` call. Every boundary Pi
would discover from disk is supplied: in-memory `ModelRuntime` (no auth.json, no models.json, no
catalog network), an empty `ResourceLoader`, `SettingsManager.inMemory({defaultTools: [], …})`,
`SessionManager.inMemory("/", {id}, entries)`, `cwd: "/"`, the tools allowlist plus the four custom
tools, a model copy with `maxTokens = limits.max_output_tokens`, `thinkingLevel: "low"`. Prompts go
through one method that refuses a disposed session and always passes `expandPromptTemplates: false`.

`src/run.ts` — Pi's events become the §3.2 stream, under the §3.3 host guards:

- **Tool cap**: counted at `tool_execution_start`; past `max_tool_calls` a tool answers
  `Tool budget exhausted; answer from what you have.` without calling the API; at cap + 2, or past
  `max_turns`, the run is aborted → `tool_budget_exhausted`.
- **Idle watchdog** (reset on every session event) and **deadline**
  (`AbortSignal.any([AbortSignal.timeout(deadline_ms), client gone])`) → `timeout` / `aborted`.
- **Classification** is the agent's own (`src/classify.ts`, the §3.3 table). Pi's auto-retry is
  vetoed for anything the agent would not retry, so a 400 whose text contains "500" is not retried.
- **Text**: only an answer reaches the caller. A message's text is held until it proves to be an
  answer — it carries a `[bN]` marker, or the message ends with anything but `toolUse` — then it
  streams live. Narration before a tool call ("Let me search…") is dropped. The deltas sent are
  exactly `done.final_text`. Once any text has been sent the tools are closed: a later tool call is
  refused (not run, not counted, no `status: tool`; the model is told to finish from what it has,
  and `agent.tool` logs `status: "refused_after_text"`), so no tool step ever follows the first
  delta. A message that cites and then asks for a tool keeps its text — the reader already has it —
  and the answer continues in the next message after a blank line.
- **Citations**: `markers` are the §3.2 regex over `final_text`, restricted to handles issued in THIS
  run (the seed, then each tool response in call order); an invented marker is logged
  (`agent.run.done.unseen_markers`).
- **History**: `done.entries` is the conversation as the model will see it next — the message
  entries (user, assistant, toolResult) of Pi's session projection, re-chained. An aborted or failed
  turn with no text hands back the entries from BEFORE its prompt, so a cancelled task is not resumed.
- **Logs** (§8): one JSON line per event — `agent.run.start`, `agent.tool`, `agent.retry`,
  `agent.run.abort`, `agent.run.done` — with `run_id` and `request_id`. Registered secrets (the key,
  the agent secret, each run token) are scrubbed from every line as a second layer.

`src/tools.ts` — the four tools call `tool.base_url + /outline | /sections/{h} | /passages/{h} |
/search` with `Authorization: Bearer <run token>`, TypeBox parameters (matching
`contracts/agent/internal-tools.schema.json`), and hand the model the API's (datamarked) text verbatim.
An unknown handle (404) tells the model `Passage bN is not available.`; an unusable tool route (401,
5xx, unreachable, a body that is not the §4 shape) ends the run `tool_failed`. Tool errors never carry
a URL, id, status or stack.

## Faux mode (`PAPERTREE_AGENT_FAUX=1`: tests and e2e only)

A scripted model registered in the same `ModelRuntime`, so a faux run goes through the same
`createPaperSession()`, Pi loop, tools and guards; only the model is scripted, in memory, with no key
and no socket. By default it answers from what the run gave it: an explain/ask with seed passages
quotes the first passages and cites them; a summary calls `get_outline` and writes one bullet per
outline handle; an ask without a seed calls `search_passages`. A question containing
`[faux:<name>]` selects a scripted failure for e2e error paths: `auth-error`, `upstream-503`,
`stall`, `slow`, `tool-loop`. The tests replay the eight `contracts/agent/fixtures/*.sse` recordings
as faux scripts and assert the agent emits them (`test/fixtures.test.ts`).

## Tests

`test/run.ts` runs `node --test` over `test/*.test.ts` with the audit preload
(`test/support/audit-preload.mjs`: any DNS name lookup, non-loopback connection, or read of a Pi
config/context path — `~/.pi`, AGENTS.md, CLAUDE.md, SYSTEM.md, auth/models/settings.json — fails
the process at exit) and, on macOS, under `sandbox-exec` with outbound network denied except to
localhost (`unshare -rn` on Linux; without either it says so loudly). `test/mutants.ts` applies one
exact edit per mutant to a copy of the package (`.mutants/`, git-ignored) and runs the suite against
it; every mutant must make it fail.

| File                 | What it pins                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `fixtures.test.ts`   | the 8 recorded streams, emitted by the agent, event by event                                  |
| `errors.test.ts`     | every §3.3 error row on a mock Anthropic server (the real provider path), watchdog (fires after idle_ms of silence; reset by every event), deadline |
| `guards.test.ts`     | tool loop, caps, narration, tools closed after text, citations, system-prompt text, history restore / pre-prompt rule, busy, DELETE, tools |
| `wiring.test.ts`     | the four tools, both isolation layers, settings, prompt options, canary cwd, boot refusals, HTTP envelope, limit bounds, the 413 |
| `contract.test.ts`   | the runtime request check and the tool parameters agree with ajv on the committed schemas     |
| `audit.test.ts`      | the audit is loaded; positive and negative controls; the kernel deny                          |
| `heartbeat.test.ts`  | one `: ping` per interval, and at the real 5 s                                                |

## Pins and the install decision

| Package                           | Version  | Why exact                                                          |
| --------------------------------- | -------- | ------------------------------------------------------------------ |
| `@earendil-works/pi-coding-agent` | `0.87.1` | Pi is pre-1.0; the faux and mock suites guard every bump.          |
| `@earendil-works/pi-ai`           | `0.87.1` | Bumped together with pi-coding-agent, never alone (spike §11).     |
| `typebox`                         | `1.3.27` | The tool parameters, and the runtime request validator.            |
| `ajv` (dev)                       | `8.20.0` | The tests' independent reading of `contracts/agent/*.schema.json`. |

**Decision (S5): pnpm, not the npm fallback.** `pnpm --filter @papertree/agent ls --depth 3
@earendil-works/pi-ai` lists 0.87.1 three times, all one directory in the store (exactly one pi-ai);
`@anthropic-ai/sdk` is 0.124.0 as in the spike's npm lock. pnpm ignores the shrinkwrap Pi publishes, so
26 deeper packages (mostly the AWS Bedrock client, `ws`, `gaxios`) differ by patch versions from the
spike's tree (S0's measurement); none is on the anthropic-messages path this service uses, and the
suites above run against the installed tree. pnpm blocks the `@google/genai` and `protobufjs` install
scripts; nothing here needs them.

## Contract notes

- **`entries`** are message entries only (see "History"); Pi's raw `getEntries()` also holds
  `model_change`, `thinking_level_change`, the system prompt as a `role: "system"` message and retry
  `context_edit`s, which this wrapper re-creates on every run.
- The user turn is `question + "\n\n" + quote` on a thread's first turn and the question alone on a
  follow-up (as the recordings have it). The seed passages and the datamark are in the SYSTEM prompt,
  rebuilt each run.
- `kind` and `prompt_version` must pair (`explain`/`explain-v1`, `ask`/`ask-v1`,
  `summary`/`summary-v1`), and `tool.base_url` must end with the run id; the schema allows both.
  `limits.deadline_ms` and `limits.idle_ms` must be at most 2,147,483,647 (Node's longest timer);
  the schema sets no maximum.
- Paper-derived text the API has not datamarked — the title and the selection's section name — is
  flattened to one line (no controls, no datamark look-alikes, ≤ 300 characters) and datamarked
  word by word in the system prompt; passage and page labels are flattened. The quote in the user
  turn is verbatim (the recordings' `entries` hold it so).
- `markers` are the handles issued in THIS run; the prompt tells the model that an earlier turn's
  handle is not valid now and to find that passage again with a tool.
- A `usage` event is emitted for every assistant message except an aborted one that carries no usage
  (nothing was billed). A real stream aborted after `message_start` carries input tokens, so it does
  get one.
