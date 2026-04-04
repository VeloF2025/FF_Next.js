import * as React from 'react';
import { cn } from '@/utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link' | 'default' | 'outline' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'default';
  loading?: boolean;
}

const variants: Record<string, string> = {
  primary: 'bg-[var(--ff-primary-600)] text-white hover:bg-[var(--ff-primary-700)] focus-visible:ring-[var(--ff-primary-500)]',
  secondary: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]',
  danger: 'bg-red-600/10 text-red-400 border border-red-500/30 hover:bg-red-600/20',
  ghost: 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]',
  link: 'text-[var(--ff-primary-500)] hover:text-[var(--ff-primary-400)] underline-offset-2 hover:underline p-0 h-auto',
  // Backward compat aliases (old API)
  default: 'bg-[var(--ff-primary-600)] text-white hover:bg-[var(--ff-primary-700)] focus-visible:ring-[var(--ff-primary-500)]',
  outline: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]',
  destructive: 'bg-red-600/10 text-red-400 border border-red-500/30 hover:bg-red-600/20',
};

const sizes: Record<string, string> = {
  sm: 'px-3 py-1 text-xs gap-1',
  md: 'px-4 py-2 text-sm gap-1.5',
  lg: 'px-5 py-2.5 text-base gap-2',
  icon: 'p-2',
  default: 'px-4 py-2 text-sm gap-1.5',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          'disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {loading && (
          <svg className="animate-spin w-4 h-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

// Backward compat aliases
export const buttonVariants = variants;
