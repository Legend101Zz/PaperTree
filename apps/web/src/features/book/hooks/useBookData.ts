/**
 * useBookData — what the opened book fetches when it opens (#200): the figures the parser found,
 * the abstract, the summary's state, the owner's display name; and the two writes, the plate and
 * the name. UI → these hooks → `bookApi` / `summaryApi` / `authApi` → services/api → SQLite. A
 * plate change re-reads the library (`['papers']`), whose row carries the plate the covers draw.
 */
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { getSessionToken } from '@/lib/api/client';
import { authApi } from '@/lib/api/papers';
import { summaryApi } from '@/lib/api/summary';

import { bookApi, bookKeys } from '../api/bookApi';

import type { Me } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

/** The library list's cache key (`features/library/hooks/useLibrary`). */
const PAPERS_KEY = ['papers'] as const;
/** `GET /auth/me`, shared by the bookplate and the header's initial. */
export const ME_KEY = ['me'] as const;
/** Where "Not now" to "Whose library is this?" is remembered: per account, in this browser. */
export const NAME_DECLINED_PREFIX = 'papertree/book/name-declined/';

/**
 * The figures, the abstract and the summary's state of one paper, fetched when the book opens.
 * The summary is `GET /papers/{id}/summary` itself (the current prompt version, `ready` or
 * `partial`), not the library row's looser `has_summary` (#200 review S4).
 *
 * @param paperId - The paper.
 * @param enabled - False until the spread is shown (the pull-out needs none of them).
 * @returns The three queries.
 */
export function useBookFacts(paperId: string, enabled: boolean) {
  const figures = useQuery({
    queryKey: bookKeys.figures(paperId),
    queryFn: () => bookApi.figures(paperId),
    enabled,
    staleTime: 5 * 60_000,
  });
  const abstract = useQuery({
    queryKey: bookKeys.abstract(paperId),
    queryFn: () => bookApi.abstract(paperId),
    enabled,
    staleTime: 5 * 60_000,
  });
  const summary = useQuery({
    queryKey: bookKeys.summary(paperId),
    queryFn: () => summaryApi.get(paperId),
    enabled,
  });
  return { figures, abstract, summary };
}

/** A session token is stored; a storage that throws (blocked site data) reads as none. */
function hasSession(): boolean {
  try {
    return getSessionToken() !== null;
  } catch {
    return false;
  }
}

/**
 * The signed-in account (`GET /auth/me`): its email and the name it chose, cached once for the
 * bookplate and the header. Asked only with a session: signed out there is no one to ask about.
 *
 * @returns The query.
 */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => authApi.me(),
    enabled: hasSession(),
    staleTime: 60_000,
    retry: false,
  });
}

function readDeclined(userId: string | null): boolean {
  if (userId === null) return false;
  try {
    return window.localStorage.getItem(NAME_DECLINED_PREFIX + userId) === 'yes';
  } catch {
    return false;
  }
}

function writeDeclined(userId: string, declined: boolean): void {
  try {
    if (declined) window.localStorage.setItem(NAME_DECLINED_PREFIX + userId, 'yes');
    else window.localStorage.removeItem(NAME_DECLINED_PREFIX + userId);
  } catch {
    // A private window keeps no storage: the plate asks again next time, which is honest.
  }
}

/**
 * The owner's display name for the bookplate, asked once (D5): `save` stores it with
 * `PATCH /auth/me`; `decline` remembers "Not now" for THIS account in this browser, so another
 * account signing in here is still asked; `reopen` ("Name this library") asks again.
 *
 * @returns The name (null until set), whether this account declined, and the actions.
 */
export function useDisplayName() {
  const client = useQueryClient();
  const me = useMe();
  const userId = me.data?.user_id ?? null;
  const [, rerender] = useState(0);
  const save = useMutation({
    mutationFn: (name: string) => authApi.setDisplayName(name),
    onSuccess: (next: Me) => client.setQueryData(ME_KEY, next),
  });
  const decline = useCallback(() => {
    if (userId === null) return;
    writeDeclined(userId, true);
    rerender((n) => n + 1);
  }, [userId]);
  const reopen = useCallback(() => {
    if (userId === null) return;
    writeDeclined(userId, false);
    rerender((n) => n + 1);
  }, [userId]);
  return {
    loaded: me.isSuccess,
    displayName: me.data?.display_name ?? null,
    declined: readDeclined(userId),
    save,
    decline,
    reopen,
  };
}

/**
 * Choosing the cover plate and putting the typographic cover back.
 *
 * @param paperId - The paper.
 * @returns The two mutations; both re-read the library on success.
 */
export function usePlateChoice(paperId: string) {
  const client = useQueryClient();
  const refresh = (): Promise<void> => client.invalidateQueries({ queryKey: PAPERS_KEY });
  const choose = useMutation({
    mutationFn: (anchor: Anchor) => bookApi.setPlate(paperId, anchor),
    onSuccess: refresh,
  });
  const clear = useMutation({ mutationFn: () => bookApi.clearPlate(paperId), onSuccess: refresh });
  return { choose, clear };
}
