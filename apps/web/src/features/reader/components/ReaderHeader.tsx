'use client';

/**
 * The reader's header (frame 04's top bar, #203): Library, Contents, the paper's title in Caslon with
 * "p. 2 of 15", the Source · Guided · Split switch, zoom, Board and the Explain toggle. It holds no
 * state: the workspace owns the mode, zoom, page and panels, and this bar reports presses.
 */
import { ToolbarButton } from '@papertree/ui';
import { AlignLeft, ArrowLeft, Workflow } from 'lucide-react';

import { ModeSwitch, type ReadingMode } from '@/components/reader/ModeSwitch';
import { ZoomControl, type ZoomMode } from '@/components/reader/ZoomControl';

import { pageCounterLabel } from '../model/pageCounter';

import type { ReactNode, RefObject } from 'react';

/** The Explain toggle's state; absent for a sample paper, which has no server to ask. */
export interface ExplainToggle {
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  /** The panel hands focus back here when it closes. */
  readonly ref: RefObject<HTMLButtonElement>;
}

/** Props for `ReaderHeader`. */
export interface ReaderHeaderProps {
  readonly title: string;
  /** 0-based page at the top of the view, or null before the reader has shown one. */
  readonly page: number | null;
  /** The paper's page count, or null while the PDF is opening. */
  readonly pageCount: number | null;
  readonly mode: ReadingMode;
  readonly onModeChange: (mode: ReadingMode) => void;
  /** Guided and Split need the parse. */
  readonly guidedAvailable: boolean;
  readonly zoom: number;
  readonly zoomMode: ZoomMode;
  readonly onZoomChange: (mode: ZoomMode) => void;
  readonly navigatorOpen: boolean;
  readonly navigatorAvailable: boolean;
  readonly onNavigatorToggle: () => void;
  readonly highlightCount: number;
  /** The paper's board, or null for a sample paper. */
  readonly boardHref: string | null;
  readonly explain: ExplainToggle | null;
}

const ICON = 18;

/** "Contents", and "Contents, 2 highlights" when there are some (the visible label comes first). */
function contentsName(count: number): string {
  if (count === 0) return 'Contents';
  return `Contents, ${String(count)} ${count === 1 ? 'highlight' : 'highlights'}`;
}

/**
 * The reader's one bar. Below 640 px it takes two rows (the mode switch and zoom on the second);
 * from 768 px it is one 56 px row, and the explain drawer opens under it.
 *
 * @param props - What to show and where presses go; see `ReaderHeaderProps`.
 * @returns The `<header>`.
 */
export function ReaderHeader(props: ReaderHeaderProps): ReactNode {
  const counter = pageCounterLabel(props.page, props.pageCount);
  return (
    <header className="pt-reader__bar">
      {/* A link, not a button: it leaves the reader. The sprout stays on the library's own bar. */}
      <a className="pt-toolbtn pt-reader__back" href="/dashboard" style={{ minHeight: 40 }}>
        <span className="pt-toolbtn__icon" aria-hidden="true">
          <ArrowLeft size={ICON} strokeWidth={1.5} />
        </span>
        <span className="pt-toolbtn__label">Library</span>
      </a>
      {/* A plain toolbar-styled button rather than `ToolbarButton`: its name carries the highlight
          count, and it says whether the panel it opens is expanded (WCAG 2.5.3: the name starts
          with the visible "Contents"). */}
      <button
        type="button"
        className="pt-toolbtn pt-reader__contents"
        style={{ minHeight: 40 }}
        aria-label={contentsName(props.highlightCount)}
        aria-expanded={props.navigatorOpen}
        aria-pressed={props.navigatorOpen}
        aria-disabled={props.navigatorAvailable ? undefined : true}
        title={
          props.navigatorAvailable
            ? 'Outline, pages and highlights'
            : 'Available when the paper has been read'
        }
        onClick={props.navigatorAvailable ? props.onNavigatorToggle : undefined}
      >
        <span className="pt-toolbtn__icon" aria-hidden="true">
          <AlignLeft size={ICON} strokeWidth={1.5} />
        </span>
        <span className="pt-toolbtn__label">Contents</span>
        {props.highlightCount > 0 ? (
          <span className="pt-reader__count pt-num" aria-hidden="true">
            {props.highlightCount}
          </span>
        ) : null}
      </button>
      <span className="pt-reader__rule" aria-hidden="true" />
      <h1 className="pt-reader__title" title={props.title}>
        {props.title}
      </h1>
      {counter === null ? null : <span className="pt-reader__page">{counter}</span>}
      <div className="pt-reader__controls">
        <ModeSwitch
          mode={props.mode}
          onModeChange={props.onModeChange}
          guidedAvailable={props.guidedAvailable}
          unavailableReason="Guided and Split open when the paper has been read."
        />
        {props.mode === 'guided' ? null : (
          <ZoomControl mode={props.zoomMode} zoom={props.zoom} onModeChange={props.onZoomChange} />
        )}
        {props.boardHref === null ? null : (
          <a
            className="pt-toolbtn pt-reader__board"
            href={props.boardHref}
            style={{ minHeight: 40 }}
          >
            <span className="pt-toolbtn__icon" aria-hidden="true">
              <Workflow size={ICON} strokeWidth={1.5} />
            </span>
            <span className="pt-toolbtn__label">Board</span>
          </a>
        )}
        {props.explain === null ? null : (
          <ToolbarButton
            ref={props.explain.ref}
            label="Explain"
            icon={null}
            className="pt-reader__explain"
            pressed={props.explain.open}
            onPressedChange={props.explain.onToggle}
          />
        )}
      </div>
    </header>
  );
}
