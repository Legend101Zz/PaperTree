'use client';

/**
 * The reader's header (frame 04's top bar, #203): Library, Contents, the paper's title in Caslon with
 * "p. 2 of 15", the Source · Guided · Split switch, zoom, Board and the Explain toggle. Below 768 px
 * (frame 08b, #205) it is one row: back, the title, "p. 2", Explain and a menu holding the rest. It
 * holds no state: the workspace owns the mode, zoom, page and panels, and this bar reports presses.
 */
import { ToolbarButton } from '@papertree/ui';
import { AlignLeft, ArrowLeft, Workflow } from 'lucide-react';

import { ModeSwitch, type ReadingMode } from '@/components/reader/ModeSwitch';
import { ZoomControl, type ZoomMode } from '@/components/reader/ZoomControl';

import { usePhone } from '../hooks/usePhone';
import { PageCounter } from './PageCounter';
import { ReaderMenu } from './ReaderMenu';

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
  /** Guided's top page, or the saved one (0-based); Source and Split show the most visible page. */
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

/** Contents: a plain toolbar-styled button rather than `ToolbarButton`: its name carries the
 * highlight count, and it says whether its panel is expanded (WCAG 2.5.3: the name starts with the
 * visible "Contents"). */
function ContentsButton({ props, onPress }: { props: ReaderHeaderProps; onPress?: () => void }) {
  return (
    <button
      type="button"
      className="pt-toolbtn pt-reader__contents"
      aria-label={contentsName(props.highlightCount)}
      aria-expanded={props.navigatorOpen}
      aria-pressed={props.navigatorOpen}
      aria-disabled={props.navigatorAvailable ? undefined : true}
      title={
        props.navigatorAvailable
          ? 'Outline, pages and highlights'
          : 'Available when the paper has been read'
      }
      onClick={
        props.navigatorAvailable
          ? () => {
              props.onNavigatorToggle();
              onPress?.();
            }
          : undefined
      }
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
  );
}

/** The reading mode, zoom (not in Guided) and Board: the bar's right side, or the phone menu's. */
function ReadingControls({ props, onLeave }: { props: ReaderHeaderProps; onLeave?: () => void }) {
  return (
    <>
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
        <a className="pt-toolbtn pt-reader__board" href={props.boardHref} onClick={onLeave}>
          <span className="pt-toolbtn__icon" aria-hidden="true">
            <Workflow size={ICON} strokeWidth={1.5} />
          </span>
          <span className="pt-toolbtn__label">Board</span>
        </a>
      )}
    </>
  );
}

function ExplainButton({ explain }: { explain: ExplainToggle | null }): ReactNode {
  return explain === null ? null : (
    <ToolbarButton
      ref={explain.ref}
      label="Explain"
      icon={null}
      className="pt-reader__explain"
      pressed={explain.open}
      onPressedChange={explain.onToggle}
    />
  );
}

/** A link, not a button: it leaves the reader. The sprout stays on the library's own bar. */
function BackLink(): ReactNode {
  return (
    <a className="pt-toolbtn pt-reader__back" href="/dashboard">
      <span className="pt-toolbtn__icon" aria-hidden="true">
        <ArrowLeft size={ICON} strokeWidth={1.5} />
      </span>
      <span className="pt-toolbtn__label">Library</span>
    </a>
  );
}

/**
 * The reader's one bar: a 56 px row from 768 px, under which the explain drawer opens; below it
 * the phone row of frame 08b with the reading controls in `ReaderMenu`.
 *
 * @param props - What to show and where presses go; see `ReaderHeaderProps`.
 * @returns The `<header>`.
 */
export function ReaderHeader(props: ReaderHeaderProps): ReactNode {
  const phone = usePhone();
  const title = (
    <h1 className="pt-reader__title" title={props.title}>
      {props.title}
    </h1>
  );
  if (phone) {
    return (
      <header className="pt-reader__bar pt-reader__bar--phone">
        <BackLink />
        {title}
        {/* "p. 2": the count does not fit a phone row (frame 08b). */}
        <PageCounter mode={props.mode} page={props.page} pageCount={null} />
        <ExplainButton explain={props.explain} />
        <ReaderMenu>
          {(close) => (
            <>
              <ContentsButton props={props} onPress={close} />
              <ReadingControls props={props} onLeave={close} />
            </>
          )}
        </ReaderMenu>
      </header>
    );
  }
  return (
    <header className="pt-reader__bar">
      <BackLink />
      <ContentsButton props={props} />
      <span className="pt-reader__rule" aria-hidden="true" />
      {title}
      <PageCounter mode={props.mode} page={props.page} pageCount={props.pageCount} />
      <div className="pt-reader__controls">
        <ReadingControls props={props} />
        <ExplainButton explain={props.explain} />
      </div>
    </header>
  );
}
