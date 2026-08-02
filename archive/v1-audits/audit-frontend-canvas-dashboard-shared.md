# Audit — Frontend: canvas, dashboard, shared layer

Scope: `apps/web/src/app/paper/[id]/canvas`, `components/canvas/**`, `hooks/useCanvas.ts`, `store/canvasStore.ts`, `app/dashboard`, `components/dashboard`, `lib/api.ts`, `lib/auth.ts`, `store/authStore.ts`, `types/**`, `app/globals.css`, `middleware.ts`, `components/ui/**`. Cross-referenced against `apps/api/papertree_api/{canvas,papers,highlights,explanations}` to check the client's assumptions.

---

## What this subsystem actually does

**The canvas is not a spatial research notebook. It is a server-generated tree of the PDF's pages, rendered in React Flow.**

Five node types are registered (`PaperCanvas.tsx:33-39`), but only four components exist and `paper` is aliased to the AI node renderer:

| type | component | renders |
|---|---|---|
| `paper` | `AIResponseNode` | paper title + `book_content.tldr`, styled as if it were an AI answer |
| `page_super` | `PageSuperNode` | LLM page summary markdown, "P{n}" badge |
| `exploration` | `ExplorationNode` | the highlighted sentence, in quotes |
| `ai_response` | `AIResponseNode` | model output as markdown + KaTeX + Mermaid |
| `note` | `NoteNode` | a textarea |

Node creation is overwhelmingly **automatic, not intentional**. On first open, the page fires `canvasApi.populate` (`canvas/page.tsx:48-70`) whenever the canvas has ≤1 node, and the server creates **one `page_super` node per PDF page** — `for page_num in range(page_count)` (`canvas/services.py:234`). A 34-page paper produces 35 nodes and 34 edges before the user has done anything. The "Sync Highlights" button (`canvas/page.tsx:197-208`) re-runs the same routine and re-runs `_tree_layout(nodes)` (`services.py:400`) over the whole board.

Edges are **decoration over `parent_id`**. `toReactFlowEdge` (`PaperCanvas.tsx:79-97`) maps `edge_type` to a stroke colour and a dash pattern and nothing else; no traversal, filtering or reasoning ever reads it. A user-drawn edge (`onConnect`, `PaperCanvas.tsx:195-198`) is written into React Flow local state only, then destroyed on the next store sync at line 193. Edges therefore mean "the server made this child" — a user cannot express a relation.

There is **no undo, no redo, no history, no multi-select, no keyboard shortcuts** (repo-wide grep for `undo|history` returns zero hits). Delete is `confirm()` followed by irreversible recursive destruction on client (`canvasStore.ts:82-101`) and server (`canvas/routes.py:254-294`).

The dashboard is a three-column card grid of papers with Read / Canvas / Delete buttons (`PaperList.tsx:30-76`). Upload is a modal with drag-drop that accepts only `application/pdf` (`UploadModal.tsx:20-24`). There is **no processing state anywhere** — no status field exists on the paper model, and `has_book_content` (declared at `types/index.ts:196`) is never rendered.

The shared layer is two API clients, two contradictory type systems for the same domain, a no-op middleware, and a client-side auth guard.

---

## Data flow

**Read:** `canvas/page.tsx` → TanStack Query `['paper', id]` + `['canvas', id]` → `canvasApi.get` (`fetchApi`, JWT from `localStorage`) → `GET /papers/{id}/canvas` → the whole canvas document (`elements.nodes[]`, `elements.edges[]`) as one blob. `initialNodes/initialEdges` memos → `PaperCanvas` → `useCanvasStore.setNodes/setEdges` → `toReactFlowNode` → React Flow's own `useNodesState`. So node state lives in **three places at once**: Zustand, React Flow, and per-node `useState` (`AIResponseNode.tsx:49`, `PageSuperNode.tsx:16`).

**Write:** every mutation (`toggleNodeCollapse`, `updateNodePosition`, `addNode`, note edits) sets `isDirty: true`; a 3-second timer (`PaperCanvas.tsx:260-264`) PUTs the **entire canvas** back. There is no diffing, no optimistic concurrency, no `updated_at` check — last writer wins the whole document.

