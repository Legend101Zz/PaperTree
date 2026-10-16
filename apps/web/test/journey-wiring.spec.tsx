/**
 * The #77 regression suite: one test per defect the UX walk found, each starting where the USER
 * starts rather than where the component starts.
 *
 * WHY THESE TESTS LOOK DIFFERENT FROM THE REST OF THIS DIRECTORY. Every other spec here imports the
 * component it is testing and hands it well-formed props. That is why an entire epic of green tests
 * sat on top of a product where a registered user could not sign in, the upload button posted to a
 * route that does not exist, and "Explain this selection" explained the title of the paper. #77
 * names the cause: *"every acceptance test imports the component it tests."*
 *
 * So each test below asserts a JOINT — the place where two modules agree about a name — rather than
 * a behaviour inside one of them:
 *
 *   D1  the field name in the auth response          `token`, not `access_token`
 *   D2  the localStorage key                          one key, not two
 *   D3  which client the library page imports          v2, not the archived v1
 *   D4  the row shape `GET /papers` really returns     `metadata` is a JSON string
 *   D6  what the Inspector is asked about              the selection, not `blocks[0]`
 *
 * A joint is exactly what a unit test cannot see, because each side is internally consistent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { libraryPaperFromWire } from '@/components/library/types';
import type { LibraryPaper as WirePaper } from '@/lib/api/types';

/** The real body of `POST /auth/login`, copied from a live response during the walk. */
const REAL_SESSION = {
  token: 'folzXLSCQf8-B6Eemj8wBSC-SzHmN0rHM8PB-kcNf1U',
  user_id: 'usr_01KZ65KBMR6CMA77813J1BREZJ',
  email: 'uxwalk@papertree.test',
} as const;

/** One `GET /papers` row in the S1 shape (contracts.md §2.2). */
const REAL_ROW: WirePaper = {
  paper_id: 'ppr_7R9RKPFP4FSVAV1TV622F4Z575',
  title: 'Deep Residual Learning for Image Recognition',
  authors: ['Kaiming He', 'Xiangyu Zhang'],
  original_filename: 'resnet.pdf',
  source_hash: 'sha256:00',
  page_count: 9,
  processing: 'ready',
  job: null,
  generation: 1,
  parser_version: '1.0.0',
  highlight_count: 0,
  created_at: '2026-08-04T10:40:57.083752+00:00',
  updated_at: '2026-08-04T10:41:57.083752+00:00',
  reading: null,
  year: null,
  arxiv_id: null,
  arxiv_category: null,
  thread_count: 0,
  has_summary: false,
};

describe('D1/D2 — the session survives sign-in', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it('stores the token under the field name the service actually sends', async () => {
    // WATCHED FAILING against `session.access_token`: `setToken(undefined)` ran, the store held
    // `"undefined"`, and every later request was `Bearer undefined` -> 401. In the browser that
    // presented as "register succeeds (201), then you are bounced back to /login with no error".
    const papers = await import('@/lib/api/papers');
    vi.spyOn(papers.authApi, 'login').mockResolvedValue({ ...REAL_SESSION });

    const { useAuthStore } = await import('@/store/authStore');
    await useAuthStore.getState().login('uxwalk@papertree.test', 'pw');

    const { getToken } = await import('@/lib/auth');
    expect(getToken()).toBe(REAL_SESSION.token);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.email).toBe(REAL_SESSION.email);
  });

  it('writes the token where the READER looks for it, which is the same place', async () => {
    // D2. Two modules, one session. `lib/auth` wrote "token"; the v2 client read
    // "papertree.session". Both were internally correct, so both suites were green while a valid
    // session produced `missing or invalid session token` in the reader. Asserted through the two
    // PUBLIC accessors rather than against a literal key, so the test still holds if the key is
    // renamed — what it forbids is the two disagreeing.
    const { setToken } = await import('@/lib/auth');
    const { getSessionToken } = await import('@/lib/api/client');

    setToken(REAL_SESSION.token);

    expect(getSessionToken()).toBe(REAL_SESSION.token);
  });

  it('clearing the session clears it for the reader too', async () => {
    const { setToken, removeToken } = await import('@/lib/auth');
    const { getSessionToken } = await import('@/lib/api/client');

    setToken(REAL_SESSION.token);
    removeToken();

    expect(getSessionToken()).toBeNull();
  });
});

