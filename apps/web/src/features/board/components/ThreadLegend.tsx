'use client';

/**
 * board/components/ThreadLegend — the strip under the board (frame 06): THREADS, the seven kinds
 * drawn by the shared `ThreadSwatch` (colour, cue, glyph and name), and PINS, the four port pins,
 * with the one instruction a newcomer needs: "Drag from a brass pin to make a thread."
 *
 * On a phone the strip would cover a third of the board, so it starts folded behind a "Threads
 * and pins" summary there; on a wide screen (a phone turned sideways included) it is always open
 * and the summary is not drawn. It follows the screen as it turns.
 */
import { THREAD_KINDS, ThreadSwatch } from '@papertree/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { PIN_NAMES, type Port } from '../model/pins';

const PINS: readonly Port[] = ['evidence_in', 'question_in', 'claim_out', 'answer_out'];

/** A screen wide enough for the strip to stay open: the phone breakpoint, 640 px. */
const WIDE = '(min-width: 640px)';

/** True when the screen is wide (and on the server, where there is no screen to fold for). */
function wide(): boolean {
  return typeof window === 'undefined' || window.matchMedia(WIDE).matches;
}

/** The legend of threads and pins. */
export function ThreadLegend(): ReactNode {
  const [isWide, setWide] = useState(wide);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const follow = (): void => setWide(query.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  return (
    <section className="pt-legend" aria-label="Legend">
      <details
        className="pt-legend__fold"
        open={isWide || open}
        onToggle={(e) => {
          if (!isWide) setOpen(e.currentTarget.open);
        }}
      >
        <summary className="pt-legend__summary">Threads and pins</summary>
        <div className="pt-legend__row">
          <h2 className="pt-legend__head">threads</h2>
          <ul className="pt-legend__list">
            {THREAD_KINDS.map((info) => (
              <li key={info.kind}>
                <ThreadSwatch kind={info.kind} width={34} className="pt-legend__swatch" />
              </li>
            ))}
          </ul>
        </div>
        <div className="pt-legend__row">
          <h2 className="pt-legend__head">pins</h2>
          <ul className="pt-legend__list">
            {PINS.map((port) => (
              <li key={port} className="pt-legend__pin">
                <span className={`pt-pin pt-pin--${port}`} aria-hidden="true" />
                {PIN_NAMES[port]}
              </li>
            ))}
          </ul>
          <p className="pt-legend__hint">Drag from a brass pin to make a thread.</p>
        </div>
      </details>
    </section>
  );
}
