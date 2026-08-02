# Backend Audit — `papers/routes.py`, `papers/llm_service.py`, `services/ai.py`, `papers/models.py`

Scope: the upload→read lifecycle, LLM generation, and figure serving.
Method: full read of the four target files plus `papers/extraction.py`, `papers/services.py`, `explanations/routes.py`, `explanations/services.py`, `highlights/routes.py`, `canvas/services.py`, `config.py`, `database.py`, `main.py`, and `apps/web/src/lib/api.ts`.

---

## What this subsystem actually does

Despite four dataclass-rich modules that *look* like a document pipeline, the live path stores exactly one representation of a paper: **a single concatenated Python string**.

`upload_paper` (`routes.py:40`) writes the PDF to disk under a random UUID, then calls the 12-line `extract_text_from_pdf` (`routes.py:25-37`), which produces `"[Page 1]\n...\n\n[Page 2]\n..."`. That string is written into the Mongo `papers` document as `extracted_text`. **Nothing else is extracted.** No bounding boxes, no block IDs, no font sizes, no headings, no figures, no metadata, no TOC.

Two other extractors exist and are **completely dead** — nothing imports either:

- `papers/extraction.py` (1017 lines): a genuinely good block model — `BoundingBox` normalized to page coords (`:34`), `SourceLocation` with page + bbox + char offsets (`:46`), typed `HeadingBlock`/`MathBlock`/`FigureBlock`/`TableBlock`, figure caption detection (`:844`), PDF TOC extraction (`:893`), stable `blk_<uuid>` IDs (`:310`).
- `papers/services.py` (683 lines): a second, weaker structured extractor with **no geometry at all** — blocks carry only `type` and `content` (`:254-286`).

Three extractors; the one wired in is the one that throws away every piece of provenance the other two capture.

`generate_book` (`routes.py:146`) then re-parses that flat string with a regex (`llm_service.extract_page_text`, `llm_service.py:113`) to recover per-page text, and sends each page to OpenRouter. What comes back is stored as `book_content.page_summaries`. `smart_outline` — the "Smart Outline" — is **not** a document outline: it is one entry per generated page, `level` hardcoded to `1`, `title` taken from a model-invented page title, `description` = `key_concepts[0]` (`routes.py:198-207`). The paper's real section structure is never surfaced.

"Book mode" in the reader (`BookViewer.tsx:529`) renders `page_summaries` — i.e. the user reading "the book" is reading **only LLM prose**, never the paper.

### Exact prompt payloads

- **TL;DR** — `generate_book_content` passes `paper_text[:6000]` (`llm_service.py:313`), then `generate_paper_tldr` re-truncates to 4000 chars (`llm_service.py:216`). Template `PAPER_TLDR_USER_PROMPT` (`llm_service.py:101`) supplies `Title:` = the **filename minus `.pdf`** (`routes.py:61`), so the model is told a paper is called "1706.03762". ≈1,100 input tokens, `max_tokens: 300`.
- **Per page** — `PAGE_SUMMARY_SYSTEM_PROMPT` (~1,540 chars ≈ 400 tok) + `PAGE_SUMMARY_USER_PROMPT` (~700 chars) + page text capped at 5,000 chars, or `text[:2500] + "...[content truncated]..." + text[-2500:]` if longer (`llm_service.py:161-162`). ≈**1,900–2,000 input tokens/page**, `max_tokens: 2500`, `temperature: 0.7`.
- Default `POST /generate-book` = 1 + 5 sequential calls ≈ 11k input / ≤12.5k output tokens. `generate_all=true` on a 40-page paper = **41 sequential HTTP calls inside one request handler**, ≈80k in / ≤100k out.

### Grounding, validation, retries, cost

There are none. `_validate_page_summary` (`llm_service.py:395`) is a `.get()`-with-defaults reshaper — it checks no type, no emptiness, no relation to the source page. There is no retry, no backoff, no 429 handling anywhere in the repo. `data["usage"]` from OpenRouter is read and discarded (`llm_service.py:193`) — the path that burns ~95% of the tokens records zero cost telemetry.

### Figures

There is no figure pipeline. `GET /papers/{id}/page/{n}/image` (`routes.py:349`) re-opens the PDF and rasterizes an arbitrary caller-supplied normalized rect. The caller must already know the rect; the backend never tells it where figures are. `db.paper_images` gets an index at `database.py:19` and is never written or read.

