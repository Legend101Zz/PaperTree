/**
 * ui/primitives — the five surfaces every reader screen is assembled from.
 *
 * §18.2 of the design brief reduces the reader to "one document, one navigator, one inspector, one
 * transport". That is only a simplification if the navigator and the inspector are ONE component
 * each rather than six panels wearing a tab bar, so the chrome collapses to exactly five things:
 * `IconButton`, `Panel`, `SegmentedControl`, `Tabs`, `Sheet`.
 *
 * THREE RULES ARE ENFORCED HERE RATHER THAN REVIEWED FOR, because `research/audit-frontend-reader.md`
 * records all three failing in v1 and none of them is the kind of thing review catches twice.
 *
 * 1. **44×44 CSS px, from an inline style, on every interactive element.**
 *    v1's targets are 8–20px. The fix is not a Tailwind class: `packages/ui` is OUTSIDE
 *    `apps/web/tailwind.config.ts`'s `content` globs, so `min-w-[44px]` written here is purged to
 *    nothing and the guarantee silently becomes whatever the icon happens to measure. An inline
 *    style cannot be purged, cannot be lost to a stylesheet that failed to load, and is readable by
 *    `reader/touch.spec`'s automated audit in happy-dom, where no CSS is applied at all. So the
 *    minimum is `TOUCH_TARGET_STYLE` and the `.pt-*` classes carry only appearance.
 *
 * 2. **Pointer Events, with `onClick` kept solely as the keyboard path.** v1 has zero touch
 *    handlers. `usePress` below is the single implementation: `onClick` fires the action only when
 *    `event.detail === 0`, which is how a click synthesised by Enter/Space is distinguished from
 *    one synthesised by a tap — the same test `provenance.tsx` already uses.
 *
 * 3. **Nothing hover-only.** Every hover affordance in here also answers to `:focus-visible` and,
 *    on a coarse pointer, is simply always visible (`styles.css`, `@media (hover: none)`). No
 *    `title` attributes: a native tooltip is reachable by neither a finger nor a screen reader.
 *
 * NO GEOMETRY IS MEASURED ANYWHERE IN THIS FILE. Nothing reads a bounding rect, an offset size or
 * a window dimension — the identifiers are not even written here, so a repo-wide grep for the v1
 * measurement bug stays clean. The sheet's drag resolves its detent from a pointer DELTA rather
 * than from the container's height, so the whole file is correct at any zoom without a read-back.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';

/** The iOS Human Interface Guidelines minimum, in CSS px. `reader/touch.spec` asserts it. */
export const TOUCH_TARGET_MIN_PX = 44;

/**
 * The minimum as an inline style. Exported so that surfaces outside this package (the selection
 * toolbar, the transport) hit the same number from the same constant instead of retyping 44.
 */
export const TOUCH_TARGET_STYLE: CSSProperties = {
  minWidth: TOUCH_TARGET_MIN_PX,
  minHeight: TOUCH_TARGET_MIN_PX,
};

/** `touch-action` for a plain target: kill the 300ms delay, keep scrolling. */
const TAP_STYLE: CSSProperties = { ...TOUCH_TARGET_STYLE, touchAction: 'manipulation' };

