# The end-to-end UX walk — #77

**Walked 2026-08-04 in Chrome 1470×867 on macOS (OS appearance: Dark), against a live stack:
`services/api` on :8000, `papertree_api.worker`, `next dev` on :3000, and a real MiniMax-M3 key.**
Every observation below is what happened, not what should have.

---

## 0. The measurement discipline, first, because it invalidated four observations

`AGENTS.md` §4: the reader renders nothing in a backgrounded tab — `visibilityState === 'hidden'`
starves `requestAnimationFrame`, pdf.js's `RenderTask.promise` never settles, and you get **0 spans,
no error, canvas apparently painted**.

**This is not theoretical and it is not only a CI hazard. It bit this walk repeatedly.** The browser
tab was `hidden` for the first four observations of this session — the tab existed and even reported
`document.hasFocus() === true`, but it was not the *active* tab in its window, so it never became
`visible`. An early reading of the reader recorded `0 canvases, 0 textLayerSpans` and **that
observation was void**, not a finding.

Two things follow, and both are recorded here because the next person to automate this will hit them:

1. **`hasFocus()` is not the guard. `document.visibilityState === 'visible'` is.** A tab can have
   focus and still be hidden.
2. Foregrounding needed an explicit AppleScript step (`set active tab index of w to ti` +
   `set index of w to 1`); neither navigating nor screenshotting the tab was sufficient.

**Every reader observation below was taken with `visibilityState === 'visible'` asserted in the same
evaluation, and with a non-zero text-layer span count.** The healthy baseline for
`resnet-cvpr-2col` at 100 %:

```
visibility          visible
canvases                  5
.papertree-text-layer   944 spans
[data-page-index]         8
[data-block-id]         773
```

### One blank reader that was NOT a defect

The reader first rendered completely blank with `/fixtures/resnet-cvpr-2col.pdf` → **404**. That was
**my worktree, not the product**: `apps/web/scripts/copy-fixtures.mjs` stages PDFs from
`research/benchmarks/corpus/`, which is gitignored and absent from a fresh worktree, so `predev`
copied the IR and the assets and skipped the PDFs. Symlinking the corpus and re-running the script
(`3 IR documents, 29 assets, 3/3 PDFs`) produced the healthy baseline above. Recorded because it
looks exactly like a product defect and is not one.

---

## 1. The seven journeys

| # | journey | outcome |
|---|---|---|
| 1 | Register → land | **BROKEN — D1, D2.** Account is created; the user is bounced to `/login` and can never get in |
| 2 | Upload → watch it parse | **BROKEN — D3, D4.** The dashboard's upload posts to a route that does not exist; a parsed paper never updates its card |
| 3 | Source / Guided / Split | **PARTIAL — D5.** All three modes render; the mode switch throws away the reading position |
| 4 | Highlight → reload | **NOT REACHED.** Blocked behind D1/D2 in a clean session; not walked, and not claimed |
| 5 | Ask → answer → citation | **WORKS, but explains the wrong text — D6.** A real model answered and the citation navigation is correct |
| 6 | Zoom 50→400 %, resize | **WORKS.** Exact scaling at every step |
| 7 | Designed system states | **PARTIAL — D7.** Reachable, but one is reached for the wrong reason |

---

## 2. Defects

### D1 — a registered user can never sign in (CRITICAL)

`authStore.ts:23` and `:30` read **`response.access_token`**. `services/api` returns **`token`**
(`app.py:206`, `Session` model). So `setToken(undefined)`.

Measured, in the browser, with real typing:

```
POST /auth/register  ->  201 Created      the account IS created
GET  /auth/me        ->  401 Unauthorized
                     ->  bounced to /login

POST /auth/login     ->  200 OK           the credentials ARE correct
GET  /auth/me        ->  401 Unauthorized
                     ->  bounced to /login
```

The account exists in `users` afterwards (`usr_01KZ65KBMR6CMA77813J1BREZJ | uxwalk@papertree.test`).
**No error is shown.** The user clicks, the screen returns to login, and nothing says why.

### D2 — the two halves of the app use different localStorage keys (CRITICAL)

Independent of D1, and it would break the reader even if D1 were fixed:

```
apps/web/src/lib/auth.ts:3       localStorage key "token"              <- what authStore writes
apps/web/src/lib/papertree.ts:21 localStorage key "papertree.session"  <- what the reader reads
```

Measured: with a valid token under `"token"`, `/auth/me` returned **200** while the reader rendered
**"This paper could not be loaded — {"detail":"missing or invalid session token"}"**. Copying the
same string to `"papertree.session"` loaded the paper (773 blocks). Two independent breaks, both on
the only path into the product.

*(That error state also renders a raw JSON body to the user. A reader is not owed
`{"detail": …}`.)*

### D3 — the dashboard talks to the v2 service through the v1 client (CRITICAL)

