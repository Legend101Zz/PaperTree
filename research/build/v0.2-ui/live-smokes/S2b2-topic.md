# S2b2 live smoke: the topic suggestion run (issue #242)

2026-10-17. Redacted: no key, secret, token or header. All figures are estimates (Flash is priced on
M3 rates, `estimate on M3 rates`).

## Setup

- API from the `v02-s2b2` worktree on 127.0.0.1:18908 against a copy of the build data root; agent
  from the same worktree on 127.0.0.1:18903 with the real MiniMax key in its environment only.
- A fresh account whose topics are "Transformers & attention" and "Vision & detection"; one real
  upload, DDPM (`research/benchmarks/fresh/pdfs/ddpm-2006.11239.pdf`), parsed by the real worker.
  Its arXiv category (cs.LG) is held by no topic, so the deterministic rule has nothing to say.
- The daily budget of that API was set to $0.05 for the smoke.

## The call (`GET /papers/{id}/topic`, the first read after the parse)

| Item | Value |
| --- | --- |
| Input: title | Denoising Diffusion Probabilistic Models |
| Input: category | cs.LG |
| Input: existing topic names | "Transformers & attention", "Vision & detection" |
| Input: abstract excerpt | 801 characters from the parsed `abstract` blocks ("We present high quality image synthesis results using diffusion probabilistic models, ...") |
| Model | minimax/MiniMax-M3.1-Flash-Preview (effort low) |
| Tokens in / out | 748 in (190 of them cache read) / 67 out (29 reasoning) |
| Estimated cost | $0.000316 |
| Latency | 2,280 ms in the agent (first text 2,278 ms); 2.7 s wall for the whole request |
| Validated | yes: the agent's `topic_valid: true`, then the API's own check |
| Stored | `status: suggested`, `source: model`, `source_detail: MiniMax-M3.1-Flash-Preview`, topic "Vision & detection"; nothing shelved |
| Second read | byte-identical, no second call (one `ai_runs` row of kind `topic`, `done`, 0 tool calls) |

## Raw answer

The first call's text is not stored anywhere (the API keeps usage, not the model's words), so the raw
answer was captured by sending the SAME request (same title, category, topic names and abstract
excerpt) straight to the agent once more, outside the API (no `ai_runs` row). Second call: 699 in
(190 cache read) / 81 out (42 reasoning), $0.000318, 2,239 ms.

```json
{"topic_name":"Vision & detection","is_new":false,"reason":"The paper focuses on high-quality image synthesis using diffusion probabilistic models, fitting the existing computer vision topic."}
```

It validates (zod in the agent, pydantic in the API): `topic_name` is one of the existing names with
`is_new: false`, within 60 characters, with one sentence of reason. The two calls' answers agree on the
topic; the first call's wording of the reason is NOT CONFIRMED (not captured).

## Spend

Two calls, about $0.00063 in total (limit for this slice: $0.05).

## What this does not show

- One paper. Whether Flash proposes sensible NEW names when nothing fits, and how often it breaks the
  one-object format, is NOT CONFIRMED (the faux `[faux:topic-new]` and `[faux:topic-bad]` paths are
  tested, a live miss is not).
- "Vision & detection" for a diffusion paper is a judgement call: the person's list had no
  generative-models topic, and the prompt prefers an existing topic.