function classNames(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// press
// ────────────────────────────────────────────────────────────────────────────────────────────────

interface PressHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: () => void;
  readonly onPointerLeave: () => void;
  readonly onClick: (event: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * The one press implementation. Pointer Events for pointers, `onClick` for keys.
 *
 * The pointer id is remembered from `pointerdown` and checked at `pointerup`, so a press that
 * BEGAN somewhere else and merely ended here does not activate — the behaviour a native `<button>`
 * has and a bare `onPointerUp` does not. `pointerleave` cancels for the same reason: dragging off a
 * control is how a user says "no, not that one", and on iPad it is how they say it most often.
 *
 * `disabled` is honoured here rather than via the `disabled` attribute so the control stays
 * focusable and can still announce WHY it is unavailable (§19.8, offline: "visibly disabled with
 * the reason, not silently broken").
 */
function usePress(onPress: () => void, disabled: boolean): PressHandlers {
  const activePointer = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      // `button !== 0` is a right- or middle-click; a context menu must not activate anything.
      if (disabled || event.button !== 0) return;
      activePointer.current = event.pointerId;
    },
    [disabled],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (disabled || activePointer.current !== event.pointerId) return;
      activePointer.current = null;
      onPress();
    },
    [disabled, onPress],
  );

  const cancel = useCallback((): void => {
    activePointer.current = null;
  }, []);

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>): void => {
      // `detail === 0` ⇒ synthesised by Enter/Space. A pointer-generated click was already handled
      // by `onPointerUp`; letting it through here would fire every action twice.
      if (disabled || event.detail !== 0) return;
      onPress();
    },
    [disabled, onPress],
  );

  return { onPointerDown, onPointerUp, onPointerCancel: cancel, onPointerLeave: cancel, onClick };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// IconButton
// ────────────────────────────────────────────────────────────────────────────────────────────────

