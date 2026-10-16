/**
 * AccessionSlip: the empty library (#196, frame 01b). An empty walnut plank between its bookends
 * with an accession slip standing on it: "Drop PDFs here or choose files", what happens next, and
 * that the whole page takes PDFs. "choose files" opens the header's file picker and a drop lands
 * in the page's drop-anywhere target, so the slip adds no second upload path.
 */
'use client';

import { SproutMark } from '@papertree/ui';
import { Upload } from 'lucide-react';
import { useId } from 'react';

import { ShelfPlank } from './ShelfPlank';

import type { ReactNode } from 'react';

/** Props for `AccessionSlip`. */
export interface AccessionSlipProps {
  /** Opens the file picker (the header's Add papers input). */
  readonly onChooseFiles: () => void;
}

/**
 * The empty shelf and its slip.
 *
 * @example
 * <AccessionSlip onChooseFiles={chooseFiles} />
 */
export function AccessionSlip({ onChooseFiles }: AccessionSlipProps): ReactNode {
  const headingId = useId();
  return (
    <div className="pt-emptyshelf" data-state="empty-library">
      <ShelfPlank>
        <div className="pt-emptyshelf__slot">
          <section className="pt-slip" aria-labelledby={headingId}>
            <div className="pt-slip__head">
              <span className="pt-slip__name">
                <SproutMark size={24} />
                Accession slip
              </span>
              {/* The first paper you add is the library's first accession. */}
              <span className="pt-slip__number">No. 001</span>
            </div>
            <h2 id={headingId} className="pt-slip__call">
              Drop PDFs here or{' '}
              <button type="button" className="pt-slip__choose" onClick={onChooseFiles}>
                choose files
              </button>
            </h2>
            <p className="pt-slip__note">
              Each paper opens in Source mode straight away. Guided, Explain and the board follow
              when reading finishes.
            </p>
            <p className="pt-slip__foot">
              <Upload size={18} strokeWidth={1.5} aria-hidden="true" />
              The whole page takes PDFs: drop them anywhere.
            </p>
          </section>
        </div>
      </ShelfPlank>
    </div>
  );
}
