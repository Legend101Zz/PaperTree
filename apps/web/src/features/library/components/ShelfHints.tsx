/**
 * ShelfHints: the row under the plank (#195, frame 01). Without a search it teaches the keys
 * ("← → along the shelf · Enter take it out · Space its card · Esc put it back", dismissed
 * with Got it, per browser) and notes that PDFs drop anywhere; with one it says what matched and what Enter and
 * Esc do now.
 */
'use client';

import { Upload } from 'lucide-react';
import { useEffect, useState } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { useTouchTargets } from '../hooks/useTouchTargets';

import type { ReactNode } from 'react';

const HINTS_KEY = 'papertree/library/shelf-hints';

/** Props for `ShelfHints`. */
export interface ShelfHintsProps {
  /** The query, or '' when no search is active. */
  readonly query: string;
  /** How many papers the query matched. */
  readonly matched: number;
  readonly total: number;
  /** Got it hides the key hints; focus goes here instead of falling to the page. */
  readonly onKeysHidden?: () => void;
}

/**
 * The hint row.
 *
 * @example
 * <ShelfHints query="atten" matched={2} total={24} />
 */
export function ShelfHints({ query, matched, total, onKeysHidden }: ShelfHintsProps): ReactNode {
  const touch = useTouchTargets();
  // Shown until "Got it"; read after mount, because the server cannot see localStorage.
  const [keysHidden, setKeysHidden] = useState(false);
  useEffect(() => {
    try {
      setKeysHidden(window.localStorage.getItem(HINTS_KEY) === 'hidden');
    } catch {
      // A private window: the hints just show.
    }
  }, []);

  if (query.trim() !== '') {
    return (
      <div className="pt-hints">
        <span>
          {matched} of {total} match “{query.trim()}”
        </span>
        <span className="pt-hints__key">
          <kbd className="pt-kbd">Enter</kbd> take down the first
        </span>
        <span className="pt-hints__key">
          <kbd className="pt-kbd">Esc</kbd> clear
        </span>
      </div>
    );
  }
  return (
    <div className="pt-hints">
      {keysHidden ? null : (
        <>
          <span className="pt-hints__key">
            <kbd className="pt-kbd">←</kbd>
            <kbd className="pt-kbd">→</kbd> along the shelf
          </span>
          <span className="pt-hints__key">
            <kbd className="pt-kbd">Enter</kbd> take it out
          </span>
          <span className="pt-hints__key">
            <kbd className="pt-kbd">Space</kbd> its card
          </span>
          <span className="pt-hints__key">
            <kbd className="pt-kbd">Esc</kbd> put it back
          </span>
          <button
            type="button"
            className={`pt-hints__gotit${touch ? ` ${TOUCH_TARGET}` : ''}`}
            onClick={() => {
              setKeysHidden(true);
              onKeysHidden?.();
              try {
                window.localStorage.setItem(HINTS_KEY, 'hidden');
              } catch {
                // Not remembered in a private window; hidden for this visit.
              }
            }}
          >
            Got it
          </button>
        </>
      )}
      <span className="pt-hints__note">
        <Upload size={18} strokeWidth={1.5} aria-hidden="true" />
        Drop PDFs anywhere to add them
      </span>
    </div>
  );
}