---

## Data flow

```
POST /papers/upload
  await file.read()            → whole file in RAM, no size limit  (routes.py:54)
  write storage/papers/<uuid4>.pdf   (relative path, from CWD)     (config.py:24)
  extract_text_from_pdf()      → SYNCHRONOUS, blocks event loop    (routes.py:59)
  insert {extracted_text: str, book_content: None, smart_outline: []}

POST /papers/{id}/generate-book   (fully synchronous, no job, no status)
  extracted_text → generate_paper_tldr(text[:6000][:4000])         (1 call)
  for page in range(min(default_pages, page_count)):               (N sequential calls)
      extract_page_text(full_text, page)  ← regex over the string
      httpx POST openrouter, timeout=90s
      _parse_page_summary → JSON | ```json``` | {...} | RAW CONTENT AS SUMMARY
  ONLY AFTER ALL N SUCCEED → single $set of book_content + smart_outline

POST /papers/{id}/generate-pages
  N sequential calls → merge with existing → $set   (crashes if book_content is None)

GET /papers/{id}
  returns extracted_text (full) + book_content (full) + smart_outline
  BookContent(**doc) → pydantic; malformed stored data = permanent 500
```

Failure handling: partial success within a `generate-book` call is **discarded** — nothing is persisted until the loop finishes (`routes.py:210`). Per-page failures inside `generate_multiple_pages` are converted into error placeholder dicts (`llm_service.py:282-292`) that are then persisted as if they were real summaries.

---

## Findings

