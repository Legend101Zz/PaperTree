'use client';

/**
 * board/components/LinkAsPicker — "Link as" (DESIGN.md §3.9, frame 06): a paper listbox of the
 * seven kinds in a 4 + 3 grid, each drawn by `ThreadSwatch` with its key 1–7, under a header that
 * names both ends. Not a modal: no scrim, it settles at the thread's midpoint (240 ms, settle).
 *
 * Keys: 1–7 choose; Enter or a click chooses the focused kind; the arrows walk the grid; Tab moves
 * within the picker; Escape keeps a plain link on a new thread and changes nothing on a saved one
 * (`escapeKind`); a press outside the picker counts as Escape. A disabled kind stays focusable and
 * says why. The label field is folded behind "Add a label" so it never sits between you and a key.
 */
import { ThreadSwatch } from '@papertree/ui';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { escapeKind, gridMove, kindForKey, type KindChoice } from '../model/linkAs';
import './linkAs.css';

import type { Point } from '../model/threads';
import type { EdgeKind } from '@/lib/api/types';

/** Props for `LinkAsPicker`. */
export interface LinkAsPickerProps {
  /** The two ends, by name (`endName`). */
  readonly from: string;
  readonly to: string;
  readonly choices: readonly KindChoice[];
  /** A new thread, or a saved thread's kind being changed. */
  readonly mode: 'new' | 'change';
  /** The kind focused first; default the first enabled one. */
  readonly initial?: EdgeKind;
  /** Top-left corner in the stage, once measured. */
  readonly at: Point | null;
  readonly onChoose: (kind: EdgeKind, label: string | null) => void;
  /** Escape on a saved thread: nothing changes. */
  readonly onCancel: () => void;
}

/** Options per row: 4 + 3 on a wide screen, two columns on a phone (the stylesheet agrees). */
const columns = (): number =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 2 : 4;

/** Focus the option at `index` inside the picker. */
function focusOption(root: HTMLElement | null, index: number): void {
  root?.querySelector<HTMLElement>(`[data-index="${String(index)}"]`)?.focus();
}

/**
 * The "Link as" picker.
 *
 * @example
 * <LinkAsPicker from="Diagram ‘Scaled…’" to="Passage p. 1" choices={kindChoices(a, b)}
 *   mode="new" at={{ x: 64, y: 696 }} onChoose={save} onCancel={close} />
 */
export function LinkAsPicker(props: LinkAsPickerProps): ReactNode {
  const { from, to, choices, mode, initial, at, onChoose, onCancel } = props;
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const start = Math.max(
    0,
    choices.findIndex((c) => (initial === undefined ? c.enabled : c.kind === initial)),
  );
  const [active, setActive] = useState(start);
  const [label, setLabel] = useState('');
  const [labelling, setLabelling] = useState(false);
  const words = (): string | null => (label.trim() === '' ? null : label.trim());
  const choose = (choice: KindChoice | undefined): void => {
    if (choice?.enabled === true) onChoose(choice.kind, words());
  };
  const escape = (): void => {
    const kind = escapeKind(mode);
    if (kind === null) onCancel();
    else onChoose(kind, words());
  };
  const latest = useRef({ escape, start });
  latest.current = { escape, start };
  const focusAt = (index: number): void => focusOption(root.current, index);

  // Once placed (a hidden element cannot take focus), focus the first option.
  const placed = at !== null;
  useEffect(() => {
    if (placed) focusOption(root.current, latest.current.start);
  }, [placed]);
  // A press anywhere outside the picker counts as Escape.
  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) latest.current.escape();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  useEffect(() => {
    if (labelling) root.current?.querySelector<HTMLElement>('input')?.focus();
  }, [labelling]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const typing = (event.target as HTMLElement).tagName === 'INPUT';
    if (event.key === 'Escape') escape();
    else if (event.key === 'Tab') {
      const stops = [...(root.current?.querySelectorAll<HTMLElement>('[data-stop]') ?? [])];
      const here = stops.indexOf(event.target as HTMLElement);
      const step = event.shiftKey ? stops.length - 1 : 1;
      stops[(here + step) % stops.length]?.focus();
    } else if (typing) {
      if (event.key !== 'Enter') return;
      choose(choices[active]);
    } else if (/^[1-7]$/.test(event.key)) {
      const kind = kindForKey(event.key, choices);
      const index = choices.findIndex((c) => c.key === event.key);
      if (kind === null) focusAt(index);
      else choose(choices[index]);
    } else {
      const next = gridMove(active, event.key, choices.length, columns());
      if (next === null) return;
      focusAt(next);
    }
    event.preventDefault();
    event.stopPropagation(); // the board under it must not take the key too
  };

  const current = choices[active];
  const style: CSSProperties =
    at === null ? { visibility: 'hidden' } : { insetInlineStart: at.x, insetBlockStart: at.y };
  return (
    // The picker is one composite widget: its keys (1–7, the arrows, Tab, Escape) are handled once
    // here for every option inside, as a listbox's are (DESIGN.md §3.9).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={root}
      className="pt-linkas nodrag nopan nowheel"
      role="group"
      aria-labelledby={`${id}-title ${id}-ends`}
      style={style}
      onKeyDown={onKeyDown}
    >
      <header className="pt-linkas__head">
        <span className="pt-linkas__title" id={`${id}-title`}>
          link as
        </span>
        <span className="pt-linkas__ends" id={`${id}-ends`}>
          {from} → {to}
        </span>
        <span className="pt-linkas__keys">
          1–7 · Esc {mode === 'new' ? '= plain link' : '= no change'}
        </span>
      </header>
      <div className="pt-linkas__grid" role="listbox" aria-labelledby={`${id}-title`}>
        {choices.map((c, i) => (
          <button
            key={c.kind}
            type="button"
            role="option"
            className="pt-linkas__opt"
            data-index={i}
            data-stop
            data-kind={c.kind}
            aria-label={c.label}
            aria-selected={i === active}
            aria-disabled={c.enabled ? undefined : true}
            aria-describedby={c.enabled ? undefined : `${id}-why`}
            aria-keyshortcuts={c.key}
            tabIndex={i === active ? 0 : -1}
            style={{ '--pt-linkas-wire': `var(--pt-wire-${c.design})` } as CSSProperties}
            onFocus={() => setActive(i)}
            onClick={() => choose(c)}
          >
            <ThreadSwatch kind={c.design} width={128} />
            <span className="pt-linkas__key" aria-hidden="true">
              {c.key}
            </span>
          </button>
        ))}
      </div>
      <p className="pt-linkas__why" id={`${id}-why`} hidden={current?.enabled !== false}>
        {current?.why ?? choices.find((c) => !c.enabled)?.why}
      </p>
      {mode === 'new' ? (
        <div className="pt-linkas__label">
          {labelling ? (
            <input
              className="pt-field"
              data-stop
              aria-label="Label on the thread (optional)"
              placeholder="Shows on the thread instead of the kind"
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          ) : (
            <button
              type="button"
              className="pt-linkas__add"
              data-stop
              tabIndex={-1}
              onClick={() => setLabelling(true)}
            >
              Add a label
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