**AI:** `ask` / `explore` are synchronous request/response. `create_exploration` (`services.py:521`) calls OpenRouter inline inside the HTTP handler, then persists the answer; the client blocks on `isAsking` with a spinner. No streaming, no job id, no resumability — closing the tab mid-generation loses the work with no trace.

**Failure handling:** `fetchApi` throws a bare `Error`; the canvas catches and shows `alert('AI query failed. Please try again.')` (`PaperCanvas.tsx:222`). Save failures are `console.error` only (`PaperCanvas.tsx:253`) — the "✓ Saved" badge still flips because `markSaved()` sits in the try block's success path but the user is never told a save failed.

---

## Findings

| Sev | Title | file:line | Evidence | Consequence |
|---|---|---|---|---|
| critical | Canvas auto-generates one node per page, unbidden | `canvas/services.py:234`, `canvas/page.tsx:53-56` | `for page_num in range(page_count):` … creates `page-{paper_id}-{n}`; client: `if (nodeCount <= 1 && paper?.page_count > 0) { setIsPopulating(true); canvasApi.populate(paperId)` | Opening a 40-page paper yields 41 nodes the user never asked for. The canvas is a machine-made page index, so it can never accumulate *personal* meaning — the core promise of the product. |
| critical | "Go to source" is a dead deep link | `canvas/page.tsx:115-123` vs `paper/[id]/read/page.tsx:5` | canvas pushes `` `/paper/${paperId}/read?highlight=${data.highlight_id}` ``; reader imports only `useParams, useRouter` and never reads a query string (no `useSearchParams`, no `URLSearchParams` parse anywhere in the file) | Every "Reader" / external-link button on every node dumps the user at the top of the document. Round-trip provenance is advertised in the UI and does not exist. |
| critical | Provenance is one integer; all geometry is discarded | `canvas/services.py:562-573`; `types/canvas.ts:38-65` | node data carries only `"source_page": page_number, "source_highlight_id": highlight_id`; `CanvasNodeData` has no bbox/rect/anchor/block-id field at all — even though `Highlight` already carries `rects` and `anchor` (`types/index.ts:413-414`) | A node can never point at its exact region, can never be re-anchored after re-extraction, and can never drive a highlight overlay. Blocks the "Goodnotes" model outright. |
| critical | Auto-save ⇄ invalidate loop rewrites the canvas forever | `canvasStore.ts:43-44`, `PaperCanvas.tsx:133-136,260-264`, `canvas/page.tsx:105-109` | `setNodes: (nodes) => set({ nodes, isDirty: true })`; init effect `setStoreNodes(initialNodes)` → dirty → `setTimeout(handleSave, 3000)` → `onSave` → mutation `onSuccess: invalidateQueries(['canvas'])` → new `canvas` object → new `initialNodes` memo → effect re-runs | Merely *looking* at a canvas issues two full-document PUTs every ~3 s indefinitely, and each refetch can overwrite an in-flight local edit (typed note text, dragged position) with the server copy. |
| critical | Failed AI generations are persisted as answers | `canvas/services.py:726-728,754` | `except Exception as e: answer = f"**Error generating response:** {str(e)}\n\nPlease try again."` then written into the node with `"status": "complete"` | An error string is stored permanently, renders as authored markdown in `AIResponseNode`, is indistinguishable from a real answer, and is fed back as context to later follow-ups via `_build_conversation_history`. |
| major | AI content and source content share one undifferentiated field | `canvas/services.py:565,613`; `AIResponseNode.tsx:192-218` | both exploration and AI nodes use `"content": <string>` + `content_type: markdown/plain`; the only distinction is a pill badge and node colour | Once collapsed, exported, or copied, model output is not separable from the paper's own words. No provenance flag, no model/version on most nodes, no "generated" marker in the data. |
| major | Server layout destroys every manual arrangement | `PaperCanvas.tsx:267-281`; `canvas/routes.py:193-198`; `services.py:400` | `handleLayout` → `POST .../canvas/layout` → `for i, n in enumerate(nodes): n["position"] = {...}`; `populate_canvas` also calls `_tree_layout(nodes)` on every Sync | Pressing "Sync Highlights" — advertised as importing new highlights — silently re-lays-out the entire board. Spatial memory, the only reason to use a canvas, is not durable. |
| major | Single click on any node mutates and persists state | `PaperCanvas.tsx:307-310` | `onNodeClick={(_, node) => { toggleNodeCollapse(node.id); }}` | A reading gesture is a write. Combined with no undo, casual exploration permanently reshapes the document. |
| major | Phantom edge ids returned by `/explore` | `canvas/services.py:581-586` vs `655-658` | the persisted page→exploration edge is `{"id": f"edge-{_uid()}", ...}` at 582; the response fabricates a **second, different** `_uid()` for the same logical edge at 656 | Client store holds edge ids that do not exist server-side; if autosave fires before the refetch, a duplicate edge is written back permanently. |
| major | Every node action is hover-only — canvas is unusable on touch | `PageSuperNode.tsx:100`, `ExplorationNode.tsx:61`, `AIResponseNode.tsx:136`, `NoteNode.tsx:78` | `{hovered && ( … Ask AI / Note / Reader / Delete … )}`; repo-wide grep for `onTouch|pointerdown|panOnDrag` returns zero | On iPad — the device the product concept implies — Ask AI, Add Note, Delete and Go-to-source are all unreachable. |
| major | Two contradictory canvas type systems | `types/index.ts:273-346` vs `types/canvas.ts:6-82` | index: `CanvasNodeType = "paper"\|"excerpt"\|"question"\|"answer"\|"followup"\|"note"\|"diagram"`; canvas.ts: `"paper"\|"page_super"\|"exploration"\|"ai_response"\|"note"\|"diagram"` | `RichCanvasNode.tsx:16` imports from `@/types` and renders `data.excerpt` / `data.source` — fields the backend never emits, so ~120 lines of its render tree are unreachable. |
| major | `canvasApi.batchExport` does not exist | `paper/[id]/read/page.tsx:296` vs `lib/api.ts:285-383` | `const result = await canvasApi.batchExport(paperId, {...})` — no such key on the exported object | The reader's "Export to Canvas" always throws `TypeError`, caught at :307, showing "Failed to export to canvas." A shipped, permanently broken feature. |
| major | `hooks/useCanvas.ts` is dead and references ~10 non-existent methods | `hooks/useCanvas.ts:102`, `:14-31` | `const { setAIQueryInProgress } = useCanvasStore();` — no such action exists (`canvasStore.ts:18-32`); calls `canvasApi.getBookCanvases/getCanvas/getCanvasNodes/createNode/runAIQuery/createBranch/createFromHighlight/generateAutoSummary`, none of which are defined | 168 lines of plausible-looking API that would throw on first call. Nothing imports it. |
| major | JWT in `localStorage` **and** in URL query strings | `lib/api.ts:29-30,49-50,99-100,108-118`; `lib/auth.ts:6-9` | `localStorage.getItem("token")`; `getFileUrl: (paperId) => \`${API_URL}/papers/${paperId}/file?token=${getToken()}\`` | Any XSS (and the app injects model-generated HTML — see below) exfiltrates the session. Tokens additionally leak into server access logs, browser history and `Referer`. Not XSS-safe. |
| major | Two API clients with divergent auth and error behaviour | `lib/api.ts:25-47` vs `52-72` | `fetchApi` (all canvas + explanation calls) does no 401 handling and no retry; the axios instance hard-redirects `window.location.href = "/login"` on 401 | An expired token on the canvas produces `alert('AI query failed')` instead of re-auth; on the dashboard it bounces to login. Same app, two failure models. No retry/backoff anywhere. |
| moderate | Silent exception swallowing + debug prints in the AI path | `canvas/services.py:709-710,688,878` | `except Exception:\n        pass  # Non-fatal`; `print('test',parent_data)`; `print('hereqqq')` | When paper-context lookup fails the answer is silently ungrounded and nothing records it. Debug prints ship in the request path. |
| moderate | Upload blocks the request; no processing feedback | `papers/routes.py:54-59`; `PaperList.tsx:32-46` | `content = await file.read()` then synchronous `extract_text_from_pdf(file_path)` in the handler; the card shows only title, date, page count | Large PDFs stall the event loop for all users. A freshly uploaded paper looks identical to a fully processed one; `book_content` is generated by a *separate* endpoint the dashboard never calls. |
| moderate | Model-generated SVG injected with `dangerouslySetInnerHTML` under `securityLevel: 'loose'` | `MermaidRenderer.tsx:38,122` | `securityLevel: 'loose'` … `dangerouslySetInnerHTML={{ __html: svg }}` | LLM output becomes live DOM. Combined with the `localStorage` token this is a complete token-theft chain. |
| moderate | Middleware is a no-op that runs on every route | `middleware.ts:7-17,20` | matcher `"/((?!api|_next/static|_next/image|favicon.ico).*)"` yet the body only ever `return NextResponse.next();` | Zero protection with full cost. Every guarded page ships to anonymous clients and redirects on the client (`AuthGuard.tsx:19-23`), producing a spinner→flash→redirect on each cold load. |
| moderate | Ask-box mixes flow coordinates with viewport coordinates | `PaperCanvas.tsx:66-72` vs `:232-235`, `InlineAskInput.tsx:47-50` | button path passes `node.position.x + 200` (document space); right-click path passes `event.clientX` (viewport space); the component uses both as `position: fixed; top/left` | After any pan or zoom, "Ask AI" opens the input in an unrelated corner of the screen. |
| minor | Expansion state cannot survive a reload | `AIResponseNode.tsx:49`, `PageSuperNode.tsx:16` | `const [expanded, setExpanded] = useState(false);` — local component state, never persisted | Every "Show full response" is lost on refresh and on any store update that remounts nodes. |
| minor | Content truncated mid-token at render time | `AIResponseNode.tsx:217`, `PageSuperNode.tsx:80` | `{expanded ? cleanedContent : cleanedContent.slice(0, 1800)}`; `data.page_summary.slice(0, 1200)` | A LaTeX block or fenced code straddling the cut renders as broken markup until the user expands. |

