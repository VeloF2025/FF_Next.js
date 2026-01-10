import { InputHTMLAttributes, forwardRef } from 'react';
import { clsx } from 'clsx';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, fullWidth = false, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={clsx(
          'px-3 py-2 border rounded-lg text-sm transition-colors',
          'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]',
          'focus:outline-none focus:ring-2 focus:ring-blue-500',
          error
            ? 'border-red-400 focus:ring-red-500'
            : 'border-[var(--ff-border-light)] focus:border-blue-500',
          fullWidth && 'w-full',
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';