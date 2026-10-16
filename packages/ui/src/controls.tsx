/**
 * ui/controls — the Ex Libris buttons and fields (v0.2, #189).
 *
 * Owns `Button`, `ToolbarButton` and `TextField`. They sit beside the v0.1 primitives rather than
 * replacing them: `IconButton` keeps its props, and the v0.1 app classes (`.pt-btn`, `.pt-field`)
 * stay until each feature slice moves over. The classes here are `.pt-button*`, `.pt-toolbtn*` and
 * `.pt-textfield*` so the two generations never share a selector.
 *
 * Disabled controls use `aria-disabled`, never the `disabled` attribute: a disabled button leaves
 * the tab order, and the person who most needs to learn why is the one who can no longer reach it.
 * The 40/44 px sizes are inline styles for the reason `primitives.tsx` gives (no CSS in happy-dom,
 * and this package is outside Tailwind's content globs).
 */

import { forwardRef, useId } from 'react';
import type {
  ButtonHTMLAttributes,
  ForwardedRef,
  InputHTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

/** Joins the class names that are present. */
export function joinClasses(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

/** The button flavours of DESIGN.md §3 item 1. */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

/** `md` is the 40 px desktop target; `touch` is the 44 px phone target. */
export type ControlSize = 'md' | 'touch';

/** Minimum control heights in CSS px, by size. Inline so a missing stylesheet cannot shrink them. */
export const CONTROL_MIN_HEIGHT_PX: Readonly<Record<ControlSize, number>> = { md: 40, touch: 44 };

type ButtonDomProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'type'>;

/** Props for `Button`. */
export interface ButtonProps extends ButtonDomProps {
  /** Defaults to `secondary`. */
  readonly variant?: ButtonVariant;
  /** Defaults to `md`. */
  readonly size?: ControlSize;
  /** An icon node drawn before the label (the icon set lives in apps/web, so it arrives as a node). */
  readonly leadingIcon?: ReactNode;
  /** An icon node drawn after the label, e.g. the arrow on Continue. */
  readonly trailingIcon?: ReactNode;
  /** Sets `aria-disabled` and swallows clicks; the button stays focusable. */
  readonly disabled?: boolean;
  /** Defaults to `button`; pass `submit` inside a form. */
  readonly type?: 'button' | 'submit';
}

/**
 * The Ex Libris button. Primary is an oxblood cloth fill with a gilt inner fillet; danger is red
 * ink on the page, never a red fill.
 *
 * @example
 * <Button variant="outline" trailingIcon={<ArrowRight />} onClick={resume}>Continue</Button>
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  disabled = false,
  type = 'button',
  className,
  style,
  onClick,
  children,
  ...rest
}: ButtonProps): ReactNode {
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      {...rest}
      type={type}
      className={joinClasses('pt-button', `pt-button--${variant}`, `pt-button--${size}`, className)}
      style={{ minHeight: CONTROL_MIN_HEIGHT_PX[size], touchAction: 'manipulation', ...style }}
      aria-disabled={disabled ? true : undefined}
      data-disabled={disabled ? 'true' : undefined}
      onClick={handleClick}
    >
      {leadingIcon === undefined ? null : (
        <span className="pt-button__icon" aria-hidden="true">
          {leadingIcon}
        </span>
      )}
      <span className="pt-button__label">{children}</span>
      {trailingIcon === undefined ? null : (
        <span className="pt-button__icon" aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </button>
  );
}

/** Props for `ToolbarButton`. */
export interface ToolbarButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'disabled' | 'type' | 'aria-label'
> {
  /** The accessible name; also the visible text unless `iconOnly`. */
  readonly label: string;
  /** Drawn before the label; `null` for a text-only button (the reader's Explain tab). */
  readonly icon: ReactNode;
  /** Hide the visible text; `label` still names the button. */
  readonly iconOnly?: boolean;
  /** Present makes this a toggle (`aria-pressed`); omit for a plain action. */
  readonly pressed?: boolean;
  /** Called with the next pressed state when a toggle is activated. */
  readonly onPressedChange?: (next: boolean) => void;
  readonly size?: ControlSize;
  readonly disabled?: boolean;
}

function ToolbarButtonBase(
  {
    label,
    icon,
    iconOnly = false,
    pressed,
    onPressedChange,
    size = 'md',
    disabled = false,
    className,
    style,
    onClick,
    ...rest
  }: ToolbarButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
): ReactNode {
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (pressed !== undefined) onPressedChange?.(!pressed);
    onClick?.(event);
  };
  const minHeight = CONTROL_MIN_HEIGHT_PX[size];
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      className={joinClasses('pt-toolbtn', iconOnly && 'pt-toolbtn--icon', className)}
      style={{
        minHeight,
        ...(iconOnly ? { minWidth: minHeight } : {}),
        touchAction: 'manipulation',
        ...style,
      }}
      aria-label={iconOnly ? label : undefined}
      aria-pressed={pressed}
      aria-disabled={disabled ? true : undefined}
      data-disabled={disabled ? 'true' : undefined}
      onClick={handleClick}
    >
      {icon === null || icon === undefined ? null : (
        <span className="pt-toolbtn__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {iconOnly ? null : <span className="pt-toolbtn__label">{label}</span>}
    </button>
  );
}

/**
 * A labelled icon button for the reader header and the board and notebook tool bars (Board,
 * Explain, Select, Add note, Thread, Fit all). With `pressed` it is a toggle. The ref reaches the
 * `<button>`, so a panel the toggle opens can hand focus back to it when it closes.
 *
 * @example
 * <ToolbarButton label="Board" icon={<Grid />} pressed={open} onPressedChange={setOpen} />
 */
export const ToolbarButton = forwardRef(ToolbarButtonBase);

/** The default text for an ask that could not be sent. The typed value is never cleared. */
export const NOT_SENT_MESSAGE = 'Not sent; your text is kept';

interface TextFieldBase {
  readonly label: string;
  /** Help text, linked with `aria-describedby`. */
  readonly hint?: string;
  /** `true` shows `NOT_SENT_MESSAGE`; a string shows that text instead. The value is kept. */
  readonly error?: boolean | string;
  /** `you` sets the person's own words in Courier Prime and marks them `data-voice="you"`. */
  readonly voice?: 'you';
}

/** Props for a single-line `TextField`. */
export interface InputFieldProps
  extends TextFieldBase, Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-label'> {
  readonly multiline?: false;
}

/** Props for a multi-line `TextField`. */
export interface TextareaFieldProps
  extends TextFieldBase, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'aria-label'> {
  readonly multiline: true;
}

/** Props for `TextField`: an input, or a textarea with `multiline`. */
export type TextFieldProps = InputFieldProps | TextareaFieldProps;

/**
 * A labelled input or textarea with a hint and an error. The error is shown beside the field and
 * the value is left exactly as typed, so a failed ask costs the person nothing.
 *
 * @example
 * <TextField multiline voice="you" label="Follow-up" value={text} onChange={…} error={failed} />
 */
export function TextField(props: TextFieldProps): ReactNode {
  const { label, hint, error, voice, className, multiline, ...dom } = props;
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const errorText = error === true ? NOT_SENT_MESSAGE : typeof error === 'string' ? error : '';
  const invalid = errorText !== '';
  const describedBy =
    [hint === undefined ? '' : hintId, invalid ? errorId : ''].filter(Boolean).join(' ') ||
    undefined;
  const common = {
    id,
    className: joinClasses(
      'pt-textfield__control',
      voice === 'you' && 'pt-textfield__control--you',
    ),
    'aria-invalid': invalid ? true : undefined,
    'aria-describedby': describedBy,
    'data-voice': voice,
  };
  // The rest-spread of a union loses which element it belongs to; `multiline` is the discriminant.
  const control =
    multiline === true ? (
      <textarea {...(dom as TextareaHTMLAttributes<HTMLTextAreaElement>)} {...common} />
    ) : (
      <input type="text" {...(dom as InputHTMLAttributes<HTMLInputElement>)} {...common} />
    );
  return (
    <div className={joinClasses('pt-textfield', invalid && 'pt-textfield--error', className)}>
      <label className="pt-textfield__label" htmlFor={id}>
        {label}
      </label>
      {control}
      {hint === undefined ? null : (
        <p className="pt-textfield__hint" id={hintId}>
          {hint}
        </p>
      )}
      {invalid ? (
        <p className="pt-textfield__error" id={errorId} role="alert">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
