# v0.1 quality panel (3 papers, 3 model judges)

**What this is.** A judged sample: 24 AI answers on 3 papers, scored by 3 model judges. **It is not a grounding rate.** It does not say what share of PaperTree answers are correct. A real grounding rate needs human-written questions (Tier C, #62), which this panel does not have. Read every number below as "what three model judges said about 24 answers", nothing more.

## Method

- **Papers (3):** _Neural Ordinary Differential Equations_, _BERT_, and _Denoising Diffusion Probabilistic Models_ (DDPM). They come from the benchmark corpus and were chosen to differ in kind: a maths-heavy method paper, an empirical NLP paper with many benchmark numbers, and a generative-modelling paper with both. Only three papers were run, so the sample is narrow. No other selection rationale was recorded.
- **Stack:** the real API, worker and agent on one machine, a fresh data root, one registered user, the three PDFs uploaded over HTTP and parsed to `ready`. The MiniMax key was in the agent process environment only.
- **Items (25 generated, 24 scored):**
  - explain: 2 fixed passages per paper (a method passage and a numeric passage), default model (MiniMax-M3.1-Flash-Preview, "Flash"): 6 items. There is no M3 arm for explain.
  - ask: one fixed question per paper ("What are the main limitations the authors acknowledge, and how do they address them?"), default (Flash) vs MiniMax-M3: 3 + 3 items.
  - follow-up: one fixed follow-up per paper ("Which of those is the most serious, and how could someone test that?"), same two arms: 3 + 3 items.
  - summary: one per paper, M3 vs Flash at medium effort ("Flash medium"): 3 + 3 items.
  - One extra item (`neural-odes-ask-default-attempt1-error`) hit a retryable `tool_failed` error and was re-run; the error item is excluded from every table here (one judge scored it with 1s, the others with 0s).
- **Judges (3):** three separate model judges, each given a different brief: judge 1 an ML-researcher read with correctness weighted highest, judge 2 a strict fact-check (claims grepped against the cited blocks and the paper text), judge 3 a PhD-student reader. Each scored every item on four criteria from 1 to 5 (grounded, citations land, readable, useful), and counted unsupported claims and wrong citations. Each also gave a preference for 6 blinded X/Y pairs (ask plus its follow-up judged together as one pair; summary against summary). The pair key was only opened by the aggregator, after scoring.
- **Blinding was imperfect.** The pair file given to judges carried item ids that contain the arm names (`-m3`, `-default`, `-flash-medium`), and judges 1 and 2 say so in their reports. Style differences (Flash's headings and bold lead-ins) also give the arm away. Treat the pair preferences as not blind.
- **Aggregation:** every number below was recomputed from `qual-gen/items.jsonl`, `qual-gen/pairs-key.json` and `qual-judge-{1,2,3}/scores.json` (evidence labels), not copied from the judges' own reports. Means pool the 3 judges.
- **Machine load:** generation ran with a 1-minute load average between about 2.4 and 6.6 (per-arm ranges in the latency table; arms ran at different times, so load differs between arms). Aggregation was done at load averages 2.36 2.99 3.64. Latency comparisons across arms are confounded by load.

## Scores by kind and arm (mean of 3 judges, 1 to 5)

| kind / arm             | n items | grounded | citations land | readable | useful | mean of 4 |
| ---------------------- | ------- | -------- | -------------- | -------- | ------ | --------- |
| explain / default      | 6       | 4.39     | 4.44           | 4.56     | 4.33   | 4.43      |
| ask / default          | 3       | 4.00     | 4.22           | 4.33     | 4.00   | 4.14      |
| ask / m3               | 3       | 4.11     | 4.22           | 4.44     | 4.67   | 4.36      |
| followup / default     | 3       | 3.22     | 3.22           | 4.11     | 3.44   | 3.50      |
| followup / m3          | 3       | 3.78     | 4.22           | 4.00     | 4.11   | 4.03      |
| summary / m3           | 3       | 4.67     | 4.44           | 4.00     | 3.00   | 4.03      |
| summary / flash-medium | 3       | 3.44     | 3.67           | 4.00     | 4.33   | 3.86      |

Per judge:

| kind / arm             | judge | grounded | citations_land | readable | useful |
| ---------------------- | ----- | -------- | -------------- | -------- | ------ |
| explain / default      | J1    | 4.33     | 4.50           | 4.50     | 4.17   |
| explain / default      | J2    | 4.33     | 4.67           | 4.50     | 4.33   |
| explain / default      | J3    | 4.50     | 4.17           | 4.67     | 4.50   |
| ask / default          | J1    | 4.00     | 4.33           | 4.33     | 4.00   |
| ask / default          | J2    | 4.00     | 4.33           | 4.33     | 4.00   |
| ask / default          | J3    | 4.00     | 4.00           | 4.33     | 4.00   |
| ask / m3               | J1    | 4.33     | 4.33           | 4.33     | 4.67   |
| ask / m3               | J2    | 3.67     | 4.00           | 4.33     | 4.33   |
| ask / m3               | J3    | 4.33     | 4.33           | 4.67     | 5.00   |
| followup / default     | J1    | 3.33     | 3.00           | 4.00     | 3.33   |
| followup / default     | J2    | 3.33     | 3.33           | 4.33     | 3.67   |
| followup / default     | J3    | 3.00     | 3.33           | 4.00     | 3.33   |
| followup / m3          | J1    | 4.00     | 4.33           | 4.00     | 4.33   |
| followup / m3          | J2    | 3.67     | 4.00           | 4.00     | 4.00   |
| followup / m3          | J3    | 3.67     | 4.33           | 4.00     | 4.00   |
| summary / m3           | J1    | 5.00     | 4.67           | 4.00     | 3.33   |
| summary / m3           | J2    | 4.67     | 4.67           | 4.00     | 3.00   |
| summary / m3           | J3    | 4.33     | 4.00           | 4.00     | 2.67   |
| summary / flash-medium | J1    | 3.67     | 4.00           | 4.67     | 4.67   |
| summary / flash-medium | J2    | 3.33     | 3.33           | 3.67     | 3.67   |
| summary / flash-medium | J3    | 3.33     | 3.67           | 3.67     | 4.67   |

n is small (3 items for most cells), so a 0.3 gap is one or two scores moving.

## Unsupported claims and wrong citations (counted by each judge, summed)

| kind / arm             | n   | unsupported total (3 judges) | per judge J1/J2/J3 | wrong cites total | per judge |
| ---------------------- | --- | ---------------------------- | ------------------ | ----------------- | --------- |
| explain / default      | 6   | 11                           | 4/3/4              | 1                 | 0/0/1     |
| ask / default          | 3   | 9                            | 3/3/3              | 1                 | 0/0/1     |
| ask / m3               | 3   | 8                            | 2/3/3              | 3                 | 1/1/1     |
| followup / default     | 3   | 15                           | 5/3/7              | 9                 | 3/3/3     |
| followup / m3          | 3   | 8                            | 2/3/3              | 0                 | 0/0/0     |
| summary / m3           | 3   | 3                            | 0/1/2              | 0                 | 0/0/0     |
| summary / flash-medium | 3   | 14                           | 5/4/5              | 4                 | 1/2/1     |

Judges count different things as an "unsupported claim", so the per-judge split matters more than the total.

## Inter-judge agreement

Over the 24 scored items:

| criterion          | mean abs diff (judge pairs) | items where all 3 within 1 point |
| ------------------ | --------------------------- | -------------------------------- |
| grounded           | 0.28                        | 23/24 (96%)                      |
| citations_land     | 0.36                        | 24/24 (100%)                     |
| readable           | 0.19                        | 24/24 (100%)                     |
| useful             | 0.36                        | 23/24 (96%)                      |
| unsupported_claims | 0.36                        | 22/24 (92%)                      |
| wrong_citations    | 0.08                        | 24/24 (100%)                     |

The judges agree closely on the 1-to-5 scores (all three within one point on 23 or 24 of 24 items for every score). That agreement is between three model judges reading the same text, and it does not show the scores are right. They also share the same blind spot: if all three miss an error, it is invisible here.

## Pair preferences, unblinded

Each pair is one question's answers from the two arms. M3 against Flash (default model) for ask plus follow-up; M3 against Flash medium for summary.

| pair                | J1           | J2           | J3           |
| ------------------- | ------------ | ------------ | ------------ |
| neural-odes-ask     | tie          | tie          | default      |
| neural-odes-summary | flash-medium | flash-medium | flash-medium |
| bert-ask            | m3           | default      | default      |
| bert-summary        | m3           | m3           | flash-medium |
| ddpm-ask            | m3           | m3           | m3           |
| ddpm-summary        | m3           | m3           | m3           |

| pair type | judge       | M3 wins | ties | Flash wins |
| --------- | ----------- | ------- | ---- | ---------- |
| ask       | J1          | 2       | 1    | 0          |
| ask       | J2          | 1       | 1    | 1          |
| ask       | J3          | 1       | 0    | 2          |
| ask       | all 9 votes | 4       | 2    | 3          |
| summary   | J1          | 2       | 0    | 1          |
| summary   | J2          | 2       | 0    | 1          |
| summary   | J3          | 1       | 0    | 2          |
| summary   | all 9 votes | 5       | 0    | 4          |

Votes are 3 pairs x 3 judges per type. Per pair, `ddpm-ask` and `ddpm-summary` went to M3 on all 3 judges, `neural-odes-summary` went to Flash medium on all 3, and the rest split.

## API's own "supported" flag against the judges

The API marks each citation `supported` or not after a verifier pass. Share of citations flagged supported, next to the judges' mean grounded and citations-land scores:

| kind / arm             | API supported cites | API supported share | judge grounded (of 5) | judge citations_land (of 5) | grounded as % of 5 |
| ---------------------- | ------------------- | ------------------- | --------------------- | --------------------------- | ------------------ |
| explain / default      | 20/29               | 69%                 | 4.39                  | 4.44                        | 88%                |
| ask / default          | 15/20               | 75%                 | 4.00                  | 4.22                        | 80%                |
| ask / m3               | 14/19               | 74%                 | 4.11                  | 4.22                        | 82%                |
| followup / default     | 0/18                | 0%                  | 3.22                  | 3.22                        | 64%                |
| followup / m3          | 1/15                | 7%                  | 3.78                  | 4.22                        | 76%                |
| summary / m3           | 37/43               | 86%                 | 4.67                  | 4.44                        | 93%                |
| summary / flash-medium | 44/50               | 88%                 | 3.44                  | 3.67                        | 69%                |

- For explain and ask the API's share (69% to 75%) and the judges' grounded scores (4.00 to 4.39 of 5) are at a broadly similar level, but they measure different things and should not be set equal.
- **Follow-up citations are almost never flagged supported (1 of 33)** while the judges still found most follow-up citations land (3.22 to 4.22 of 5). The judges disagree with the verifier there. This panel does not explain why; do not read the verifier's follow-up number as an accuracy figure.
- Summary: Flash medium's supported share (88%) is slightly higher than M3's (86%), yet the judges scored Flash medium lower on grounded (3.44 against 4.67). The verifier did not see the errors the judges found, such as the inverted claims below.

## Latency and cost

Cost is the API's estimate (`cost_usd_est`), not a bill. Latency is end to end per item.

| kind / arm             | n   | median latency s | median first text s | mean cost $ | total cost $ | load avg (1 min) range |
| ---------------------- | --- | ---------------- | ------------------- | ----------- | ------------ | ---------------------- |
| explain / default      | 6   | 6.2              | 2.9                 | 0.0017      | 0.0101       | 4.45-6.59              |
| ask / default          | 3   | 16.9             | 13.7                | 0.0048      | 0.0143       | 4.77-5.47              |
| ask / m3               | 3   | 20.3             | 16.1                | 0.0064      | 0.0191       | 2.5-3.98               |
| followup / default     | 3   | 10.2             | 2.4                 | 0.0040      | 0.0119       | 4.1-5.4                |
| followup / m3          | 3   | 16.3             | 10.6                | 0.0060      | 0.0180       | 2.41-3.63              |
| summary / m3           | 3   | 10.0             | 7.0                 | 0.0026      | 0.0078       | 5.48-5.55              |
| summary / flash-medium | 3   | 8.6              | 6.3                 | 0.0046      | 0.0138       | 2.36-3.21              |

Summary status: M3 {complete: 2, partial: 1} (the partial is `bert-summary-m3`); Flash medium {complete: 3}. In this sample Flash medium summaries cost more than M3 ones (about $0.0046 against $0.0026 per item) because they used more input tokens and tool calls (mean input 10,109 against 4,730 tokens; 2.7 tool calls against 0).

## What is weak, with examples

Short quotes from the judges' notes; each of these was found by at least one judge reading the paper text.

- **Flipped facts.** `neural-odes-explain-numeric`: judge 1 notes the passage says the density "CAN be evaluated", the answer says it cannot. `bert-summary-flash-medium`: says NSP data "cannot be trivially generated"; the paper says it can. `ddpm-summary-flash-medium`: stronger decoder "would not be straightforward"; the paper says it would be. These flips are what pulls the Flash medium summary grounded score down.
- **Missed stated limitation.** `ddpm-ask-default` misses "non-competitive log likelihoods", which the paper states in its own introduction; the default follow-up then builds on the miss. All three judges flag this.
- **Backwards reading in M3 too.** `ddpm-followup-m3` mislabels "late (high-noise) steps" as governing fine detail. Fine detail is at low noise. All three judges flag this.
- **Invented quote.** `bert-ask-m3`: judge 2 finds the quoted "beyond the scope of this paper" absent from the paper.
- **Wrong citations on follow-ups.** `ddpm-followup-default` cites b46 (latent stochasticity) for the 1000-step chain and a marker with no cited block; nine of the 18 wrong citations in this sample sit on default follow-ups.
- **Thin summaries.** M3 summaries scored lowest on useful (3.00): no headline results numbers (for DDPM, no FID) and a meta bullet saying the digest does not state limitations. Flash medium summaries scored higher on useful (4.33) with concrete numbers, at the cost of grounding.
- **Little coverage of the failure modes we care most about.** 3 papers, 4 kinds, 1 question per paper per kind, 3 model judges: this does not test OCR-heavy or table-heavy papers, long papers, or questions a person would really ask.

## Model policy evidence

This section reports numbers only. It does not decide policy. The decision is in ADR-003 and the earlier single-judge A/B is in `MODEL-AB.md`.

**Ask (ask plus follow-up, Flash default against M3, n = 6 answers per arm, 3 papers):**

- Mean of the four scores: ask Flash 4.14 against M3 4.36; follow-up Flash 3.50 against M3 4.03. M3 is higher on every cell except readable on follow-up (Flash 4.11, M3 4.00) and equal on citations land for ask (4.22 each).
- Grounded: ask Flash 4.00 against M3 4.11; follow-up Flash 3.22 against M3 3.78.
- Defects (3 judges summed): unsupported claims Flash 24 (ask 9, follow-up 15) against M3 16 (8 and 8); wrong citations Flash 10 (1 and 9) against M3 3 (3 and 0).
- Pair votes: M3 4, ties 2, Flash 3 (9 votes). The three papers split: ddpm to M3 on all judges; bert and neural-odes split.
- On this sample Flash did not hold quality against M3 on follow-ups (grounded 3.22 against 3.78, 9 against 0 wrong citations), and was closer on the first ask answer (4.00 against 4.11 grounded). With 3 items per cell this is a direction, not a measurement.

**Summary (Flash medium against M3, n = 3 per arm):**

- Grounded: Flash medium 3.44 against M3 4.67; citations land 3.67 against 4.44; readable 4.00 each; useful Flash medium 4.33 against M3 3.00.
- Defects: unsupported claims Flash medium 14 against M3 3; wrong citations 4 against 0.
- Pair votes: M3 5, Flash medium 4 (9 votes, no ties). neural-odes went to Flash medium on all 3 judges; ddpm went to M3 on all 3.
- Status: Flash medium 3 complete of 3; M3 2 complete and 1 partial.
- On this sample Flash medium did not hold quality on grounding (3.44 against 4.67, with the flipped facts above), while being rated more useful (4.33 against 3.00) and preferred in 4 of 9 pair votes.

**Explain:** only the Flash default arm was run in this panel (6 items, mean of four scores 4.43, grounded 4.39, 11 unsupported claims and 1 wrong citation summed over 3 judges). There is no M3 explain arm here, so no comparison can be made from this panel; see `MODEL-AB.md` for the earlier explain A/B.

## Limits, once more

- A judged sample of 3 papers by 3 model judges, with one fixed question per paper per kind. Not a grounding rate.
- The judges are language models that read the same texts, partly saw arm names, and may share biases (for example towards longer or more structured answers).
- Cells have 3 items, so small gaps are noise. No significance testing was done.
- The grounding rate that can be quoted outside this repo still needs human-written questions and human scoring (Tier C, #62).

Evidence (labels, kept outside the repo): `qual-gen/items.jsonl`, `qual-gen/pairs-key.json`, `qual-judge-1/scores.json`, `qual-judge-2/scores.json`, `qual-judge-3/scores.json`, and each judge's `REPORT.md`.
