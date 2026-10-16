# v0.2 gap audit: the final design against the running app

Checked on 2026-10-16 against `main` = `release/v0.2` = `79f637d` (v0.1.0 + docs), running on a copy of the README
demo data (four demo accounts; YOLO, ResNet, BERT, Attention and DDPM with real parses and real stored MiniMax answers),
faux agent. Three agents audited one area each, frame by frame, against the PNGs at design size, the `.dc.html`
mock-ups and the code; each row carries evidence (a `file:line`, an endpoint and what it returned, or a
screenshot). The full tables, with an **Issue** column added to every frame row, are:

- [`audit/GAP-A1-library.md`](audit/GAP-A1-library.md): library, the opened book, topics, map, table, reading
  progress, phone and lamp-lit library (frames 00 furniture, 01, 01b–f, 02, 02a, 03, 08a, 09a; prototype steps 1–5).
- [`audit/GAP-A2-reader.md`](audit/GAP-A2-reader.md): reader, explain (ask → answer → trace), summary, AI diagrams,
  phone and lamp-lit reader (frames 00 voices, 04, 04b–d, 07a–d, 08b, 09b, 13; steps 5–8).
- [`audit/GAP-A3-notebook-board.md`](audit/GAP-A3-notebook-board.md): notebook, board, design system and theming,
  motion, phone notebook, lamp-lit board (frames 05, 05b, 06, 06b, 08c, 09c, 10, 11, 12; steps 9–14).

Screenshots of the current app are in [`audit/shots/`](audit/shots/); the design's frames are copied into
[`reference/`](reference/) (rendered from the final design at its sizes). One caveat on method: from about 15:44
the shared dev server served chunks compiled by an e2e run in the same worktree, which pointed the web app at a
dead API port for a few minutes. The audit agents saw it, retook their shots after the fix, and marked the
affected rows; the cause is recorded in `STATE.md`.

## The counts

| Area | Rows | exists | partial | missing | wrong |
| --- | --- | --- | --- | --- | --- |
| A1 library and book | 87 | 6 | 21 | 56 | 3 (+1 not confirmed) |
| A2 reader, explain, diagrams | ~79 | 7 | 30 | 34 | 8 |
| A3 notebook, board, system, motion | 98 | 11 | 31 | 50 | 6 |

**What "exists" means here:** the v0.1 behaviour that survives into v0.2 (upload, retry, delete, polling, the
three reading modes, highlights, the selection toolbar, streaming, Stop, follow-ups, the cached summary, chip
flashes, the canvas basics with delete + Undo). Almost everything drawn in the 32 frames is new UI.

## Frames → issues

| Frames | Issues |
| --- | --- |
| 00 strip, 10 design system | #188 S1a tokens/fonts/theme · #189 S1b interface components · #190 S1c voices and citations · #191 S1d design-system page |
| 01 shelf (both states) | #195 S2d shelf · #196 S2e reading now · #192 S2a reading state + facts (backend) |
| 01b empty, 01c three papers, 01f at scale | #196 S2e |
| 01d table and "need a look" | #197 S2f |
| 01e map, 03 topics | #198 S2g · #194 S2c links (backend) · #193 S2b topics (backend) |
| 02a pulled, 02 open book | #200 S3 |
| 08a phone library, 09a lamp-lit library | #199 S2h |
| 04 reader + explain, 13 ask/trace options | #202 S4b exchange · #201 S4a exchanges (backend) · #203 S4c reader chrome |
| 04b streaming, 04c stopped/budget, 04d summary | #204 S4d |
| 08b phone reader, 09b lamp-lit reader | #205 S4e |
| 05 notebook | #208 S5c page · #206 S5a backend · #207 S5b model · #209 S5d ink |
| 05b tablet, 08c phone notebook | #210 S5e |
| 06 board, 06b empty, 09c lamp-lit board | #211 S6a backend · #212 S6b cards/pins/threads · #213 S6c Link as · #214 S6d frames/minimap/toolbar · #215 S6e undo/scale |
| 07a–d diagrams | #216 S7a backend · #217 S7b plate |
| 11 motion, 12 prototype | #218 S8 (and each slice's own moments) |
| Prettier never covered `apps/web` (found in review) | #187 |

## The prototype flow, step by step

| # | Step | Today | Status | Issue |
| --- | --- | --- | --- | --- |
| 1 | Library | v0.1 "My papers" card grid | wrong | #195 |
| 2 | Search "atten" | no search | missing | #195 |
| 3 | Pull out | no shelf | missing | #200 |
| 4 | Open | no book | missing | #200 |
| 5 | Read | a card opens the reader | exists (path) | #200 |
| 6 | Select a sentence | selection toolbar appears, over the paragraph above | partial | #203 |
| 7 | Explain | answer streams with per-claim "p. N" chips; the ask is not shown | partial | #202 |
| 8 | Marker 2 lights passage 2 on p. 2 | a chip scrolls and flashes (1,200 ms); no numbered markers or margin tab | partial | #202 |
| 9 | Dive in | nothing | missing | #210 |
| 10 | Notebook | nothing (no route, tables or ink) | missing | #206–#209 |
| 11 | Board | the v0.1 canvas ("Canvas") with three card kinds | partial | #212 |
| 12 | A thread from the plate's brass pin | no diagrams, no typed pins | missing | #212, #216, #217 |
| 13 | "Link as" | `KindPicker` exists; Esc creates nothing (the design keeps a plain link) | wrong | #213 |
| 14 | supports | the kind exists; edges have no colour or second cue | partial | #212 |