describe('D3 — the library page talks to the service that is actually running', () => {
  it('imports `papersApi` from the v2 client, not from the archived v1 one', async () => {
    // Asserted on the MODULE IDENTITY rather than on a call, because the defect was an import line.
    // `lib/api.ts` (v1) and the v2 client both exported a symbol called `papersApi`, so which one a
    // file got was invisible at every call site — and the v1 one posts `/papers/upload`, which the
    // v2 service answers **405 Method Not Allowed** (measured in the browser).
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/library/LibraryView.tsx'),
      'utf8',
    );

    expect(source).toContain("import { papersApi } from '@/lib/api/papers'");
    // The v1 client is not merely unimported, it is GONE (S0, slice-plan §R R1), so no file can
    // pick up its `papersApi` by accident again. `@/lib/api` now names the v2 DIRECTORY, whose
    // modules are imported by their own paths — a string check on `from '@/lib/api'` would no
    // longer distinguish the two, and the file's absence does.
    expect(existsSync(resolve(process.cwd(), 'src/lib/api.ts'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/lib/papertree.ts'))).toBe(false);
    expect(source).not.toContain("from '@/lib/papertree'");
  });
});

describe('D4 — a parsed paper reads as parsed', () => {
  it('takes the title, authors, page count and id from the S1 row', () => {
    const paper = libraryPaperFromWire(REAL_ROW);

    expect(paper.title).toBe('Deep Residual Learning for Image Recognition');
    expect(paper.authors).toEqual(['Kaiming He', 'Xiangyu Zhang']);
    expect(paper.id).toBe(REAL_ROW.paper_id);
    expect(paper.pageCount).toBe(9);
  });

  it('maps every `processing` value, and ready is not queued', () => {
    // The pre-S1 bridge defaulted to pending, so a promoted paper still said "Queued" (#141).
    expect(libraryPaperFromWire(REAL_ROW).processing).toBe('complete');
    expect(libraryPaperFromWire({ ...REAL_ROW, processing: 'partial' }).processing).toBe('partial');
    expect(libraryPaperFromWire({ ...REAL_ROW, processing: 'queued' }).processing).toBe('pending');
    expect(libraryPaperFromWire({ ...REAL_ROW, processing: 'reading' }).processing).toBe('parsing');
    expect(libraryPaperFromWire({ ...REAL_ROW, processing: 'failed' }).processing).toBe('failed');
  });

  it('never renders an untitled card, because an untitled card has no accessible name', () => {
    const untitled = libraryPaperFromWire({ ...REAL_ROW, title: '  ', original_filename: null });

    expect(untitled.title.length).toBeGreaterThan(0);
    expect(untitled.title).not.toBe(REAL_ROW.paper_id);
  });
});

describe('D6 — the explain panel is asked about the selection', () => {
  it('the reader shell holds the live selection, and the Inspector is gone', async () => {
    // THE DEFECT WAS ONE LINE and no behavioural test could reach it: the old Inspector was handed
    // `blocks[0]` whatever was selected. S6 replaced it with the explain panel, which is asked
    // about the Anchor the selection toolbar captured (`openExplain({anchor, quote})`), so the
    // mount site no longer computes a context at all. What stays pinned: the shell receives the
    // selection from the pane, and nothing of the old Inspector is mounted.
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/paper/[id]/read/ReaderWorkspace.tsx'),
      'utf8',
    );

    expect(source).not.toContain('components/inspector');
    expect(source).not.toContain('inspectorContext');
    expect(source).toContain('onSelectionChange={setSelection}');
  });

  it('SourcePane requires the selection callback, so a shell cannot silently drop it', async () => {
    // Required, not optional — the same argument `onViewportResize` records after being optional
    // for one commit and silently never supplied. An optional prop here reproduces D6 exactly.
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/reader/SourcePane.tsx'),
      'utf8',
    );

    expect(source).toContain(
      'readonly onSelectionChange: (selection: PendingSelection | null) => void;',
    );
    expect(source).not.toContain('readonly onSelectionChange?:');
  });
});