### Design tokens (de facto) — is there a system?

`globals.css` defines exactly **three** custom properties (`--foreground-rgb`, `--background-rgb` at `:root`/`.dark`/`.sepia`, lines 8-21) and then 600 lines of component CSS. `tailwind.config.ts` extends only a `sepia` colour ramp. Everything else is ad-hoc Tailwind palette picking:

- **Colour**: chrome `gray-50/100/200/700/800/900/950`; accents assigned per component with no shared meaning — `blue-500/600` (primary buttons *and* AI nodes), `indigo-300/500` (page nodes, Sync button), `amber/orange` (explorations), `yellow-300/900` (notes), `green` (saved), `red-500` (delete), plus six ask-mode badge colours (`AIResponseNode.tsx:27-34`). Highlight category colours are declared **three times** with conflicting values (`types/index.ts:394-402`, `types/highlight.ts:9-16`, `highlights/models.py:37-44` and again `:59-67`).
- **Type scale**: dashboard uses `text-sm/base/lg/xl/2xl`; canvas nodes use a separate arbitrary micro-scale — `text-[10px]`, `[11px]`, `[12px]`, `[13px]` — plus `.canvas-prose { font-size: 13px; line-height: 1.75 }` (`globals.css:447-452`). Two unrelated scales.
- **Spacing**: `px-3 py-2` / `px-4 py-2.5` alternate arbitrarily; node widths are hard-coded literals (200, 240, 280, 300, 320, 380, 420, 560, 640).
- **Radii**: `rounded-lg` (8) for controls, `rounded-xl` (12) for cards and nodes, `rounded-full` for badges — while `globals.css:410-413` forces `.react-flow__node { border-radius: 8px }`, contradicting the nodes' own `rounded-xl`.
- **Type family**: Inter via `next/font` (`layout.tsx:6`), overridden per-class in CSS (Georgia / Inter / JetBrains Mono, `:189-199`) and hard-coded again in `MermaidRenderer.tsx:39`.