`dashboard/page.tsx:52` imports `papersApi` from `@/lib/api` — the **v1** client, whose own header
says it talks to `apps/api` ("MongoDB, its own JWT, its own PDF extractor"). `apps/api` is archived,
and `NEXT_PUBLIC_API_URL` defaults to `localhost:8000`, which is now **v2**. So the v1 client is
pointed at the v2 service. Measured:

| v1 client sends | v2 serves | result |
|---|---|---|
| `POST /papers/upload` | `POST /papers` | **405 Method Not Allowed** — measured |
| reads `{access_token}` | sends `{token}` | D1 |
| `GET /auth/me` → `{id,…}` | sends `{user_id,…}` | `id` undefined |

**The dropzone on the library page cannot ever work.** `lib/api.ts` and `lib/papertree.ts` both
export a symbol named `papersApi`, so which one a file gets is invisible at the call site.

### D4 — a fully parsed paper still shows as unparsed, with a critical a11y consequence (HIGH)

Uploaded `resnet-cvpr-2col.pdf` via the API; the worker logged
`job … -> succeeded` and `promoted ppr_7R9RKPFP4FSVAV1TV622F4Z575 generation 1`. The library card
rendered:

> *(no title)* · **Authors not identified** · **0 pages** · **Queued** · "Source mode ready"

`GET /papers` returns **no `title`, `authors`, `page_count` or `processing` field at all**, and
returns `metadata` as a **JSON string** rather than an object. The real title is in there —
`metadata` parses to `{"title":{"value":"Deep Residual Learning for Image Recognition",…}}` — and
nothing parses it.

**This is also a critical accessibility violation**, and axe found it independently: the card's
button has no accessible name, because its name comes from the title that never arrived.

```
button-name   impact: critical   #paper-title-undefined
"Element does not have inner text that is visible to screen readers"
```

The element id is literally `paper-title-undefined`.

### D5 — switching modes throws away the reading position (MEDIUM)

#77 asks directly: "does the mode switch preserve position?" **No.**

```
Source, scrolled       scrollTop 2400, top block blk_iityvkeqsv76g5ry
click Guided           scrollTop    0, top block blk_7vfkrcyfxjnxyfkb
                                       = the FIRST block in Guided's list
```

A reader eight pages into a paper who switches to Guided is returned to the title.

**Filed rather than fixed** — mapping a position across two different renderings of the same
document is a design question (nearest block? nearest section? the anchor under the caret?) and
`IA-wireframes-and-design-brief.md` does not answer it. #77: *"If a fix needs a design decision the
brief does not answer, file it, do not invent it."*

### D6 — "Explain this selection" does not read the selection (CRITICAL)

The marquee journey. `ReaderWorkspace.tsx:413`:

```tsx
context={{ kind: 'selection', blockIds: [doc.blocks[0]?.id ?? ''], quote: title }}
```

The Inspector's context is a **hardcoded literal pointing at the document's first block**. It is
never connected to what the user selected.

Measured twice, with real drag-selections in the pdf.js text layer:

| selected | answer was about |
|---|---|
| abstract, 182 chars: *"…ensemble of these residual nets achieves 3.57 % error…"* | the title, two authors, the affiliation and the email line |
| introduction: *"…level features [50] and classifiers in an end-to-end multi-layer fashion…"* | *(unchanged — see D7)* |

The five cited blocks are `doc.blocks[0]` plus what `generate_explanation`'s structure-aware
expansion pulled in around it. The pipeline is working perfectly on the wrong input.

This is exactly the class #77 was opened for: **every component works, every test passes, and the
journey is incoherent.** The comment above this call site discusses `answerSource`, `paperId` and
`onNavigate` at length; nobody noticed `context` was a placeholder.

**Why no test caught it:** `ask-wiring.spec.tsx` constructs the context itself and asserts the
Inspector does the right thing with it. It cannot see that the real mount site passes a constant.

### D7 — one ask per page load (MEDIUM)

Once an answer renders, `[data-inspector-ask]` is **gone** — the button is replaced by the answer.
There is no "ask again" or "clear". A second question requires a page reload. Measured: the second
`.click()` was a no-op and no second `/ask` request was made.

### D8 — form controls are unreadable on a dark-mode OS (SERIOUS)

On the login and register screens, with the OS in Dark:

```
color-contrast   impact: serious   1.87:1   #000000 on #3b3b3b
                 input[type="email"], input[type="password"]
```

Confirmed twice — by hand from `getComputedStyle`, and independently by axe in the real browser.
WCAG AA requires 4.5:1. **1.87:1 is barely legible**; the screenshot in this PR shows it.

**Root cause, and it is a whole theme layer mounted by nothing:**

| | |
|---|---|
| `packages/ui/src/styles.css:63` | declares `color-scheme: light dark` |
| `packages/ui/src/styles.css:72` | ships a **real** dark theme via `@media (prefers-color-scheme: dark)` for every `--pt-*` token |
| `apps/web/tailwind.config.ts:9` | `darkMode: "class"` |
| everywhere | **nothing ever adds a `.dark` class** — `document.documentElement.className` is `""` and there is no `classList` call in `apps/web/src` |

