/**
 * TopicsView: the library's Topics view (#198, frame 03). One card per topic in the topics' own
 * order, a grid with ONE tab stop (arrows move, Home and End jump; Tab then reaches that card's "…"
 * menu), Enter shows the topic's papers on the shelf, and the Unshelved card under it offers each
 * paper without a topic its suggestion. A search dims the cards and rows with no match, as the shelf
 * does. With no topics yet it says how topics arrive.
 */
'use client';

import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { describeError } from '@/components/ui/errors';

import { useTopics } from '../hooks/useTopics';
import { gridStep, topicShelves } from '../model/topics';
import './topics.css';
import { TopicCard } from './TopicCard';
import { UnshelvedCard } from './UnshelvedCard';

import type { LibraryBook } from '../hooks/useLibrary';
import type { KeyboardEvent, ReactNode } from 'react';

/** Props for `TopicsView`. */
export interface TopicsViewProps {
  readonly books: readonly LibraryBook[];
  readonly matches: ReadonlySet<string> | null;
  /** Enter on a card: the shelf, arranged by topic, at this paper (the topic's first). */
  readonly onShowOnShelf: (paperId: string) => void;
}

const NEW_TOPIC = '[data-new-topic] button';

/**
 * The Topics view.
 *
 * @example
 * <TopicsView books={books} matches={matches} onShowOnShelf={showTopicOnShelf} />
 */
export function TopicsView({ books, matches, onShowOnShelf }: TopicsViewProps): ReactNode {
  const { topics, query, actions } = useTopics();
  const headingId = useId();
  const keysId = useId();
  const shelves = useMemo(() => topicShelves(topics, books), [topics, books]);
  const unshelved = useMemo(
    () =>
      books
        .filter((book) => !book.topic)
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id)),
    [books],
  );
  const order = useMemo(() => shelves.map((s) => s.topic.topic_id), [shelves]);
  const grid = useRef<HTMLUListElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const stop = (focused !== null && order.includes(focused) ? focused : order[0]) ?? null;
  const focusCard = useCallback((id: string) => {
    grid.current
      ?.querySelector<HTMLElement>(`[data-topic-id="${CSS.escape(id)}"] [data-topic-open]`)
      ?.focus();
  }, []);
  // After a delete the card leaves: focus goes to its neighbour, or to New topic for the last one.
  const [refocus, setRefocus] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (refocus === null) return;
    if (refocus === NEW_TOPIC) document.querySelector<HTMLElement>(NEW_TOPIC)?.focus();
    else if (order.includes(refocus)) focusCard(refocus);
    else return;
    setRefocus(null);
  }, [refocus, order, focusCard]);
  const onRemoved = useCallback(
    (id: string) => {
      const at = order.indexOf(id);
      setRefocus(order[at + 1] ?? order[at - 1] ?? NEW_TOPIC);
    },
    [order],
  );
  const onOpen = useCallback(
    (id: string) => {
      const first = shelves.find((s) => s.topic.topic_id === id)?.papers[0];
      if (first !== undefined) onShowOnShelf(first.id);
    },
    [shelves, onShowOnShelf],
  );
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const node = grid.current;
    const columns =
      node === null
        ? 1
        : getComputedStyle(node).gridTemplateColumns.split(' ').filter(Boolean).length;
    const next = gridStep(
      stop === null ? 0 : order.indexOf(stop),
      event.key,
      order.length,
      columns || 1,
    );
    const id = next === null ? undefined : order[next];
    if (id === undefined) return;
    event.preventDefault();
    setFocused(id);
    focusCard(id);
  };

  if (query.isLoading) {
    return <div role="status" aria-label="Loading your topics" className="pt-s3-skeleton" />;
  }
  if (query.isError) {
    return (
      <div role="alert" className="pt-s3-alert pt-s3-alert--error flex flex-col gap-3">
        <p>
          {describeError(query.error, 'Your topics could not be loaded.')} Your papers are safe.
        </p>
        <div>
          <button
            type="button"
            className="pt-s3-btn pt-s3-btn--small"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  return (
    <section className="pt-topics" aria-labelledby={headingId}>
      <h2 id={headingId} className="pt-sr-only">
        Topics
      </h2>
      {shelves.length === 0 ? (
        <div className="pt-topics__empty">
          <p className="pt-topics__empty-title">No topics yet</p>
          <p>
            A topic is a shelf you name. Make one with New topic and choose it for a paper below.
            After that, a new paper from the same arXiv category is offered to it, and nothing is
            shelved until you accept.
          </p>
        </div>
      ) : (
        <ul
          ref={grid}
          className="pt-topics__grid"
          aria-label="Your topics"
          aria-describedby={keysId}
        >
          {shelves.map((shelf) => (
            <TopicCard
              key={shelf.topic.topic_id}
              topic={shelf.topic}
              papers={shelf.papers}
              matches={matches}
              active={shelf.topic.topic_id === stop}
              onFocusCard={setFocused}
              onOpen={onOpen}
              onKeyDown={onKeyDown}
              actions={actions}
              onRemoved={onRemoved}
            />
          ))}
        </ul>
      )}
      <p id={keysId} className="pt-sr-only">
        Arrow keys move between the topics; Enter shows a topic’s papers on the shelf.
      </p>
      <UnshelvedCard papers={unshelved} topics={topics} matches={matches} actions={actions} />
    </section>
  );
}