| Sev | Title | file:line | Evidence | Consequence |
|---|---|---|---|---|
| critical | `generate-pages` crashes with 500 *after* paying for LLM calls | `papers/routes.py:248` | `book_content = paper.get("book_content", {})` — upload sets the key explicitly to `None` (`routes.py:71`), so `.get` returns `None`, not `{}`. Line 264 makes the LLM calls, then line 271 `list(book_content.get("page_summaries", []))` → `AttributeError: 'NoneType' object has no attribute 'get'` | Any call to `/generate-pages` on a paper that has not run `/generate-book` first burns N OpenRouter calls, throws them away, and returns a 500. The frontend exposes this via `handleGenerateMorePages` (`read/page.tsx:172`). |
| critical | A page with no extractable text makes the *previous* page's summary describe the rest of the document | `papers/routes.py:33` + `papers/llm_service.py:116` | `if text: text_parts.append(f"[Page {page.number + 1}]\n{text}")` — image-only pages emit **no marker**. Then `pattern = rf'\[Page {page_num + 1}\]\n(.*?)(?=\[Page {page_num + 2}\]\|\Z)'` — with the `N+2` marker absent the lookahead falls through to `\Z` | The regex swallows everything to end-of-document. That blob is then cut to `text[:2500] + text[-2500:]` (`llm_service.py:162`), so "Page 7" is summarized from page 7's opening plus **the bibliography**. Wrong content is shown, attributed to a specific page, with no error signalled. Scanned pages and full-page figures are common in papers. |
| critical | Explicit page selection is silently ignored; wrong pages are generated | `papers/routes.py:186` | `elif request.pages: default_pages = len(request.pages)` — only the *count* survives; `generate_book_content` then does `pages_to_generate = list(range(min(default_pages, page_count)))` (`llm_service.py:316`) | `POST /generate-book {"pages": [17, 22, 40]}` generates pages **0, 1, 2**. The API accepts a request it does not honour and reports `"status": "success"`. |
| critical | A malformed LLM response permanently bricks `GET /papers/{id}` | `papers/routes.py:128` | `book_content = BookContent(**paper["book_content"])` with no try/except. `_validate_page_summary` does `result.get("key_concepts", [])[:5]` (`llm_service.py:401`) — if the model returns a string, slicing yields a string, which is stored, and `PageSummary.key_concepts: List[str]` (`models.py:28`) then rejects it | The paper detail endpoint 500s forever. The user cannot open, re-generate, or recover the paper — only delete it. Nothing validates model output before it becomes the schema's problem. |
| critical | Failed generations are recorded as successful and can never be retried | `papers/llm_service.py:282-292` + `routes.py:276` | On exception a placeholder `{"summary": f"_Failed to generate summary: {str(e)}_", "error": True}` is appended; `routes.py:276` then writes `generated_pages = [ps["page"] for ps in all_summaries]` | A transient 429 or 90s timeout permanently marks the page as generated. `routes.py:258` filters `p not in existing_pages`, so retry is impossible short of `force_regenerate` on the whole book. Worse: `PageSummary` (`models.py:23`) has **no `error` field**, so pydantic drops the flag at `routes.py:128` — the client cannot distinguish a failure stub from a real summary. |
| critical | All provenance is destroyed at ingest; the live extractor is the only one without geometry | `papers/routes.py:25-37` | `text = page.get_text("text", sort=True)` … `return "\n\n".join(text_parts), page_count` — while `extraction.py:46` (`SourceLocation(page, bbox, char_start, char_end)`) and `extraction.py:310` (`blk_` IDs) sit unimported | Nothing can be anchored to the document: no highlight→region mapping, no "jump to source", no stable IDs across re-extraction, no figure locations. This is the single change that blocks the "Goodnotes for papers" vision — annotations must live on document coordinates, and the backend has none. |
| critical | AI output is indistinguishable from source content, and raw model text can become "the page" | `papers/llm_service.py:383-392` | Fallback when all JSON parsing fails: `return {"title": f"Page {page_num + 1}", "summary": content, "has_math": "$" in content, ...}` | A refusal, an apology, or a chain-of-thought dump is stored verbatim as the page's content and rendered in Book mode as the paper. There is no `is_generated` flag, no source quotes, no confidence, no page-region citation anywhere in `PageSummary` or `BookContent` (`models.py:23-64`). The prompt template itself contains invalid JSON — `"has_math": true/false` (`llm_service.py:83`) — actively inviting this path. |
| major | Extraction and rasterization run synchronously in the async event loop | `papers/routes.py:59`, `routes.py:397` | `extracted_text, page_count = extract_text_from_pdf(file_path)` inside `async def upload_paper`; `pix = page.get_pixmap(matrix=mat, clip=clip_rect)` inside `async def get_page_image` — no `run_in_threadpool` | CPU-bound PyMuPDF work blocks *every* concurrent request. A 200-page upload stalls the whole API for seconds; each figure thumbnail re-opens and re-rasterizes the PDF from disk on every request. |
| major | Generation is a long-lived blocking request with no status, progress, or resumability | `papers/routes.py:190-216` | `result = await generate_book_content(...)` then a single `$set` at line 210 — the loop at `llm_service.py:265` is `for page_num in pages_to_generate:` (sequential), each with `timeout=90.0` (`llm_service.py:171`) | `generate_all=true` on a 40-page paper = up to 3,600s in one HTTP request. No proxy or browser holds that. **All completed, paid-for page summaries are lost** on disconnect or restart because nothing is written until the loop completes. There is no job record, no `status` field, no progress endpoint — the only state the frontend has is a React `isGenerating` boolean (`read/page.tsx:141`) that does not survive a reload. |
| major | Unbounded client-controlled rasterization scale | `papers/routes.py:359` | `scale: float = 2.0` taken straight from the query string into `fitz.Matrix(scale, scale)` (`routes.py:396`) with no clamp | `?scale=200` on a letter page requests a ~170,000 × 220,000 px pixmap — unauthenticated-adjacent memory exhaustion, trivially repeatable. |
| major | JWTs are passed in query strings and the responses are publicly cacheable | `papers/routes.py:320`, `routes.py:353`, `routes.py:405` | `token: Optional[str] = None` … `auth_token = token or (authorization[7:] ...)`; response sets `headers={"Cache-Control": "max-age=3600"}` (no `private`) | Bearer tokens land in browser history, `Referer` headers, and access logs; `api.ts:100` builds `.../file?token=${getToken()}` for the PDF itself. `max-age=3600` without `private` lets a shared proxy cache page images keyed on a URL containing a credential. |
| major | `except Exception` around the image handler converts a 400 into a 500 | `papers/routes.py:408` | `raise HTTPException(status_code=400, detail="Invalid page number")` at line 384 sits **inside** the `try:` opened at line 380; `except Exception as e: raise HTTPException(status_code=500, detail=str(e))` re-wraps it | Invalid page numbers return `500 {"detail": "400: Invalid page number"}`. Every real failure — missing file, corrupt PDF — is also flattened to a 500 with a raw internal string leaked to the client. |
| major | Bare `except:` masks database failures as 404s | `papers/routes.py:120`, `routes.py:240` | `except:` with no exception class, returning `HTTPException(404, "Paper not found")` | Catches `BaseException` (incl. `KeyboardInterrupt`, `SystemExit`). A Mongo outage, a network partition, or a bug in `find_one` is reported to the user as "Paper not found" — a data-loss-shaped message for a transient fault. Repeated at `explanations/routes.py:37, 55, 228, 286, 346`. |
| major | The only cost accounting in the codebase is structurally guaranteed to report `$0.00` | `services/ai.py:162` vs `services/ai.py:14-33` | Default `model: str = "deepseek/deepseek-chat"` (also `:227`, `:275`), but `MODELS` keys are `"deepseek/deepseek-v3.2"`, `"anthropic/claude-sonnet-4.5"`, `"qwen/..."`. `_estimate_cost` does `MODELS.get(model, {})` → `{}` → `.get("cost_per_1k_input", 0)` → `0` | `cost_estimate` is always `0.0` and is persisted as truth into `model_metadata.cost_estimate` (`highlights/routes.py:192`). Meanwhile `papers/llm_service.py` — the path that actually spends the money — records nothing at all. Per-user and per-paper spend is unmeasurable, and there is no quota or rate limit anywhere. |
| major | `MODELS` mislabels a model in user-facing output | `services/ai.py:27-28` | `"qwen/qwen3-235b-a22b-thinking-2507": {"name": "GPT-4o Mini", ...}` | `model_name` is stored on every explanation (`highlights/routes.py:187`) and shown to the user. The product would tell a researcher their explanation came from GPT-4o Mini when it came from Qwen. |
| major | `services/ai.py` bypasses the app's config system | `services/ai.py:10` | `OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")` at import time, while everything else uses `settings.openrouter_api_key` from pydantic-settings' `.env` loader (`config.py:19`, `env_file = ".env"`) | If the key lives only in `.env` (the documented mechanism) and is not exported, this module sends `Authorization: Bearer None` — highlight explanations 401 while page generation works. Two config sources, two base URLs, two `HTTP-Referer` values (`ai.py:177` = `https://papertree.app`, `llm_service.py:177` = `http://localhost:3000`). |
| major | Four independent OpenRouter clients with four different prompt vocabularies | `papers/llm_service.py:411`, `explanations/services.py:68`, `services/ai.py:156`, `canvas/services.py:593` | `MODE_PROMPTS` (8 modes, `ai.py:36`), `ASK_MODE_PROMPTS` (7 different modes, `explanations/services.py:11`), plus two inline prompt strings in `llm_service.py` | Four copies of headers/timeout/parse logic, four disjoint mode taxonomies (`explain` vs `explain_simply`, `derive` vs `derive_steps`), zero shared retry/cost/validation. Any grounding or provenance work must be done four times. |
| major | Paper file paths are relative to the process working directory | `config.py:24` + `papers/routes.py:51` | `storage_path: str = "storage/papers"`, then `file_path = os.path.join(settings.storage_path, safe_filename)` stored verbatim in Mongo | Every stored `file_path` is CWD-relative. Start the API from a different directory, containerize it, or change the layout and `os.path.exists(paper["file_path"])` (`routes.py:339`) fails — every paper 404s while the PDFs are still on disk. |
| moderate | No content hashing; identical uploads are fully duplicated | `papers/routes.py:49` | `file_id = str(uuid.uuid4())` — `hashlib` is imported in the dead `extraction.py:8` and never used | Re-uploading the same PDF creates a second file, a second extraction, and a second set of paid generations, with no way to carry highlights or notes across. Blocks any future "same paper, same annotations" story. |
| moderate | Failed uploads leave orphaned files and 500s | `papers/routes.py:55-59` | The file is written to disk before `fitz.open` is attempted; validation is `file.filename.endswith('.pdf')` on a client-supplied string | A renamed `.txt`, an encrypted PDF, or a corrupt file raises inside `extract_text_from_pdf` → unhandled 500, and the junk file stays on disk forever. `await file.read()` (`routes.py:54`) also loads the whole upload into RAM with no size cap. |
| moderate | List and detail endpoints ship the entire document body | `papers/routes.py:93`, `routes.py:140-142` | `cursor = db.papers.find({"user_id": ...})` with no projection; `extracted_text=paper.get("extracted_text")` returned in full alongside full `book_content` | Rendering a library of 30 papers pulls 30 full `extracted_text` blobs + all summaries out of Mongo. Opening one paper ships the entire text plus every summary to the browser in a single JSON response. All of it lives in one BSON document, which has a hard 16MB ceiling that a long thesis plus `generate_all` will approach. |
| moderate | `force_regenerate` destroys previously generated pages | `papers/routes.py:210-216` | `$set: {"book_content": result, "smart_outline": smart_outline}` — a wholesale replacement, where `result` contains only the first `default_pages` summaries | A user who generated 40 pages and then hits regenerate is left with 5. Canvas nodes hold **copies** of the old summaries (`canvas/services.py:248-249` `"content": page_summary`), so the canvas silently retains stale, now-orphaned text. |
| moderate | `SmartOutlineItem` is a page list, not an outline — and the real TOC is thrown away | `papers/routes.py:198-207` | `{"id": f"page-{ps['page']}", "title": ps["title"], "level": 1, "section_id": f"page-{ps['page']}", "description": ps["key_concepts"][0] ...}` | Every entry is `level: 1`; there is no hierarchy, no section nesting, and the titles are model inventions rather than the paper's headings. `extraction.py:893` (`self.doc.get_toc()`) and `services.py:562` both extract the real TOC and are unreachable. The navigation surface of a "premium reader" is currently a flat list of hallucinated page titles. |
| moderate | Deletion leaves orphans across three collections | `papers/routes.py:428-431` | Deletes `highlights`, `explanations`, `canvases` — but not `highlight_explanations` (written at `highlights/routes.py:198`) or `canvas_nodes` (indexed at `database.py:37`) | Orphaned AI output and canvas nodes accumulate per deleted paper, indefinitely. The highlight delete also matches only `paper_id`, missing legacy docs keyed on `book_id` (`highlights/routes.py:369`). |
| moderate | Unbounded in-process response cache in a module singleton | `services/ai.py:127`, `ai.py:212` | `self._request_cache: Dict[str, Any] = {}` … `self._request_cache[cache_key] = result`, never evicted, keyed on `md5(model:prompt)` | Grows without limit for the process lifetime; does not survive a restart; is not shared across workers, so "idempotency" silently breaks the moment there is more than one process. |
| moderate | Highlight context is always empty — it reads a collection that does not exist | `highlights/routes.py:164` | `book = await db.books.find_one({"_id": ObjectId(highlight["book_id"])})` then `if book and "pages" in book:` — papers are stored in `db.papers` and have no `pages` array | `context` is always `""`, so `/highlights/{id}/explain` asks the model to explain a fragment with zero surrounding text. The naming split (`book_id` vs `paper_id`) has produced a silently dead code path. |
| minor | Dead imports and dead functions in the live modules | `papers/routes.py:15-19`, `llm_service.py:130`, `llm_service.py:411` | `extract_page_text`, `PDFRegion`, `SearchResult`, `PageSummary` imported and never used; `count_pages_in_text` and `generate_highlight_explanation` defined and never called | Signals which abstractions were abandoned mid-flight. `PDFRegion` (`models.py:9`) — the one geometry type in the live models file — is imported by the router and used nowhere. |
| minor | Paper title is the filename | `papers/routes.py:61` | `title = os.path.splitext(file.filename)[0]` — while `doc.metadata` is available and `extraction.py:937` reads it | Papers are titled `1706.03762` or `paper (3) final v2`, and that string is fed to the model as the paper's title in the TL;DR prompt (`llm_service.py:104`). |
| minor | `ObjectId()` without guard on the file/image endpoints | `papers/routes.py:335`, `routes.py:373` | `paper = await db.papers.find_one({"_id": ObjectId(paper_id), ...})` — no try/except, unlike lines 115 and 235 | A malformed id yields an unhandled `bson.errors.InvalidId` → 500 instead of 404. |

