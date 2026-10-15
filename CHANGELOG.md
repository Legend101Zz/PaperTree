# Changelog

All notable changes to PaperTree are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release's measured results, and what got
better or worse, are in [`docs/METRICS.md`](docs/METRICS.md).

## [Unreleased]

### Added

- The MIT license (`LICENSE`), with Mrigesh Thakur as the author.
- A new README: a demo recording and screenshots of the real app, badges, the v0.1.0 release notes and the
  v0.2 roadmap.

## [0.1.0] - 2026-10-15

The first usable release. Upload a research paper, read it as the real PDF or as reflowed text,
highlight passages, ask an AI to explain a passage or the whole paper (every claim is cited back to the
page), and lay out what you found on a canvas. It runs locally, with MiniMax as the model backend. The
full notes are on the [GitHub release](https://github.com/Legend101Zz/PaperTree/releases/tag/v0.1.0);
every feature below was checked by hand in a real browser on the release code
([`research/build/READER-RELEASE-RESULT.md`](research/build/READER-RELEASE-RESULT.md)).

### Added

- **Library and upload:** register, sign in and sign out (signing out revokes the server session); upload
  by file picker or drag and drop, with progress and Cancel; cards go Queued → Reading (n/3) → Ready
  without a reload and show the real title and page count; a PDF that can't be read says why and offers
  Retry; Delete asks first.
- **Reader:** Source (the PDF with selectable text), Guided (the paper's own words in one column) and
  Split; zoom, mode switches and reloads keep your place; Contents with outline, pages and highlights
  tabs; a paper that is still being read can be opened at once.
- **Highlights:** on a sentence, a table cell, a figure label or across paragraphs; colour, note, delete.
  Stored as anchors and painted from stored quads, identical after reload. A highlight that can't be
  placed goes to a tray with the reason.
- **AI:** explain a selection with streaming and status labels; follow-ups and free questions; Stop keeps
  the partial answer; Retry after an error; citation chips scroll to and flash the cited passage; a
  cached paper summary with cited bullets; a usage line with tokens and estimated cost; AI text styled
  apart from the paper's words; a daily spend cap (`PAPERTREE_DAILY_BUDGET_USD`, default $1.00).
- **Canvas:** send passages and explanations; drag; labelled links (supports, contradicts, derives from,
  answers, compares with, references, or a plain link); notes; groups; delete with Undo; "Open source"
  lands on the passage.
- **Evidence:** every AI run records model, provider, tokens, cost, first-text time, latency, request id
  and the exact code path in `ai_runs`.
- **Everywhere:** 1440 and 390 px, light and dark, keyboard navigation; axe 0 serious or critical in 12
  of 12 page × width × theme combinations.
- **Model policy** ([ADR-003](research/architecture-decisions/ADR-003-model-policy.md)): explain (and
  follow-ups in an explain thread) on `MiniMax-M3.1-Flash-Preview` at effort low; ask (and its follow-ups)
  and summary on `MiniMax-M3`.
- **CI:** Prettier, `next build`, the corpus tests, Playwright journeys A–D and a live journey against the
  real model, added to typecheck, lint, unit tests and codegen drift.

### Known issues

- Highlighting once scrolled the reader (seen once, not reproduced on the release code, guarded, cause
  not found): PARTIAL.
- A Shift+click selection that starts at the very start of a line loses its first 1–2 characters:
  PARTIAL.
- The grounding check is lexical; a selection across columns includes the caption between them;
  highlight delete has no undo; the Contents outline shows raw block labels; the phone canvas first opens
  tiny; test-model runs are recorded in `ai_runs` like real ones. The full list is in
  [`docs/METRICS.md`](docs/METRICS.md) → "Known defects at release", and the fixes are planned in
  [#182](https://github.com/Legend101Zz/PaperTree/issues/182).

[Unreleased]: https://github.com/Legend101Zz/PaperTree/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Legend101Zz/PaperTree/releases/tag/v0.1.0
