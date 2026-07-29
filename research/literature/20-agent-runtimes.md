# 20 — Agent Runtime / Harness Comparison for PaperTree

**Research date: 2026-07-29. All version numbers and prices verified on this date from npm/PyPI registry JSON and vendor documentation.**

## 0. The question, stated precisely

PaperTree needs an LLM to call **~20 read-only, in-process tools** (`get_block`, `get_figure`, `crop_pdf_region`, `search_semantic_blocks`, `resolve_citation`, …) that sit on top of a deterministic document-processing pipeline. The agent must **never** touch a shell or a filesystem. The backend today is FastAPI + MongoDB + OpenRouter, with a Next.js front end.

This is *not* a coding-agent workload. That single fact eliminates roughly half the candidate list, and the elimination is on hard grounds (licence, architecture, data retention), not taste.

---

## 1. The honest baseline: how much of this is a weekend?

A tool-calling loop against a single provider is genuinely small — **~250–400 lines** including tool dispatch, JSON-schema generation from Python type hints, an SSE relay, and a max-turns guard. Anyone claiming otherwise is selling something.

What is genuinely **not** trivial, ranked by how much it will hurt PaperTree:

| Hard problem | Why it is hard | Rough real cost |
|---|---|---|
| **Compaction** | You must drop history without ever orphaning a `tool_use` block from its `tool_result` — an orphan is a hard 400 from the Anthropic Messages API on the *next* request. Then you must re-anchor prompt-cache breakpoints or you silently lose the cache discount. | 2–4 weeks to get right, plus ongoing |
| **Cancellation coherence** | User closes the tab mid-stream. You now hold an assistant turn containing a `tool_use` with no `tool_result`. Persist it naively and every subsequent request on that thread 400s. | Days, but a recurring source of production bugs |
| **Streaming edge cases** | Partial-JSON tool arguments accumulate across deltas; Anthropic uses content-block deltas, OpenAI uses index-keyed `tool_calls` fragments; thinking blocks interleave; streams truncate mid-block and must be retried without duplicating emitted text. | 1–2 weeks per provider family |
| **Provider quirks via OpenRouter** | Strict `json_schema` support varies by upstream model; `cache_control` placement is Anthropic-specific; reasoning-token fields differ; stop reasons differ. OpenRouter normalises *some* of this, not all. | Ongoing tax |
| **Resumability** | Crash between tool call and tool result. Are your 20 tools idempotent on replay? (`crop_pdf_region` probably is; anything that writes isn't.) | Design work, not line count |
| **Retries** | Distinguishing retryable (429, 529, overloaded, truncated stream) from terminal, with partial-output dedup. | ~1 week |
| **Tracing** | OTel spans carrying token counts and per-call cost, correlated to a paper + user. | ~1 week |

**Conclusion:** the loop is cheap; the *lifecycle* is not. That is the correct thing to buy from a library — and it argues for a thin library, not a harness.

---

## 2. Candidate-by-candidate

### 2.1 Pi / pi-agent-core — MIT, TypeScript, genuinely embeddable, pre-1.0

The project is real and I verified it against the local install (`/Users/comreton/.local/lib/node_modules/@earendil-works/pi-coding-agent@0.80.7`) as well as upstream.

- **Repo:** [github.com/earendil-works/pi](https://github.com/earendil-works/pi) (formerly `badlogic/pi-mono`), maintained by Earendil Inc. & Contributors ([pi.dev](https://pi.dev/)). [LICENSE](https://raw.githubusercontent.com/earendil-works/pi/main/LICENSE) is **MIT**, "Copyright (c) 2025 Mario Zechner".
- **An embeddable general agent core exists separately from the coding harness — the key finding.** `@earendil-works/pi-agent-core`: *"General-purpose agent with transport abstraction, state management, and attachment support"* — **v0.82.1, published 2026-07-25, MIT, 48 versions, npm scope created 2026-05-07**. Its predecessor `@mariozechner/pi-agent` ran to v0.9.0 (2025-11-21, 82 versions from 2025-08-09), so the lineage is ~1 year, not 3 months.
- **Tools are 100% user-supplied.** The [agent README](https://raw.githubusercontent.com/earendil-works/pi/main/packages/agent/README.md) defines tools via `AgentTool` on `agent.state.tools`. There are **no built-in filesystem or shell tools in `pi-agent-core`** — those live in `pi-coding-agent`. Ideal shape for PaperTree: nothing to disable, because nothing dangerous is there.
- **API:** `Agent` with `prompt()`, `continue()`, `abort()`, `subscribe()`, `steer()`, `followUp()`; lower-level `agentLoop()`, `agentLoopContinue()`, `streamProxy()`. Compaction via `transformContext()`. Sessions via `sessionId` + `@earendil-works/pi-storage-sqlite-node` (v0.82.1, MIT, **created 2026-07-21 — 5 versions old**).
- **Best provider abstraction in this survey.** `@earendil-works/pi-ai` (v0.82.1, MIT) lists 30+ providers including **OpenRouter (`openrouterProvider()`)**, Vercel AI Gateway, Bedrock, and any OpenAI-compatible endpoint, with `constrainedSampling: {type: 'json_schema'}` and per-request `usage.cost.total`.
- **Maturity — the disqualifier.** The [agent CHANGELOG](https://raw.githubusercontent.com/earendil-works/pi/main/packages/agent/CHANGELOG.md) shows **breaking changes in v0.81.0 (2026-07-21) and v0.82.0 (2026-07-24)** — three days apart (`SessionStorage` interface changed, `streamFn` → required `streamFunction`; then `ExecutionEnv` → `toolContext`). Separately, [discussion #3337](https://github.com/earendil-works/pi/discussions/3337) (2026-04-17) — a company asking whether `pi-agent-core` suits a customer-hosted product runtime at hundreds of concurrent runs — has **zero maintainer replies**.
- **Language:** TypeScript only; non-Node integration is via RPC over stdin/stdout, i.e. a subprocess.

**Verdict for PaperTree:** architecturally the best-shaped OSS runtime here, and the right answer *if* the agent service were Node. From a Python FastAPI backend it means either a second runtime or an RPC subprocess, and you would be pinning to a pre-1.0 API that broke twice in one week.

### 2.2 Claude Agent SDK — proprietary (TS), CLI-subprocess, filesystem-first

- **TypeScript:** `@anthropic-ai/claude-agent-sdk` **v0.3.220, published 2026-07-24**, 254 versions since 2025-09-27. Its [LICENSE.md](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/LICENSE.md) reads in full: *"© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service."* — **proprietary, not open source.**
- **Python:** `claude-agent-sdk` **v0.2.128, published 2026-07-25**, 130 releases; its repo [LICENSE](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-python/main/LICENSE) *is* MIT. **This asymmetry is misleading**: per the [Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart), *"Both the TypeScript and Python SDKs bundle a native Claude Code binary for your platform"* — the MIT grant covers the thin wrapper, not the proprietary binary you actually ship.
- **It is a subprocess supervisor, not a library.** The [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) confirms the SDK spawns the Claude Code CLI and that *"SDK version tracks CLI version"* (SDK v0.3.191 ↔ Claude Code v2.1.191) — i.e. shipping a coding-agent binary into production and paying process-per-session on concurrency.
- **Can filesystem/shell tools be fully disabled? Yes — but by enumeration, which is a standing hazard.** Per [Permissions](https://code.claude.com/docs/en/agent-sdk/permissions), a **bare-name deny rule removes the tool definition from the request entirely**: `disallowed_tools=["Bash"]` means *"Claude does not see the tool and cannot attempt it."* `disallowed_tools=["*"]` removes every tool, but that glob also matches your MCP tools, so it is unusable as a blanket. Documented lockdown is `allowedTools: [...] + permissionMode: "dontAsk"`, plus `settingSources: []` so the server does not inherit `~/.claude/` and project `.claude/` config. **Hazard:** you must name every built-in, and a CLI upgrade adding a new one silently exposes it. A `PreToolUse` hook is the only backstop running before every step.
- **Custom tools are fine:** `tool()` + `createSdkMcpServer()` gives in-process MCP tools, no extra subprocess.
- **Non-Anthropic models: officially no.** Supported auth is Anthropic API, Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`), Vertex (`CLAUDE_CODE_USE_VERTEX=1`), Foundry, Claude Platform on AWS. The only OpenRouter-ish route is pointing `ANTHROPIC_BASE_URL` at a gateway serving the Anthropic Messages shape (LiteLLM's `/v1/messages`), and that route has reported defects: [claude-agent-sdk-python#677](https://github.com/anthropics/claude-agent-sdk-python/issues/677) (bundled binary ignores `ANTHROPIC_BASE_URL` from `ClaudeAgentOptions(env=…)`) and [BerriAI/litellm#22963](https://github.com/BerriAI/litellm/issues/22963) (Claude Code sends `output_config`, which OpenAI rejects). Branding constraints also apply, and third-party products may not offer claude.ai login/rate limits.

**Verdict:** hard reject for PaperTree. Proprietary licence on the TS side, vendor-locked to Anthropic, filesystem-first by design, and a subprocess model that fights a FastAPI concurrency story. Its strengths (compaction, sessions, subagents, hooks) are real but are strengths *for a coding agent*.

### 2.3 Anthropic Managed Agents — a hosted sandbox; the opposite of what PaperTree wants

[Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview): a hosted REST API (`/v1/agents`, `/v1/environments`, `/v1/sessions`, SSE via `GET /v1/sessions/{id}/stream`) in **beta, header `managed-agents-2026-04-01`**. Anthropic runs the agent loop *and* the sandbox; built-in tools are Bash, file operations, and web search/fetch.

- **Cost (vendor-published, [pricing page](https://platform.claude.com/docs/en/about-claude/pricing)):** tokens at standard rates **plus $0.08 per session-hour**, metered to the millisecond and only while status is `running`. Idle time is free. Replaces code-execution container-hour billing. Reference token prices: Opus 5 $5/$25 per MTok; Sonnet 5 $2/$10 (introductory, through 2026-08-31; $3/$15 after); Haiku 4.5 $1/$5.
- **Data retention — the blocker.** Verbatim: *"Managed Agents is not currently eligible for Zero Data Retention (ZDR) or HIPAA Business Associate Agreement (BAA) coverage."* Conversation history, sandbox state and outputs are stored server-side. You can delete sessions via API, but you cannot opt out of the storage.
- Anthropic models only. Self-hosted sandboxes are supported for data residency, which mitigates but does not remove the retention position.

**Verdict:** reject. PaperTree's whole value is a *deterministic* document pipeline it controls; paying $0.08/session-hour for a Linux sandbox it must then lock down, while giving up ZDR eligibility for users' unpublished papers, is backwards.

### 2.4 OpenAI Agents SDK — MIT, both languages, no filesystem tools at all

- `openai-agents` (Python) **v0.19.1, 2026-07-29**, **MIT**, 112 releases, `>=3.10`. `@openai/agents` (JS) **v0.14.1, 2026-07-29**, **MIT**, 95 versions since 2025-06-03. Repo LICENSEs confirm MIT (OpenAI, 2025) for both.
- **Primitives:** Agents, Handoffs, Guardrails (input/output validation), Sessions, Tracing. **It ships no filesystem or shell tools** — your tools are the only tools. Nothing to disable.
- **Session persistence is unusually good** ([Sessions docs](https://openai.github.io/openai-agents-python/sessions/)): `SQLiteSession`, `AsyncSQLiteSession`, `RedisSession`, `SQLAlchemySession`, **`MongoDBSession`**, `DaprSession`, `EncryptedSession`, plus `AdvancedSQLiteSession` (conversation **branching**) and `OpenAIResponsesCompactionSession` (**compaction**). Custom backends implement a `Session` protocol (`get_items`/`add_items`/`pop_item`/`clear_session`).
- **Provider portability:** `OpenAIChatCompletionsModel` over `AsyncOpenAI(base_url="https://openrouter.ai/api/v1")`, or `LitellmModel` via `pip install openai-agents[litellm]` ([Models docs](https://openai.github.io/openai-agents-python/models/)). Documented caveats: `json_schema` support varies upstream; hosted tools are OpenAI-only.
- **Tracing is a data-governance trap: ON by default, uploading to OpenAI's backend.** Disable via `OPENAI_AGENTS_DISABLE_TRACING=1`, `set_tracing_disabled(True)`, or `RunConfig.tracing_disabled`; docs state tracing is unavailable under ZDR ([Tracing docs](https://openai.github.io/openai-agents-python/tracing/)). **Day-one, non-negotiable change if adopted** — otherwise paper content and tool arguments flow to OpenAI while you bill through OpenRouter.

### 2.5 Codex SDK — confirmed inappropriate, by OpenAI's own documentation

`@openai/codex-sdk` **v0.146.0, 2026-07-29, Apache-2.0**, 769 versions since 2025-10-01. It is a thin wrapper that **spawns the `@openai/codex` CLI and exchanges JSONL over stdin/stdout** ([README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)). It exposes sandbox presets `read_only` / `workspace_write` / `full_access`, i.e. a filesystem workspace is the core abstraction. OpenAI models only; TypeScript primary, Python in beta. The [docs](https://learn.chatgpt.com/docs/codex-sdk) say it directly: *"Use the Codex SDK for coding-focused Codex threads"* — for anything broader, use the Agents SDK. **Expectation confirmed: reject.**

### 2.6 General orchestration libraries

| Library | Latest (2026-07-29) | Licence | Lang | Notes |
|---|---|---|---|---|
| **LangGraph** | py `langgraph` 1.2.10 (07-28); js `@langchain/langgraph` 1.4.8 (07-15) | **MIT** (LangChain, Inc. 2024) | Py + TS | Durable execution, checkpointers (`langgraph-checkpoint-postgres`/`-sqlite` 3.1.0), interrupts (HITL), time-travel, streaming. Runs standalone: *"you don't need to use LangChain to use LangGraph"*; LangSmith and LangGraph Platform are optional. Cost is conceptual — you adopt a graph/state model for what is one loop. |
| **Mastra** | `@mastra/core` 1.54.0 (07-28) | **Apache-2.0 + carve-out** | TS only | [LICENSE.md](https://raw.githubusercontent.com/mastra-ai/mastra/main/LICENSE.md): Apache-2.0 (Kepler Software, Inc. 2025) **except any directory named `ee/`** (incl. `packages/core/src/auth/ee/`, `packages/server/src/server/auth/ee/`), under a separate `ee/LICENSE` — auth is partly in the enterprise carve-out. **1,426 versions since 2024-10-02** implies very high churn. |
| **Vercel AI SDK** | `ai` 7.0.42 (07-29); `@ai-sdk/anthropic`, `@ai-sdk/openai` 4.0.24 | **Apache-2.0** (Vercel, 2023) | TS only | `ToolLoopAgent` + `stopWhen` (`isStepCount(20)` default, `hasToolCall`, `isLoopFinished`), `prepareStep`, `tool({inputSchema})`, `generateObject`/`streamObject`. OpenRouter via `@openrouter/ai-sdk-provider` 3.0.0 (2026-07-06, Apache-2.0, peer `ai ^7`). No filesystem tools. **No session persistence — you own the message array.** |
| **Pydantic AI** | `pydantic-ai` / `-slim` 2.20.0 (07-29) | **MIT** (Pydantic Services Inc.) | Python | Typed tools, structured output with streamed validation, DI, HITL approval, message history, MCP, durable execution (Temporal native). **First-class OpenRouter**: `pip install "pydantic-ai-slim[openrouter]"`, `Agent('openrouter:anthropic/claude-sonnet-4.6')`, `OpenRouterModel` + `OpenRouterProvider`, `openrouter_cache_instructions`/`_messages`/`_tool_definitions`, `usage.cache_read_tokens`. Logfire optional (any OTel backend). |
| **LlamaIndex Workflows** | `llama-index-workflows` 2.22.2 (2026-06-30) | **MIT** (LlamaIndex Inc. 2026) | Python | Event-driven, async-first, step-based control flow. A workflow engine, not an agent runtime — you still write the loop. |
| **Roll your own** | — | yours | either | ~250–400 lines for the loop. You inherit every row of the table in §1. |

---

## 3. Consolidated comparison

Scoring is **for PaperTree's specific job**, not in the abstract.

| | Pi core | Claude SDK | Managed Agents | OpenAI Agents | Codex SDK | LangGraph | Mastra | AI SDK | Pydantic AI | Roll-own |
|---|---|---|---|---|---|---|---|---|---|---|
| **Embed in FastAPI** | RPC only | subprocess | HTTP | ✅ | ✗ | ✅ | ✗ | ✗ | ✅ | ✅ |
| **Licence** | MIT | **proprietary** (TS); MIT wrapper + proprietary binary (Py) | ToS | MIT | Apache-2.0 | MIT | Apache-2.0 + `ee/` | Apache-2.0 | MIT | — |
| **OpenRouter** | ✅ built-in | ✗ (broken gateway hack) | ✗ | ✅ base_url | ✗ | ✅ | ✅ | ✅ plugin | ✅ **first-class** | ✅ |
| **TS / Python** | ✅ / ✗ | ✅ / ✅ | REST | ✅ / ✅ | ✅ / beta | ✅ / ✅ | ✅ / ✗ | ✅ / ✗ | ✗ / ✅ | ✅ / ✅ |
| **No shell/fs** | ✅ inherent | ⚠ by enumeration | ✗ sandbox | ✅ inherent | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Streaming** | ✅ | ✅ | ✅ SSE | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ validated | you |
| **Structured out** | ✅ schema | via tools | via tools | ✅ prov-dep | ✅ | ✅ | ✅ | ✅ | ✅ **best** | you |
| **Sessions** | SQLite (new) | ✅ | ✅ server | ✅ **Mongo** | threads | ✅ checkpoint | ✅ | ✗ | ✅ | you |
| **Branching** | ✗ | `forkSession` | ✗ | ✅ Advanced | ✗ | ✅ | ✅ | ✗ | ✗ | you |
| **Compaction** | `transformContext` | ✅ | ✅ | Responses only | ✅ | ✗ | ✗ | `prepareStep` | ✗ | you |
| **Cancellation** | `abort()` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | you |
| **Resumability** | replay | resume | ✅ best | replay | resume | ✅ **best OSS** | ✅ | ✗ | ✅ Temporal | you |
| **Tracing** | cost only | hooks | ✅ e2e | ⚠ **default→OpenAI** | ✅ | OTel | ✅ | OTel | OTel | you |
| **Approval** | `steer()` | ✅ | ✅ | guardrails | ✅ | ✅ | ✅ | ✅ | ✅ | you |
| **Concurrency** | ✅ in-proc | ✗ per-process | vendor | ✅ in-proc | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Subagents** | ✗ | ✅ | ✅ | handoffs | ✗ | subgraphs | ✅ | ✗ | ✅ | you |
| **Lock-in** | none | **high** | **very high** | low | very high | low | low-med | low | **lowest** | none |
| **Retention risk** | none | none | **no ZDR/BAA** | tracing | OpenAI | none | none | none | none | none |
| **Maturity** | pre-1.0, 2 breaks/4 days | v0.3.x | beta | v0.19.1 | v0.146 | **v1.x** | 1426 vers | v7 | v2.20.0 | — |

---

## 4. Recommendation

**Primary: Pydantic AI (`pydantic-ai-slim[openrouter]` 2.20.0, MIT), in the existing FastAPI process.**

It is the only candidate that is simultaneously Python-native, MIT, has **no filesystem or shell tools to disable**, treats OpenRouter as a first-class provider *with* Anthropic cache-control breakpoints (which materially cuts cost when 20 tool schemas ride in every request), sends telemetry nowhere by default, and has the strongest typed structured-output story — which matters because PaperTree's tools return structured document objects, not prose.

**Close alternative: OpenAI Agents SDK (Python, MIT).** Pick this instead if session persistence is the dominant concern — `MongoDBSession` drops straight onto PaperTree's existing MongoDB, and `AdvancedSQLiteSession` gives conversation branching that Pydantic AI lacks. **Non-negotiable if adopted:** set `OPENAI_AGENTS_DISABLE_TRACING=1` before the first production request.

**Explicit rejections, with the reason that decides it:**
- **Claude Agent SDK** — proprietary TS licence + bundled Claude Code binary + no OpenRouter path + filesystem-first defaults.
- **Managed Agents** — ZDR/BAA ineligible, and you would be renting a Linux sandbox you must then lock down.
- **Codex SDK** — OpenAI's own docs route non-coding workloads elsewhere.
- **Mastra / Vercel AI SDK / Pi core** — TypeScript-only; wrong side of the stack today. **If the agent layer ever moves to Node, Pi is the pick** — `pi-agent-core` is the best-shaped OSS runtime in this survey (MIT, zero built-in dangerous tools, 30+ providers, compaction hook) — but wait for a stability signal, given breaking changes in v0.81.0 and v0.82.0 three days apart.
- **LangGraph** — correct choice if PaperTree later needs multi-stage document workflows with durable checkpoints; today it is a graph runtime bought for a single loop.

**Architectural guardrail regardless of choice:** put the ~20 tools behind a plain registry (name → JSON schema → async callable) that the runtime merely *adapts*. Every candidate here can consume that in under 100 lines of glue, which keeps the runtime a swappable dependency rather than a rewrite.

---

## 5. What I could not verify

- **Pi under concurrency.** No published benchmark or maintainer statement on `pi-agent-core` at dozens-to-hundreds of concurrent runs. The one public question about it ([discussion #3337](https://github.com/earendil-works/pi/discussions/3337), 2026-04-17) is unanswered. I did not read the source.
- **Pi's 1.0 timeline / API-stability policy.** [pi.dev](https://pi.dev/) makes no production-readiness statement. RFC 0015 (2026-03-30, reported as committing the core to MIT while reserving Fair Source layers) appeared only in secondary sources — **I did not read the RFC**, so treat "MIT core, proprietary layers later" as unconfirmed. The repo-root MIT LICENSE *is* verified. Whether Pi's event stream covers subagents or structured output is also unconfirmed (absent from the README; `packages/agent/docs/sdk.md` 404s).
- **GitHub commit recency and issue counts** for every repo — the REST API rate-limited me and `gh` is unauthenticated here. Recency is inferred from npm/PyPI publish dates only. Relatedly, the two Claude Agent SDK / LiteLLM defects rest on search results I did not open; I cannot confirm whether they are open, fixed, or version-specific.
- **Whether `disallowed_tools=["*"]` strips MCP tools in practice** — docs say `"*"` "matches every tool", implying yes, but there is no worked example. **Test before relying on it.**
- **Managed Agents rate limits** — referenced at `/docs/en/managed-agents/reference#rate-limits`; not fetched.
- **Mastra's `ee/LICENSE` text** — the carve-out and its directories are confirmed, but I did not read the licence, so I cannot name it (Elastic v2, BUSL, or bespoke). **LlamaIndex Workflows TypeScript parity** — not investigated.
- **Latency.** No candidate publishes runtime overhead figures, and I ran no benchmarks. Every number in this report is pricing, versioning, or licensing — **no latency claim here is measured**.
- **Pydantic AI compaction.** The overview lists durable execution and message history but no compaction primitive. If PaperTree runs long paper-reading sessions, assume you write compaction yourself (see §1 — it is the expensive row).