**Verdict: there is no design system.** There is one genuinely good thing — a *reading* typography layer (`.book-content`, `.canvas-prose`, KaTeX sizing, theme-aware highlight pulses) that shows real craft. Everything else is per-component improvisation.

---

## What is worth keeping

1. **`.canvas-prose` / `.book-content` typography and the KaTeX + Mermaid render pipeline** (`globals.css:178-231, 446-602`, `AIResponseNode.tsx:192-218`). The markdown→math→diagram path, the mermaid-fence extraction (`AIResponseNode.tsx:36-45`) and the raw-code fallback in `MermaidRenderer` are the most mature code in the subsystem.
2. **The ask-mode taxonomy** (`explain_simply / explain_math / derive_steps / intuition / pseudocode / diagram`) — consistently defined in TS and Python and genuinely product-shaped. `InlineAskInput.tsx:11-18` is a good interaction primitive.
3. **`NoteNode`'s editing ergonomics** — auto-edit on empty, auto-resize, Ctrl+Enter/Esc/blur-to-save, `onMouseDown` stopPropagation to defeat drag capture (`NoteNode.tsx:14-54,152`). The only touch-adjacent thoughtfulness in the file set.
4. **`components/ui/{Button,Card,Modal,Input}`** — small, dependency-light, `cn()`-based. Not premium, but a clean base to re-skin rather than rewrite.
5. **`types/canvas.ts`** — the one type file that actually matches the Python models. Should become the single source of truth.
6. **`UploadModal`'s drag-drop shell** and the dashboard's Query wiring (`dashboard/page.tsx:18-35`) — correct invalidate patterns, cheap to keep.

