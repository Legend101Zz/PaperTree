# 21 — Durable Background Jobs and Workflow Engines

**Scope:** Temporal, Restate, Inngest, Trigger.dev, Hatchet, DBOS, Celery, RQ, Dramatiq, arq, Prefect, Dagster, BullMQ, pg-boss, pgmq, River, Oban, Cloudflare Workflows, AWS Step Functions, Vercel Workflows (WDK), and plain Postgres `SKIP LOCKED`.
**Prepared for:** PaperTree background-pipeline architecture decision (PDF parsing, audiobook generation, embedding/indexing).
**Date of research:** 2026-07-29. Most recent primary evidence: Vercel Workflows docs `last_updated: 2026-07-15`; Cloudflare Workflows billing commences 2026-08-10 (per Cloudflare pricing page); `temporalio` (Python) 1.30.0 released 2026-07-02; Celery 5.6.3 released 2026-03-26; Dramatiq 2.2.0 released 2026-06-17; RQ 2.10.0 released 2026-06-20; arq 0.28.0 released 2026-04-16; Prefect's acquisition of Dagster Labs announced July 2026.

---

## 0. Bottom line up front

1. **The GPU requirement eliminates half the field.** Trigger.dev, Cloudflare Workflows and Vercel Workflows all execute *your code on their runtime*. None of them offers a GPU tier that PaperTree can use for layout parsing or local TTS. Any engine PaperTree picks must support **workers on PaperTree's own hardware**, which means Temporal, Restate, Hatchet, Inngest (via Connect), DBOS, Step Functions Activities, or a self-built queue.
2. **The lowest-operational-burden option with genuine per-step resumability is Temporal Cloud** (hard floor **$100/month**), with **Hatchet Cloud's Developer tier** ($0 up to 100,000 task runs/month) as the cheaper contender and **DBOS Transact** (MIT, library-only, needs only Postgres) as the minimum-infrastructure self-hosted answer.
3. **A plain Postgres `SKIP LOCKED` table is more than sufficient for the *queueing*** at PaperTree's throughput — this is not close. It is **not** sufficient for step-level resumability, fan-out/fan-in over chapters, or the operator UI you will want at 3am. My estimate of the delta is **20–36 engineer-days** to build, plus ongoing maintenance. That is roughly **150 months of Temporal Cloud Essentials**.
4. **Important stack fact:** PaperTree is currently FastAPI + MongoDB. Every "just use Postgres" option (pg-boss, DBOS, Hatchet self-host, River, pgmq, DIY `SKIP LOCKED`) means *adding a second datastore* — that cost belongs in the comparison and is usually omitted.

---

## 1. Managed / hosted platforms

