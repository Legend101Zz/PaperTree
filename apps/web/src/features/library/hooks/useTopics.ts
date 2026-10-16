/**
 * useTopics: the Topics view's data (#198): `GET /topics` and every write the view makes (create,
 * rename or recolour, delete, accept, "Not this"), each followed by a re-read of the topics, the
 * papers (a paper's accepted topic is on its row) and the offers (shelving one paper can change what
 * another is offered). `usePaperOffers` reads the pending offer of each Unshelved paper.
 * UI → this hook → `topicsApi` → services/api `routers/topics.py` → SQLite.
 */
'use client';

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { topicsApi, type PaperTopic } from '@/lib/api/topics';

const TOPICS_KEY = ['topics'] as const;
const OFFER_KEY = 'paper-topic';

/**
 * The person's topics and the writes the view makes.
 *
 * @returns The topics (empty until loaded), the query, and the actions (one stable object; each
 *   resolves after the re-read, and rejects with the server's error).
 */
export function useTopics() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: TOPICS_KEY,
    queryFn: () => topicsApi.list(),
    refetchOnWindowFocus: false,
  });
  const after = useCallback(
    async <T>(write: Promise<T>): Promise<T> => {
      const result = await write;
      await Promise.all(
        [TOPICS_KEY, ['papers'], [OFFER_KEY]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
      return result;
    },
    [client],
  );
  const actions = useMemo(
    () => ({
      create: (...args: Parameters<typeof topicsApi.create>) => after(topicsApi.create(...args)),
      patch: (...args: Parameters<typeof topicsApi.patch>) => after(topicsApi.patch(...args)),
      remove: (topicId: string) => after(topicsApi.remove(topicId)),
      accept: (...args: Parameters<typeof topicsApi.accept>) => after(topicsApi.accept(...args)),
      reject: (paperId: string) => after(topicsApi.reject(paperId)),
    }),
    [after],
  );
  return { topics: query.data ?? [], query, actions };
}

/** The writes `useTopics` returns, for components that make them. */
export type TopicActions = ReturnType<typeof useTopics>['actions'];

/**
 * The pending offer of each paper, by id. Keyed by the paper's state as well: a paper still being
 * read has no category yet, and the server stores nothing until it has an offer, so it is asked
 * again once the paper is read.
 *
 * @param papers - The papers to ask about (the Unshelved card's shown rows).
 * @returns Each paper's `PaperTopic`, absent while it loads or when it could not be read.
 */
export function usePaperOffers(
  papers: readonly { readonly id: string; readonly processing: string }[],
): ReadonlyMap<string, PaperTopic> {
  return useQueries({
    queries: papers.map((paper) => ({
      queryKey: [OFFER_KEY, paper.id, paper.processing],
      queryFn: () => topicsApi.ofPaper(paper.id),
      refetchOnWindowFocus: false,
    })),
    combine: (results) =>
      new Map(
        results.flatMap((result, index) => {
          const id = papers[index]?.id;
          return result.data === undefined || id === undefined ? [] : [[id, result.data]];
        }),
      ),
  });
}