## What should go

- `hooks/useCanvas.ts` — dead, references a non-existent API surface and a non-existent store action.
- `components/canvas/RichCanvasNode.tsx` — dead; built against the abandoned `@/types` canvas model.
- `components/canvas/CanvasToolbar.tsx` — dead; its four "templates" (`summary_tree`, `question_branch`, `critique_map`, `concept_map`) have no backend at all.
- `components/Mermaid.tsx` — duplicate of `MermaidRenderer` with module-scope `mermaid.initialize`, no timeout, no fallback.
- `hooks/useHighlights.ts` + `store/highlightStore.ts` — mutually referential, imported by nothing.
- The canvas half of `types/index.ts` (lines 272-359) and its duplicate `Highlight`/`HighlightCategory`/`ContentType`/`AskMode` declarations; the `ContentBlock`/`StructuredContent` tower (lines 65-159) has **no** server counterpart — `PaperDetailResponse` (`papers/models.py:89-92`) exposes only `extracted_text`, `book_content`, `smart_outline`.
- `middleware.ts` as written — either enforce or delete.
- The `populate` → `_tree_layout` auto-generation path, and the `explore` response's fabricated `new_edges`.
- The `fetchApi` client (fold into one client with real 401/retry/error typing) and `getFileUrl`'s `?token=` pattern.
- Python `ExploreResponse` (`canvas/models.py:135-139`) — declares `edges`, the route actually returns `new_edges` + `canvas_id`; the model is unused and lies about the contract.

## Open questions

1. **Is the canvas meant to be authored or derived?** Everything today is derived (pages, highlights, explanations auto-imported). A "spatial research notebook" requires user-placed objects as the primary citizens and derived content as guests. Which way does the redesign go?
2. **What is the durable anchor?** Highlights already carry `rects` + `anchor` (prefix/exact/suffix/section_path); canvas nodes carry a page integer. Is the anchor going to be geometric (bbox on a page), textual (quote anchor), or block-id based? Nothing downstream can work until this is decided.
3. **Page indexing** is inconsistent: `populate_canvas` converts 1-indexed to 0-indexed (`services.py:304-310`) while `/explore` trusts the caller; UI displays `page_number + 1` in two places. Which convention wins?
4. **Does the product still want two highlight APIs?** `book_id`-based (`/highlights/`, `/highlights/book/{id}`) and `paper_id`-based (`/highlights/papers/{id}`) both exist and are both exposed in `lib/api.ts:192-281`.
5. **Long AI generation**: sync request/response caps usable answer length and loses work on tab close. Is streaming or a job model in scope?
6. **Touch/iPad**: is it a target? If yes, essentially every interaction in `components/canvas` needs re-specification, not adjustment.