| System | Licence (server) | Workers run where | Per-step resumability | Long-run limits | Python + TS | Cost at PaperTree scale | GPU pool |
|---|---|---|---|---|---|---|---|
| **Temporal Cloud** | Server MIT ([LICENSE](https://github.com/temporalio/temporal/blob/main/LICENSE)); Cloud is the hosted control plane | **Your infra** | Yes — event-sourced replay; activities never re-run once recorded | History cap **51,200 events or 50 MB**, warn at 10,240 / 10 MB ([docs](https://docs.temporal.io/workflow-execution/limits)); no wall-clock limit | Both, first-class. `temporalio` 1.30.0 (2026-07-02, MIT); TS SDK v1.21.1 | **$100/mo floor**, 1M Actions included; $50/M after ([pricing](https://docs.temporal.io/cloud/pricing)) | **Excellent** — dedicated Task Queues per worker pool |
| **Hatchet Cloud** | **MIT** ([LICENSE](https://github.com/hatchet-dev/hatchet/blob/main/LICENSE)); Postgres-backed | **Your infra** | Yes — durable event log, checkpoint/replay ([docs](https://docs.hatchet.run/home/durable-execution)) | Not published in a limits table (see §7) | Python, TS, Go, Ruby | **$0** to 100k runs/mo; **$10/M** overage; then **$500/mo** Team ([pricing](https://hatchet.run/pricing)) | **Very good** — worker labels/affinity + sticky assignment, explicit GPU docs |
| **Restate Cloud** | **BUSL-1.1** → Apache-2.0 after 4y; Additional Use Grant bars offering a "Public Restate Platform Service" ([LICENSE](https://raw.githubusercontent.com/restatedev/restate/main/LICENSE)) | **Your infra** | Yes — journal/replay durable execution | Not verified | Python, TS, Java, Go, Rust, Kotlin | Free tier **50k actions/mo**; paid pricing not machine-readable (§9) | Good in principle; no GPU-specific routing docs found |
| **Inngest Cloud** | Server **SSPL-1.0** + irrevocable Apache-2.0 grant on 3rd anniversary ([LICENSE.md](https://github.com/inngest/inngest/blob/main/LICENSE.md)) | Your infra, but via **HTTP callback** or **Connect (public beta)** | Yes — memoised `step.run()` | **Max 1,000 steps/function**; step ≤ 2h; run 30d (Free) → 366d (Pro); step return ≤ 4 MiB, run state ≤ 32 MiB ([limits](https://www.inngest.com/docs/usage-limits/inngest)) | TS 3.34.1+, Go 0.11.2+, **Python 0.5.0+** (pre-1.0) | Free 50k executions / 5 concurrency; **Pro $99/mo** 1M executions ([pricing](https://www.inngest.com/pricing)) | Workable via Connect, but Connect is **beta** and Python SDK is pre-1.0 |
| **Trigger.dev Cloud** | **Apache-2.0** ([LICENSE](https://github.com/triggerdotdev/trigger.dev/blob/main/LICENSE)) | **Their infra** | Yes — checkpointed tasks/waits | "Tasks can run for as long as you need, with no timeouts" (vendor claim) | TS-first | Free $5 credits; Hobby $10/mo; Pro $50/mo; compute $0.0000169–$0.00068/s; $0.000025/run ([pricing](https://trigger.dev/pricing)) | **Poor** — no GPU machine tier in the published price list |
| **Cloudflare Workflows** | Proprietary (Workers platform) | **Their infra (Workers)** | Yes — `step.do()` results persisted | Paid: 10,000 steps default (→25,000); **30s CPU/step** (→5 min); `step.sleep` ≤ 365d; 1 MiB step result; 1 GB state/instance ([limits](https://developers.cloudflare.com/workflows/reference/limits/)) | **JS/TS only** | Paid plan: 10M req + 30M CPU-ms + 500k steps included; $0.80/100k extra steps ([pricing](https://developers.cloudflare.com/workflows/reference/pricing/)) | **None** — orchestrator only |
| **Vercel Workflows (WDK)** | Platform proprietary; built on open-source Workflow SDK (`workflow` npm, licence unverified) | **Their infra (Vercel Functions)** | Yes — event-sourced, `'use step'` | **10,000 steps/run**, 25,000 events/run, 50 MB payload, 2 GB entity storage/run, max run duration **no limit**, `sleep` **no limit**, replay ≤ 240s ([pricing & limits](https://vercel.com/docs/workflows/pricing)) | JS/TS + **Python** via `vercel` SDK | $0.02/1K events; $0.50/GB written; $0.50/GB-month retained; Hobby 50k events free | **None** — orchestrator only |
| **AWS Step Functions** | Proprietary | **Your infra** via Activities (long-poll `GetActivityTask`) | Yes — each state's result is durable | Standard: **1 year** max execution, **25,000 events** max history, **256 KiB** I/O per state ([quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)) | Any (Activities are language-agnostic) | **$0.000025/state transition**, 4,000 free/mo ([pricing](https://aws.amazon.com/step-functions/pricing/)) | **Good** via the Activity pattern; 1-year task timeout suits GPU jobs |
| **DBOS (Conductor)** | Library **MIT** ([py](https://github.com/dbos-inc/dbos-transact-py), [ts](https://github.com/dbos-inc/dbos-transact-ts)) | **Your infra** | Yes — every step checkpoints to Postgres | Bounded only by Postgres | **Python and TS, both MIT** | Pro **$99/mo**, 1M checkpoints, $50/M overage; Teams $499/mo ([pricing](https://www.dbos.dev/dbos-pricing)) | Good — you own the worker process entirely |

---

## 2. Self-hosted libraries and queues

| System | Licence | Store | Durability default | Step resumability | Notes |
|---|---|---|---|---|---|
| **Celery 5.6.3** | BSD-3-Clause | Redis/RabbitMQ/SQS | **`task_acks_late=False` by default → task lost if worker dies mid-task**; Redis visibility timeout defaults to 1 hour and re-delivers long tasks ([issue #6229](https://github.com/celery/celery/issues/6229), [#5935](https://github.com/celery/celery/issues/5935)) | **No** — chains restart the failed link, no memoised prior results | Actively released, but the Redis+long-task failure mode is exactly PaperTree's audiobook shape |
| **RQ 2.10.0** | BSD-2-Clause | Redis/Valkey | At-least-once with retries | **No** | **Pickle default serializer — arbitrary code execution on unpickle**; switch to `JSONSerializer` |
| **Dramatiq 2.2.0** | **LGPL-3.0-or-later** | RabbitMQ/Redis | Better ack semantics than Celery | **No** | LGPL is safe for a SaaS (no network-copyleft clause) but **flag it**: modifications you redistribute must stay LGPL |
| **arq 0.28.0** | MIT | Redis | At-least-once | **No** | **Maintenance-only mode** (PyPI page cites issue #510). Do not build on it. |
| **Prefect 3** | **Apache-2.0** ([LICENSE](https://github.com/PrefectHQ/prefect/blob/main/LICENSE)) | Postgres/SQLite | Task-level retries + result caching | Partial (result persistence + cache keys) | Data-pipeline ergonomics, not request-path job semantics |
| **Dagster** | **Apache-2.0** ([LICENSE](https://github.com/dagster-io/dagster/blob/master/LICENSE)) | Postgres | Asset-based re-materialisation | Partial | **Prefect acquired Dagster Labs, July 2026** — two overlapping orchestrators now under one owner; roadmap risk |
| **BullMQ** | MIT | Redis | Redis-persistence-bound | Flows (parent/child DAG), not memoised steps | Commercial **BullMQ Pro** + Taskforce.sh UI |
| **pg-boss** | MIT | **Postgres** (`SKIP LOCKED`) | Transactional enqueue | Job dependencies, not memoised steps | Node 22.12+, PG 13+; retries w/ exponential backoff, DLQ, cron, dashboard |
| **pgmq** | PostgreSQL Licence | Postgres | Visibility-timeout, SQS-like | No | Pure SQL, no background worker; Python + Rust official clients |
| **River** | **MPL-2.0** | Postgres | Transactional enqueue | Yes — resumable steps / `ResumableStepTx` | **Go only** — wrong language for PaperTree |
| **Oban** | Apache-2.0 core; **Oban Pro commercial** | Postgres | Strong | Workflows (fan-in/fan-out) in **Pro only** | **Elixir only** — cite as the design reference, not a candidate |

---

## 3. Cost modelled at PaperTree's three scales

My step-count model (mine, not vendor-supplied): PDF parse ≈ **8 steps**; audiobook ≈ **39 steps** (plan + 12 chapters × [script, TTS, align] + stitch + persist); embed/index ≈ **7 steps**.

| Tier | Volume | Steps/month |
|---|---|---|
| **T0** — single-digit users | 50 papers, 10 audiobooks | ~1,100 |
| **T1** — ~100 paying users | 2,000 papers, 300 audiobooks | ~42,000 |
| **T2** — thousands of users | 50,000 papers, 5,000 audiobooks | ~945,000 |

| Engine | T0 | T1 | T2 |
|---|---|---|---|
| Temporal Cloud (≈2.5 Actions/step) | **$100** (floor) | **$100** (floor; ~105k Actions ≪ 1M) | **~$170** (2.4M Actions: 1M incl. + 1.4M × $50/M) |
| Hatchet Cloud | **$0** | **$0** (42k < 100k free) | ~$8.50 usage, but Team tier **$500** if you need >3-day retention or >10 users |
| Inngest | $0 (Hobby) | $0 Hobby / **$99** Pro | **$99** Pro (945k < 1M) |
| DBOS Conductor | $0–$99 | **$99** Pro | **$99** + ~$0 overage (≈1M checkpoints) |
| AWS Step Functions (Standard, ~3 transitions/step) | ~**$0** (4k free) | **~$3** | **~$70** |
| Cloudflare Workflows | $5 (Workers Paid) | **$5** | **~$9** |
| Vercel Workflows (3 events/step) + Pro seat | $20 | ~$22 | ~$76 + function compute |
| Self-hosted Temporal | infra ~$60–150/mo **+ engineer time** | same | same + tuning |
| DIY Postgres `SKIP LOCKED` | ~$0 marginal | ~$0 marginal | ~$0 marginal |

Two observations. First, **at T1 the entire spread is $0–$100/month** — cost is not the deciding variable; operational burden and programming model are. Second, **Temporal Cloud's $100/month floor is the dominant cost until roughly 2M Actions/month** (≈800k steps/month, i.e. between T1 and T2), and remains cheap well beyond: 10M Actions ≈ $500/month.

---

## 4. Operational burden, precisely

**Self-hosting Temporal is not cheap.** Temporal's own production checklist requires Kubernetes or equivalent, a persistence store, a separate Visibility store, shard-count capacity planning that is **fixed at build time and requires a rebuild + migration to change**, and **sequential minor-version server upgrades roughly every two weeks with no version skipping** ([production checklist](https://docs.temporal.io/self-hosted-guide/production-checklist)). Visibility supports PostgreSQL v12+, MySQL 8.0.17+, SQLite 3.31+, Elasticsearch 7/8 and OpenSearch 2+ (Server ≥1.30.1); Elasticsearch is *not* required, but Temporal "recommend[s] Elasticsearch or OpenSearch for any Temporal Service setup that handles more than a few Workflow Executions" ([visibility docs](https://docs.temporal.io/self-hosted-guide/visibility)). Cassandra visibility was removed in v1.24. Call this **~0.25–0.5 FTE**.

**Self-hosting Trigger.dev loses the features you were buying.** The self-hosting overview states self-hosted deployments have **no warm starts, no auto-scaling, and no checkpoints (non-blocking waits)**, and that you "assume all responsibility and risk" ([self-hosting docs](https://trigger.dev/docs/self-hosting/overview)). Losing checkpoints means a 30-minute audiobook wait burns a live container. v3 is end-of-life; 4.5.1+ rejects v3 triggers.

**Self-hosting Inngest** is supported (Postgres + Redis, Helm chart exists) but **authentication was explicitly out of scope for the self-hosted MVP** — verify current state before relying on it.

**DBOS has the lowest possible infrastructure burden of anything with real step checkpointing:** it is a library, not a server. "DBOS is entirely contained in this open-source library, there's no additional infrastructure for you to configure or manage" — you need only Postgres. MIT for both `dbos-transact-py` and `dbos-transact-ts`.

---

## 5. GPU worker pools

Only three approaches are genuinely good here:

- **Temporal Task Queues.** Register the GPU activities on a dedicated task queue and run that worker only on GPU nodes. Non-GPU activities of the *same workflow* run on a different queue. This is the cleanest separation available and needs no vendor feature.
- **Hatchet worker labels + affinity + sticky assignment.** Labels are dynamic key/value pairs on workers ("model X loaded", "disk free"), and sticky assignment (SOFT/HARD) pins all child tasks of a workflow to the same worker — directly useful for keeping a loaded TTS or layout model resident across a paper's chapters. Hatchet publishes explicit GPU-instance docs.
- **Step Functions Activities.** Your GPU box long-polls `GetActivityTask` and calls `SendTaskSuccess`; task timeout is bounded only by the 1-year execution limit. Language-agnostic and costs cents. The price is writing ASL and living with CloudWatch as your UI.

Cloudflare Workflows, Vercel Workflows and Trigger.dev cannot host GPU work; with those you would orchestrate over HTTP into a separately-operated Python GPU service, which reintroduces the durability problem you were trying to outsource (who retries the 20-minute TTS call? who resumes chapter 7?).

---

## 6. Is plain Postgres `SKIP LOCKED` enough?

**For dequeuing: yes, unambiguously.** Postgres documents `SKIP LOCKED` as being for exactly this: "Skipping locked rows provides an inconsistent view of the data, so this is not suitable for general purpose work, but can be used to avoid lock contention with multiple consumers accessing a queue-like table" ([PostgreSQL SELECT docs](https://www.postgresql.org/docs/current/sql-select.html)). PaperTree at T2 needs **under 1 job/second sustained**. Postgres will not notice.

**For durable *workflows*: no, not without real work.** What you would have to build, and my estimate:

| Component | Estimate |
|---|---|
| Claim/lease with `FOR UPDATE SKIP LOCKED`, worker ID, lease expiry | 1–2 d |
| Retry policy: attempt counter, exponential backoff + jitter, max attempts, dead-letter table | 1–2 d |
| **Step checkpoint table** — step key → memoised output; resume skips completed steps | 3–5 d |
| Heartbeats + zombie reclaim (essential for 20-minute GPU activities) | 2–3 d |
| Idempotency keys for external side-effects (TTS spend, S3 writes) | 2 d |
| Fan-out/fan-in across chapters with a join barrier and partial-failure semantics | 3–5 d |
| Cancellation, priority, per-tenant concurrency caps | 2–3 d |
| Operator UI: run/step timeline, logs, **retry-from-step**, force-fail | 5–10 d |
| Cron/schedules; metrics, alerting, table bloat/partition maintenance | 3–6 d |
| **Total** | **~22–38 engineer-days (4.5–8 weeks for one engineer)** |

At a $600/day loaded cost that is **$13,000–$23,000**, versus $100/month. Break-even against Temporal Cloud Essentials is **10–19 years**. Ongoing maintenance (~2–4 days/quarter) never appears on the buy side at all.

**The honest middle path.** There is a legitimate cheap design that is *not* a full workflow engine: **model each pipeline stage as its own row in a `pipeline_stage` table, each with its own job.** Stage N's completion transactionally enqueues stage N+1 and persists its output (S3 key, not blob). You get per-stage resumability by construction, retries per stage, and a trivially queryable state table — for **~8–12 engineer-days**, no new abstraction, and no vendor. What you do *not* get is a timeline UI, sub-stage memoisation, sleep/wait primitives, or fan-in barriers you can trust. For PaperTree's audiobook shape (chapter plan → per-chapter fan-out → stitch), the fan-in barrier is the part that will bite.

---

## 7. Recommendation

**Answer to "lowest operational burden with per-step resumability for a small team": Temporal Cloud, using Python workers on your own (GPU) hardware and the TypeScript SDK from the Next.js control plane.** Rationale: it is the only option where (a) the durable store is fully someone else's ops problem, (b) both SDKs are mature and MIT-licensed, (c) GPU routing is a first-class primitive (task queues), (d) there is no licence encumbrance, and (e) the cost is a flat $100/month from T0 through roughly 800k steps/month. Its cost is a **real learning curve** — determinism constraints, replay, workflow versioning — call it two weeks of ramp.

**Cheaper alternative worth a spike: Hatchet Cloud.** MIT, Postgres-backed, Python + TS, explicit GPU/worker-affinity support, and **free to 100k task runs/month** — which covers PaperTree through T1. The risk is the **$0 → $500/month cliff**: the Developer tier's retention and user limits are unpublished, and the next tier is Team at $500. Establish what the free tier actually retains before committing.

**If you refuse any vendor: DBOS Transact** (MIT, Python + TS, Postgres-only, no server to run) is the lowest-infrastructure durable-execution option and the Conductor UI is optional at $99/month. Younger and smaller-ecosystem than Temporal; treat the library as the commitment and Conductor as disposable.

**Avoid** for PaperTree: Celery (default `acks_late=False` loses in-flight tasks; Redis visibility-timeout redelivery is a landmine for 20-minute jobs), arq (maintenance-only), Trigger.dev / Cloudflare Workflows / Vercel Workflows (no GPU execution), Prefect/Dagster (data-pipeline shape, plus July-2026 acquisition roadmap uncertainty), Restate (BUSL — usable for PaperTree, but pricing is not publicly verifiable).

**When does the answer change?** Not at a throughput threshold — at these three:
1. **History size, not volume.** Temporal caps a workflow at **51,200 events / 50 MB** and warns at 10,240 / 10 MB. A 40-step audiobook with inline payloads will approach this. Store payloads in S3 and pass keys; if a run still needs >10k events, split into child workflows per chapter. Same applies to Step Functions (25,000 events) and Vercel (25,000 events / 10,000 steps).
2. **~50–100M Actions/month.** At $25–30/M this is $1,250–$3,000/month, at which point self-hosting Temporal (~0.25–0.5 FTE + ~$500/month infra) becomes arguably cheaper. PaperTree is two orders of magnitude away.
3. **Compliance.** HIPAA/SOC2/data-residency requirements force self-host or an enterprise tier long before scale does.

---

## 8. What I could not verify

- **Restate Cloud paid pricing.** `restate.dev/pricing` and `restate.dev/cloud` are client-rendered; a direct `curl` returned only chrome and footer links, and `docs.restate.dev/cloud/pricing` 404s. The only figure I could reach was **50k free actions/month** (from Restate's own blog, "Restate Cloud is Open to Everyone", dated **2025-09-30**). A search snippet claimed "$25/million up to 100M, then $10/million to 200M" — **I could not confirm this on a Restate-owned page and it should be treated as unverified.**
- **Temporal TypeScript SDK release date.** GitHub Releases showed **v1.21.1** released "July 24" without a year visible in the fetched rendering. Version number verified; year not.
- **`@temporalio/worker` npm metadata** — npmjs.com returned HTTP 403 to the fetcher.
- **Hatchet's published limits.** I found no equivalent of Temporal's or Inngest's limits table: max steps per workflow, max run duration, max payload size, and the Developer tier's retention/user/tenant caps are all unverified. Hatchet's `hatchet.run/pricing` also omits included-run counts for the Team and Scale tiers.
- **Hatchet licence carve-outs.** Root `LICENSE` is MIT (Hatchet Technologies Inc., 2023–present). I did **not** verify whether any `ee/`, `enterprise/`, or cloud-only directory carries a separate licence — check before self-hosting.
- **The `workflow` npm package licence** behind Vercel WDK (`workflow-sdk.dev`). Vercel's docs call it "open-source"; I did not read a LICENSE file, so I cannot state the licence.
- **Whether Vercel Workflows / WDK is GA or beta.** Docs reference `workflow` `5.0.0-beta.33` for multi-region, which implies at least parts of the SDK are pre-release; the product page does not label itself beta.
- **DBOS free tier limits.** DBOS's pricing page lists Pro/Teams/Enterprise only. Multiple secondary sources mention a free tier and "6 months free DBOS Pro for startups"; **neither is confirmed on a DBOS-owned pricing page I read**. DBOS Cloud (hosted compute) pricing is separate and unverified. Latest `dbos-transact-py` / `-ts` version numbers were not shown on the GitHub pages fetched.
- **Inngest self-hosting production-readiness in 2026.** Postgres backing and a Helm chart exist per search results, but authentication was documented as out of scope for the self-hosted MVP; I did not confirm whether that is still true.
- **Celery FAQ / `task_acks_late` primary docs** — `docs.celeryq.dev` returned HTTP 429 twice. The `acks_late` default (`False`) and the Redis visibility-timeout redelivery behaviour are sourced from **Celery GitHub issues #5935 and #6229**, which are primary project artifacts but not the reference documentation.
- **pg-boss and BullMQ latest version numbers and release dates** were not displayed on the GitHub landing pages fetched. Feature claims (SKIP LOCKED, DLQ, flows) come from those READMEs.
- **River's use of `SKIP LOCKED`** is implied by its Postgres design but not stated in the README I read. Latest release version not shown.
- **Oban Pro pricing and licence terms** — `oban.pro` was not fetched. Irrelevant to PaperTree (Elixir) but flagged for completeness.
- **My cost table is a model, not a quote.** The Actions-per-step ratio (2.5), events-per-step ratio (3), and the T0/T1/T2 volumes are my assumptions. Temporal Actions in particular are subtle — child workflow starts count as **two** Actions, scheduled workflows cost **three** per execution, every timer and every activity retry is an Action, and the Fairness feature adds 0.1 Actions per Action per hour ([Actions docs](https://docs.temporal.io/cloud/actions)). Validate against a real trace before budgeting.
- **The 22–38 engineer-day DIY estimate is my judgement**, not a measured figure from any source.