So on a dark OS the *token* layer goes dark, every Tailwind `dark:` utility in `apps/web` stays
light — `dark:bg-gray-800 dark:text-white` on `Input.tsx` is **dead code** — and Chrome, told by
`color-scheme` that dark is permitted, paints its own dark UA background into a control whose text
colour is still black.

The comment at `styles.css:66-71` claims three dark mechanisms are "in play", naming Tailwind's
class strategy as one. It is inert.

---

## 3. The a11y and touch re-measurement #77 asked for

**#77's premise is false and the measurement is what corrects it.** #77 says Epic 2 measured
0 violations *"with `color-contrast` and `target-size` both actually running (#42)"*.

```
apps/web/test/a11y.spec.tsx:48-50   'color-contrast':          { enabled: false }
                                    'color-contrast-enhanced': { enabled: false }
                                    'target-size':             { enabled: false }
apps/web/test/a11y.spec.tsx:122-123 expect(evaluated.has('color-contrast')).toBe(false)
                                    expect(evaluated.has('target-size')).toBe(false)
```

The suite **asserts those rules did not run** — happy-dom does not lay out, so they cannot. And
`touch.spec` reads Tailwind class *declarations*, not pixels, and says so in its own header.

So this is **not a re-run. It is the first time these rules have ever been evaluated on this
product.** axe-core 4.12.1, in Chrome, foregrounded, over live API data:

| surface | violations | notes |
|---|---|---|
| **reader** (`/paper/{api-id}/read`) | **0** — 26 rule groups passed | `color-contrast` and `target-size` both confirmed evaluated |
| **login** | **1** — `color-contrast`, serious | D8 |
| **dashboard** | **1** — `button-name`, critical | D4 |

**Epic 2's "0 violations" claim survives contact with a real browser on the surface it was made
about.** The reader is genuinely clean, including the two rules that had never run. The two
violations are both on surfaces built before Epic 2's component library, and both trace to defects
already listed above rather than to the design system.

**`touch.spec`'s "75 interactive elements, 0 under 44×44" does not survive**, on the same surfaces:
measured in real pixels, the login submit button is **399×36** and the "Sign up" link is **50×17**.
Both are under 44. (`target-size` at WCAG 2.2 AA requires 24×24, which they pass — the failure is
against the repo's own stated 44×44 bar, not against AA. Recorded precisely rather than as a
violation it is not.)

---

## 4. What was fixed here, and what was filed

| | |
|---|---|
| **Fixed with a regression test** | D1, D2, D3, D4, D6, D8 |
| **Filed, needs a design decision** | D5 → **#132**; D7 and the missing `page_count` → **#133** |
| **Corrected in the issue itself** | #77's `color-contrast`/`target-size` premise, [as a comment with the file:line evidence](https://github.com/Legend101Zz/PaperTree/issues/77#issuecomment-5178173471) |

Journey 4 (highlight → reload) is **not claimed**: it was blocked behind D1/D2 for a clean session
and was not walked. It is listed as unwalked rather than assumed working.

### Verification after the fix, split by how it was verified

Every defect above was **found** in a foregrounded browser. Not every fix was **re-verified** there,
and the difference is recorded rather than blurred.

| defect | re-verified in the live browser | how |
|---|---|---|
| D1 | **yes** | registered a new account through the form; landed on `/dashboard` signed in, no bounce |
| D2 | **yes** | same session then loaded an API paper — 773 blocks, no `missing or invalid session token` |
| D3 | **yes** | `POST /papers` → **202 Accepted** with the session the app now stores |
| D4 | **yes** | the uploaded card renders **"Attention Is All You Need · Ashish Vaswani, Noam Shazeer, Niki Parmar +4 more · Ready"** (screenshot in the PR). `0 pages` remains — see below |
| D8 | **yes** | login inputs now `#ffffff` on `#111827` = **17.74:1**, up from 1.87:1 |
| — | **yes** | axe re-run: **dashboard 0 violations** (was 1 critical `button-name`), **login 0 violations** (was 1 serious `color-contrast`) |
| **D6** | **NO — unit-verified only** | see below |

**D6's fix was not re-walked in the browser.** The Chrome session became unavailable partway through
verification, and rather than keep seizing a browser that may have had someone else using it, the
re-walk was stopped. What backs D6 instead is a mutation-tested assertion on the mount site itself
(`journey-wiring.spec.tsx`): restoring the hardcoded
`blockIds: [doc.blocks[0]?.id ?? '']` turns that test red. That is strong evidence the wiring is
right and it is **not** the same thing as having watched the Inspector answer about a selection, so
it is not claimed as such.

`0 pages` on the card is **not** a regression and not an oversight: `GET /papers` returns no page
count in any form, and `libraryPaperFromPaperRow` leaves it at 0 rather than deriving one from
`sections`, which would be a guess rendered as a fact. Filed, not invented.