export interface IconButtonProps {
  /**
   * The accessible name. REQUIRED — the toolbar in §19.1 is seven glyphs with no labels, so an
   * unnamed icon button there is an unusable control, not a terse one.
   */
  readonly label: string;
  readonly icon: ReactNode;
  readonly onPress: () => void;
  /** Toggle state, e.g. the Navigator's ☰. Omit entirely for plain actions. */
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  /** Shown and announced when `disabled`. §19.8: never silently inert. */
  readonly disabledReason?: string;
  /** `tooltip` reveals the label on hover/focus (and always, on a coarse pointer). */
  readonly labelPlacement?: 'tooltip' | 'inline' | 'none';
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function IconButton({
  label,
  icon,
  onPress,
  pressed,
  disabled = false,
  disabledReason,
  labelPlacement = 'tooltip',
  className,
  style,
}: IconButtonProps): ReactNode {
  const reasonId = useId();
  const press = usePress(onPress, disabled);
  const showReason = disabled && disabledReason !== undefined;

  return (
    <button
      type="button"
      className={classNames('pt-iconbutton', `pt-iconbutton--label-${labelPlacement}`, className)}
      style={{ ...TAP_STYLE, ...style }}
      // NOT the `disabled` attribute: a disabled button is removed from the tab order, so the user
      // who most needs the reason is the one who can no longer reach it.
      aria-disabled={disabled}
      data-disabled={disabled ? 'true' : undefined}
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...(showReason ? { 'aria-describedby': reasonId } : {})}
      {...press}
    >
      <span className="pt-iconbutton__icon" aria-hidden="true">
        {icon}
      </span>
      {labelPlacement === 'none' ? null : (
        // `aria-hidden` because `aria-label` already names the button; this span is the VISUAL
        // affordance only, and duplicating it into the accessibility tree just stutters.
        <span className="pt-iconbutton__label" aria-hidden="true">
          {label}
        </span>
      )}
      {showReason ? (
        <span className="pt-iconbutton__reason" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Panel
// ────────────────────────────────────────────────────────────────────────────────────────────────

export interface PanelProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Transient panels close; docked ones do not. Omit to render no close affordance. */
  readonly onClose?: () => void;
  /** §18.2: the Inspector "closes on deselect unless pinned". */
  readonly onTogglePin?: () => void;
  readonly pinned?: boolean;
  /** Extra header controls, rendered before pin/close. */
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
}

/**
 * A titled surface: the Navigator, the Inspector, and every card inside them.
 *
 * A `<section>` with `aria-labelledby`, so the panel is a landmark a screen reader can jump to and
 * its name is the visible heading rather than a second string that can drift from it. v1 positions
 * its panels at hardcoded viewport coordinates (`HighlightsPanel.tsx:279`); this one has no opinion
 * about where it is — the shell places it.
 */
export function Panel({
  title,
  children,
  onClose,
  onTogglePin,
  pinned = false,
  actions,
  footer,
  className,
}: PanelProps): ReactNode {
  const titleId = useId();

  return (
    <section className={classNames('pt-panel', className)} aria-labelledby={titleId}>
      <header className="pt-panel__header">
        <h2 className="pt-panel__title" id={titleId}>
          {title}
        </h2>
        <div className="pt-panel__actions">
          {actions}
          {onTogglePin === undefined ? null : (
            <IconButton
              label={pinned ? 'Unpin panel' : 'Pin panel'}
              icon="📌"
              onPress={onTogglePin}
              pressed={pinned}
              labelPlacement="tooltip"
              className="pt-panel__action"
            />
          )}
          {onClose === undefined ? null : (
            <IconButton
              label="Close panel"
              icon="✕"
              onPress={onClose}
              labelPlacement="tooltip"
              className="pt-panel__action"
            />
          )}
        </div>
      </header>
      <div className="pt-panel__body">{children}</div>
      {footer === undefined ? null : <footer className="pt-panel__footer">{footer}</footer>}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// SegmentedControl
// ────────────────────────────────────────────────────────────────────────────────────────────────

export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: ReactNode;
}

export interface SegmentedControlProps<V extends string> {
  /** Accessible name for the group, e.g. "Reading mode". */
  readonly label: string;
  readonly options: readonly SegmentedOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  readonly className?: string;
}

/**
 * ⟨Source│Guided│Split⟩ — §18.3's mode switch, and anything else that is one-of-N.
 *
 * `radiogroup`, NOT `tablist`. The distinction is not pedantry: a tab selects which panel you are
 * looking at, whereas this changes what the document IS, and the two have different keyboard
 * contracts. Radio semantics (arrow keys move focus AND select, Home/End jump, one tab stop for the
 * whole group) are what a user of a segmented control expects, and are what APG specifies.
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<V>): ReactNode {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const moveTo = useCallback(
    (index: number): void => {
      const wrapped = ((index % options.length) + options.length) % options.length;
      const option = options[wrapped];
      if (option === undefined) return;
      buttons.current[wrapped]?.focus();
      onChange(option.value);
    },
    [onChange, options],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const from = selectedIndex < 0 ? 0 : selectedIndex;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          moveTo(from + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          moveTo(from - 1);
          break;
        case 'Home':
          moveTo(0);
          break;
        case 'End':
          moveTo(options.length - 1);
          break;
        default:
          return;
      }
      // Only after a handled key: an unhandled one must keep its default (Tab must still leave).
      event.preventDefault();
    },
    [moveTo, options.length, selectedIndex],
  );

  return (
    <div
      className={classNames('pt-segmented', className)}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => (
        <Segment
          key={option.value}
          option={option}
          index={index}
          checked={option.value === value}
          // Roving tabindex: exactly ONE stop for the group. With nothing selected the first
          // segment takes the stop, otherwise the group is unreachable by keyboard entirely.
          tabStop={selectedIndex < 0 ? index === 0 : option.value === value}
          onSelect={onChange}
          register={(element) => {
            buttons.current[index] = element;
          }}
        />
      ))}
    </div>
  );
}

interface SegmentProps<V extends string> {
  readonly option: SegmentedOption<V>;
  readonly index: number;
  readonly checked: boolean;
  readonly tabStop: boolean;
  readonly onSelect: (value: V) => void;
  readonly register: (element: HTMLButtonElement | null) => void;
}

/**
 * Split out only so `usePress` can be called per segment — hooks cannot live inside a `.map`.
 */
function Segment<V extends string>({
  option,
  checked,
  tabStop,
  onSelect,
  register,
}: SegmentProps<V>): ReactNode {
  const select = useCallback(() => {
    onSelect(option.value);
  }, [onSelect, option.value]);
  const press = usePress(select, false);

  return (
    <button
      type="button"
      ref={register}
      role="radio"
      aria-checked={checked}
      tabIndex={tabStop ? 0 : -1}
      className="pt-segmented__option"
      style={TAP_STYLE}
      {...press}
    >
      {option.label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Tabs
// ────────────────────────────────────────────────────────────────────────────────────────────────

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly content: ReactNode;
}

export interface TabsProps {
  /** Accessible name for the tab list, e.g. "Navigator". */
  readonly label: string;
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly orientation?: 'horizontal' | 'vertical';
  /**
   * `automatic` selects on focus (APG's default, and right for cheap panels); `manual` waits for
   * Enter/Space, which is what the Pages tab wants once it is rendering thumbnails.
   */
  readonly activation?: 'automatic' | 'manual';
  readonly className?: string;
}

/**
 * The Navigator's six tabs — Outline · Pages · Highlights · Notes · Questions · Chapters — and the
 * single component that replaces `OutlinePanel` + `SmartOutlinePanel` + `HighlightsPanel` +
 * `PDFMinimap` (§18.2).
 *
 * Controlled, because §18.2 requires the last-used tab to be REMEMBERED per paper: state that has
 * to outlive the component cannot live inside it.
 *
 * Only the selected panel is mounted — six eager panels is the perf failure `reader/perf.spec`
 * exists to catch. `aria-controls` is therefore set only on the selected tab: pointing it at a
 * `<div>` that is not in the document is an `aria-valid-attr-value` violation, and the attribute's
 * whole job is to name something a screen reader can actually go to.
 */
export function Tabs({
  label,
  tabs,
  value,
  onChange,
  orientation = 'horizontal',
  activation = 'automatic',
  className,
}: TabsProps): ReactNode {
  const idPrefix = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = tabs.findIndex((tab) => tab.id === value);
  const [focusIndex, setFocusIndex] = useState(selectedIndex < 0 ? 0 : selectedIndex);

  // A tab selected from outside (a deep link into Highlights, say) must also take the tab stop, or
  // the next Tab press lands on whichever tab the user last arrowed to instead of the visible one.
  useEffect(() => {
    if (selectedIndex >= 0) setFocusIndex(selectedIndex);
  }, [selectedIndex]);

  const focusTab = useCallback(
    (index: number): void => {
      const wrapped = ((index % tabs.length) + tabs.length) % tabs.length;
      const tab = tabs[wrapped];
      if (tab === undefined) return;
      setFocusIndex(wrapped);
      buttons.current[wrapped]?.focus();
      if (activation === 'automatic') onChange(tab.id);
    },
    [activation, onChange, tabs],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
      const back = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
      switch (event.key) {
        case forward:
          focusTab(focusIndex + 1);
          break;
        case back:
          focusTab(focusIndex - 1);
          break;
        case 'Home':
          focusTab(0);
          break;
        case 'End':
          focusTab(tabs.length - 1);
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [focusIndex, focusTab, orientation, tabs.length],
  );

  const selected = selectedIndex < 0 ? undefined : tabs[selectedIndex];

  return (
    <div className={classNames('pt-tabs', `pt-tabs--${orientation}`, className)}>
      <div
        className="pt-tabs__list"
        role="tablist"
        aria-label={label}
        aria-orientation={orientation}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            idPrefix={idPrefix}
            selected={tab.id === value}
            tabStop={index === focusIndex}
            onSelect={() => {
              setFocusIndex(index);
              onChange(tab.id);
            }}
            register={(element) => {
              buttons.current[index] = element;
            }}
          />
        ))}
      </div>

      {selected === undefined ? null : (
        <div
          className="pt-tabs__panel"
          role="tabpanel"
          id={`${idPrefix}-panel-${selected.id}`}
          aria-labelledby={`${idPrefix}-tab-${selected.id}`}
          // Focusable so a keyboard user can Tab straight from the tab into its content even when
          // the panel's first child is not itself focusable (Outline headings, for instance).
          tabIndex={0}
        >
          {selected.content}
        </div>
      )}
    </div>
  );
}

interface TabProps {
  readonly tab: TabItem;
  readonly idPrefix: string;
  readonly selected: boolean;
  readonly tabStop: boolean;
  readonly onSelect: () => void;
  readonly register: (element: HTMLButtonElement | null) => void;
}

function Tab({ tab, idPrefix, selected, tabStop, onSelect, register }: TabProps): ReactNode {
  const press = usePress(onSelect, false);

  return (
    <button
      type="button"
      ref={register}
      role="tab"
      id={`${idPrefix}-tab-${tab.id}`}
      aria-selected={selected}
      {...(selected ? { 'aria-controls': `${idPrefix}-panel-${tab.id}` } : {})}
      tabIndex={tabStop ? 0 : -1}
      className="pt-tabs__tab"
      style={TAP_STYLE}
      {...press}
    >
      {tab.label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Sheet
// ────────────────────────────────────────────────────────────────────────────────────────────────

export type SheetDetent = 'peek' | 'half' | 'full';

/** §19.6's peek detent, in CSS px. Exported so the shell reserves the same number. */
export const SHEET_PEEK_PX = 120;

/** Ordered shortest → tallest; the grip's arrow keys and drag both walk this. */
export const SHEET_DETENTS: readonly SheetDetent[] = ['peek', 'half', 'full'];

const DETENT_HEIGHT: Record<SheetDetent, string> = {
  peek: `${String(SHEET_PEEK_PX)}px`,
  half: '50%',
  full: '100%',
};

const DETENT_LABEL: Record<SheetDetent, string> = {
  peek: 'peek',
  half: 'half height',
  full: 'full height',
};

/** How far a drag must travel before it means a detent change rather than a twitch. */
const DRAG_THRESHOLD_PX = 40;
/** How far the sheet follows the finger before snapping — a hint, not a free-floating panel. */
const DRAG_RUBBER_PX = 96;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

export interface SheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly detent: SheetDetent;
  readonly onDetentChange: (detent: SheetDetent) => void;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
  /**
   * Defaults to `detent === 'full'`. See the note on modality below — this is deliberately NOT
   * always-on, and the default is the honest reading of §19.6.
   */
  readonly trapFocus?: boolean;
  readonly className?: string;
}

/**
 * The iPad-portrait Inspector: a bottom sheet at three detents — peek 120px / half / full (§19.6).
 *
 * ON MODALITY, which is the one real design decision in here. §19.6 says "the document stays
 * visible above it — critical, because the user is reading *about* something they must still be
 * able to see". A focus trap that is always on contradicts that exactly: at `peek` the sheet is a
 * companion to the document, and trapping the keyboard inside it makes the document unreachable
 * for precisely the user who cannot escape by tapping. So the trap exists, is tested, and is ON
 * when the sheet covers the document (`full`) and OFF when it does not — overridable per caller.
 * `aria-modal` and the scrim follow the same switch, because claiming modality without enforcing it
 * is worse than either.
 *
 * ON HEIGHT: the detents are CSS heights against the sheet's positioned container, and the drag
 * resolves from the pointer DELTA against a fixed threshold. Nothing measures the container, so
 * nothing here can be wrong at a zoom level, on a rotated iPad, or during a resize.
 */
export function Sheet({
  open,
  title,
  detent,
  onDetentChange,
  onDismiss,
  children,
  trapFocus,
  className,
}: SheetProps): ReactNode {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement | null>(null);
  const restoreFocusTo = useRef<Element | null>(null);
  const dragStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const modal = trapFocus ?? detent === 'full';
  const detentIndex = SHEET_DETENTS.indexOf(detent);

  // Take focus only when we are also going to hold it. Pulling focus into a peek sheet would move
  // the caret out of the document the user is still reading — the sheet is additive there.
  useEffect(() => {
    if (!open || !modal) return undefined;
    restoreFocusTo.current = document.activeElement;
    sheetRef.current?.focus();
    return () => {
      const previous = restoreFocusTo.current;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, modal]);

  const step = useCallback(
    (delta: number): void => {
      const next = SHEET_DETENTS[Math.min(SHEET_DETENTS.length - 1, Math.max(0, detentIndex + delta))];
      if (next !== undefined && next !== detent) onDetentChange(next);
    },
    [detent, detentIndex, onDetentChange],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): void => {
      if (event.key === 'Escape') {
        // Stop here: an Escape meant for the sheet must not also clear the document's selection.
        event.stopPropagation();
        onDismiss();
        return;
      }
      if (event.key !== 'Tab' || !modal) return;

      const root = sheetRef.current;
      if (root === null) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        // Nothing to land on — keep focus on the sheet rather than letting Tab escape the trap.
        event.preventDefault();
        root.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [modal, onDismiss],
  );

  const onGripDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    dragStartY.current = event.clientY;
    // Implicit capture only covers touch; a mouse drag off the grip needs this or the release is
    // delivered to whatever is underneath and the sheet sticks mid-drag.
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onGripMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = dragStartY.current;
    if (start === null) return;
    const dy = event.clientY - start;
    setDragOffset(Math.max(-DRAG_RUBBER_PX, Math.min(DRAG_RUBBER_PX, dy)));
  }, []);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const start = dragStartY.current;
      dragStartY.current = null;
      setDragOffset(0);
      if (start === null) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const dy = event.clientY - start;
      if (dy <= -DRAG_THRESHOLD_PX) step(1);
      // A downward flick from the shortest detent is a dismissal — there is nothing shorter, and
      // "drag it away" is the gesture every sheet on the platform answers to.
      else if (dy >= DRAG_THRESHOLD_PX) {
        if (detentIndex <= 0) onDismiss();
        else step(-1);
      }
    },
    [detentIndex, onDismiss, step],
  );

  const onGripKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      switch (event.key) {
        case 'ArrowUp':
          step(1);
          break;
        case 'ArrowDown':
          step(-1);
          break;
        case 'Home':
          onDetentChange('peek');
          break;
        case 'End':
          onDetentChange('full');
          break;
        case 'Enter':
        case ' ':
          // The tap equivalent, and the reverse of it: cycle rather than dead-end at full.
          onDetentChange(SHEET_DETENTS[(detentIndex + 1) % SHEET_DETENTS.length] ?? 'peek');
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [detentIndex, onDetentChange, step],
  );

  const onScrimUp = useCallback((): void => {
    onDismiss();
  }, [onDismiss]);

  if (!open) return null;

  return (
    <>
      {modal ? (
        <div
          className="pt-sheet__scrim"
          aria-hidden="true"
          // Escape covers the keyboard path; a scrim is a pointer affordance by definition.
          onPointerUp={onScrimUp}
          style={{ touchAction: 'none' }}
        />
      ) : null}

      <section
        ref={sheetRef}
        className={classNames('pt-sheet', className)}
        role="dialog"
        aria-modal={modal}
        aria-labelledby={titleId}
        data-detent={detent}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{
          height: DETENT_HEIGHT[detent],
          // A transform, so following the finger costs a composite and never a re-layout.
          transform: dragOffset === 0 ? undefined : `translateY(${String(dragOffset)}px)`,
        }}
      >
        <div
          className="pt-sheet__grip"
          // A slider over the three detents: `aria-valuetext` says "half height", not "1", and
          // Arrow/Home/End are the keyboard equivalent of the drag. A drag handle with no keyboard
          // path is the commonest way a sheet becomes mouse-only.
          role="slider"
          aria-label={`${title} height`}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={SHEET_DETENTS.length - 1}
          aria-valuenow={detentIndex < 0 ? 0 : detentIndex}
          aria-valuetext={DETENT_LABEL[detent]}
          tabIndex={0}
          // `none`, not `pan-y`: the browser must not claim a vertical drag that starts here.
          style={{ ...TOUCH_TARGET_STYLE, touchAction: 'none' }}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onGripKeyDown}
        >
          <span className="pt-sheet__grip-bar" aria-hidden="true" />
        </div>

        <header className="pt-sheet__header">
          <h2 className="pt-sheet__title" id={titleId}>
            {title}
          </h2>
          <IconButton label="Dismiss" icon="✕" onPress={onDismiss} className="pt-sheet__close" />
        </header>

        {/* The sheet's own content scrolls; the document behind it does not. */}
        <div className="pt-sheet__body" style={{ touchAction: 'pan-y' }}>
          {children}
        </div>
      </section>
    </>
  );
}
