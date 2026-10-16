/**
 * TopicForm: a topic's name and its cloth (#198), the one form behind "New topic" and a card's
 * "Rename or recolour". The cloth is a native radio group (arrows move, one tab stop) of the six
 * cloths, each a swatch with its colour's name. The server's refusal (a name already used) is shown
 * beside the field and the typed name is kept.
 */
'use client';

import { Button, TextField } from '@papertree/ui';
import { useId, useState } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';
import { describeError } from '@/components/ui/errors';

import { useTouchTargets } from '../hooks/useTouchTargets';
import { CLOTHS } from '../model/topics';

import type { ClothId } from '../model/shelf';
import type { FormEvent, ReactNode } from 'react';

/** Props for `TopicForm`. */
export interface TopicFormProps {
  readonly initialName?: string;
  readonly initialCloth: ClothId;
  /** The submit button's words ("Create topic", "Save"). */
  readonly submitLabel: string;
  /** Resolves when saved; a rejection is shown as the field's error. */
  readonly onSubmit: (name: string, cloth: ClothId) => Promise<unknown>;
}

/**
 * The name field, the cloth picker and the submit button.
 *
 * @example
 * <TopicForm initialCloth="vision" submitLabel="Create topic" onSubmit={(n, c) => create({ name: n, cloth: c })} />
 */
export function TopicForm({
  initialName = '',
  initialCloth,
  submitLabel,
  onSubmit,
}: TopicFormProps): ReactNode {
  const [name, setName] = useState(initialName);
  const [cloth, setCloth] = useState<ClothId>(initialCloth);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const group = useId();
  const touch = useTouchTargets();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Give the topic a name.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    onSubmit(trimmed, cloth).then(
      () => setBusy(false),
      (caught: unknown) => {
        setBusy(false);
        setError(describeError(caught, 'The topic was not saved. Try again.'));
      },
    );
  };
  return (
    <form className="pt-topicform" onSubmit={submit} noValidate>
      <TextField
        label="Name"
        value={name}
        maxLength={60}
        autoComplete="off"
        error={error ?? undefined}
        onChange={(event) => setName(event.target.value)}
      />
      <fieldset className="pt-topicform__cloths">
        <legend>Cloth</legend>
        {CLOTHS.map((option) => (
          <label
            key={option.id}
            className={['pt-topicform__cloth', touch && TOUCH_TARGET].filter(Boolean).join(' ')}
          >
            <input
              type="radio"
              name={group}
              value={option.id}
              checked={cloth === option.id}
              onChange={() => setCloth(option.id)}
            />
            <span
              className="pt-topicform__swatch"
              aria-hidden="true"
              style={{ backgroundColor: `var(--pt-cloth-${option.id})` }}
            />
            {option.name}
          </label>
        ))}
      </fieldset>
      <Button type="submit" variant="primary" size={touch ? 'touch' : 'md'} disabled={busy}>
        {busy ? 'Saving' : submitLabel}
      </Button>
    </form>
  );
}
