import { cn } from '@/utils/cn';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'primary' | 'secondary' | 'white' | 'success' | 'warning' | 'error';
  className?: string;
  label?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6', 
  lg: 'w-8 h-8',
  xl: 'w-12 h-12',
};

const variantClasses = {
  primary: 'text-primary-600',
  secondary: 'text-[var(--ff-text-secondary)]',
  white: 'text-white',
  success: 'text-success-600',
  warning: 'text-warning-600',
  error: 'text-error-600',
};

export function LoadingSpinner({ 
  size = 'md', 
  variant = 'primary', 
  className = '',
  label = 'Loading...'
}: LoadingSpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className="flex flex-col items-center space-y-2">
        <svg
          className={cn(
            'animate-spin',
            sizeClasses[size],
            variantClasses[variant]
          )}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          role="status"
          aria-label={label}
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        {label && size !== 'sm' && (
          <span className="text-sm text-[var(--ff-text-secondary)]">{label}</span>
        )}
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}

// Inline spinner for buttons and small spaces
export function InlineSpinner({ 
  size = 'sm', 
  className = '' 
}: Pick<LoadingSpinnerProps, 'size' | 'className'>) {
  return (
    <svg
      className={cn(
        'animate-spin',
        sizeClasses[size],
        'text-current',
        className
      )}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      aria-label="Loading"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  );
}

// Full page loading overlay
export function LoadingOverlay({ 
  isVisible = true,
  label = 'Loading...',
  variant = 'primary'
}: { 
  isVisible?: boolean;
  label?: string;
  variant?: LoadingSpinnerProps['variant'];
}) {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-[var(--ff-surface-overlay)] z-50 flex items-center justify-center">
      <div className="bg-[var(--ff-surface-primary)] rounded-lg shadow-xl p-8 border border-[var(--ff-border-primary)]">
        <LoadingSpinner size="lg" variant={variant} label={label} />
      </div>
    </div>
  );
}