---

## What is worth keeping

- **`papers/extraction.py` — the whole block model.** `BoundingBox.from_rect` normalizing to page-relative 0–1 coords (`:34`), `SourceLocation(page, bbox, char_start, char_end)` (`:46`), stable `blk_<hex>` IDs (`:310`), the typed block hierarchy, figure caption detection (`:844`), and the TOC-to-block reconciliation in `_extract_toc`/`_find_heading_block` (`:893`, `:918`). This is the document-coordinate substrate the product needs, already written and already correct in shape. It has never run in production, so treat it as a well-informed draft, not tested code.
- **The `[Page N]` marker convention is worth keeping only as an *output* of a block store, never as the storage format.** Page-scoped generation is the right granularity; recovering pages by regex over a string is not.
- **`_estimate_cost` + the `MODELS` table** (`ai.py:281`, `:14`) — the right idea, currently disconnected from the models actually in use. The cost/usage capture belongs in one shared client that every call site goes through.
- **The `page_summaries` + `summary_status` shape** (`models.py:35`, `:60`) — incremental, per-page, resumable-in-principle. It needs a real status enum (`pending`/`running`/`failed`/`done`) and a job record instead of a bare `generated_pages` list.
- **The mode taxonomies** in `ASK_MODE_PROMPTS` (`explanations/services.py:11`) and `MODE_PROMPTS` (`ai.py:36`) — the prompt *content* is decent; the duplication is the problem.
- **`search_in_blocks`** (`extraction.py:969`) returns `block_id` + `source` with every hit — the only search in the repo that can point at a location.

