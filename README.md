<div align="center">

# PaperTree

**Read research papers with an AI that shows its sources.**

Upload a PDF, read the real pages, highlight passages, ask questions that are answered from the paper
with citations that jump back to the exact passage, and lay out what you found on a board.

[![Release](https://img.shields.io/github/v/release/Legend101Zz/PaperTree?label=release&color=2b5797)](https://github.com/Legend101Zz/PaperTree/releases/tag/v0.1.0)
[![CI](https://github.com/Legend101Zz/PaperTree/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Legend101Zz/PaperTree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/Legend101Zz/PaperTree)](https://github.com/Legend101Zz/PaperTree/commits/main)
[![Stars](https://img.shields.io/github/stars/Legend101Zz/PaperTree?style=flat&color=e3b341)](https://github.com/Legend101Zz/PaperTree/stargazers)

[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![uv](https://img.shields.io/badge/uv-workspace-DE5FE9)](https://docs.astral.sh/uv/)
[![Model: MiniMax](https://img.shields.io/badge/model-MiniMax%20M3%20%2B%20M3.1%20Flash-E5484D)](#model-policy)

[![TS tests](https://img.shields.io/badge/TS%20tests-3%2C149%20passing-brightgreen)](#tests-and-quality-gates)
[![pytest](https://img.shields.io/badge/pytest-2%2C562%20passing-brightgreen)](#tests-and-quality-gates)
[![e2e](https://img.shields.io/badge/e2e-88%2F88%20Playwright-brightgreen)](#tests-and-quality-gates)
[![axe](https://img.shields.io/badge/axe-0%20serious%20or%20critical-brightgreen)](#metrics-against-v010)

[Quick start](#quick-start) · [What's new in v0.2](#whats-new-in-v02-not-released-yet) ·
[Screenshots](#screenshots) · [Release notes](#release-notes-v02-not-released-yet) · [Roadmap](#roadmap) ·
[Docs](#docs)

<br/>

<img src="docs/assets/readme/demo.gif" alt="PaperTree v0.1.0 demo: upload a paper, select a passage, ask, follow up, open a citation, summarize, highlight and send to the canvas" width="100%"/>

<sub>The <b>v0.1.0</b> demo, recorded on the v0.1 interface (a card library, page chips, the canvas) with the
live model: upload, explain a passage, a follow-up, a citation, the summary, a highlight and the canvas. It
plays at about 1.35× speed; the waits for the model and a few pauses are sped up further. A v0.2 recording
is tracked in <a href="https://github.com/Legend101Zz/PaperTree/issues/321">#321</a>; the v0.2 interface is
in the <a href="#screenshots">screenshots</a>.</sub>

</div>

---

## What's new in v0.2 (not released yet)

v0.2 is the "Ex Libris" interface: the whole UI rebuilt from one design, plus a notebook and AI diagrams. It
is on the [`release/v0.2`](https://github.com/Legend101Zz/PaperTree/tree/release/v0.2) branch and **has not
been released**; the latest release is still [v0.1.0](https://github.com/Legend101Zz/PaperTree/releases/tag/v0.1.0).

- **Library:** the papers stand as cloth spines on a shelf, a row per topic; Reading now with Continue; pull
  a book out and open it; Topics, with suggestions from the arXiv category or, labelled as such, from the
  AI; a Map that draws only real citation links; a sortable Table; a phone layout.
- **Reader:** a new header and reader desk; the selection toolbar sits in the margin; every answer is an
  exchange (your ask, the answer with numbered markers, the passages it stands on), and a marker flashes
  its passage; a bottom sheet on a phone; a lamp-lit dark mode.
- **Diagrams:** "Explain with a diagram" draws an engraved plate whose parts stream in, each cited to its
  passage or marked "inferred".
- **Notebook:** Dive in from an answer to a bound page with quote cards, typed notes, ink and a lasso, on a
  computer, a tablet or a phone.
- **Board** (v0.1's canvas): cards with brass pins, seven thread kinds told apart by colour and a second
  cue, Link as, frames, a minimap, undo and redo, and 500 cards.
- **Motion:** every animation has a reduced-motion path.

The full list, the metrics against v0.1 and the known limits are in the
[v0.2 release notes](#release-notes-v02-not-released-yet).

## Contents

- [What's new in v0.2](#whats-new-in-v02-not-released-yet)
- [Why PaperTree](#why-papertree)
- [Features](#features)
- [Screenshots](#screenshots)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Model policy](#model-policy)
- [Tests and quality gates](#tests-and-quality-gates)
- [Release notes (v0.2, not released yet)](#release-notes-v02-not-released-yet)
- [Release notes (v0.1.0)](#release-notes-v010)
- [Roadmap](#roadmap)
- [Troubleshooting](#troubleshooting)
- [Docs](#docs)
- [Contributing](#contributing)
- [License](#license)
- [Author](#author)

## Why PaperTree

Most "chat with your PDF" tools turn the paper into text, lose the page, and give you answers you cannot
check. PaperTree keeps the paper as the paper:

- **You read the real pages.** Source mode is the PDF itself with selectable text. Guided mode reflows the
  paper's own words into one column, and Split shows both.
- **Every AI claim points back to the page.** Answers carry citation markers. Click one and the reader
  scrolls to the cited passage and flashes it. AI text is styled apart from the paper's own words and
  from yours.
- **Highlights stay where you put them.** They are stored as anchors and painted from stored
  coordinates, so they come back in the same place after a reload. A highlight that can't be placed goes to
  a tray with the reason; it is never painted in the wrong spot.
- **Failures are shown, not hidden.** A PDF that can't be read says why. An AI run that fails or is
  stopped says so, and the part that did arrive is kept.
- **You can see what every AI call cost.** Each run records its model, tokens, estimated cost, latency
  and the exact code path. A daily spend cap is on by default.
- **It runs on your machine.** It uses one SQLite file and a data folder. The model key stays in one
  process.

## Features

What **v0.1.0**, the release, does. Each item was checked in a real browser (Chrome, driven through
Playwright) against the real stack and model on the release code. A few items, such as drag and drop,
Cancel and the budget message, were carried over from an earlier walk of nearly the same code; the full
feature table marks them "carried"
([`research/build/READER-RELEASE-RESULT.md`](research/build/READER-RELEASE-RESULT.md)). What the unreleased
v0.2 adds is in [What's new in v0.2](#whats-new-in-v02-not-released-yet).

| Area                  | What you can do                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Library**           | Register and sign in. Upload PDFs with the file picker or by drag and drop, with progress and Cancel. Cards go Queued → Reading → Ready without a reload and show the real title and page count.                                                                                                  |
| **Reader**            | Source (the PDF), Guided (the paper's words in one column) and Split. Zoom, mode switches and reloads keep your place. Contents has Outline, Pages and Highlights tabs. A paper still being read opens at once.                                                                                   |
| **Highlights**        | Highlight a sentence, a table cell, a figure label or a passage across paragraphs. Change the colour, add a note, delete. A highlight that can't be placed goes to a tray with the reason.                                                                                                        |
| **Explain and ask**   | Select a passage and press Ask: the answer streams, with status labels. Ask follow-ups or free questions about the paper. Stop keeps the partial answer; Retry after an error.                                                                                                                    |
| **Citations**         | Answers carry page chips. A chip scrolls to the cited passage and flashes it.                                                                                                                                                                                                                     |
| **Summary**           | A paper summary with cited bullets. It is cached, so a reload does not pay for it again.                                                                                                                                                                                                          |
| **Canvas**            | Send passages and answers to a per-paper canvas. Drag, connect cards with labelled links (supports, contradicts, derives from, answers, compares with, references, or a plain link), add notes, group, delete with Undo. "Open source" jumps back to the passage.                                 |
| **Cost and evidence** | A usage line under each answer (tokens and estimated cost). Each run is recorded in `ai_runs` with model, provider, tokens, cost, first-text time, latency, request id and code path. A daily budget cap.                                                                                         |
| **Everywhere**        | Desktop (1440 px) and phone (390 px), light and dark, keyboard navigation. axe reported 0 serious or critical issues in all 12 combinations tested (the library, reader Source and reader Guided, each at 1440 and 390 px, light and dark); the canvas and the explain panel were not axe-tested. |

## Screenshots

### v0.2 (not released yet)

The v0.2 interface on `release/v0.2` at `a8eb3e5`: a production build (`next build` + `next start`) in
Playwright's Chromium at 1440 × 900 (1440 × 1000 for the notebook, 390 × 844 for the phone), on 2026-10-17,
against a copy of the demo data with nine more corpus papers uploaded, 13 in all (credited under
[Acknowledgements](#acknowledgements)).

**What is real in these shots.** Every paper was parsed by PaperTree. The explain thread on "Attention Is
All You Need" is real model output (MiniMax-M3.1-Flash-Preview, recorded on v0.1.0 on 2026-10-15). The plate
is one live diagram run made for this README (MiniMax-M3.1-Flash-Preview, 4,318 tokens, ≈ $0.0015, an
estimate on M3 rates). The notebook page, the board's new cards and its three new threads were made in the
app from that thread (Dive in, Send to board, Send page to board, a brass pin, Link as); the board's
passage card, first answer, note and supports thread come from the v0.1 demo. The typed note, the sticky,
the ink and the board's note are the demo account's own words. The topics, three reading places, the
bookplate's name and the board's layout were set through the API routes the app calls. No shot shows the
test model's answers.

<table>
  <tr>
    <td width="50%"><img src="docs/assets/readme/v0.2/library-shelf.png" alt="The library: Reading now with three papers and Continue, then 13 papers as cloth spines on a walnut shelf, grouped under five topic label holders"/><br/><sub><b>The shelf.</b> A row per topic; a ribbon marks a paper you are reading; Reading now above.</sub></td>
    <td width="50%"><img src="docs/assets/readme/v0.2/book-open.png" alt="The opened book: an Ex libris bookplate on the left, and on the right the topic, year, arXiv id, pages, figures found, title, authors, the abstract with its page tab, reading progress, Read and Summary"/><br/><sub><b>The opened book.</b> Enter pulls a spine out, Enter again opens it; Esc puts it back.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/readme/v0.2/topics.png" alt="Topics view: five topic cards with cloth banners, counts, a skyline of their spines and where the topic came from"/><br/><sub><b>Topics.</b> Each says where it came from: chosen by you, or suggested from the arXiv category and accepted.</sub></td>
    <td><img src="docs/assets/readme/v0.2/map.png" alt="Map view: the plan of the reading room with topic islands and dotted citation links labelled cites it, matched by title or by arXiv id"/><br/><sub><b>The Map.</b> Only real citation links, each labelled with how it was matched.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/readme/v0.2/table.png" alt="Table view: a ruled catalogue with title, authors, year, topic and its source, pages, state, highlights and last opened"/><br/><sub><b>The Table.</b> Sort, filter and choose columns; a missing value is a dash, never a guess.</sub></td>
    <td><img src="docs/assets/readme/v0.2/reader-explain.png" alt="The reader with the explain panel: the ask on a call slip, the answer with numbered markers and page tabs; marker 2 is lit and its passage on page 2 is outlined with a margin tab saying from marker 2 in the answer"/><br/><sub><b>Ask → answer → trace.</b> Marker 2 lights its passage on p. 2 and says so in the margin.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/readme/v0.2/diagram-plate.png" alt="An AI plate titled Scaled Dot-Product Attention steps with five lettered parts and a key quoting the paper for each; part C is selected and its passage on page 4 is outlined"/><br/><sub><b>The plate.</b> Five parts, five cited; tapping part C flashes the paragraph it quotes.</sub></td>
    <td><img src="docs/assets/readme/v0.2/notebook.png" alt="A notebook page: the ask, the AI answer, the coverage line, four numbered quote cards, a typed note, a sticky and a hand-drawn arrow, with the template and counts panel on the right"/><br/><sub><b>The notebook.</b> Dive in makes a page from the answer: quote cards, then your notes and ink.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/readme/v0.2/board.png" alt="The board: a passage card, two answer cards, a notebook page card, the plate card and a note, joined by supports, derives from, references and plain link threads, with the thread legend and minimap"/><br/><sub><b>The board.</b> Threads of four kinds here, each a colour and a second cue (+, », dots, a line).</sub></td>
    <td><img src="docs/assets/readme/v0.2/reader-explain-dark.png" alt="The same reader and explain panel in the lamp-lit dark scheme, with the PDF page shown as dimmed ivory"/><br/><sub><b>Lamp-lit.</b> The dark scheme keeps the PDF page paper-coloured.</sub></td>
  </tr>
</table>

<p align="center">
  <img src="docs/assets/readme/v0.2/phone-library.png" alt="The library at phone width: Reading now, then books lying flat in stacks under a topic holder" width="24%"/>
  &nbsp;
  <img src="docs/assets/readme/v0.2/phone-explain.png" alt="The explain sheet at phone width: the ask, the first paragraph of the answer, Read the whole answer, and Dive in and To board pinned above the follow-up box" width="24%"/>
  &nbsp;
  <img src="docs/assets/readme/v0.2/phone-notebook.png" alt="The notebook at phone width: the exchange and the quote cards as a stack, with Text, Sticky, Highlight and Pen: off at the foot" width="24%"/>
  <br/><sub><b>Phone (390 px).</b> The library, the explain sheet and the notebook.</sub>
</p>

Each slice's own shots, compared against the design's frames, are in
[`research/build/v0.2-ui/shots/`](research/build/v0.2-ui/shots/); the frames themselves are in
[`research/build/v0.2-ui/reference/`](research/build/v0.2-ui/reference/).

<details>
<summary><b>v0.1.0 screenshots (history)</b></summary>

All of these are of the real app (v0.1.0) on four arXiv papers.

<table>
  <tr>
    <td width="50%"><img src="docs/assets/readme/explain.png" alt="Explain panel: an answer about the selected passage, with page citation chips"/><br/><sub><b>Explain.</b> Select a passage and press Ask. The answer cites pages.</sub></td>
    <td width="50%"><img src="docs/assets/readme/chip-flash.png" alt="A citation chip has scrolled the reader to the cited passage and flashed it"/><br/><sub><b>Citations you can check.</b> A chip takes you to the passage it cites.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/readme/summary.png" alt="Paper summary with cited bullets"/><br/><sub><b>Summary.</b> Cited bullets, cached after the first run. A citation the checker can't verify says "not verified".</sub></td>
    <td><img src="docs/assets/readme/highlights.png" alt="Contents panel with the Highlights tab, and a highlighted passage on the page"/><br/><sub><b>Highlights.</b> Stored as anchors and listed in Contents.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/readme/split.png" alt="Split mode: the PDF on the left, the reflowed text on the right"/><br/><sub><b>Split mode.</b> The PDF beside the paper's own words reflowed.</sub></td>
    <td><img src="docs/assets/readme/canvas.png" alt="Canvas with a passage card, an AI explanation card, a supports link and a note"/><br/><sub><b>Canvas.</b> Passages, answers, notes and labelled links.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/readme/library.png" alt="Library with four Ready papers"/><br/><sub><b>Library.</b> Upload and watch each paper go Queued → Reading → Ready.</sub></td>
    <td><img src="docs/assets/readme/explain-dark.png" alt="The reader and the explain panel in dark mode"/><br/><sub><b>Dark mode.</b> Every screen has a light and a dark theme.</sub></td>
  </tr>
</table>

<p align="center">
  <img src="docs/assets/readme/phone-reader.png" alt="The reader at phone width" width="24%"/>
  &nbsp;
  <img src="docs/assets/readme/phone-explain.png" alt="The explain sheet at phone width" width="24%"/>
  &nbsp;
  <img src="docs/assets/readme/phone-library-dark.png" alt="The library at phone width in dark mode" width="24%"/>
  <br/><sub><b>Phone (390 px).</b> The reader, the explain sheet and the library in dark mode.</sub>
</p>

The full set from the v0.1 hands-on test (every screen at 1440 and 390 px, light and dark) is in
[`docs/release/v0.1/screens/`](docs/release/v0.1/screens/).

</details>

## How it works

```mermaid
flowchart TB
  B["Browser<br/>Next.js 14 web app"] -- "REST + SSE" --> A["API<br/>FastAPI"]
  A -- "parse jobs" --> W["Worker<br/>PyMuPDF → document IR"]
  A -- "AI runs: explain, ask, summary,<br/>diagram, topic (shared secret)" --> G["Agent<br/>Node, Pi harness SDK"]
  G -- "paper tools<br/>(internal routes)" --> A
  A --- D[("Data root<br/>SQLite (WAL), PDFs, figures")]
  W --- D
  G -- "the only process<br/>with the key" --> M["MiniMax API"]
```

- **Web** (`apps/web`): Next.js 14. The browser talks to the API and to nothing else. The v0.2 interface
  lives in one folder per feature, `apps/web/src/features/<feature>/` (library, book, reader, explain,
  diagram, notebook, board, highlights, settings, design-system), each with a README; the shared components
  and the design tokens are in `packages/ui`. The reader renders pages with pdf.js; the board uses React
  Flow (`@xyflow/react`); notebook ink is `perfect-freehand` outlines on an SVG layer; motion is CSS and the
  Web Animations API, with no animation library
  ([ADR-004](research/architecture-decisions/ADR-004-v0.2-ui-stack.md)).
- **API** (`services/api`): FastAPI, the only public edge. Accounts, uploads, the paper store, highlights,
  reading state, topics, threads, summaries, notebooks, boards and the `ai_runs` ledger. Data lives in one
  SQLite file plus a few folders under the data root; the schema moves forward by numbered migrations
  (`infrastructure/migrations/`; v0.2 adds 0006–0011).
- **Worker** (`python -m papertree_api.worker`): parses uploaded PDFs with PyMuPDF into the paper's
  structure (sections, blocks, figures, tables, equations) while you wait. It shares the API's data root.
- **Agent** (`services/agent`): a small Node service that runs the AI through the Pi harness SDK against
  MiniMax. It binds `127.0.0.1`, is called only by the API, is the only process that ever holds the
  MiniMax key, and loads nothing from `~/.pi` or any `AGENTS.md`.

### The flows

| Flow            | What happens                                                                                                                                                                                                                                                                                                                       | Stored in                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Library         | `GET /papers` carries each paper's reading state, the year and category from its arXiv id and stamp, counts, its topic and its plate. The reader writes your place with `PUT /papers/{id}/reading-state`.                                                                                                                          | `reading_state` (0006)                                        |
| Topics          | `GET /papers/{id}/topic` offers a topic: first your topic that already holds papers of the same arXiv category; when that finds nothing, one short `topic` run in the background (once per paper). An offer never shelves a paper; only `PUT /papers/{id}/topic` does.                                                             | `topics`, `paper_topics` (0009)                               |
| Map             | `GET /library/links` matches each paper's references to your other papers by arXiv id or by normalised title, and says which.                                                                                                                                                                                                      | nothing: computed on read                                     |
| The book        | `GET /papers/{id}/figures` and `/abstract`; `PUT`/`DELETE /papers/{id}/plate` chooses a figure as the cover; `PATCH /auth/me` sets the bookplate's name.                                                                                                                                                                           | `paper_plate` (0010), `users.display_name` (0006)             |
| Explain and ask | `POST /papers/{id}/threads` and `…/messages` stream the answer (SSE). Each citation's locator (page, ¶, section) and each answer's coverage are derived from the parse when read.                                                                                                                                                  | `ai_threads`, `ai_messages`, `ai_citations`, `ai_runs`        |
| Diagram         | `POST /papers/{id}/threads` with `kind: "diagram"`. The agent streams the plate as JSON lines (the title, each part, each link), each checked as it arrives; the API resolves each part's quote to an anchor (cited, not verified, or inferred when there is none) and streams `plate`, `part` and `link` events.                  | `ai_diagram_parts`, `ai_messages.diagram_json` (0011)         |
| Notebook        | Dive in is `POST /papers/{id}/notebook/pages` with the answer's message id: the server seeds the page with the ask, the answer and one quote card per cited passage (each an anchor). Items and ink strokes are saved under `/notebook/pages/{id}`; `GET /papers/{id}/notebook/search` searches typed text, quotes and the answer. | `notebook_pages`, `notebook_items`, `notebook_strokes` (0007) |
| Board           | `GET /papers/{id}/board`; cards and threads are created, moved and deleted one request per gesture. A thread names its pins (`from_port`, `to_port`), and the API refuses a pin pair its table does not allow (422).                                                                                                               | `canvas_nodes`, `canvas_edges` (rebuilt in 0008)              |

### AI run kinds

Every AI request is one run of one kind. The API starts it, the agent runs it, and its row in `ai_runs`
records the model, tokens, estimated cost and code path. The limits are the API's
(`services/api/python/papertree_api/agent_client.py`, `LIMITS`); the model for each kind is under
[Model policy](#model-policy).

| Kind      | Started by                                                                                 | Deadline | Output tokens | Tool calls | Retries |
| --------- | ------------------------------------------------------------------------------------------ | -------- | ------------- | ---------- | ------- |
| `explain` | Explain or Ask on a selection, and every follow-up in that thread                          | 45 s     | 4,096         | 8          | 1       |
| `ask`     | A question about the whole paper (no selection), and its follow-ups                        | 60 s     | 4,096         | 8          | 1       |
| `summary` | Summarize paper (cached afterwards)                                                        | 90 s     | 6,144         | 12         | 1       |
| `diagram` | Explain with a diagram, and Redraw (v0.2)                                                  | 90 s     | 2,048         | 4          | 1       |
| `topic`   | A paper the arXiv-category rule has no topic for, once per paper, in the background (v0.2) | 30 s     | 1,024         | none       | none    |

A follow-up runs as its thread's kind. A topic run that fails or answers badly is simply "no suggestion".

## Quick start

### Prerequisites

- Node.js 22.x (CI pins 22.23.0; see `.nvmrc`)
- pnpm, through Corepack: `corepack enable` (the version is pinned by `packageManager` in `package.json`)
- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- A MiniMax API key for the AI features. Without one you can still upload, read, highlight and use the
  board; every AI request fails visibly (and a notebook page starts from an AI answer).
- A current Chrome. v0.1.0 was tested in Chrome 155; v0.2's checks run in Playwright's Chromium. Other
  browsers are untested (Safari's handling of the 3D book is not checked).

### Run it

Run these from the repository root. You need four terminals, one per process; use the default ports
(8000, 8200, 3000) unless something else on your machine already uses them.

**1. Clone and install** (once):

```sh
git clone https://github.com/Legend101Zz/PaperTree.git
cd PaperTree
git checkout v0.1.0          # the latest release
# git checkout release/v0.2  # or: the unreleased v0.2 interface this README shows
corepack enable
uv sync --locked --all-packages
pnpm install --frozen-lockfile
```

**2. Configure** (once):

```sh
cp .env.example .env
echo "PAPERTREE_AGENT_SECRET=$(openssl rand -hex 32)" >> .env
cp apps/web/.env.example apps/web/.env.local
```

`.env` holds everything except the model key; the API, the worker and the agent each load it with the
`source` line below. The key is never put in this file.

**3. Start the four processes**, one per terminal:

```sh
# terminal 1: API (http://127.0.0.1:8000)
set -a; source .env; set +a
uv run python -m papertree_api
```

```sh
# terminal 2: worker (parses uploads; same data root as the API)
set -a; source .env; set +a
uv run python -m papertree_api.worker
```

```sh
# terminal 3: agent (http://127.0.0.1:8200). The key goes to this process only.
set -a; source .env; set +a
read -rs MINIMAX_KEY        # paste your MiniMax key, press Enter (nothing is echoed)
PAPERTREE_MINIMAX_API_KEY="$MINIMAX_KEY" pnpm --filter @papertree/agent start
```

```sh
# terminal 4: web (http://127.0.0.1:3000)
pnpm --filter papertree-web dev -H 127.0.0.1
```

(`-H 127.0.0.1` keeps the dev server off your network; without it Next.js listens on every interface.)

**4. Open the app** at **http://127.0.0.1:3000** (not `localhost`; see Troubleshooting). Register an
account and add a PDF.

- **On v0.2:** "Add papers" in the header, or drop PDFs anywhere on the library. A paper being read stands
  in a kraft wrap; once it has its title, press Enter on it to take it out, Enter again to open the book,
  then Read (or click it for its card). Select a sentence and use the toolbar in the margin: Explain (opens
  the Explain panel; its numbered markers flash the passage), Ask, Highlight, Send to board or Explain with
  a diagram. Dive in under an answer opens its notebook page; Board in the reader's header opens the board.
- **On v0.1.0:** "Choose PDFs"; when its card shows "Ready", open it, select a sentence and use the
  toolbar: Highlight, Ask or Send to canvas (the "Canvas" link in the reader opens it).

Check that everything is up: `curl http://127.0.0.1:8000/healthz` and `curl http://127.0.0.1:8200/healthz`
(the agent's reply names the model per kind and says `key_present: true`).

Start the web app with `pnpm`, not `next dev` directly. Its `predev` step copies the pdf.js worker into
`apps/web/public/`; without it every PDF fails with "This PDF could not be opened".

Your data is in `~/.papertree` (SQLite, uploaded PDFs, extracted figures). Delete that folder to start
clean; set `PAPERTREE_DATA_ROOT` to keep it elsewhere. A v0.1 data root works on v0.2: the API applies the
new migrations when it starts and first copies the database to `papertree.sqlite.pre-0008.bak` and
`.pre-0011.bak`, before the two table rebuilds.

## Configuration

The variables below are every one the code reads, apart from test and research switches. The contract is
`research/build/reader-release/contracts.md` section 7. `.env.example` and `apps/web/.env.example` list
the v0.1 set; the four model variables for the v0.2 kinds and `NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM` are not
in them yet ([#323](https://github.com/Legend101Zz/PaperTree/issues/323)). Everything is optional except
the secret and the key.

<details>
<summary><b>All environment variables</b></summary>

| Variable                                                                          | Read by            | Default                   | Notes                                                                                                      |
| --------------------------------------------------------------------------------- | ------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PAPERTREE_DATA_ROOT`                                                             | api, worker        | `~/.papertree`            | SQLite plus `uploads/ assets/ staging/`; the API and the worker must share it                              |
| `PAPERTREE_HOST`, `PAPERTREE_PORT`                                                | api                | `127.0.0.1`, `8000`       |                                                                                                            |
| `PAPERTREE_SESSION_HOURS`                                                         | api                | `24`                      | login lifetime                                                                                             |
| `PAPERTREE_MAX_UPLOAD_MB`                                                         | api                | `100`                     | larger uploads are refused with 413                                                                        |
| `PAPERTREE_SIGNING_SECRET`                                                        | api                | random per boot           | asset URL signing; a restart invalidates open asset URLs unless you set it                                 |
| `PAPERTREE_AGENT_URL`                                                             | api                | `http://127.0.0.1:8200`   | where the API reaches the agent                                                                            |
| `PAPERTREE_AGENT_SECRET`                                                          | api, agent         | **required for AI**       | shared secret; the API answers 503 `not_configured` without it and the agent refuses to boot               |
| `PAPERTREE_DAILY_BUDGET_USD`                                                      | api                | `1.00`                    | per-user AI spend cap over a rolling 24 h, from `ai_runs.cost_usd_est`                                     |
| `PAPERTREE_CORS_ORIGINS`                                                          | api                | empty                     | extra browser origins beyond `http://localhost:*` and `http://127.0.0.1:*`                                 |
| `PAPERTREE_AGENT_PORT`                                                            | agent              | `8200`                    | binds `127.0.0.1` only                                                                                     |
| `PAPERTREE_API_INTERNAL_URL`                                                      | agent              | `http://127.0.0.1:8000`   | the API origin the agent fetches paper tools from                                                          |
| `PAPERTREE_MINIMAX_API_KEY`                                                       | **agent only**     | **required**              | read once, then removed from the agent's environment; never `MINIMAX_API_KEY`                              |
| `PAPERTREE_MODEL`                                                                 | agent              | per kind, see below       | one model for every kind: `MiniMax-M3` or `MiniMax-M3.1-Flash-Preview`                                     |
| `PAPERTREE_MODEL_EXPLAIN`, `_ASK`, `_SUMMARY`, `_DIAGRAM`, `_TOPIC`               | agent              | `PAPERTREE_MODEL`         | the model for one kind (`_DIAGRAM` and `_TOPIC` are new in v0.2)                                           |
| `PAPERTREE_MODEL_EFFORT` (+ `_EXPLAIN`, `_ASK`, `_SUMMARY`, `_DIAGRAM`, `_TOPIC`) | agent              | `low`                     | Flash only: `low`, `medium` or `high`                                                                      |
| `PAPERTREE_AGENT_LOG_LEVEL`                                                       | agent              | `info`                    | `debug` adds raw provider error text; keys and tokens are never logged                                     |
| `PAPERTREE_AGENT_FAUX`                                                            | agent              | unset                     | `1` = a scripted test model with canned answers (the e2e suite uses it); not for real use                  |
| `PI_OFFLINE`, `PI_TELEMETRY`, `PI_CODING_AGENT_DIR`                               | agent              | set by the agent          | defence in depth; do not set them                                                                          |
| `NEXT_PUBLIC_PAPERTREE_API_URL`                                                   | web                | `http://localhost:8000`   | the API origin as the browser reaches it; `apps/web/.env.example` sets `http://127.0.0.1:8000`             |
| `NEXT_PUBLIC_PAPERTREE_FIXTURES`                                                  | web                | `off`                     | `on` only in tests and demos                                                                               |
| `NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM`                                             | web, at build time | off in a production build | v0.2: `on` serves the `/design-system` developer page from a production build; `next dev` always serves it |

</details>

To use a different port for the web app, set `PORT` (for example `PORT=3001 pnpm --filter papertree-web dev`).
If you move the API, change `PAPERTREE_PORT`, `PAPERTREE_API_INTERNAL_URL` and
`NEXT_PUBLIC_PAPERTREE_API_URL` together; if you move the agent, change `PAPERTREE_AGENT_PORT` and
`PAPERTREE_AGENT_URL`.

## Model policy

The agent decides which MiniMax model answers which kind of run (`services/agent/src/models.ts`,
`DEFAULT_MODELS`; [ADR-003](research/architecture-decisions/ADR-003-model-policy.md)). The v0.1 defaults
were chosen from an A/B test and a 3-judge quality panel ([`MODEL-AB.md`](docs/release/v0.1/MODEL-AB.md),
[`QUALITY.md`](docs/release/v0.1/QUALITY.md)):

| Kind                                                         | Model                                    | Why                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `explain`: a selection (and follow-ups in that thread)       | `MiniMax-M3.1-Flash-Preview`, effort low | First text p50 1.8 s in the A/B, against 9.3 s on M3                                                       |
| `ask`: a question about the whole paper (and its follow-ups) | `MiniMax-M3`                             | Flash's ask follow-ups drew 9 wrong-citation marks against 0 for M3 (3 follow-ups, 3 judges, summed)       |
| `summary`                                                    | `MiniMax-M3`                             | Flash summaries (effort medium) had 14 unsupported claims against 3 for M3 (3 summaries, 3 judges, summed) |
| `diagram` (v0.2)                                             | `MiniMax-M3.1-Flash-Preview`, effort low | A short, structured plate from one selection, like an explain. Not A/B-tested: two live runs so far        |
| `topic` (v0.2)                                               | `MiniMax-M3.1-Flash-Preview`, effort low | One short JSON answer per paper, no tools. Not A/B-tested: one live smoke (two calls)                      |

A follow-up stays on its thread's model. Follow-ups to an explanation therefore run on Flash; the quality
panel's follow-ups were all asks, so that case has not been measured. `PAPERTREE_MODEL=MiniMax-M3` puts every
kind on M3, and `PAPERTREE_MODEL_ASK=MiniMax-M3.1-Flash-Preview` puts ask back on Flash. MiniMax publishes no price for Flash, so the cost recorded in `ai_runs` for Flash
runs is an estimate on M3's rates, and the agent's `/healthz` says so (`cost_basis`).

## Tests and quality gates

The commands CI runs (from the repository root; `.github/workflows/ci.yml` is authoritative). CI runs on
every pull request, whatever its base, and on every push to `main`:

| Gate               | Command                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codegen drift      | `pnpm run codegen`, then the working tree must be unchanged                                                                                                                                                                  |
| TypeScript         | `pnpm run typecheck`, `pnpm run lint` (oxlint for the packages and the agent, `next lint` for `apps/web`, a doc lint for `packages/ui`), `pnpm run test`                                                                     |
| Python             | `uv run pytest`, the peak-RSS test in its own process, `uv run ruff check packages services`, `uv run ruff format --check packages services`, `uv run mypy packages/*/python services/*/python`, `tools/check-docstrings.sh` |
| Prettier           | `pnpm exec prettier --check .` (it covers `apps/web` since v0.2)                                                                                                                                                             |
| Web build          | `pnpm --filter papertree-web build`                                                                                                                                                                                          |
| Fixture validation | `node .github/scripts/validate-fixtures.mjs packages/document-ir`                                                                                                                                                            |
| End to end         | `pnpm e2e` (Playwright; starts its own API, worker, web and a faux agent on free ports)                                                                                                                                      |

Locally, run the same gates uncached: `turbo` caches, so `pnpm test` can reprint a pass it did not run. The
exact list, with `--force`, is in [`CONTRIBUTING.md`](CONTRIBUTING.md#the-gate). `pnpm install` also
installs a pre-commit hook (lefthook) that runs Prettier and the linters on staged files.

- **End to end runs in GitHub Actions.** The E2E job runs the whole Playwright suite on every PR against a
  faux agent. It fails if any spec is skipped, if Journey B (it needs the YOLO PDF) did not pass, or if
  anything failed. You can run `pnpm e2e` yourself (it needs a Chromium:
  `pnpm exec playwright install chromium`); on the maintainer's machine the full suite is left to CI.
- **The live journey** (the real model) is a separate workflow, `live-journey.yml`, gated on the
  `run-live` label; it is not part of a normal run.
- **Web unit tests never touch the network** ([#310](https://github.com/Legend101Zz/PaperTree/issues/310),
  [#312](https://github.com/Legend101Zz/PaperTree/pull/312)). `apps/web/test/setup-no-network.ts` fails any
  test that makes an unmocked request and names the origin it tried. The agent's suite runs under an audit
  that fails it on any DNS lookup or non-loopback connection, with outbound network also denied by the OS
  where it can be (`sandbox-exec` on macOS, `unshare -rn` on Linux).
- **Corpus-gated tests.** Some tests need the benchmark PDFs, which are fetched rather than committed:
  `./research/benchmarks/fetch_corpus.sh` and `./research/benchmarks/fresh/fetch_fresh.sh`. Without them
  such a test skips and says so, naming the fetch script. CI fetches both sets, checks their checksums, and
  fails if any corpus- or fresh-gated test skipped. The web build needs them too: its `prebuild` step copies
  fixtures made from the corpus and fails without them.
- A few timing tests (`test_30k_*`, the migrations spec's 30k insert) are wall-clock bounds and can flake
  on a loaded machine: re-run them alone before diagnosing.

**The counts for v0.2** (each read from its own run's log for this README):

- **TypeScript: 3,149 tests** on `release/v0.2` at `a8eb3e5`: vitest 2,970 (web 1,568, document-ir 864,
  anchoring 336, ui 202) and 179 agent tests. `pnpm exec turbo run test --force`, 2026-10-17, load average
  2.07 at the start.
- **pytest: 2,562 passed**, 4 skipped, 1 expected failure, with the peak-RSS test passing in its own process.
  The local gate on `cbe70fa` (the head of [#320](https://github.com/Legend101Zz/PaperTree/pull/320), S8),
  2026-10-17, load average 19.32 at the start; the CI run on #320 counted the same.
- **e2e: 88 of 88** Playwright specs passed in 30.1 min, none skipped, in the CI run on #320
  ([run 39015930115](https://github.com/Legend101Zz/PaperTree/actions/runs/39015930115)), which tested
  `cbe70fa` merged into `release/v0.2`.

At the v0.1.0 release the uncached local gate ran 1,858 TypeScript tests, 2,236 passing Python tests (4
skipped, 1 expected failure) and 60 of 60 Playwright specs, and every CI job was green, including the
live journey against the real model.

## Release notes (v0.2, not released yet)

**v0.2 is not released.** It is the `release/v0.2` branch; the owner merges it into `main` and tags it when
it is done. It is tracked in [#182](https://github.com/Legend101Zz/PaperTree/issues/182), and the build's
plan, audit and results are in [`research/build/v0.2-ui/`](research/build/v0.2-ui/). One slice is still
open: S8 ([#218](https://github.com/Legend101Zz/PaperTree/issues/218),
[PR #320](https://github.com/Legend101Zz/PaperTree/pull/320)), the whole-flow e2e, the reduced-motion check,
the numbers at scale and a verdict per design frame. The numbers below from S8 come from that PR.

### What changed, by area

**Library** ([`features/library`](apps/web/src/features/library/README.md),
[`features/book`](apps/web/src/features/book/README.md))

- The papers stand as cloth spines on a walnut shelf, a row per topic under a brass label holder. A red
  ribbon marks a paper you are reading, a kraft wrap one that is still being read, a torn red label one
  that could not be read. Twelve papers or fewer stand face-out as covers; past 40, each row scrolls
  sideways and ends in a "+n more" bookend.
- Search ("/") dims what does not match and never reorders anything; the field says "2 of 24". The keyboard
  walks along the shelf (←/→, Home, End).
- **Reading now**: up to three papers you have a place in, with the page ("p. 4 of 15"), a rule and
  Continue. The place is kept on the server, so it follows you to another browser.
- **Pull out and open the book**: Enter takes a spine out and turns it face-out; Enter again opens the
  spread. The left page is a bookplate ("From the library of …"; it asks for the name once, never makes
  one up from the email), or the paper's Figure 1 if you choose it as the plate. The right page has the
  topic and where it came from, year · arXiv id · pages, the figures the parser found, the title, the
  authors, the abstract in the paper's words with its page tab, your place, the counts, Read and Summary.
  Esc puts it back.
- **Topics**: a card per topic with its cloth, counts and a skyline of its spines. A new paper is offered a
  topic from its arXiv category when one of your topics already holds that category, else by one short AI
  run, labelled "suggested by the AI (model)". An offer never shelves anything.
- **Map**: a plan of the reading room, one island per topic. It draws only real citation links (a paper's
  references matched to another of your papers by arXiv id or title, each labelled with how it matched),
  never "similar" papers, and lists everything as text too.
- **Table**: a ruled catalogue (title, authors, year, topic with its source, pages, state, highlights, last
  opened), sortable, with chips, a filter and a choice of columns. "N need a look" opens it filtered to the
  papers that are queued, being read or failed.
- **Phone**: the books lie flat in stacks; a book opens its card as a bottom sheet, and "Open the book"
  opens the spread.

**Reader** ([`features/reader`](apps/web/src/features/reader/README.md),
[`features/explain`](apps/web/src/features/explain/README.md),
[`features/highlights`](apps/web/src/features/highlights/README.md))

- A new header (Library, Contents, the title, "p. 2 of 15", Source · Guided · Split, zoom, Board, Explain)
  over a reader desk. Contents lists the real headings.
- The selection toolbar sits in the page margin beside the selection, or docked at the top of the column,
  and never covers a selected line: Explain, Ask, Highlight in five washes, Send to board, Copy and Explain
  with a diagram.
- **The explain exchange** (ask → answer → trace): your ask on a call slip, the answer with a numbered
  marker after each claim, and the numbered passages it stands on, under a coverage line ("Stands on 4
  passages · 11 citations · 1 paragraph uncited"). A marker's number is its passage's, the same in the
  answer, the trace and every later exchange. A marker and its trace row light each other; either flashes
  the passage, with a margin tab "from marker 2 in the answer". A claim with no citation goes under "no
  citation · the AI's own reading". Stored threads load when the panel opens.
- Streaming with Stop ("Stopped. The part that arrived is kept.") and Retry; a card when the daily cap is
  reached; the summary as an exchange, its bullets cited or marked "not verified". Highlight delete has
  Undo, and a highlight opens by mouse.
- **Phone**: the explain panel is a bottom sheet over a peek of the page: the first paragraph and "Read the
  whole answer", 44 px markers and trace rows, and the usage line, Dive in and To board pinned above the
  follow-up box.
- **Lamp-lit**: a dark scheme in which the PDF page stays paper (a dimmed ivory). Aa in the library header
  switches System, Daylight or Lamp-lit, per browser.

**Diagrams** ([`features/diagram`](apps/web/src/features/diagram/README.md))

- "Explain with a diagram" on a selection draws an engraved plate of lettered parts (up to A–L) in the
  explain panel. Parts stream in and never move once placed. Each part carries the quote it stands on,
  which the server checks against the paper: **cited** (found word for word), **not verified**, or
  **inferred** (no quote; drawn dashed). The key is the plate's text alternative. Tapping a part flashes
  its passage. Stop keeps the parts that arrived; Redraw makes a new plate; Send to board.

**Notebook** ([`features/notebook`](apps/web/src/features/notebook/README.md))

- **Dive in** under an answer makes a bound page for it (one page per answer): the ask, the answer, and one
  quote card per passage it cites, numbered as in the answer.
- Typed notes, stickies, shapes and five paper templates; pen, highlighter, stroke eraser and a lasso (Ask
  about this, Make sticky, Send to board, Copy, Delete); undo and redo. Search covers typed text, quotes and
  the answer (not handwriting). Send page to board.
- **Tablet** (768–1279 px): a tool rail and pen input with palm rejection. **Phone**: a stack with
  view-only ink, the pen only when switched on, and no lasso, shapes or templates (it says so).

**Board** ([`features/board`](apps/web/src/features/board/README.md))

- v0.1's canvas, now called the board (`/paper/<id>/canvas` redirects). Index cards (passage, note,
  question, notebook page, diagram) and AI-slip cards (answers), with brass pins: evidence in, question in,
  claim out, answer out. A drop on the wrong pin is refused, in words.
- **Seven thread kinds** (supports, contradicts, derives from, answers, compares with, references, plain
  link), each a colour **and** a second cue (a stitch or glyph, plus a paper tag). **Link as** opens at the
  thread's midpoint (keys 1–7; Esc keeps a plain link), and L makes a thread by keyboard.
- Frames, a minimap, a toolbar and an empty-board card; undo and redo of moves, threads, edits and deletes
  (100 steps). **500 cards**: only the cards in view are drawn, and below 45 % zoom each is a glance.

**Motion and access**

- Pull out, open, put back, Read, Dive in, the flash and Link as each have a reduced-motion path (one
  120 ms fade, or nothing); S8's spec measures every moment against the design's reduced column.
- Every voice is marked apart (the paper's, the AI's, yours), every usage line says "estimate", and no
  screen says "verified", "fact-checked" or "accurate" (a test scans the built strings).

**Under the hood**: feature folders with pure, tested models; lint rules for docs, imports and
accessibility; docstrings on new Python modules; Prettier on `apps/web`; a pre-commit hook; migrations
0006–0011; the agent's `diagram` and `topic` kinds. New runtime dependencies: `perfect-freehand` 1.2.3
(MIT) and five Fontsource font packages (SIL OFL 1.1) ([ADR-004 §3](research/architecture-decisions/ADR-004-v0.2-ui-stack.md)).

### Metrics against v0.1.0

| Metric               | v0.1.0                                                                                                                                     | v0.2 (unreleased)                                                                                                                                                                                    | Source                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| TypeScript tests     | 1,858 (vitest 1,716, agent 142)                                                                                                            | **3,149** (vitest 2,970, agent 179)                                                                                                                                                                  | v0.1: the baseline gate in `RESULT.md`; v0.2: `turbo run test --force` on `a8eb3e5`                               |
| pytest               | 2,236 passed                                                                                                                               | **2,562 passed**, 4 skipped, 1 expected failure                                                                                                                                                      | S8's gate on `cbe70fa`; CI on #320                                                                                |
| e2e (Playwright)     | 60 of 60                                                                                                                                   | **88 of 88**, in 30.1 min                                                                                                                                                                            | CI run 39015930115 on #320                                                                                        |
| axe                  | 0 serious or critical in 12 combinations (library, reader Source, reader Guided); canvas and explain panel not tested                      | **0 serious or critical** after each of the 14 steps of the prototype flow at 1440 and 390 px, daylight and lamp-lit: library, book, reader, explain panel, notebook and board                       | S8's `e2e/v02/prototype-flow.spec.ts` (#320)                                                                      |
| Design frames        | none                                                                                                                                       | 32 frames: 17 done, 15 partial (each with its issue), 0 not done                                                                                                                                     | S8's verdict per frame (#320)                                                                                     |
| 500 cards on a board | loaded in 553 ms; zoom frames median 16.7 ms, p95 17.7 ms (load 3.6–9.1); all 500 in the DOM; first view at the 0.2 zoom floor, unreadable | first card 198–245 ms after navigation; pan, wheel zoom and drag p50 / p95 / max 16.7 / 16.7 / 17 ms; at the first view (20 %) all 500 drawn as glances, at 106 % only the 30 cards in view, in full | v0.1: [`GAP-AUDIT.md`](research/build/v0.2-ui/GAP-AUDIT.md) on `79f637d`; v0.2: S8 (a different probe, see below) |
| Live AI spend        | —                                                                                                                                          | 5 live calls during the v0.2 build, ≈ $0.0058 in all (estimates)                                                                                                                                     | `RESULT.md`, "Live AI spend"                                                                                      |

**At scale** (S8, #320): a production build in headless Chromium at 1440 × 900, on a copy of the v0.2 data.
"To the frame" is from the action's dispatch to the second animation frame after it, measured in the page;
"script" is CDP's `ScriptDuration` over the action. The box was nearly idle (load about 2–4), quieter than
during the slices' own runs, so a lower number than a slice's is mostly the load, not a gain.

| What                                                    | Measured                                                                                                                                                                                                     | Load (1 / 5 / 15 min)             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| 400 spines (the demo rows repeated to 400; 3 runs)      | shelf drawn 18–23 ms after the `GET /papers` answer; a search keystroke 3–31 ms to the frame (median 15–18), 1–15 ms of script; Arrange by Year / Title / Topic 43–57 / 31–46 / 18–28 ms                     | 2.02–2.30 / 4.62–4.86 / 7.13–7.30 |
| 400 rows in the Table (3 runs)                          | open the Table 62–81 ms; sort by year 26–48 ms; a keystroke 3–57 ms (median 10–12); back to the Shelf 33–49 ms                                                                                               | same runs                         |
| 500 cards (real ResNet paragraphs, 167 threads; 2 runs) | first card 198–245 ms; one long task (66–82 ms); at 20 % and 106 % zoom, pan, wheel zoom and a card drag p50 / p95 / max 16.7 / 16.7 / 17 ms; Fit all max 33–67 ms; a settled board makes 0 requests in 15 s | 2.26–4.00 / 4.30–4.77 / 6.80–7.11 |
| Ink latency (200-point strokes at 240 Hz, 2 × 3 runs)   | pointer event to the frame that wrote the path: median 13.5–14.2 ms, p95 15.2–16.0 ms; to the next frame (a proxy): 28.1–29.0 / 30.4–31.3 ms; script 1.7–2.1 / 2.4–2.6 ms                                    | 2.22–2.69 / 3.98–4.24 / 6.56–6.75 |

Not measured: a real phone or tablet (every number is headless Chromium at 60 Hz, with no display),
glass-to-pixel time, the library at 400 papers on a phone, ink on an iPad with a Pencil, and the 3D book in
Safari.

**Got worse or costs more:**

- The E2E job is the slowest check: 31 min on #320's run, 30.1 min of it the 88 specs. #320 raises its
  timeout from 40 to 60 min.
- The Python job took 18 min 44 s on #320's run (about 16 min at v0.1.0).

### Known limits (v0.2)

- **Design frames still partial** (S8's verdicts): Enter in the library search opens the card instead of
  pulling the book out ([#313](https://github.com/Legend101Zz/PaperTree/issues/313)); topic banners never
  show the paper's Figure 1 ([#314](https://github.com/Legend101Zz/PaperTree/issues/314)); small library
  differences ([#315](https://github.com/Legend101Zz/PaperTree/issues/315)); Back from the notebook has no
  reverse page turn ([#316](https://github.com/Legend101Zz/PaperTree/issues/316)); the notebook has no
  figure crop tool and draws ink under the cards ([#317](https://github.com/Legend101Zz/PaperTree/issues/317));
  explain says "Summarize paper", shows no first-text time and no live trace while streaming
  ([#318](https://github.com/Legend101Zz/PaperTree/issues/318)); a diagram part stands on one passage and
  there is no crafted-figure job ([#319](https://github.com/Legend101Zz/PaperTree/issues/319)).
- **Citations:** the flash does not work in Guided mode yet
  ([#245](https://github.com/Legend101Zz/PaperTree/issues/245)); a ¶ number can be one off after a
  paragraph that continues across columns ([#234](https://github.com/Legend101Zz/PaperTree/issues/234));
  the coverage count treats a paragraph as cited when its only handles match no citation
  ([#246](https://github.com/Legend101Zz/PaperTree/issues/246)); summary citations have no ¶ or section
  ([#257](https://github.com/Legend101Zz/PaperTree/issues/257)); board passage cards say "p. 2" without the
  ¶ ([#255](https://github.com/Legend101Zz/PaperTree/issues/255)); a plate's flash marks the whole
  paragraph, not the quoted words ([#123](https://github.com/Legend101Zz/PaperTree/issues/123)). The
  grounding check is still lexical ([#179](https://github.com/Legend101Zz/PaperTree/issues/179)).
- **Missing actions:** the daily cap cannot be changed in the app
  ([#256](https://github.com/Legend101Zz/PaperTree/issues/256)); no Dive in or Send to board from the
  summary ([#258](https://github.com/Legend101Zz/PaperTree/issues/258)); no Add to notebook for a plate
  ([#276](https://github.com/Legend101Zz/PaperTree/issues/276)); pinch does not zoom the notebook on a
  tablet ([#292](https://github.com/Legend101Zz/PaperTree/issues/292)).
- **Phone and theme:** the flash's margin tab on a phone is off-screen or over the passage
  ([#279](https://github.com/Legend101Zz/PaperTree/issues/279)); on a phone after Fit all, the board's
  in-card pins and buttons are under the 24 px target size
  ([#282](https://github.com/Legend101Zz/PaperTree/issues/282)); two theme transitions leave a label
  unreadable for about 100 ms ([#308](https://github.com/Legend101Zz/PaperTree/issues/308)).
- **Board and notebook defects:** a notebook page's card squeezes its title under the miniature
  ([#322](https://github.com/Legend101Zz/PaperTree/issues/322)); the board accepts any id as a diagram
  card's plate ([#277](https://github.com/Legend101Zz/PaperTree/issues/277)); a notebook item's undo after
  a failed create can leave the item on the server
  ([#284](https://github.com/Legend101Zz/PaperTree/issues/284)); Dive in's page id is global, not per
  owner ([#300](https://github.com/Legend101Zz/PaperTree/issues/300)).
- **Parser:** A3C's title parses as "Abstract" ([#298](https://github.com/Legend101Zz/PaperTree/issues/298));
  the parser issues carried over from v0.1 are still open
  ([#101](https://github.com/Legend101Zz/PaperTree/issues/101),
  [#103](https://github.com/Legend101Zz/PaperTree/issues/103)).
- **Not in v0.2:** audio and paper replay ([#5](https://github.com/Legend101Zz/PaperTree/issues/5)), OCR or
  scanned PDFs, memory write-back, a hosted version and a Docker setup.

## Release notes (v0.1.0)

**v0.1.0, 2026-10-15** is the first usable release. The full notes are on the
[GitHub release](https://github.com/Legend101Zz/PaperTree/releases/tag/v0.1.0) and in
[`CHANGELOG.md`](CHANGELOG.md); the metrics page is [`docs/METRICS.md`](docs/METRICS.md).

### What changed since the pre-release baseline

The baseline column is the discovery walk at `6ff15ad` (2026-09-25). `docs/METRICS.md` also has the handoff gate `45fb2db` (2026-09-26) as a second baseline.

| Metric                                 | Baseline (`6ff15ad`)                                           | v0.1 (`60ae507`)                                                                |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Journey A: upload, parse, read         | PARTIAL (DDPM dead-letters; card only after a reload, 0 pages) | PASS                                                                            |
| Journey B: highlights                  | FAIL (mouse cannot create one; gone on reload)                 | PASS; two items PARTIAL (see Known limits)                                      |
| Journey C: explain, follow-up, summary | PARTIAL (2 of 5 asks 504; no follow-up, no summary)            | PASS                                                                            |
| Journey D: canvas                      | FAIL (404)                                                     | PASS, minimal scope                                                             |
| Journey E: which code and provider ran | code read; one socket seen                                     | PASS: request id → logs → `ai_runs` row; only socket = `api.minimax.io`         |
| Papers that parse (of 14)              | 12                                                             | 14                                                                              |
| Repo-gold pooled reading order         | 0.900 (26 discordant pairs)                                    | 0.962 (9)                                                                       |
| Explain first text                     | not streamed; 10–40 s silence                                  | Flash p50 2.13 s (n=9); 2.4 s in the hands-on test                              |
| Failed AI answers                      | 2 of 5 asks returned 504                                       | 0 of 38 A/B runs failed (3 summaries ended partial)                             |
| TS tests                               | 1,389                                                          | 1,858                                                                           |
| pytest                                 | 1,733 passed                                                   | 2,236 passed, 0 failed                                                          |
| e2e (Playwright)                       | 0                                                              | 60 specs in CI                                                                  |
| CI checks                              | 5 jobs; no prettier, build, corpus, browser or live call       | + prettier, `next build`, corpus tests, Playwright A–D, live journey; all green |
| 390 px reader                          | FAIL (scrollWidth 622)                                         | PASS                                                                            |

**Got worse** (the main items; the full list, with causes, is in [`docs/METRICS.md`](docs/METRICS.md) →
"WORSE, with cause"):

- ResNet pooled reading order 0.932 → 0.906. This was accepted: the scored pool shrank, and real discordant
  pairs went 2 → 0. Some per-type F1 scores dropped with the same parser rule. GPT-3 macro-F1 fell by
  0.0013.
- Explain on M3 got slower in one sample: first text p50 8.45 → 20.62 s (n=6, cause not attributed). This
  is why explain moved to Flash.
- The grounding check lets more fabricated claims through in mixed cases: 3 of 18 judged supported,
  against 2 of 18 before.
- The Python CI job takes about 16 min, because the corpus tests now run.
- Datamarked quotes add about 12 % input tokens.

### Known limits

- **Two hands-on items are PARTIAL:**
  - Highlighting once scrolled the reader. It is not reproduced on the release code and is guarded, but
    the cause was never found.
  - A Shift+click selection that starts at the very start of a line loses its first 1–2 characters.
- **Grounding:** the citation check is lexical. Negation and comparator swaps pass it, and names found
  only in the references list, and equation numbers, cannot be verified.
- **Other defects:** a selection across columns includes the figure caption between them; highlight delete
  has no undo; the Contents outline shows raw block labels; a Guided figure crop shows its caption twice;
  the phone canvas first opens tiny. The full list is in
  [`docs/METRICS.md`](docs/METRICS.md) → "Known defects at release".
- **Not in v0.1:** audio (Epic 4), OCR or scanned PDFs, and memory write-back. There is no hosted version
  and no Docker setup.
- **Not measured yet:** a human-scored grounding rate (#62), and latency under concurrent users.

## Roadmap

v0.2 is tracked in [#182](https://github.com/Legend101Zz/PaperTree/issues/182). What is left before the
release: S8 ([#218](https://github.com/Legend101Zz/PaperTree/issues/218),
[PR #320](https://github.com/Legend101Zz/PaperTree/pull/320)), then the owner merges `release/v0.2` into
`main` and tags it.

**Open, for v0.2 or after** (every open issue with the `v0.2` label):

- [ ] **The design's frames** that are still partial: [#313](https://github.com/Legend101Zz/PaperTree/issues/313),
      [#314](https://github.com/Legend101Zz/PaperTree/issues/314), [#315](https://github.com/Legend101Zz/PaperTree/issues/315),
      [#316](https://github.com/Legend101Zz/PaperTree/issues/316), [#317](https://github.com/Legend101Zz/PaperTree/issues/317),
      [#318](https://github.com/Legend101Zz/PaperTree/issues/318), [#319](https://github.com/Legend101Zz/PaperTree/issues/319);
      the UI revamp's own issue, [#175](https://github.com/Legend101Zz/PaperTree/issues/175).
- [ ] **Reader and citations:** the reader's v0.1 leftovers ([#176](https://github.com/Legend101Zz/PaperTree/issues/176)),
      the flash in Guided ([#245](https://github.com/Legend101Zz/PaperTree/issues/245)), ¶ locators
      ([#234](https://github.com/Legend101Zz/PaperTree/issues/234), [#255](https://github.com/Legend101Zz/PaperTree/issues/255),
      [#257](https://github.com/Legend101Zz/PaperTree/issues/257)), the uncited count
      ([#246](https://github.com/Legend101Zz/PaperTree/issues/246)), the phone margin tab
      ([#279](https://github.com/Legend101Zz/PaperTree/issues/279)), sub-block anchors
      ([#123](https://github.com/Legend101Zz/PaperTree/issues/123)).
- [ ] **AI:** the grounding check's limits, Flash re-tests and latency
      ([#179](https://github.com/Legend101Zz/PaperTree/issues/179)); the daily cap in the app
      ([#256](https://github.com/Legend101Zz/PaperTree/issues/256)); the summary to the notebook and the
      board ([#258](https://github.com/Legend101Zz/PaperTree/issues/258)).
- [ ] **Notebook:** a plate on a page ([#276](https://github.com/Legend101Zz/PaperTree/issues/276)), undo
      after a failed create ([#284](https://github.com/Legend101Zz/PaperTree/issues/284)), pinch zoom
      ([#292](https://github.com/Legend101Zz/PaperTree/issues/292)), per-owner Dive-in ids
      ([#300](https://github.com/Legend101Zz/PaperTree/issues/300)).
- [ ] **Board:** the canvas's deferred parts ([#178](https://github.com/Legend101Zz/PaperTree/issues/178)),
      plate ids checked ([#277](https://github.com/Legend101Zz/PaperTree/issues/277)), phone target sizes
      ([#282](https://github.com/Legend101Zz/PaperTree/issues/282)), thread versions
      ([#283](https://github.com/Legend101Zz/PaperTree/issues/283)), the controller split
      ([#309](https://github.com/Legend101Zz/PaperTree/issues/309)), the notebook card's title
      ([#322](https://github.com/Legend101Zz/PaperTree/issues/322)).
- [ ] **Theme:** two transitions ([#308](https://github.com/Legend101Zz/PaperTree/issues/308)), dark-scheme
      axe checks in some e2e specs ([#269](https://github.com/Legend101Zz/PaperTree/issues/269)).
- [ ] **Parser:** a held-out set, pinned corpus URLs and text beside tables
      ([#180](https://github.com/Legend101Zz/PaperTree/issues/180)), A3C's title
      ([#298](https://github.com/Legend101Zz/PaperTree/issues/298)), the inline-equation role
      ([#101](https://github.com/Legend101Zz/PaperTree/issues/101)), float detection on ResNet and Neural
      ODEs ([#103](https://github.com/Legend101Zz/PaperTree/issues/103)).
- [ ] **CI, tests and docs:** faux runs that look real in `ai_runs`, the Python job's time
      ([#181](https://github.com/Legend101Zz/PaperTree/issues/181)), a peak-memory test that reads high when
      suites run at once ([#129](https://github.com/Legend101Zz/PaperTree/issues/129)), a lint crash on
      `apps/web/test` ([#219](https://github.com/Legend101Zz/PaperTree/issues/219)), the e2e harness's
      leftover data folder ([#268](https://github.com/Legend101Zz/PaperTree/issues/268)), the env files
      ([#323](https://github.com/Legend101Zz/PaperTree/issues/323)), a v0.2 demo GIF
      ([#321](https://github.com/Legend101Zz/PaperTree/issues/321)).
- [ ] **Later:** audio and paper replay ([#5](https://github.com/Legend101Zz/PaperTree/issues/5)).

## Troubleshooting

<details>
<summary><b>Common problems and fixes</b></summary>

- **The page is zoomed or looks wrong on `localhost`.** Chrome keeps a saved zoom level per host name.
  Browse `http://127.0.0.1:3000` instead.
- **"This PDF could not be opened".** The web app was started with `next dev` instead of
  `pnpm --filter papertree-web dev`, so the pdf.js worker was never copied. Restart it with pnpm.
- **Port already in use.** Something else owns 8000, 8200 or 3000 (3000 is a common one). Pick other ports
  as described under Configuration; the four processes only need to agree with each other.
- **Uploads stay "processing"** (on v0.2, the spine stays in its kraft wrap). The worker is not running, or
  it was started with a different `PAPERTREE_DATA_ROOT` than the API. Both load `.env`; do not override one
  of them.
- **Explain answers "AI explanations are not configured" (503).** `PAPERTREE_AGENT_SECRET` is missing in the
  API's environment. Re-run the `echo ... >> .env` line, then restart the API and the agent.
- **The agent exits at boot** with one `agent.boot.refused` line naming the problem: usually
  `PAPERTREE_AGENT_SECRET` or `PAPERTREE_MINIMAX_API_KEY` is unset. An ambient `MINIMAX_API_KEY` is not
  used: the agent deletes it at boot and reads only `PAPERTREE_MINIMAX_API_KEY`.
- **Where the key goes.** To the agent process only, inline on its start command. If you put it in `.env` it
  is also loaded into the API and the worker, which must not hold it.
- **Daily budget reached.** AI requests are refused once your estimated spend in the last 24 h passes
  `PAPERTREE_DAILY_BUDGET_USD`; the refusal says so.
- **No topic is suggested** (v0.2). The arXiv-category rule only offers a topic you already use for that
  category. Otherwise the suggestion is one AI run per paper, which needs the agent and the key, runs in the
  background and shows on a later look; any failure is just "No suggestion yet". You can always choose a
  topic yourself.
- **The scheme is not the one you want** (v0.2). Aa in the library header switches System, Daylight and
  Lamp-lit; the choice is kept per browser.
- **`/design-system` answers 404** in a production build. Build with `NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM=on`;
  `next dev` always serves it.
- **Reset everything.** Stop the four processes, delete the data root (`~/.papertree` by default).

</details>

## Docs

- [`research/architecture-decisions/ADR-002-reader-release.md`](research/architecture-decisions/ADR-002-reader-release.md):
  the architecture and why
- [`research/architecture-decisions/ADR-003-model-policy.md`](research/architecture-decisions/ADR-003-model-policy.md)
  and [`docs/release/v0.1/MODEL-AB.md`](docs/release/v0.1/MODEL-AB.md): models
- [`research/architecture-decisions/ADR-004-v0.2-ui-stack.md`](research/architecture-decisions/ADR-004-v0.2-ui-stack.md):
  what the v0.2 interface is built with, and what was rejected
- [`research/build/reader-release/contracts.md`](research/build/reader-release/contracts.md): the normative
  wire, database and environment contracts
- [`contracts/README.md`](contracts/README.md): the generated JSON schemas
- [`services/agent/README.md`](services/agent/README.md): the agent service
- **The v0.2 build** ([`research/build/v0.2-ui/`](research/build/v0.2-ui/)):
  [`PLAN.md`](research/build/v0.2-ui/PLAN.md) (the slices and their issues),
  [`GAP-AUDIT.md`](research/build/v0.2-ui/GAP-AUDIT.md) (the design against the v0.1 app),
  [`RESULT.md`](research/build/v0.2-ui/RESULT.md) (the gates, the slices, the live spend),
  [`STATE.md`](research/build/v0.2-ui/STATE.md), the research notes on the
  [canvas](research/build/v0.2-ui/RESEARCH-R1-canvas.md), [ink](research/build/v0.2-ui/RESEARCH-R2-ink.md)
  and [diagrams and motion](research/build/v0.2-ui/RESEARCH-R3-diagrams-motion.md), and the design's
  [frames](research/build/v0.2-ui/reference/)
- **The v0.2 features**, one README each: [library](apps/web/src/features/library/README.md),
  [book](apps/web/src/features/book/README.md), [reader](apps/web/src/features/reader/README.md),
  [explain](apps/web/src/features/explain/README.md), [diagram](apps/web/src/features/diagram/README.md),
  [notebook](apps/web/src/features/notebook/README.md), [board](apps/web/src/features/board/README.md),
  [highlights](apps/web/src/features/highlights/README.md), [settings](apps/web/src/features/settings/README.md),
  [design system](apps/web/src/features/design-system/README.md)
- [`docs/METRICS.md`](docs/METRICS.md): release metrics, and what got better or worse
- [`research/build/READER-RELEASE-RESULT.md`](research/build/READER-RELEASE-RESULT.md): the v0.1 hands-on
  feature table
- [`AGENTS.md`](AGENTS.md): working rules and hazards for contributors and coding agents
- [`CONTRIBUTING.md`](CONTRIBUTING.md): setup, dev ports, the gate, lint rules, code layout
- [`docs/release/v0.1/PLAN.md`](docs/release/v0.1/PLAN.md): the v0.1 release plan
- [`archive/README.md`](archive/README.md): the retired v1 code, kept for reference and not part of the
  build

## Contributing

Issues and pull requests are welcome. Before you open a PR:

1. Read [`AGENTS.md`](AGENTS.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md): the repository's working rules,
   its known hazards, the code layout and the lint rules.
2. Work on a branch and open a PR against `main`; until v0.2 is released, v0.2 work targets
   `release/v0.2` instead. Describe what you changed and how you checked it.
3. Run the gates in [Tests and quality gates](#tests-and-quality-gates) that cover your change. CI runs all
   of them on every PR, the e2e suite included.
4. Never commit a key, a secret or a machine-specific absolute path.

The v0.2 tracker ([#182](https://github.com/Legend101Zz/PaperTree/issues/182)) is the best place to find
work.

## Acknowledgements

- Built on [pdf.js](https://mozilla.github.io/pdf.js/), [PyMuPDF](https://pymupdf.readthedocs.io/),
  [React Flow](https://reactflow.dev/) (`@xyflow/react`), [perfect-freehand](https://github.com/steveruizok/perfect-freehand),
  [Next.js](https://nextjs.org/), [FastAPI](https://fastapi.tiangolo.com/), the Pi harness SDK
  (`@earendil-works/pi-coding-agent`) and [MiniMax](https://www.minimax.io/) models.
- The v0.2 typefaces are Libre Caslon Display and Text, Alegreya Sans and Alegreya Sans SC, and Courier
  Prime (SIL Open Font License 1.1), self-hosted from the [Fontsource](https://fontsource.org/) packages.
- The screenshots and the demo show these papers, used as examples; they belong to their authors:
  - Vaswani et al., [_Attention Is All You Need_](https://arxiv.org/abs/1706.03762) (2017).
  - Redmon et al., [_You Only Look Once: Unified, Real-Time Object Detection_](https://arxiv.org/abs/1506.02640) (2016).
  - He et al., [_Deep Residual Learning for Image Recognition_](https://arxiv.org/abs/1512.03385) (2016).
  - Ho et al., [_Denoising Diffusion Probabilistic Models_](https://arxiv.org/abs/2006.11239) (2020).
  - Devlin et al., [_BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding_](https://arxiv.org/abs/1810.04805) (2019).
  - Brown et al., [_Language Models are Few-Shot Learners_](https://arxiv.org/abs/2005.14165) (2020).
  - Chen et al., [_Neural Ordinary Differential Equations_](https://arxiv.org/abs/1806.07366) (2018).
  - Wang et al., [_SuperGLUE: A Stickier Benchmark for General-Purpose Language Understanding Systems_](https://arxiv.org/abs/1905.00537) (2019).
  - Kingma and Ba, [_Adam: A Method for Stochastic Optimization_](https://arxiv.org/abs/1412.6980) (2015).
  - Dao et al., [_FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness_](https://arxiv.org/abs/2205.14135) (2022).
  - He et al., [_Mask R-CNN_](https://arxiv.org/abs/1703.06870) (2017).
  - Reimers and Gurevych, [_Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks_](https://arxiv.org/abs/1908.10084) (2019).
  - Zhang et al., [_PDF-to-Tree: Parsing PDF Text Blocks into a Tree_](https://aclanthology.org/2024.findings-emnlp.628/) (2024).

## License

PaperTree is released under the [MIT License](LICENSE). Copyright © 2026 Mrigesh Thakur.

The MIT license covers this repository's own code. Its dependencies keep their own licenses. Note that
the PDF parser uses [PyMuPDF](https://pymupdf.readthedocs.io/), which is licensed under the AGPL-3.0
(or a commercial license from Artifex). If you distribute PaperTree or run it as a network service for
others, check PyMuPDF's terms. The benchmark papers are fetched from their sources, not redistributed, and
keep their own licenses.

## Author

**Mrigesh Thakur** · GitHub [@Legend101Zz](https://github.com/Legend101Zz)

If PaperTree is useful to you, a ⭐ on the repository helps others find it.
