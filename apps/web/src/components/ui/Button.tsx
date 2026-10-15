import React from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

/** Styling lives in `@papertree/ui` (`.pt-s3-btn*`), so the v0.2 revamp restyles it in one place. */
const VARIANT: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'pt-s3-btn--primary',
  secondary: '',
  ghost: 'pt-s3-btn--quiet',
  danger: 'pt-s3-btn--danger',
};

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn('pt-s3-btn', VARIANT[variant], size === 'sm' && 'pt-s3-btn--small', className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading && (
        <svg
          className="pt-s3-spin h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" />
        </svg>
      )}
      {children}
    </button>
  );
}
