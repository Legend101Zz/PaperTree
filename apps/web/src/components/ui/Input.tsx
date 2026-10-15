import React, { useId } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /** A line under the field, e.g. the password rule. Wired with `aria-describedby`. */
  hint?: string;
}

/**
 * A labelled text field. The `<label>` is associated with the input (`htmlFor`/`id`), which the
 * previous version was not: a screen reader announced an unnamed edit box. Styling is
 * `@papertree/ui`'s `.pt-s3-field*`, which names its colours explicitly so a dark-mode OS cannot
 * paint a native control black-on-grey (#77 D8).
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const generated = useId();
    const inputId = id ?? generated;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;
    const describedBy =
      [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
        .filter((part): part is string => part !== null)
        .join(' ') || undefined;

    return (
      <div className="pt-s3-field">
        {label !== undefined && (
          <label htmlFor={inputId} className="pt-s3-field__label">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn('pt-s3-field__input', className)}
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {hint !== undefined && (
          <p id={hintId} className="pt-s3-field__hint">
            {hint}
          </p>
        )}
        {error !== undefined && (
          <p id={errorId} className="pt-s3-small" style={{ color: 'var(--pt-s3-bad)' }}>
            {error}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
