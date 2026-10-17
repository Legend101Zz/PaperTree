# S7b live diagram smoke (#217)

One "Explain with a diagram" against the live MiniMax agent, 2026-10-17 02:45 IST (21:15:20Z), at 1440 × 900, on a
copy of the demo data root (`demo@example.test`, "Attention Is All You Need", `ppr_G9AYN750E5MG1NRBMGSQJ4N5JM`).
Stack: this branch's API (127.0.0.1:18906), web (18905) and agent (18907); the agent got the key from the Keychain in
the environment of the command that started it, nothing else held it, and it was stopped by its PID right after the
run. One run, no retries.

## The run

| What | Value |
| --- | --- |
| Passage | §3.2.1 ¶1, p. 4, selected with the mouse in Source: "We call our particular attention "Scaled Dot-Product Attention" (Figure 2). The input consists of queries and keys of dimension dk, and values of dimension dv. We compute the dot products of the query with all keys, divide each by √dk, and apply a softmax function to obtain the weights on the" |
| Model | `MiniMax-M3.1-Flash-Preview`, effort low (the shipped default for `diagram`, ADR-003) |
| Tokens | 4,487 in (4,416 of them cache reads), 351 out; reasoning not reported separately (`null`) |
| Cost | ≈ $0.0020 (estimate, on M3 rates: MiniMax publishes no Flash price) |
| Time to first part | 2,981 ms (API `first_text_ms`, the first plate line); 3,411 ms from the click to the first key row in the browser |
| Total | 3,970 ms (API `latency_ms`); 4,210 ms from the click to the finished plate in the browser |
| Parts | 6: **6 cited**, 0 not verified, 0 inferred; no `link` lines |
| Status frames | `thinking` "Reading the selected passage"; `tool` "Reading p. 4 · b1" (one `get_passage`); `writing`. **No skipped line, no dropped arrow.** |
| Agent end | `complete`, stop reason `stop`, 2 turns, 1 tool call, `thinking_chars` 0, 1,291 characters of model text |
| Readout | "6 parts · 6 cited · drawn by AI from p. 4" |
| Usage line | "4,838 tokens · ≈ $0.0020 (estimate)" |

## The plate the model drew

| Part | Label (kind) | After (edge label) | Quote | Tab |
| --- | --- | --- | --- | --- |
| A | Queries and keys (dk) (input) | — | "The input consists of queries and keys of dimension dk" | p. 4 ¶1 |
| B | Values (dv) (input) | — | "and values of dimension dv" | p. 4 ¶1 |
| C | Dot products QK^T (step) | A (scores) | "We compute the dot products of the query with all keys" | p. 4 ¶1 |
| D | Divide by sqrt(dk) (step) | C (scaling) | "divide each by √dk" | p. 4 ¶1 |
| E | Softmax (step) | D (normalise) | "apply a softmax function to obtain the weights on the values" | p. 4 ¶1 |
| F | Weighted sum of values (output) | E (weights), B (weighted by) | "the weight assigned to each value is computed by a compatibility function" | p. 4 |

Every quote resolved word for word (`supported: true`, an Anchor each). The labels are the model's: it wrote `QK^T` and
`sqrt(dk)` in ASCII where the paper sets symbols. F's quote is from §3.2's carry-over paragraph at the top of p. 4 (the
parse counts no ¶ for it, so its tab is "p. 4").

## Does each cited part's flash land on the right passage?

Each key row was pressed in turn; the text-layer lines under the flashed polygon were read back.

| Part | Flashed passage | Holds the quote? |
| --- | --- | --- |
| A–E | §3.2.1 ¶1 ("We call our particular attention … weights on the"), tab "p. 4 ¶1 · from part A…E" | yes, all five |
| F | p. 4's first lines ("of the values, where the weight assigned to each value is computed by a compatibility function of the query with the corresponding key."), tab "p. 4 · from part F, Weighted sum of values" | yes |

6 of 6 land on the passage that holds the quote. The flash marks the whole paragraph, not the quoted words: S7a stores
a part's Anchor on the block (`evidence.mint_block_anchor`), so five parts on ¶1 flash the same paragraph.

## Did Flash's thinking fit the output cap?

On this run, yes, with room: the diagram cap is 2,048 output tokens (`LIMITS["diagram"]`, flagged NOT CONFIRMED by
S7a) and the run used 351 output tokens, ended with stop reason `stop` (not `length`), and logged 0 thinking
characters at effort low. The provider does not report reasoning tokens separately, so the 351 is everything it
counted as output. One run on one passage is not a distribution: a twelve-part plate or a harder passage is not
measured.

## Shots

- `07c-live-as-run-1440-light.png`: the browser at the end of the run, as drawn then.
- `07c-live-1440-light.png`, `-dark.png`, `07c-live-flash-F-1440-light.png`: the same stored plate re-opened from the
  thread menu after the label fitting was improved (two-line box labels, edge labels cut to their lane). No new run:
  the re-open sent 0 requests to `/threads`.

Spend: ≈ $0.0020 of this slice's $0.30 (estimate).
