/**
 * NewTopic: "New topic" at the right of the view row in the Topics view (#198): a popover with the
 * topic form, its cloth preset to one the person does not use yet. Creating closes it and puts focus
 * back on the button; the new card is then in the grid.
 */
'use client';

import { Plus } from 'lucide-react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { usePopover } from '../hooks/usePopover';
import { useTopics } from '../hooks/useTopics';
import { useTouchTargets } from '../hooks/useTouchTargets';
import { nextCloth } from '../model/topics';
import { TopicForm } from './TopicForm';

import type { ReactNode } from 'react';

/**
 * The New topic button and its form.
 *
 * @example
 * <NewTopic />
 */
export function NewTopic(): ReactNode {
  const { topics, actions } = useTopics();
  const menu = usePopover();
  const touch = useTouchTargets();
  return (
    <div ref={menu.wrapper} className="pt-hmenu" data-new-topic="">
      <button
        ref={menu.button}
        type="button"
        className={['pt-hmenu__button pt-newtopic', touch && TOUCH_TARGET]
          .filter(Boolean)
          .join(' ')}
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.panelId : undefined}
        onClick={menu.toggle}
      >
        <Plus size={20} strokeWidth={1.5} aria-hidden="true" />
        New topic
      </button>
      {menu.open ? (
        <div
          id={menu.panelId}
          role="group"
          aria-label="New topic"
          className="pt-hmenu__panel pt-topicmenu__panel"
        >
          <TopicForm
            initialCloth={nextCloth(topics)}
            submitLabel="Create topic"
            onSubmit={(name, cloth) => actions.create({ name, cloth }).then(() => menu.close())}
          />
        </div>
      ) : null}
    </div>
  );
}
