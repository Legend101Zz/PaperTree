'use client';

/**
 * board/components/tree/UsesPicker — the popover behind each dotted item of the Uses line (V3-23).
 *
 * - "this path" lists what the AI will read, in order, and what it will NOT (sibling branches), and
 *   offers "this path" or "this card only";
 * - "the paper" is the page and its neighbours, the whole paper, or off;
 * - "level" is New to this, Familiar, Expert (the choice sticks for the board's next ask);
 * - "diagram" is may draw, never, always.
 *
 * Escape is the board's (`escapeStep`): it closes this picker before the ask box. Arrow keys move
 * between the options; Enter or Space picks.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import {
  DIAGRAM_LABELS,
  LEVEL_LABELS,
  PAPER_SENTENCES,
  type ReadList,
} from '../../model/askPayload';

import type { AskLevel, AskUses } from '@/lib/api/types';
import type { PickerName } from '../../model/ui';

/** Props for `UsesPicker`. */
export interface UsesPickerProps {
  readonly name: PickerName;
  readonly uses: AskUses;
  readonly read: ReadList;
  readonly onChange: (patch: Partial<AskUses>) => void;
  readonly onClose: () => void;
}

interface Option {
  readonly value: string;
  readonly label: string;
  readonly note?: string;
  readonly on: boolean;
  readonly pick: () => void;
}

const PAPER_OPTIONS: readonly { value: AskUses['paper']; label: string }[] = [
  { value: 'page', label: 'The page and its neighbours' },
  { value: 'whole', label: 'The whole paper' },
  { value: 'off', label: 'Not the paper' },
];
const LEVELS: readonly AskLevel[] = ['new', 'familiar', 'expert'];
const DIAGRAMS: readonly AskUses['diagram'][] = ['may', 'never', 'always'];

function optionsFor(props: UsesPickerProps): Option[] {
  const { name, uses, onChange, onClose } = props;
  const choose = (patch: Partial<AskUses>) => () => {
    onChange(patch);
    onClose();
  };
  if (name === 'path') {
    return [
      {
        value: 'path',
        label: 'This path',
        note: 'the passage and every turn above this card',
        on: uses.path,
        pick: () => onChange({ path: true }),
      },
      {
        value: 'card',
        label: 'This card only',
        note: 'the passage and the card you ask from',
        on: !uses.path,
        pick: () => onChange({ path: false }),
      },
    ];
  }
  if (name === 'paper') {
    return PAPER_OPTIONS.map((o) => ({
      value: o.value,
      label: o.label,
      note: PAPER_SENTENCES[o.value],
      on: uses.paper === o.value,
      pick: choose({ paper: o.value }),
    }));
  }
  if (name === 'level') {
    return LEVELS.map((level) => ({
      value: level,
      label: LEVEL_LABELS[level],
      on: uses.level === level,
      pick: choose({ level }),
    }));
  }
  return DIAGRAMS.map((diagram) => ({
    value: diagram,
    label: DIAGRAM_LABELS[diagram],
    on: uses.diagram === diagram,
    pick: choose({ diagram }),
  }));
}

const TITLE: Readonly<Record<PickerName, string>> = {
  path: 'What the AI will read',
  paper: 'How much of the paper',
  level: 'Level',
  diagram: 'Diagram',
};

/** The picker for one dotted item. */
export function UsesPicker(props: UsesPickerProps): ReactNode {
  const { name, read } = props;
  const box = useRef<HTMLDivElement>(null);
  const options = optionsFor(props);

  useEffect(() => {
    // The chosen option takes focus, so arrows and Enter work at once.
    const buttons = box.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    const chosen = [...(buttons ?? [])].find((b) => b.getAttribute('aria-checked') === 'true');
    (chosen ?? buttons?.[0])?.focus({ preventScroll: true });
  }, [name]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
    const at = buttons.findIndex((b) => b === document.activeElement);
    const next =
      buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
    event.preventDefault();
    next?.focus();
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrows move between the options
    <div
      ref={box}
      className="pt-pick"
      role="dialog"
      aria-label={TITLE[name]}
      data-picker={name}
      onKeyDown={onKeyDown}
    >
      <p className="pt-pick__title">{TITLE[name]}</p>
      <div role="radiogroup" aria-label={TITLE[name]}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.on}
            className="pt-pick__opt"
            onClick={o.pick}
          >
            <span className="pt-pick__radio" aria-hidden="true" data-on={o.on} />
            <span>
              {o.label}
              {o.note === undefined ? null : <span className="pt-pick__note">{o.note}</span>}
            </span>
          </button>
        ))}
      </div>
      {name !== 'path' ? null : (
        <>
          <ul className="pt-pick__reads" aria-label="The AI will read">
            {read.items.map((item, i) => (
              <li key={`${item.kind}-${item.id ?? String(i)}`} className="pt-pick__read">
                <span className="pt-pick__tick" aria-hidden="true" />
                <span>
                  {item.title}
                  {item.note === '' ? null : <span className="pt-pick__note">{item.note}</span>}
                </span>
              </li>
            ))}
            <li className="pt-pick__read">
              <span className="pt-pick__tick" aria-hidden="true" />
              <span>{read.paper}</span>
            </li>
          </ul>
          {read.notRead.length === 0 ? null : (
            <>
              <p className="pt-pick__title">Not sent</p>
              <ul className="pt-pick__reads pt-pick__reads--off" aria-label="The AI will not read">
                {read.notRead.map((label) => (
                  <li key={label} className="pt-pick__read">
                    <span className="pt-pick__tick pt-pick__tick--off" aria-hidden="true" />
                    <span>
                      {label}
                      <span className="pt-pick__note">a sibling branch</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
