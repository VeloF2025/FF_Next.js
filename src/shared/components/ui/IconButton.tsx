import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { clsx } from 'clsx';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Icon component or SVG element to render
   * Required for keyboard accessibility
   */
  icon: ReactNode;
  
  /**
   * WCAG-required: accessible label describing button action
   * Mandatory. Shown to screen readers.
   */
  ariaLabel: string;
  
  /**
   * Visual variant: 'ghost' (transparent), 'outline' (bordered), 'danger' (red)
   * @default 'ghost'
   */
  variant?: 'ghost' | 'outline' | 'danger';
  
  /**
   * Icon size: 'sm' (16px), 'md' (24px), 'lg' (32px)
   * Button container is always 44×44px minimum (WCAG touch target)
   * @default 'md'
   */
  iconSize?: 'sm' | 'md' | 'lg';
  
  /**
   * Show loading spinner
   * @default false
   */
  loading?: boolean;
  
  /**
   * Additional tooltip text (optional, for hover context)
   */
  title?: string;
}

/**
 * IconButton — Accessible icon-only button component
 * 
 * WCAG 2.1 AA Compliance:
 * - 44×44px minimum touch target (WCAG 2.5.5 Target Size)
 * - Mandatory aria-label for screen readers (WCAG 1.1.1 Text Alternatives)
 * - Visible focus ring on keyboard navigation (WCAG 2.4.7 Focus Visible)
 * - Color contrast ≥4.5:1 on normal, ≥3:1 on large (WCAG 1.4.3)
 * - Disabled state with cursor-not-allowed (WCAG 3.2.1 Consistent Behavior)
 * 
 * @example
 * ```tsx
 * // Basic icon button with ChevronDown icon
 * <IconButton
 *   icon={<ChevronDownIcon />}
 *   ariaLabel="Expand menu"
 *   variant="ghost"
 *   onClick={handleExpand}
 * />
 * 
 * // Danger variant (e.g., delete action)
 * <IconButton
 *   icon={<TrashIcon />}
 *   ariaLabel="Delete item"
 *   variant="danger"
 *   onClick={handleDelete}
 * />
 * 
 * // Outlined variant with custom title
 * <IconButton
 *   icon={<SyncIcon />}
 *   ariaLabel="Sync data"
 *   variant="outline"
 *   title="Last synced 2 minutes ago"
 *   onClick={handleSync}
 * />
 * ```
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      ariaLabel,
      variant = 'ghost',
      iconSize = 'md',
      loading = false,
      disabled,
      className,
      title,
      ...props
    },
    ref
  ) => {
    // Base styles: 44×44px container, centered content, full accessibility support
    const baseStyles = clsx(
      'inline-flex items-center justify-center',
      'h-11 w-11', // 44×44px (2.75rem = 44px at 16px font-size)
      'rounded-md',
      'transition-colors duration-200',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      'active:scale-95' // Subtle press feedback
    );

    // Variant styles with proper contrast ratios
    const variantStyles = {
      ghost:
        'text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] focus-visible:ring-blue-500',
      outline:
        'border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] focus-visible:ring-blue-500',
      danger:
        'text-red-600 hover:bg-red-50 focus-visible:ring-red-500 dark:hover:bg-red-950/20',
    };

    // Icon sizing
    const iconSizeStyles = {
      sm: 'h-4 w-4',
      md: 'h-6 w-6',
      lg: 'h-8 w-8',
    };

    return (
      <button
        ref={ref}
        type="button"
        className={clsx(baseStyles, variantStyles[variant], className)}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          // Loading spinner (inherits color from variant)
          <svg
            className={clsx('animate-spin', iconSizeStyles[iconSize])}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          // Icon with explicit aria-hidden (label handles semantics)
          <span className={iconSizeStyles[iconSize]} aria-hidden="true">
            {icon}
          </span>
        )}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
