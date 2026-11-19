'use client';

/**
 * The level switch on an answer (v0.3 answer format §2, prototype "level" row): New to this ·
 * Familiar · Expert, the current one pressed. Plain toggle buttons rather than a radio group: an
 * arrow key must never fire a request on its way past a level. Picking a level the answer already
 * has costs nothing (the exchange holds it); picking a new one asks the same question again at
 * that level.
 */
import { LEVELS, type AnswerLevel } from '../model/levels';

import './answer.css';

import type { ReactNode } from 'react';

/** Props for `LevelSwitch`. */
export interface LevelSwitchProps {
  readonly level: AnswerLevel;
  readonly onChange: (level: AnswerLevel) => void;
  /** An answer is being written: the switch waits (a second stream would race the first). */
  readonly disabled?: boolean;
  /** The phone sheet: 44 px targets. */
  readonly touch?: boolean;
}

/** The three-level switch. */
export function LevelSwitch({
  level,
  onChange,
  disabled = false,
  touch = false,
}: LevelSwitchProps): ReactNode {
  return (
    <div className={`pt-level${touch ? ' pt-level--touch' : ''}`} data-level-switch>
      <span className="pt-level__name" aria-hidden="true">
        level
      </span>
      <div role="group" aria-label="Explain at this level" className="pt-level__group">
        {LEVELS.map((option) => (
          <button
            key={option.level}
            type="button"
            className="pt-level__option"
            aria-pressed={option.level === level}
            disabled={disabled && option.level !== level}
            onClick={() => {
              if (option.level !== level) onChange(option.level);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
