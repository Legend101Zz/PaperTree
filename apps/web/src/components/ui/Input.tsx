import React from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, label, error, ...props }, ref) => {
        return (
            <div className="w-full">
                {label && (
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {label}
                    </label>
                )}
                <input
                    ref={ref}
                    className={cn(
                        'w-full px-4 py-2 border rounded-lg transition-colors',
                        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
                        // EXPLICIT, and this is the #77 fix. `packages/ui/src/styles.css:63` sets
                        // `color-scheme: light dark`, so on a dark-mode OS Chrome paints its own
                        // DARK background into a native control. The `dark:` utilities below do not
                        // rescue it: `tailwind.config.ts:9` is `darkMode: "class"` and nothing in
                        // this app ever adds that class, so every `dark:` variant here is dead.
                        // The result was black-on-#3b3b3b at **1.87:1** against AA's 4.5:1 —
                        // measured by hand and confirmed by axe in a real browser (UX-WALK-77 §D8).
                        // Naming the light colours stops the UA from choosing them for us.
                        'bg-white text-gray-900 placeholder:text-gray-500',
                        'dark:bg-gray-800 dark:border-gray-700 dark:text-white',
                        error ? 'border-red-500' : 'border-gray-300',
                        className
                    )}
                    {...props}
                />
                {error && (
                    <p className="mt-1 text-sm text-red-500">{error}</p>
                )}
            </div>
        );
    }
);

Input.displayName = 'Input';