Forward-looking: the redesign needs (a) one extraction into a `blocks` collection with page + bbox + stable id, (b) `extracted_text` demoted to a derived index rather than the source of truth, (c) generation moved to a durable job with per-page rows written as each completes, (d) every generated artifact carrying `source_block_ids` so AI prose can be visually and structurally separated from the paper, (e) one OpenRouter client with retry/backoff/usage capture.

## What should go

- `apps/api/papertree_api/papers/services.py` — **683 lines, zero importers**, and strictly worse than `extraction.py` (no geometry). Delete outright.
- `papers/routes.py:25-37` `extract_text_from_pdf` — the lossy string format and its regex counterpart `llm_service.py:113-135`.
- `services/ai.py` as a separate client — fold into one client; the mislabelled `MODELS` entry (`:27`) and the wrong default model (`:162`, `:227`, `:275`) must not survive the merge. `parallel_generate` (`:265`) is unused.
- `llm_service.py:411` `generate_highlight_explanation` — a fourth, unreferenced duplicate of `explanations/services.py:68`.
- `BookSection` / `BookContent.sections` (`models.py:44`, `:59`) — always `[]` from `llm_service.py:340`, but still read by `explanations/routes.py:84`, which therefore always finds nothing.
- `BookContent.key_figures` (`models.py:62`) — hardcoded `[]` at `llm_service.py:347`.
- The `token` query-string auth branch on `/file` and `/page/{n}/image` (`routes.py:320`, `:353`).
- The `book_id`/`paper_id` and `text`/`selected_text` dual-write compatibility layer (`highlights/routes.py:341-347`, `:369-387`) — it is already producing dead reads (`highlights/routes.py:164`).
- All bare `except:` and `except Exception: pass` sites (`routes.py:120`, `:240`; `extraction.py:673`, `:915`, `:949`; `services.py:188`).

## Open questions

1. Was `extraction.py` ever wired in and reverted, or never wired at all? Git history decides whether the block model is a foundation or a trap.
2. Is `db.books` a leftover from a pre-PaperTree product? `highlights/routes.py:164` and the whole `book_id` vocabulary suggest an earlier "books" app that was half-renamed. Whether data exists there changes the migration story.
3. Is `generate_all=true` reachable from the UI? `api.ts:121` exposes it; `read/page.tsx:143` calls `generateBook(paperId)` with defaults. If a user can trigger it, the 41-sequential-call request is an availability incident waiting to happen.
4. How often does `_parse_page_summary` fall to the raw-content branch (`llm_service.py:383`)? Given the prompt embeds `true/false` as a literal JSON value (`llm_service.py:83`), likely non-trivially — and currently unobservable, because nothing is logged or flagged.
5. `PageSummary.model` and `BookContent.model` are both stored (`models.py:32`, `:64`). With pages generated across sessions on different models, which does the UI trust, and should mixed-model content reach the reader at all?
6. Does any deployment run more than one Uvicorn worker? If so, `services/ai.py`'s singleton cache (`:127`) plus the absence of a job store means generation state is already inconsistent between workers.
