/**
 * useBookData — what the opened book fetches when it opens (#200): the figures the parser found,
 * the abstract, the owner's display name; and the two writes, the plate and the name. UI → these
 * hooks → `bookApi` / `authApi` → services/api → SQLite. A plate change re-reads the library
 * (`['papers']`), whose row carries the plate the covers draw.
 */
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { authApi } from '@/lib/api/papers';

import { bookApi, bookKeys } from '../api/bookApi';

import type { Me } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

/** The library list's cache key (`features/library/hooks/useLibrary`). */
const PAPERS_KEY = ['papers'] as const;
const ME_KEY = ['me'] as const;
/** Where "Not now" to "Whose library is this?" is remembered, per browser (ask once). */
export const NAME_DECLINED_KEY = 'papertree/book/name-declined';

/**
 * The figures and the abstract of one paper, fetched once the book is opened.
 *
 * @param paperId - The paper.
 * @param enabled - False until the spread is shown (the pull-out needs neither).
 * @returns The two queries.
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
  return { figures, abstract };
}

function readDeclined(): boolean {
  try {
    return window.localStorage.getItem(NAME_DECLINED_KEY) === 'yes';
  } catch {
    return false;
  }
}

/**
 * The owner's display name for the bookplate, asked once (D5): `save` stores it with
 * `PATCH /auth/me`; `decline` remembers "Not now" in this browser so the plate stops asking.
 *
 * @returns The name (null until set), whether the person declined, and the two actions.
 */
export function useDisplayName() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: () => authApi.me(), staleTime: 60_000 });
  const [declined, setDeclined] = useState(readDeclined);
  const save = useMutation({
    mutationFn: (name: string) => authApi.setDisplayName(name),
    onSuccess: (next: Me) => client.setQueryData(ME_KEY, next),
  });
  const decline = useCallback(() => {
    setDeclined(true);
    try {
      window.localStorage.setItem(NAME_DECLINED_KEY, 'yes');
    } catch {
      // A private window keeps no storage: the plate asks again next time, which is honest.
    }
  }, []);
  return {
    loaded: me.isSuccess,
    displayName: me.data?.display_name ?? null,
    declined,
    save,
    decline,
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
