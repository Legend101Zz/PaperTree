'use client';

/**
 * board/components/tree/ExportSheet — Export Markdown (P4 step 10): the document as it will be
 * copied, with three include toggles (full answers, my notes, folded branches). Maths stays `$…$`,
 * a figure is a one-line note, and the Check-yourself block is never in it (`exportMarkdown`).
 * Copy writes it to the clipboard and says so; Escape closes the sheet first (the board's order).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { DEFAULT_INCLUDE, exportMarkdown, type ExportInclude } from '../../model/outline';

import type { BoardTree } from '../../model/tree';
import type { CanvasNode } from '@/lib/api/types';

/** Props for `ExportSheet`. */
export interface ExportSheetProps {
  readonly tree: BoardTree;
  readonly title: string;
  /** "Deep Residual Learning, p. 3" under a passage; undefined leaves the line out. */
  readonly sourceOf?: (passage: CanvasNode) => string | undefined;
  readonly onClose: () => void;
}

const TOGGLES: readonly { readonly key: keyof ExportInclude; readonly label: string }[] = [
  { key: 'full', label: 'Full answers' },
  { key: 'notes', label: 'My notes' },
  { key: 'folded', label: 'Folded branches' },
];

/** The export sheet. */
export function ExportSheet({ tree, title, sourceOf, onClose }: ExportSheetProps): ReactNode {
  const [include, setInclude] = useState<ExportInclude>(DEFAULT_INCLUDE);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const markdown = useMemo(
    () => exportMarkdown(tree, { title, include, ...(sourceOf === undefined ? {} : { sourceOf }) }),
    [tree, title, include, sourceOf],
  );
  useEffect(() => first.current?.focus(), []);

  const copy = (): void => {
    navigator.clipboard.writeText(markdown).then(
      () => setCopied('yes'),
      () => setCopied('no'),
    );
  };

  return (
    <div className="pt-xsheet" role="dialog" aria-label="Export Markdown" aria-modal="false">
      <div className="pt-xsheet__head">
        <h2 className="pt-xsheet__title">Export Markdown</h2>
        <button type="button" className="pt-btn pt-btn--outline" onClick={onClose}>
          Close
        </button>
      </div>
      <fieldset className="pt-xsheet__toggles">
        <legend className="pt-xsheet__legend">Include</legend>
        {TOGGLES.map((toggle, i) => (
          <label key={toggle.key} className="pt-xsheet__toggle">
            <input
              ref={i === 0 ? first : undefined}
              type="checkbox"
              checked={include[toggle.key]}
              onChange={(event) => setInclude({ ...include, [toggle.key]: event.target.checked })}
            />
            {toggle.label}
          </label>
        ))}
      </fieldset>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region must be reachable by keyboard */}
      <pre className="pt-xsheet__md" tabIndex={0} aria-label="The Markdown">
        {markdown}
      </pre>
      <div className="pt-xsheet__foot">
        <button type="button" className="pt-btn pt-btn--primary" onClick={copy}>
          Copy
        </button>
        <span role="status" className="pt-xsheet__said">
          {copied === 'yes'
            ? 'Copied.'
            : copied === 'no'
              ? 'Could not copy. Select the text and copy it.'
              : ''}
        </span>
      </div>
    </div>
  );
}
