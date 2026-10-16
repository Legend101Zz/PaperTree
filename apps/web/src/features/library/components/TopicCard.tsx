/**
 * TopicCard: one topic in the Topics view (#198, frame 03): a banner in the topic's cloth with its
 * pattern and the gilt ornament (no plate exists yet, so never a blank and never a figure), the
 * name, the stats from data, a skyline of its spines (the shelf's own width, height, cloth and
 * state, drawn small), the one source line, and the "…" menu. The name is the card's button: the
 * grid's roving stop, and a pointer anywhere on the card presses it.
 */
'use client';

import { memo, useId } from 'react';

import { clothFor, spineHeight, spineState, spineWidth, type ShelfPaper } from '../model/shelf';
import { topicSourceLine, topicStats } from '../model/topics';
import { TopicActions } from './TopicActions';

import type { TopicActions as Actions } from '../hooks/useTopics';
import type { Topic } from '@/lib/api/topics';
import type { KeyboardEvent, ReactNode } from 'react';

/** Spines a card draws before "+n"; the count is in the stats line either way. */
const SKYLINE_MAX = 12;
/** The skyline is frame 01's shelf at about a fifth of its height and three fifths of its width. */
const skyWidth = (pages: number): number => Math.round(spineWidth(pages) * 0.6);
const skyHeight = (id: string): number => Math.round(spineHeight(id) * 0.21);

/** Props for `TopicCard`. */
export interface TopicCardProps {
  readonly topic: Topic;
  readonly papers: readonly ShelfPaper[];
  /** The ids a search matched, or null when none runs. */
  readonly matches: ReadonlySet<string> | null;
  /** The card that holds the grid's tab stop. */
  readonly active: boolean;
  readonly onFocusCard: (topicId: string) => void;
  /** Enter or a click: the topic's papers on the shelf. */
  readonly onOpen: (topicId: string) => void;
  /** The grid's arrow keys, on the name button. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly actions: Pick<Actions, 'patch' | 'remove'>;
  readonly onRemoved: (topicId: string) => void;
}

/** The decorative skyline of the topic's spines on a walnut lip. */
function Skyline({ papers, matches }: Pick<TopicCardProps, 'papers' | 'matches'>): ReactNode {
  const more = papers.length - SKYLINE_MAX;
  return (
    <span className="pt-sky" aria-hidden="true">
      <span className="pt-sky__spines">
        {papers.slice(0, SKYLINE_MAX).map((paper) => {
          const state = spineState(paper);
          const kraft = state === 'queued' || state === 'parsing';
          return (
            <i
              key={paper.id}
              className={`pt-sky__spine${kraft ? ' pt-sky__spine--kraft' : ''}${state === 'failed' ? ' pt-sky__spine--torn' : ''}`}
              style={{
                width: skyWidth(paper.pageCount),
                height: skyHeight(paper.id),
                ...(kraft ? {} : { backgroundColor: `var(--pt-cloth-${clothFor(paper)})` }),
              }}
              data-match={matches === null ? undefined : String(matches.has(paper.id))}
            >
              {state === 'reading' ? <span className="pt-sky__ribbon" /> : null}
            </i>
          );
        })}
        {more > 0 ? <span className="pt-sky__more">+{more}</span> : null}
      </span>
      <span className="pt-sky__lip" />
    </span>
  );
}

/**
 * One card. Memoised: a search keystroke redraws only the cards whose matches changed.
 *
 * @example
 * <TopicCard topic={t} papers={ps} matches={null} active onFocusCard={set} onOpen={open} actions={a} onRemoved={r} />
 */
export const TopicCard = memo(function TopicCard({
  topic,
  papers,
  matches,
  active,
  onFocusCard,
  onOpen,
  onKeyDown,
  actions,
  onRemoved,
}: TopicCardProps): ReactNode {
  const statsId = useId();
  const sourceId = useId();
  const empty = papers.length === 0;
  const lit = matches === null ? undefined : papers.some((p) => matches.has(p.id));
  return (
    <li
      className="pt-topiccard"
      data-topic-id={topic.topic_id}
      data-match={lit === undefined ? undefined : String(lit)}
    >
      <span
        className={`pt-topicbanner pt-topicbanner--${topic.cloth ?? 'none'}`}
        aria-hidden="true"
      >
        <span className="pt-topicbanner__frame" />
        <span className="pt-topicbanner__ornament">
          <i />
          <b />
          <i />
        </span>
      </span>
      <div className="pt-topiccard__body">
        <h3 className="pt-topiccard__name">
          <button
            type="button"
            className="pt-topiccard__open"
            tabIndex={active ? 0 : -1}
            aria-describedby={`${statsId} ${sourceId}`}
            aria-disabled={empty ? true : undefined}
            data-topic-open=""
            onFocus={() => onFocusCard(topic.topic_id)}
            onKeyDown={onKeyDown}
            onClick={() => {
              if (!empty) onOpen(topic.topic_id);
            }}
          >
            {topic.name}
          </button>
        </h3>
        <p className="pt-topiccard__stats" id={statsId}>
          {topicStats(papers).map((part, index) => (
            <span key={part.noun}>
              {index === 0 ? null : <span aria-hidden="true"> · </span>}
              {part.value === null ? null : <b>{part.value}</b>} {part.noun}
            </span>
          ))}
        </p>
        {empty ? null : <Skyline papers={papers} matches={matches} />}
        <p className="pt-topiccard__source" id={sourceId}>
          {topicSourceLine(papers)}
        </p>
      </div>
      <TopicActions
        topic={topic}
        paperCount={papers.length}
        tabIndex={active ? 0 : -1}
        actions={actions}
        onRemoved={onRemoved}
      />
    </li>
  );
});