## What matters most (read these first)

1. **The library is v0.1, not partly v0.2.** Only the data layer survives (list, polling, upload, retry, delete).
2. **No reading state on the server.** The reader keeps its place in `localStorage` only; `readingProgress` is
   hard-coded to 0. Reading now, Continue, ribbons and "p. 4 of 15" need #192.
3. **Topics do not exist**, but every arXiv paper's stamp (`arXiv:1706.03762v7 [cs.CL] …`) is already in its parse;
   the parser keeps the id and drops the category, and the stamp block id is stored, so no re-parse is needed (#192, #193).
4. **Spine years would be wrong**: `metadata.year` is the stamp date of the latest arXiv version (Attention 2023,
   BERT 2019, YOLO 2016). The arXiv id prefix gives the real year (#192).
5. **No display name** for the bookplate; never synthesise one from the email (#192, #200).
6. **The explain panel never loads stored threads**, so a reload loses the visible thread (verified in code: only
   the canvas calls `threadsApi.list`); the list also reorders after a follow-up (#201, #202).
7. **The person's first ask is stored but never shown** ("Explain this passage."): the call slip fixes it (#202).
8. **Passage numbering, ¶ locators and coverage are derivable without a migration** (golden: the stored Attention
   thread gives b1/b6/b7/b8 → markers 1–4, 11 citations, 1 uncited paragraph), but **the ¶ number is fragile on this
   parser**: a misparsed banner makes the abstract ¶2 on p. 1, and a heading on p. 2 is typed `paragraph`. #201
   carries a front-matter rule; a wrong ¶ would be a misattribution exactly where the product promises traceability.
9. **The notebook is the largest missing area**: no route, tables, contract, ink or tests (#206–#210).
10. **The board needs a table rebuild** (SQLite cannot alter `canvas_nodes.kind`'s CHECK) for question, notebook and
    diagram cards, plus edge ports (#211); its edges have neither per-kind colour nor a second cue today (#212).
11. **There is no `diagram` run kind anywhere** (agent contract, prompts, SSE, API, DB); ADR-004 §2.9 named the
    wrong prompt home: prompts live in `services/agent/src/prompts.ts`, `packages/prompts` is Python helpers (#216).
12. **No theme switch**: dark follows the OS only; fonts are the system stack on purpose (the old Google Fonts
    download broke offline builds), so the faces must be self-hosted (#188 does that: `next/font/local` over `@fontsource`).
13. **500 cards**: the board loaded in 553 ms and zoom frames ran at a median 16.7 ms / p95 17.7 ms (load 3.6–9.1),
    with all 500 nodes in the DOM and the first view at the 0.2 zoom floor (unreadable) (#214, #215).
14. **Map links are sparse on real data**: 2 citation links among the demo papers, both by title, none by arXiv id;
    an honest Map is mostly islands (#194, #198).
15. **"Canvas" vs "Board"**: the design says Board; the app says Canvas in routes, buttons and e2e names. The UI
    wording changes in #212; routes and API names stay (renaming them buys nothing and breaks links).

## Backend work, by issue

| Need | Issue | Migration |
| --- | --- | --- |
| Reading state; year, arXiv id and category, thread count, summary flag on the list; display name | #192 | 0006 |
| Topics with source and acceptance; deterministic + Flash suggestion | #193 | 0009 |
| Real citation links for the Map | #194 | none |
| Figure list and the chosen plate (an Anchor) | #200 | 0010 |
| Thread `ask` and stable order; citation `locator`; message `coverage` | #201 | none |
| Notebook pages, items (quote cards need an Anchor), strokes; Dive in seeding | #206 | 0007 |
| Board card kinds and typed ports (rebuild) | #211 | 0008 |
| Diagram runs: kind, prompt, NDJSON parts, quotes → Anchors, budget (rebuild) | #216 | 0011 |
| A per-person daily cap ("Change the daily cap" in 04c) | not in v0.2 scope by default: the cap stays a server setting; 04c's link is drawn as text pointing to the setting. Filed with S4d's PR if the owner wants it. | — |

## v0.1 defects (#175, #176, #177, #178, #179) and where they go

| Defect | Status on 79f637d | Issue |
| --- | --- | --- |
| Contents shows raw block types and "Belongs to no section" | still present | #203 |
| Highlight card not openable by mouse | still present (layer is `pointer-events: none`) | #203 |
| Highlight delete has no undo | still present | #204 |
| "kept above" after Stop before any text | still present (code) | #204 |
| "p. 3 p. 3 p. 3" chips | still present; removed by numbered markers | #202 |
| Ask AI overlaps text at 390; Guided strip wraps | still present; removed by the 08b sheet | #205 |
| 390 px zoom restore | NOT CONFIRMED | #205 |
| Guided figure crop includes its caption | NOT CONFIRMED (partly fixed in RFIX2) | #205 |
| R2 highlight scroll, Shift+click start, cross-column selection, `latexit` in the text layer | NOT CONFIRMED in this audit; stay on #176 | #176 |
| Phone first-open of a wide board at the zoom floor | still present (now 0.2) | #214 |
| Card bodies clip with no cue | still present | #214 |
| No `main` landmark on the board | still present | #214 |
| Toast covers the composer at 390; header-drag panned once | NOT CONFIRMED | #214 |
| Upload row separators; layout shift when the "still being read" banner leaves | separators present; shift NOT CONFIRMED (no paper was mid-parse) | #195 |
