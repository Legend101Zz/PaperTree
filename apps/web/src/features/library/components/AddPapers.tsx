/**
 * AddPapers and DropAnywhere: the two ways papers come in (#195). The header's Add papers button
 * opens the file picker; a PDF dropped anywhere on the page lands in the same upload queue, under
 * a quiet full-window overlay while it is dragged.
 */
'use client';

import { Button } from '@papertree/ui';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { useTouchTargets } from '../hooks/useTouchTargets';

import type { ReactNode } from 'react';

/** Props for `AddPapers`. */
export interface AddPapersProps {
  /** The chosen files, in the order the picker gave them. */
  readonly onFiles: (files: readonly File[]) => void;
}

/**
 * The Add papers button and its file input. The input is not a second control: the button is the
 * one way in, and `data-add-papers` lets the empty library (and tests) reach the same picker.
 *
 * @example
 * <AddPapers onFiles={queue.enqueue} />
 */
export function AddPapers({ onFiles }: AddPapersProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const touch = useTouchTargets();
  return (
    <span className="pt-addpapers" data-add-papers="">
      <Button
        leadingIcon={<Plus size={20} strokeWidth={1.5} />}
        size={touch ? 'touch' : 'md'}
        className={touch ? TOUCH_TARGET : undefined}
        onClick={() => input.current?.click()}
        aria-label="Add papers"
      >
        <span className="pt-addpapers__label">Add papers</span>
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="pt-sr-only"
        onChange={(event) => {
          const { files } = event.target;
          if (files !== null) onFiles(Array.from(files));
          // Reset, so choosing the same file again fires `change` again.
          event.target.value = '';
        }}
      />
    </span>
  );
}

/** Only a drag that carries files is ours; dragging text or a spine image must not light the page. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Props for `DropAnywhere`. */
export interface DropAnywhereProps {
  readonly onFiles: (files: readonly File[]) => void;
}

/**
 * A window-wide drop target. Counts enter/leave pairs, because every child element the drag
 * crosses fires its own pair and a bare boolean would flicker.
 *
 * @example
 * <DropAnywhere onFiles={queue.enqueue} />
 */
export function DropAnywhere({ onFiles }: DropAnywhereProps): ReactNode {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const enter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      setActive(true);
    };
    const over = (event: DragEvent): void => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const leave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const drop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setActive(false);
      onFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    const pairs = [
      ['dragenter', enter],
      ['dragover', over],
      ['dragleave', leave],
      ['drop', drop],
    ] as const;
    for (const [type, handler] of pairs) window.addEventListener(type, handler);
    return () => {
      for (const [type, handler] of pairs) window.removeEventListener(type, handler);
    };
  }, [onFiles]);
  if (!active) return null;
  return (
    <div className="pt-dropall" data-drop-anywhere="" aria-hidden="true">
      <p className="pt-dropall__note">Drop PDFs to add them to your library</p>
    </div>
  );
}
