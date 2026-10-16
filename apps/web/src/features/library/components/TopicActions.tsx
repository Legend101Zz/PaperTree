/**
 * TopicActions: a topic card's "…" menu (#198): rename and recolour in one form, and Delete, which
 * is confirmed inline and says what happens ("its papers go back to Unshelved; the papers stay").
 * The button takes the card's roving tab index, so the cards stay one stop plus the focused card's
 * menu. `usePopover` holds the closing rules (Esc, a press outside, focus leaving).
 */
'use client';

import { Button } from '@papertree/ui';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { usePopover } from '../hooks/usePopover';
import { useTouchTargets } from '../hooks/useTouchTargets';
import { nextCloth } from '../model/topics';
import { TopicForm } from './TopicForm';

import type { TopicActions as Actions } from '../hooks/useTopics';
import type { Topic } from '@/lib/api/topics';
import type { ReactNode } from 'react';

/** Props for `TopicActions`. */
export interface TopicActionsProps {
  readonly topic: Topic;
  readonly paperCount: number;
  readonly tabIndex: 0 | -1;
  readonly actions: Pick<Actions, 'patch' | 'remove'>;
  /** After the delete, so the view can put focus on a neighbour. */
  readonly onRemoved: (topicId: string) => void;
}

/** The inline "Delete this topic?" with Delete topic and Keep it (focused when it appears). */
function DeleteConfirm({
  topic,
  paperCount,
  onKeep,
  onDelete,
}: {
  readonly topic: Topic;
  readonly paperCount: number;
  readonly onKeep: () => void;
  readonly onDelete: () => Promise<unknown>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const keep = useRef<HTMLDivElement>(null);
  // `Button` does not forward refs, so Keep it is found by its mark.
  useEffect(() => keep.current?.querySelector<HTMLElement>('[data-keep-it]')?.focus(), []);
  const size = useTouchTargets() ? 'touch' : 'md';
  const papers = paperCount === 1 ? 'Its paper goes' : `Its ${String(paperCount)} papers go`;
  return (
    <div
      ref={keep}
      role="group"
      aria-label={`Confirm deleting ${topic.name}`}
      className="pt-catalogue__confirm"
    >
      <p>
        Delete “{topic.name}”?{' '}
        {paperCount === 0
          ? 'It holds no papers.'
          : `${papers} back to Unshelved; the papers and their highlights stay.`}
      </p>
      {failed ? (
        <span role="alert" className="pt-catalogue__error">
          The topic was not deleted. Try again.
        </span>
      ) : null}
      <Button
        variant="danger"
        size={size}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          onDelete().catch(() => {
            setBusy(false);
            setFailed(true);
          });
        }}
      >
        {busy ? 'Deleting' : 'Delete topic'}
      </Button>
      <Button size={size} disabled={busy} data-keep-it="" onClick={onKeep}>
        Keep it
      </Button>
    </div>
  );
}

/**
 * The "…" button and its panel.
 *
 * @example
 * <TopicActions topic={t} paperCount={2} tabIndex={0} actions={topics} onRemoved={focusNext} />
 */
export function TopicActions({
  topic,
  paperCount,
  tabIndex,
  actions,
  onRemoved,
}: TopicActionsProps): ReactNode {
  const menu = usePopover();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!menu.open) setConfirming(false);
  }, [menu.open]);
  // Keep it moves focus to Delete topic BEFORE its group leaves, so focus never falls out of the
  // panel (which would close it).
  const keep = (): void => {
    document
      .getElementById(menu.panelId)
      ?.querySelector<HTMLElement>('[data-topic-delete]')
      ?.focus();
    setConfirming(false);
  };
  return (
    <div ref={menu.wrapper} className="pt-topicmenu">
      <button
        ref={menu.button}
        type="button"
        className="pt-hmenu__button pt-topicmenu__button"
        tabIndex={tabIndex}
        aria-label={`Manage ${topic.name}`}
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.panelId : undefined}
        data-topic-menu=""
        onClick={menu.toggle}
      >
        <MoreHorizontal size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {menu.open ? (
        <div
          id={menu.panelId}
          role="group"
          aria-label={`Manage ${topic.name}`}
          className="pt-hmenu__panel pt-topicmenu__panel"
        >
          <TopicForm
            initialName={topic.name}
            initialCloth={topic.cloth ?? nextCloth([])}
            submitLabel="Save"
            onSubmit={(name, cloth) =>
              actions.patch(topic.topic_id, { name, cloth }).then(() => menu.close())
            }
          />
          <Button
            variant="danger"
            aria-expanded={confirming}
            data-topic-delete=""
            onClick={() => setConfirming(true)}
          >
            Delete topic
          </Button>
          {confirming ? (
            <DeleteConfirm
              topic={topic}
              paperCount={paperCount}
              onKeep={keep}
              onDelete={() => actions.remove(topic.topic_id).then(() => onRemoved(topic.topic_id))}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
