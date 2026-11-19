'use client';

/**
 * The reader's header (frame 04's top bar, #203): Library, Contents, the paper's title in Caslon with
 * "p. 2 of 15", the Source · Guided · Split switch, zoom, Board and the Explain toggle. Below 768 px
 * (frame 08b, #205) it is one row: back, the title, "p. 2", Explain and a menu holding the rest. It
 * holds no state of the reading itself: the workspace owns the mode, zoom, page and panels, and this bar reports presses.
 */
import { ToolbarButton } from '@papertree/ui';
import { AlignLeft, ArrowLeft, Workflow } from 'lucide-react';
import { useRef, type ReactNode, type RefObject } from 'react';

import { ModeSwitch, type ReadingMode } from '@/components/reader/ModeSwitch';
import { ZoomControl, type ZoomMode } from '@/components/reader/ZoomControl';
import { usePage, type PageState } from '@/features/settings';

import { useMenuContentsFocus } from '../hooks/useMenuContentsFocus';
import { usePhone } from '../hooks/usePhone';
import { PageCounter } from './PageCounter';
import { ReaderMenu } from './ReaderMenu';
import { ReadingSettings } from './ReadingSettings';

/** The Explain toggle's state; absent for a sample paper, which has no server to ask. */
export interface ExplainToggle {
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  /** The panel hands focus back here when it closes. */
  readonly ref: RefObject<HTMLButtonElement>;
}

/** The Board beside toggle's state. */
export interface BoardBesideToggle {
  readonly open: boolean;
  readonly onToggle: () => void;
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
  /**
   * Board beside (key B): the board in a pane next to the paper (#344). Absent where the window has
   * no room for two panes or the paper has no board; the bar then keeps its plain Board link.
   */
  readonly boardBeside?: BoardBesideToggle | null;
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
function ReadingControls({
  props,
  onLeave,
  phone = false,
}: {
  props: ReaderHeaderProps;
  onLeave?: () => void;
  phone?: boolean;
}) {
  const beside = phone ? null : (props.boardBeside ?? null);
  return (
    <>
      <ModeSwitch
        mode={props.mode}
        onModeChange={props.onModeChange}
        guidedAvailable={props.guidedAvailable}
        unavailableReason="Guided and Split open when the paper has been read."
        hideSplit={beside?.open === true}
      />
      {props.mode === 'guided' ? null : (
        <ZoomControl mode={props.zoomMode} zoom={props.zoom} onModeChange={props.onZoomChange} />
      )}
      {beside !== null ? (
        <button
          type="button"
          className="pt-toolbtn pt-reader__board"
          aria-pressed={beside.open}
          aria-keyshortcuts="B"
          title="Board beside: the board next to the paper (B)"
          onClick={beside.onToggle}
        >
          <span className="pt-toolbtn__icon" aria-hidden="true">
            <Workflow size={ICON} strokeWidth={1.5} />
          </span>
          <span className="pt-toolbtn__label">Board beside</span>
          <kbd className="pt-reader__key" aria-hidden="true">
            B
          </kbd>
        </button>
      ) : props.boardHref === null ? null : (
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

/** The Explain toggle, the panel's only entry (#203); 44 px tall on the phone row (#205). */
function ExplainButton({
  explain,
  touch = false,
}: {
  explain: ExplainToggle | null;
  touch?: boolean;
}): ReactNode {
  return explain === null ? null : (
    <ToolbarButton
      ref={explain.ref}
      label="Explain"
      icon={null}
      size={touch ? 'touch' : 'md'}
      className="pt-reader__explain"
      pressed={explain.open}
      onPressedChange={explain.onToggle}
    />
  );
}

/** The phone row (frame 08b): back, the title, "p. 2", Explain and the menu with the rest. */
function PhoneHeader({
  props,
  title,
  page,
}: {
  props: ReaderHeaderProps;
  title: ReactNode;
  page: PageState;
}) {
  const menuButton = useRef<HTMLButtonElement>(null);
  const fromMenu = useMenuContentsFocus(props.navigatorOpen, menuButton);
  return (
    <header className="pt-reader__bar pt-reader__bar--phone">
      <BackLink />
      {title}
      {/* "p. 2": the count does not fit a phone row (frame 08b). */}
      <PageCounter mode={props.mode} page={props.page} pageCount={null} />
      <ExplainButton explain={props.explain} touch />
      <ReaderMenu buttonRef={menuButton}>
        {(close) => (
          <>
            <ContentsButton
              props={props}
              onPress={() => {
                fromMenu();
                close();
              }}
            />
            <ReadingControls props={props} onLeave={close} phone />
            <ReadingSettings page={page} inline />
          </>
        )}
      </ReaderMenu>
    </header>
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
  // Mounted here, not in the menu: the phone's menu unmounts when closed, and the page colour must
  // be kept applied (and follow the room) whether or not anyone has Aa open.
  const page = usePage();
  const title = (
    <h1 className="pt-reader__title" title={props.title}>
      {props.title}
    </h1>
  );
  if (phone) return <PhoneHeader props={props} title={title} page={page} />;
  return (
    <header className="pt-reader__bar">
      <BackLink />
      <ContentsButton props={props} />
      <span className="pt-reader__rule" aria-hidden="true" />
      {title}
      <PageCounter mode={props.mode} page={props.page} pageCount={props.pageCount} />
      <div className="pt-reader__controls">
        <ReadingControls props={props} />
        <ReadingSettings page={page} />
        <ExplainButton explain={props.explain} />
      </div>
    </header>
  );
}
