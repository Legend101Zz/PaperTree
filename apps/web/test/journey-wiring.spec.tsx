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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { libraryPaperFromPaperRow, type PaperRow } from '@/components/library/types';

/** The real body of `POST /auth/login`, copied from a live response during the walk. */
const REAL_SESSION = {
  token: 'folzXLSCQf8-B6Eemj8wBSC-SzHmN0rHM8PB-kcNf1U',
  user_id: 'usr_01KZ65KBMR6CMA77813J1BREZJ',
  email: 'uxwalk@papertree.test',
} as const;

/** One real row of `GET /papers`, keys and all, captured from the live service during the walk. */
const REAL_ROW: PaperRow = {
  paper_id: 'ppr_7R9RKPFP4FSVAV1TV622F4Z575',
  created_at: '2026-08-04T10:40:57.083752+00:00',
  status: 'complete',
  metadata: JSON.stringify({
    title: {
      value: 'Deep Residual Learning for Image Recognition',
      source_block_id: 'blk_3vrksodt7ivaylly',
      confidence: 0.9,
    },
    authors: [
      { value: 'Kaiming He', source_block_id: 'blk_hxgun7k2irstdlea', confidence: 0.9 },
      { value: 'Xiangyu Zhang', source_block_id: 'blk_6isf6gxscvhvvdz7', confidence: 0.9 },
    ],
  }),
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
    const papertree = await import('@/lib/papertree');
    vi.spyOn(papertree.authApi, 'login').mockResolvedValue({ ...REAL_SESSION });

    const { useAuthStore } = await import('@/store/authStore');
    await useAuthStore.getState().login('uxwalk@papertree.test', 'pw');

    const { getToken } = await import('@/lib/auth');
    expect(getToken()).toBe(REAL_SESSION.token);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.email).toBe(REAL_SESSION.email);
  });

  it('writes the token where the READER looks for it, which is the same place', async () => {
    // D2. Two modules, one session. `lib/auth` wrote "token"; `lib/papertree` read
    // "papertree.session". Both were internally correct, so both suites were green while a valid
    // session produced `missing or invalid session token` in the reader. Asserted through the two
    // PUBLIC accessors rather than against a literal key, so the test still holds if the key is
    // renamed — what it forbids is the two disagreeing.
    const { setToken } = await import('@/lib/auth');
    const { getSessionToken } = await import('@/lib/papertree');

    setToken(REAL_SESSION.token);

    expect(getSessionToken()).toBe(REAL_SESSION.token);
  });

  it('clearing the session clears it for the reader too', async () => {
    const { setToken, removeToken } = await import('@/lib/auth');
    const { getSessionToken } = await import('@/lib/papertree');

    setToken(REAL_SESSION.token);
    removeToken();

    expect(getSessionToken()).toBeNull();
  });
});

describe('D3 — the library page talks to the service that is actually running', () => {
  it('imports `papersApi` from the v2 client, not from the archived v1 one', async () => {
    // Asserted on the MODULE IDENTITY rather than on a call, because the defect was an import line.
    // `lib/api.ts` and `lib/papertree.ts` both export a symbol called `papersApi`, so which one a
    // file gets is invisible at every call site — and the v1 one posts `/papers/upload`, which the
    // v2 service answers **405 Method Not Allowed** (measured in the browser).
    const source = readFileSync(resolve(process.cwd(), 'src/app/dashboard/page.tsx'), 'utf8');

    expect(source).toContain("import { papersApi } from '@/lib/papertree'");
    expect(source).not.toContain("from '@/lib/api'");
  });
});

describe('D4 — a parsed paper reads as parsed', () => {
  it('parses the double-encoded metadata and finds the title', () => {
    // WATCHED FAILING with the old `libraryPaperFromApi(row)`: `row.title` was `undefined`, so the
    // card rendered untitled and axe reported `button-name` at CRITICAL on `#paper-title-undefined`.
    const paper = libraryPaperFromPaperRow(REAL_ROW);

    expect(paper.title).toBe('Deep Residual Learning for Image Recognition');
    expect(paper.authors).toEqual(['Kaiming He', 'Xiangyu Zhang']);
    expect(paper.id).toBe(REAL_ROW.paper_id);
  });

  it('reads `processing` from the row status instead of defaulting it to pending', () => {
    // The worker logged `promoted … generation 1` and the card still said "Queued", because the
    // bridge defaulted `processing` to 'pending' — correct when nothing could parse, wrong once
    // something could.
    expect(libraryPaperFromPaperRow(REAL_ROW).processing).toBe('complete');
    expect(libraryPaperFromPaperRow({ ...REAL_ROW, status: 'partial' }).processing).toBe('partial');
    // A row with no status has genuinely not been parsed, and must NOT claim to be complete.
    expect(libraryPaperFromPaperRow({ ...REAL_ROW, status: null }).processing).toBe('pending');
  });

  it('never renders an untitled card, because an untitled card has no accessible name', () => {
    // The fallback is the paper id: something a screen reader can announce and a human can tell
    // apart from the next card. Empty string was the accessibility defect.
    const untitled = libraryPaperFromPaperRow({ ...REAL_ROW, metadata: null });

    expect(untitled.title).toBe(REAL_ROW.paper_id);
    expect(untitled.title.length).toBeGreaterThan(0);
  });

  it('survives metadata that is not valid JSON rather than taking the library down', () => {
    const broken = libraryPaperFromPaperRow({ ...REAL_ROW, metadata: '{not json' });

    expect(broken.title).toBe(REAL_ROW.paper_id);
    expect(broken.authors).toEqual([]);
  });
});

describe('D6 — the Inspector is asked about the selection', () => {
  it('the reader shell reads the selection instead of hardcoding the first block', async () => {
    // THE DEFECT WAS ONE LINE and no behavioural test could reach it:
    //     context={{ kind: 'selection', blockIds: [doc.blocks[0]?.id ?? ''], quote: title }}
    // `ask-wiring.spec.tsx` builds its own context and asserts what the Inspector does with it, so
    // it is blind to what the mount site passes. This asserts the mount site itself.
    const source = readFileSync(resolve(process.cwd(), 'src/app/paper/[id]/read/ReaderWorkspace.tsx'), 'utf8');

    // The Inspector takes a computed context...
    expect(source).toContain('context={inspectorContext}');
    // ...which is derived from the live selection...
    expect(source).toContain('props.selection?.blockIds');
    // ...and the shell both holds that state and receives it from the pane.
    expect(source).toContain('onSelectionChange={setSelection}');
  });

  it('SourcePane requires the selection callback, so a shell cannot silently drop it', async () => {
    // Required, not optional — the same argument `onViewportResize` records after being optional
    // for one commit and silently never supplied. An optional prop here reproduces D6 exactly.
    const source = readFileSync(resolve(process.cwd(), 'src/components/reader/SourcePane.tsx'), 'utf8');

    expect(source).toContain('readonly onSelectionChange: (selection: PendingSelection | null) => void;');
    expect(source).not.toContain('readonly onSelectionChange?:');
  });
});
