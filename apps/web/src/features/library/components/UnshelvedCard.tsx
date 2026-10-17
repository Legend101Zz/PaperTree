/**
 * UnshelvedCard: the papers without an accepted topic (#198), each with what it is offered and
 * three ways on: Accept, Not this (the offer is never made again), or a topic of the person's own
 * choosing. An offer shelves nothing until it is accepted (S2b). The offers are read only for the
 * rows shown (`usePaperOffers`), so a long Unshelved list costs one request per shown paper.
 */
'use client';

import { Button } from '@papertree/ui';
import { memo, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

import { usePaperOffers } from '../hooks/useTopics';
import { useTouchTargets } from '../hooks/useTouchTargets';
import { clothFor, spineTitle } from '../model/shelf';
import { nextCloth, offerLine } from '../model/topics';

import type { LibraryBook } from '../hooks/useLibrary';
import type { TopicActions } from '../hooks/useTopics';
import type { PaperTopic, Topic } from '@/lib/api/topics';
import type { ReactNode } from 'react';

/** Rows shown before "Show all". */
const SHOWN = 8;

/** Props for `UnshelvedCard`. */
export interface UnshelvedCardProps {
  readonly papers: readonly LibraryBook[];
  readonly topics: readonly Topic[];
  readonly matches: ReadonlySet<string> | null;
  readonly actions: Pick<TopicActions, 'accept' | 'reject'>;
}

interface RowProps extends Pick<UnshelvedCardProps, 'topics' | 'actions'> {
  readonly paper: LibraryBook;
  readonly offer: PaperTopic | undefined;
  readonly match: boolean | undefined;
  /** After a write: `leaves` when the paper is shelved and its row will go. */
  readonly onDone: (paperId: string, leaves: boolean) => void;
}

/** One paper: its cloth, title, offer and the three ways on. */
const UnshelvedRow = memo(function UnshelvedRow({
  paper,
  offer,
  match,
  topics,
  actions,
  onDone,
}: RowProps): ReactNode {
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const selectId = useId();
  const size = useTouchTargets() ? 'touch' : 'md';
  const title = spineTitle(paper.title);
  const run = (write: () => Promise<unknown>, leaves: boolean): void => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    write().then(
      () => {
        setBusy(false);
        onDone(paper.id, leaves);
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };
  const offered =
    offer?.status === 'suggested' && (offer.topic !== null || offer.suggested_name !== null);
  const accept = (): Promise<unknown> =>
    actions.accept(
      paper.id,
      offer?.topic
        ? { topic_id: offer.topic.topic_id }
        : // A new name the model offered gets a cloth the person does not use yet.
          { new_topic_name: offer?.suggested_name ?? '', cloth: nextCloth(topics) },
    );
  return (
    <li
      className="pt-unshelved__row"
      data-paper-id={paper.id}
      data-match={match === undefined ? undefined : String(match)}
    >
      <span
        className="pt-unshelved__spine"
        aria-hidden="true"
        style={{ backgroundColor: `var(--pt-cloth-${clothFor(paper)})` }}
      />
      <span className="pt-unshelved__text">
        <span className="pt-unshelved__title">{paper.title}</span>
        <span className="pt-unshelved__offer">{offerLine(offer) ?? 'No suggestion yet'}</span>
        {failed ? (
          <span role="alert" className="pt-unshelved__error">
            Not saved. Try again.
          </span>
        ) : null}
      </span>
      <span className="pt-unshelved__actions">
        {offered ? (
          <>
            <Button
              variant="outline"
              size={size}
              disabled={busy}
              aria-label={`Accept the suggestion for ${title}`}
              onClick={() => run(accept, true)}
            >
              Accept
            </Button>
            <Button
              variant="ghost"
              size={size}
              disabled={busy}
              aria-label={`Not this topic for ${title}`}
              onClick={() => run(() => actions.reject(paper.id), false)}
            >
              Not this
            </Button>
          </>
        ) : null}
        {topics.length === 0 ? null : (
          <span className="pt-unshelved__choose">
            <label className="pt-sr-only" htmlFor={selectId}>
              {offered ? 'Or choose another topic' : 'Choose a topic'} for {title}
            </label>
            <select
              id={selectId}
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              style={{ minHeight: size === 'touch' ? 44 : 40 }}
            >
              <option value="">{offered ? 'Choose another' : 'Choose a topic'}</option>
              {topics.map((t) => (
                <option key={t.topic_id} value={t.topic_id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button
              size={size}
              disabled={busy || choice === ''}
              aria-label={`Shelve ${title}`}
              onClick={() => run(() => actions.accept(paper.id, { topic_id: choice }), true)}
            >
              Shelve
            </Button>
          </span>
        )}
      </span>
    </li>
  );
});

/**
 * The Unshelved card, or nothing when every paper has a topic.
 *
 * @example
 * <UnshelvedCard papers={unshelved} topics={topics} matches={null} actions={topicActions} />
 */
export function UnshelvedCard({ papers, topics, matches, actions }: UnshelvedCardProps): ReactNode {
  const [all, setAll] = useState(false);
  const headingId = useId();
  const list = useRef<HTMLUListElement>(null);
  const shown = all ? papers : papers.slice(0, SHOWN);
  const offers = usePaperOffers(shown);
  // "Show all" leaves with the press: focus goes to the first row it brought in, not to the page.
  const expanding = useRef(false);
  useLayoutEffect(() => {
    if (!all || !expanding.current) return;
    expanding.current = false;
    // A row with nothing to press yet (no topics, no offer) hands focus to the card's heading.
    const control = list.current?.children[SHOWN]?.querySelector<HTMLElement>('button, select');
    (control ?? document.getElementById(headingId))?.focus();
  }, [all, headingId]);
  // Focus never falls to the page: after "Not this" it goes to the row's own topic picker; after a
  // paper is shelved (its row leaves), to the next row, else the previous, else the view's heading.
  const [done, setDone] = useState<{ id: string; leaves: boolean; next: string | null } | null>(
    null,
  );
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const onDone = useCallback((id: string, leaves: boolean) => {
    const rows = shownRef.current;
    const at = rows.findIndex((p) => p.id === id);
    setDone({ id, leaves, next: rows[at + 1]?.id ?? rows[at - 1]?.id ?? null });
  }, []);
  useLayoutEffect(() => {
    if (done === null || (done.leaves && papers.some((p) => p.id === done.id))) return;
    const row = (id: string | null): Element | null | undefined =>
      id === null ? null : list.current?.querySelector(`[data-paper-id="${CSS.escape(id)}"]`);
    const target = done.leaves ? row(done.next) : row(done.id);
    const control = target?.querySelector<HTMLElement>(done.leaves ? 'button, select' : 'select');
    (control ?? document.getElementById(headingId))?.focus();
    setDone(null);
  }, [done, papers, headingId]);
  if (papers.length === 0) return null;
  return (
    <section className="pt-unshelved" aria-labelledby={headingId}>
      <h3 id={headingId} className="pt-unshelved__heading" tabIndex={-1}>
        Unshelved
      </h3>
      <p className="pt-unshelved__note">
        {papers.length === 1 ? '1 paper has' : `${String(papers.length)} papers have`} no topic. A
        suggestion shelves nothing until you accept it.
        {topics.length === 0 ? ' Make a topic with New topic, then choose it here.' : ''}
      </p>
      <ul ref={list} className="pt-unshelved__list">
        {shown.map((paper) => (
          <UnshelvedRow
            key={paper.id}
            paper={paper}
            offer={offers.get(paper.id)}
            match={matches === null ? undefined : matches.has(paper.id)}
            topics={topics}
            actions={actions}
            onDone={onDone}
          />
        ))}
      </ul>
      {shown.length < papers.length ? (
        <Button
          variant="ghost"
          onClick={() => {
            expanding.current = true;
            setAll(true);
          }}
        >
          Show all {papers.length}
        </Button>
      ) : null}
    </section>
  );
}
