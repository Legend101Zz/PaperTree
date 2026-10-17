# PaperTree v0.2 product video: credits

`papertree-v0.2.mp4`, `demo.gif` and `poster.png` show real screen recordings of PaperTree v0.2.0
(`release/v0.2` at `065f709`, production web build) on real papers, recorded on 2026-10-17. The UI
is shown as recorded: it is cropped, pushed in on and slowed or sped up, but never rebuilt. The two
answers on screen (the explanation and the diagram) are the live MiniMax M3.1 Flash outputs from the
recording session. The rings, the drawn thread, the chapter labels, the ink slab in the opening shot
and the title cards were added in the video.

## Tools

| Tool                                                                                                           | Version                          | Licence                           | Used for                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [HyperFrames](https://github.com/heygen-com/hyperframes) (heygen-com)                                          | CLI 0.8.168; skills at `b18b3e9` | Apache-2.0                        | composition, the product-launch-video workflow (BRIEF, frame preset, storyboard, script, audio, captions, assembly, transitions), lint/check/snapshot, render |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (hexgrad), voice `af_heart`                            | model v1.0 (ONNX)                | Apache-2.0                        | narration, synthesized locally                                                                                                                                |
| [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx)                                                     | 0.6.1                            | MIT                               | the local Kokoro runtime the CLI calls                                                                                                                        |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) with the `ggml-small.en` model (OpenAI Whisper weights) | Homebrew `whisper-cli`           | MIT (code and weights)            | word timings for the captions, transcribed locally                                                                                                            |
| [GSAP](https://gsap.com)                                                                                       | 3.14.2                           | GSAP Standard "No Charge" licence | the compositions' paused, seekable timelines                                                                                                                  |
| [FFmpeg](https://ffmpeg.org)                                                                                   | 8.1.2                            | LGPL/GPL (Homebrew build)         | the encode, the GIF, the poster                                                                                                                               |

No paid service was used, and there was no sign-in: no HeyGen, ElevenLabs or Gemini. HyperFrames
telemetry was off (`DO_NOT_TRACK=1`, `HYPERFRAMES_NO_TELEMETRY=1`).

## Sound

- **Narration:** Kokoro `af_heart`, at natural speed (1.0). Each line was split only at its own
  pauses and placed on the footage event it names. Nothing was time-stretched.
- **Music:** none.
- **Level:** the delivered MP4's audio is normalized to −16 LUFS integrated (true peak −1.5 dBFS)
  with FFmpeg `loudnorm`.
- **Clicks:** `click-soft.mp3` from the SFX library bundled with HyperFrames
  (`skills/media-use/audio/assets/sfx/`), at 0.32 gain (about −10 dB), on five real clicks:
  Explain, marker 2, Explain with a diagram, Dive in, and supports. The library's `CREDITS.md`
  states its licence: sourced from Pixabay, used under the
  [Pixabay Content License](https://pixabay.com/service/license-summary/) (free for commercial and
  non-commercial use, no attribution required).

## Files

- `papertree-v0.2.mp4`: 1920×1080, 30 fps, 90.6 s. Rendered by `hyperframes render --quality high
--video-frame-format png`, then re-encoded with FFmpeg (libx264 High, CRF 23, preset slow,
  yuv420p; AAC 128 kb/s; `+faststart`) to fit the README size budget.
- `demo.gif`: 14.7 s (22.9–37.6 s of the video: select → Explain → the answer streams → marker 2 →
  the passage flashes), 960×540, 12 fps, `palettegen` (diff stats) + `paletteuse` (diff mode),
  infinite loop.
- `poster.png`: the frame at 10.3 s (the PaperTree lockup beside the answer and its markers).
- `contact-sheet.jpg`: the `hyperframes snapshot` contact sheets (frame midpoints and both sides
  of every cut), stacked.

## Fonts (the app's own faces, from its `@fontsource` packages)

| Face                         | Where                      | Licence                   |
| ---------------------------- | -------------------------- | ------------------------- |
| Libre Caslon Display 400     | wordmark, title cards      | SIL Open Font License 1.1 |
| Libre Caslon Text 400 italic | "Every answer, cited."     | SIL Open Font License 1.1 |
| Alegreya Sans 500            | captions                   | SIL Open Font License 1.1 |
| Alegreya Sans SC 500         | chapter labels, small caps | SIL Open Font License 1.1 |
| Courier Prime 400            | `v0.2`, the repository URL | SIL Open Font License 1.1 |

Colours are PaperTree's `--pt-*` tokens (`packages/ui/src/styles.css`), and the sprout mark is the
app's `SproutMark` (MIT, like the rest of PaperTree).

## Papers shown

The library holds 14 papers; the reader, the explanation and the diagram use _Attention Is All You
Need_. Titles are as the papers publish them (the shelf shows the titles as the app parsed them).

| Paper                                                                                               | arXiv      |
| --------------------------------------------------------------------------------------------------- | ---------- |
| Attention Is All You Need (Vaswani et al.)                                                          | 1706.03762 |
| BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding                    | 1810.04805 |
| Denoising Diffusion Probabilistic Models                                                            | 2006.11239 |
| Deep Residual Learning for Image Recognition                                                        | 1512.03385 |
| You Only Look Once: Unified, Real-Time Object Detection                                             | 1506.02640 |
| Mask R-CNN                                                                                          | 1703.06870 |
| Language Models are Few-Shot Learners                                                               | 2005.14165 |
| SuperGLUE: A Stickier Benchmark for General-Purpose Language Understanding Systems                  | 1905.00537 |
| Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks                                      | 1908.10084 |
| FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness                         | 2205.14135 |
| Neural Ordinary Differential Equations                                                              | 1806.07366 |
| Adam: A Method for Stochastic Optimization                                                          | 1412.6980  |
| Asynchronous Methods for Deep Reinforcement Learning (on the shelf as "Abstract", a parsing defect) | 1602.01783 |
| PDF-to-Tree: Parsing PDF Text Blocks into a Tree                                                    | none       |

## Narration

> Reading research papers with AI shouldn't mean trusting a black box.
>
> Meet PaperTree: a reading room where every answer shows its sources.
>
> Your papers stand on a shelf, sorted by topic. Search, pull one out, and open it.
>
> The reader shows the real PDF. Select a passage, choose Explain, and the answer streams in, with numbered markers.
>
> Click a marker, and the exact passage it stands on flashes in the paper.
>
> Ask for a diagram, and it draws an engraved plate. Its parts are cited to the page, and when a quote isn't found, it says so: not verified.
>
> Dive in, and the quotes become a notebook page, where you can write, and draw.
>
> Lay your ideas out on a board, and link them with threads that say how they relate. This one: supports.
>
> Group papers into topics, and see a map of the real citation links between them.
>
> It works on your phone, and lamp-lit, after dark.
>
> PaperTree, version zero point two. Open source. Every answer, cited.

The burned-in captions use these exact words; whisper supplied only their timing.

Source: github.com/Legend101Zz/PaperTree
