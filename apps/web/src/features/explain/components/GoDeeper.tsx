'use client';

/**
 * Go deeper (v0.3 answer format §3, prototype `xsec`): Simpler · An example · Show the math · Why it
 * matters · Where else in the paper. Simpler re-levels the answer to New to this; each other chip is
 * a normal follow-up with a fixed question (no new API) and a quick ask: the panel skips the long
 * thinking pause for it (#349).
 */
import { DEEPER_CHIPS, type AnswerLevel } from '../model/levels';

import './answer.css';

import type { ReactNode } from 'react';

/** Props for `GoDeeper`. */
export interface GoDeeperProps {
  /** The level of the answer shown: Simpler has nowhere to go from New to this. */
  readonly level: AnswerLevel;
  /** Simpler. */
  readonly onRelevel: (level: AnswerLevel) => void;
  /** A fixed follow-up question. */
  readonly onAsk: (question: string) => void;
  /** An answer is being written. */
  readonly disabled?: boolean;
  /** The phone sheet: 44 px targets. */
  readonly touch?: boolean;
}

/** The go-deeper chips. */
export function GoDeeper({
  level,
  onRelevel,
  onAsk,
  disabled = false,
  touch = false,
}: GoDeeperProps): ReactNode {
  return (
    <div className={`pt-deeper${touch ? ' pt-deeper--touch' : ''}`} data-go-deeper>
      <span className="pt-ai-label">go deeper</span>
      <div className="pt-deeper__chips">
        {DEEPER_CHIPS.map((chip) => {
          const spent = 'relevel' in chip && level === chip.relevel;
          return (
            <button
              key={chip.id}
              type="button"
              className="pt-deeper__chip"
              data-chip={chip.id}
              disabled={disabled}
              aria-disabled={spent ? true : undefined}
              title={spent ? 'Already the simplest level' : undefined}
              onClick={() => {
                if (spent) return;
                if ('relevel' in chip) onRelevel(chip.relevel);
                else onAsk(chip.question);
              }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
