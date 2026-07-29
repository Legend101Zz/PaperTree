# 14 — TTS and Document-to-Audio Pipelines with Source Synchronisation

**Research date: 2026-07-29.** Most recent primary evidence collected: GitHub API metadata pulled 2026-07-29 (commit/release dates current to 2026-07-27).

**Scope.** How to turn a parsed paper into listenable narration where every moment of audio maps back to a block in the document (page + bounding box) — PaperTree's "Paper Replay". This document assumes the parsing stack already produces the geometry and section tree described in the hard requirements; the concern here is what the audio layer must *preserve*, not how the tree is built.

---

## 1. The decisive question: what timestamps does each engine return?

Everything about Paper Replay reduces to one question — can I recover, for an arbitrary audio time `t`, the position in the *input text* that was being spoken? Vendors differ enormously here, and marketing pages do not surface the difference.

| System | Timestamp granularity | Offsets back into input text? | SSML | Streaming | List price | Licence / hosting |
|---|---|---|---|---|---|---|
| **Azure Speech** | **Word + punctuation + sentence** (`WordBoundary`), plus **arbitrary `<bookmark>`** (`BookmarkReached`), plus visemes | **Yes** — `TextOffset` + `WordLength` are character indices into the submitted text/SSML ([docs](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis)) | Full W3C SSML incl. `bookmark`, `phoneme`, `say-as` | Yes | ~$16 / 1M chars neural (see §5 caveat) | Proprietary SaaS, no self-host |
| **Amazon Polly** | **Word + sentence + SSML `<mark>` + viseme** speech marks | **Yes** — `start`/`end` are **byte offsets** into input text ([docs](https://docs.aws.amazon.com/polly/latest/dg/output.html)) | Yes incl. `<mark>` | Yes | not verified from primary source | Proprietary SaaS |
| **ElevenLabs** | **Character-level** `alignment` + `normalized_alignment` arrays, in seconds ([docs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)) | Implicitly — index in the character array *is* the input index | Limited (breaks, phoneme tags) | Yes (`stream/with-timestamps`) | $0.05/1k chars Flash-Turbo; $0.10/1k Multilingual v2/v3 ([pricing](https://elevenlabs.io/pricing/api)) | Proprietary SaaS |
| **Google Cloud TTS** | **Mark-level only** — SSML `<mark>` + `enableTimePointing=SSML_MARK`, v1beta1 ([SSML docs](https://docs.cloud.google.com/text-to-speech/docs/ssml)) | Only at marks you insert | Yes; **not in streaming requests** for Chirp 3 HD ([Chirp 3 docs](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd)) | Yes | not verified from primary source | Proprietary SaaS |
| **OpenAI TTS** (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`) | **None** — no timestamps, no word boundaries | No | **No SSML** ([docs](https://developers.openai.com/api/docs/guides/text-to-speech)) | Yes (chunked) | — | Proprietary SaaS; requires disclosure that voice is AI-generated |

**Azure is the only vendor that gives all three of word boundaries, arbitrary bookmarks, and character offsets into the source string.** `AudioOffset` is in ticks (100 ns); convert with `(offset + 5000) / 10000` for ms. Polly is the close second and its byte-offset design is arguably cleaner. Google is mark-only — usable but you must instrument the SSML yourself, and the Chirp 3 HD documentation does not mention timepoints at all. OpenAI TTS is **disqualified** for Paper Replay on its own; it would require a separate forced-alignment pass.

### Cost per 1000 words

Assuming ~6.1 characters per English word including the trailing space:

| Engine | $ per 1000 words (derived) | $ for a typical 8,000-word paper |
|---|---|---|
| Azure neural | ~$0.098 | ~$0.78 |
| ElevenLabs Flash v2.5 | ~$0.305 | ~$2.44 |
| ElevenLabs Multilingual v2 | ~$0.61 | ~$4.88 |
| Kokoro-82M self-hosted | ~$0 marginal (CPU time only) | ~11 min CPU on 32 vCPU |

These are *my arithmetic* on vendor list prices, not vendor-quoted per-word figures.

ElevenLabs model constraints matter for long-form: Eleven v3 caps at **5,000 characters** per request, Multilingual v2 at **10,000**, Flash v2.5 at **40,000**, with Flash quoting **~75 ms** latency ([models doc](https://elevenlabs.io/docs/overview/models)). ElevenLabs itself recommends Multilingual v2 as "most stable on long-form generations". Any paper will need chunking regardless.

---

## 2. Open / self-hosted models — licences are the whole story

Code licence and weight licence diverge sharply here, and two of the most-recommended models are commercially unusable.

| Model | Code licence | **Weight licence** | Verdict for a commercial product |
|---|---|---|---|
| **Kokoro-82M** | Apache-2.0 | **Apache-2.0** | **Usable.** 82M params, StyleTTS2 + ISTFTNet. Trained "exclusively on permissive/non-copyrighted audio data" ([model card](https://huggingface.co/hexgrad/Kokoro-82M)) |
| **Chatterbox** (Resemble AI) | MIT | **MIT** ([HF card](https://huggingface.co/ResembleAI/chatterbox)) | **Usable.** 500M multilingual / 350M turbo / 110M nano |
| **Piper** | **GPL-3.0** | Voice collection MIT ([rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)); per-voice `MODEL_CARD` files vary | **Usable with care** — see below |
| **XTTS-v2 / Coqui** | MPL-2.0 (idiap fork) | **CPML — non-commercial only** | **REJECT** |
| **F5-TTS** | MIT | **CC-BY-NC** (Emilia training data) ([repo](https://github.com/SWivid/F5-TTS)) | **REJECT** |

**XTTS-v2 is a hard reject.** The weights are under the Coqui Public Model License, which permits non-commercial use only — and Coqui Inc. shut down in January 2024, so there is no counterparty from whom to buy a commercial licence. The code fork ([idiap/coqui-ai-TTS](https://github.com/idiap/coqui-ai-TTS), MPL-2.0, v0.27.5 released 2026-01-26) is alive; the weights are not licensable. **F5-TTS is a hard reject for the same class of reason**: MIT code, but the published checkpoints inherit CC-BY-NC from the Emilia dataset.

**Piper's GPL-3.0 is a flag, not a blocker.** [`OHF-Voice/piper1-gpl`](https://github.com/OHF-Voice/piper1-gpl) is GPL-3.0 and very actively maintained (v1.6.0 on 2026-07-23; last push 2026-07-27). GPL-3.0 means PaperTree must not statically link or embed Piper into proprietary code — invoking it as a separate CLI process is the standard mitigation, but this is a legal question, not an engineering one. Per-voice licences must be audited individually; the collection-level MIT tag does not settle it.

**Kokoro's maintenance is the concern, not its licence.** The [`hexgrad/kokoro`](https://github.com/hexgrad/kokoro) inference package's last commit is **2025-08-06** — roughly a year stale as of this writing, with 195 open issues. The weights are permanent and permissive; the wrapper code may need vendoring.

**Speed.** A third-party AWS benchmark ([gist](https://gist.github.com/efemaer/23d9a3b949b751dde315192b4dcf0653)) measured Kokoro v1.0 at **~5x realtime on CPU** (c6a.8xlarge, 32 vCPU, PyTorch and ONNX equivalent) and **96x realtime on an A10G GPU**. Chatterbox Nano (110M) is self-reported at **3x realtime on 8 CPU cores**. Both are viable on the no-GPU-initially constraint for background batch jobs: a 53-minute narration of an 8,000-word paper costs roughly 11 minutes of CPU on Kokoro.

**Chatterbox caveat:** all Chatterbox output carries Resemble AI's *Perth* neural watermark by default. That is fine — arguably good — for PaperTree, but it is a fact to know.

**None of the open models emit word timestamps natively.** This is the critical gap, and §4 resolves it.

---

## 3. Forced alignment as a timestamp-recovery fallback

| Tool | Licence | Method | Accuracy | Maintenance (as of 2026-07-29) |
|---|---|---|---|---|
| **Montreal Forced Aligner** | MIT | Kaldi GMM-HMM, Viterbi | ~21.9 ms mean absolute word-boundary deviation on TIMIT (third-party) | **Healthy** — v3.4.1, 2026-07-11 |
| **WhisperX** | BSD-2-Clause | wav2vec2 phoneme model + alignment | 70x realtime (large-v2), <8 GB VRAM ([repo](https://github.com/m-bain/whisperX)) | **Healthy** — v3.8.6, 2026-05-25 |
| **ElevenLabs Forced Alignment API** | Proprietary SaaS | hosted | per-word **and** per-char, with a per-word confidence/loss score; ≤10 h audio, ≤675k chars ([docs](https://elevenlabs.io/docs/overview/capabilities/forced-alignment)) | Vendor-maintained |
| **aeneas** | **AGPL-3.0** | DTW on MFCCs | — | **DEAD** — last commit 2020-05-13, last release v1.7.3 (2017-03-16) |
| **stable-ts** | MIT | Whisper cross-attention | — | **ARCHIVED** — final commit 2026-05-30 "Add note about paused development" |

**aeneas is a double reject: AGPL-3.0 *and* abandoned since 2020.** AGPL is the most dangerous licence class for a hosted product — network use triggers source disclosure. **stable-ts is archived**; adopting a newly-archived dependency is a needless liability.

MFA is the accuracy leader. A published comparison ([Kelley et al., *The Mason-Alberta Phonetic Segmenter*, arXiv:2310.15425](https://arxiv.org/abs/2310.15425)) uses MFA as the benchmark to beat, and a [WhisperX issue thread](https://github.com/m-bain/whisperX/issues/1247) reports WhisperX word timestamps as materially less precise than MFA. The mechanism is understood: MFA does frame-level phoneme-state Viterbi decoding; WhisperX uses a lighter end-to-end phoneme model. **However, none of this precision matters much for PaperTree** — see §4.

The ElevenLabs Forced Alignment API's **per-word confidence score** is the most interesting feature in this table, because it makes uncertainty representable rather than silent.

---

## 4. The architectural insight: don't rely on the timestamp API at all

**Synthesise each segment as its own audio file, then concatenate.** Segment boundaries then have *exact*, arithmetically-known timings — the start time of segment *n* is the sum of the durations of segments 0..n-1. No alignment, no vendor timestamp API, no drift.

This collapses the vendor decision:

- **Segment-level sync (highlight the current paragraph/equation/caption) is free from any engine**, including OpenAI TTS and every open local model. It is exact by construction.
- **Word-level sync (karaoke highlighting within a paragraph) is the only thing needing a timestamp API** — and it is a polish feature, not the core product.

This means PaperTree is not locked to Azure. It should ship segment-level sync everywhere and treat word-level as a per-engine enhancement.

### Recommended pipeline

1. **Script builder.** Walk the section tree in reading order. Emit an ordered list of segments, each carrying `{segment_id, block_id, page, bbox, kind, text}`. `kind ∈ {heading, prose, equation, caption, table_summary, footnote}`. Skip or defer running heads, page numbers, references.
2. **Verbalise per kind** (§5 for equations, §6 for figures).
3. **Synthesise per segment.** Emit one audio buffer per segment; measure its exact duration.
4. **Instrument for word-level where supported.** On Azure, prefix each segment with `<bookmark mark="seg_00123"/>` and collect `BookmarkReached` + `WordBoundary`; on ElevenLabs, keep the character alignment array. Both are *additive* on top of the exact segment timings — used to refine, never to establish, the mapping.
5. **Concatenate** with a small fixed inter-segment pause, and persist a **sync map**:
   `[{segment_id, block_id, page, bbox, t_start, t_end, words?: [{t_start, t_end, char_range}]}]`
6. **Optional recovery path.** If audio ever exists without a sync map (a re-encoded file, an imported narration), run **MFA** (MIT, CPU-viable) or WhisperX against the known script to rebuild it. This is a repair tool, not the primary path.

Because the sync map keys on `block_id`, it inherits whatever stability the parser's block identity has — the same anchoring problem as highlights, already solved once. Re-parses invalidate the map exactly when they invalidate highlights, and no more.

---

## 5. Speaking mathematics — reuse, do not invent

This is a solved accessibility problem with a mature, permissively-licensed implementation.

**[Speech Rule Engine (SRE)](https://github.com/speech-rule-engine/speech-rule-engine)** — Apache-2.0, v5.0.0-rc.4 released 2026-07-02, actively maintained. Takes **MathML** and emits speech strings. It implements the full **MathSpeak** and **ClearSpeak** rule sets plus **Nemeth braille**, in a dozen-plus languages. It is the engine behind MathJax's accessibility extensions.

Two properties make it near-ideal for PaperTree:

- **It can emit SSML directly** (also VoiceXML, Sable, ACSS) — so equation prosody, pauses and emphasis are generated for you rather than hand-tuned.
- **ClearSpeak exposes fine-grained preferences**, so PaperTree can offer a genuine reading-style setting instead of a single canned voice. MathSpeak's three verbosity settings serve the same purpose more coarsely.

**Pipeline:** `LaTeX → MathML → SRE (ClearSpeak) → SSML fragment`, wrapped in a `<bookmark>` carrying the equation's `block_id`. Since PaperTree already requires equations recoverable as LaTeX with the source region retained, the input side is free.

**[MathCAT](https://github.com/NSoiffer/MathCAT)** (MIT, Rust) is the credible alternative — MathML to speech and braille, shipping inside NVDA and JAWS, so it is battle-tested against real screen-reader users. It is the better choice if a native/Rust binary is preferable to a Node dependency.

**Degradation rule:** if MathML conversion fails or SRE returns low-confidence output, PaperTree should *say so* — "Equation 3, displayed" — and let the reader look at it, rather than narrate a mangled expression. Silence about failure is the failure mode to avoid.

---

## 6. Describing figures for audio

The governing reference is **Lundgard & Satyanarayan, "Accessible Visualization via Natural Language Descriptions: A Four-Level Model of Semantic Content", IEEE TVCG (InfoVis) 2022** ([arXiv:2110.04406](https://arxiv.org/abs/2110.04406)). Its four levels:

1. **Construction properties** — marks, encodings, axes ("a scatter plot of accuracy against parameter count").
2. **Statistical concepts and relations** — extrema, correlations, ranges.
3. **Perceptual and cognitive phenomena** — trends, clusters, outliers.
4. **Domain-specific insight** — what it means for the field.

The paper's key empirical finding is that **blind and sighted readers differ significantly in which levels they find useful**, which argues for making verbosity a user setting rather than a fixed choice.

For PaperTree this maps cleanly onto the no-hallucination requirement: **L1 and L2 are grounded** in the figure and its caption and are safe to auto-generate; **L3 and especially L4 are interpretation** and are where a VLM will confabulate. Ship L1+L2 by default, gate L3 behind explicit opt-in, and never auto-generate L4.

Supporting literature: **VisText** ([ACL 2023](https://aclanthology.org/2023.acl-long.401.pdf)), 12,441 chart–caption pairs organised on exactly this semantic hierarchy; and **FigurA11y** (Singh, Wang & Bragg, [IUI 2024](https://dl.acm.org/doi/10.1145/3640543.3645212), code at [allenai/figura11y](https://github.com/allenai/figura11y)), a human-in-the-loop system for scientific alt text that drafts from figure *and paper* metadata — evidence that grounding descriptions in surrounding text, not just pixels, is what makes scientific figure description work.

**Vector figures** (most CS architecture diagrams) are a real risk here: a raster-only VLM path will silently rasterise and lose the label text that makes such diagrams describable. Feeding extracted vector text runs alongside the rendered image materially improves grounding.

---

## 7. Implications for PaperTree

1. **Adopt the per-segment-synthesis architecture.** It makes segment-level source sync exact and engine-independent, and reduces the TTS vendor from a lock-in decision to a swappable quality/cost knob.
2. **Default engine: Kokoro-82M** (Apache-2.0 code *and* weights, ~5x realtime on CPU) for the free tier and for cost control. It satisfies the "no dedicated GPU initially" constraint on a background worker.
3. **Premium engine: Azure Speech.** Uniquely offers word boundaries + SSML bookmarks + character offsets into the source string, full SSML (which SRE's math output needs), and ~$0.10 per 1000 words. ElevenLabs is the quality leader at 3–6x the price, with character-level alignment that is finer than needed.
4. **Do not use OpenAI TTS for Paper Replay.** No timestamps and no SSML — the latter kills the equation-verbalisation path independently of the timestamp issue.
5. **Reject XTTS-v2 and F5-TTS outright** on weight licences (CPML non-commercial; CC-BY-NC). Reject aeneas (AGPL-3.0 + dead) and stable-ts (archived). Treat Piper's GPL-3.0 as requiring process isolation and a per-voice licence audit.
6. **Reuse SRE or MathCAT for equations.** Both Apache-2.0/MIT. Building a LaTeX-to-speech verbaliser in-house would be re-solving a twenty-year accessibility problem badly.
7. **Bound figure descriptions to L1+L2** of the Lundgard–Satyanarayan model, and mark them audibly as machine-generated. This is the audio expression of the no-silent-hallucination requirement.
8. **Keep MFA (MIT) as the repair tool.** It is the accuracy leader and runs on CPU. It should never be on the hot path.

---

## 8. What I could not verify

- **Google Cloud TTS and Azure Speech list prices.** Both pricing pages render their tables via JavaScript and returned no table content to my fetches. The Azure figure of **$16 per 1M characters** for neural TTS and Google's per-voice-type tiers come from search-result summaries and secondary blogs, **not** from the official pricing pages. **Treat every price in this document as indicative and re-check before committing.** The ElevenLabs figures ($0.05/$0.10 per 1k chars) *were* read off the official pricing page.
- **Amazon Polly pricing** — not verified from primary source at all.
- **Polly's and Azure's behaviour on very long inputs** (chunking limits, whether offsets remain absolute across chunks) — not tested.
- **WhisperX vs MFA head-to-head numbers.** The 21.9 ms MFA figure and the TIMIT tolerance percentages come from a third-party topic summary, not from a paper I read directly; the MFA official benchmark page returned HTTP 429 on repeated attempts. The *direction* of the finding is corroborated by the WhisperX issue tracker, but the specific numbers are unconfirmed.
- **Per-voice Piper licences.** The docs state each voice's `MODEL_CARD` carries its own licensing and must be reviewed; I did not enumerate them. The MIT tag on the HF collection may not hold for every voice.
- **Chatterbox training-data provenance and hours.** The card claims 0.5M hours "cleaned data" with no provenance statement — relevant because provenance is exactly what made F5-TTS's weights non-commercial. Chatterbox declares MIT weights, but I could not verify the underlying data rights.
- **Kokoro quality tier.** The model card mentions TTS Arena participation but publishes no Elo or MOS figures; the "comparable to larger models" claim is self-reported. No listening test conducted.
- **SRE v5 stability.** v5.0.0-rc.4 (2026-07-02) is a *release candidate*; the last stable major is v4. Verify before depending on v5 APIs.
- **Real-world sync accuracy** of the proposed concatenation approach — untested. Inter-segment pause handling and any engine-side leading/trailing silence trimming will need empirical calibration.
