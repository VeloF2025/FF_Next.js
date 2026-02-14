/**
 * DarkSelect - Dark theme native select component
 *
 * Following FibreFlow UI/UX Specification:
 * - Dark backgrounds (#1a1d23)
 * - NEVER white backgrounds
 * - Consistent border and focus states
 *
 * Use this for simple select dropdowns. For more complex needs,
 * use the Radix UI Select components from ./select.tsx
 *
 * @see docs/UI_UX_SPECIFICATION.md
 */

import { SelectHTMLAttributes, forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

export type DarkSelectSize = 'sm' | 'md' | 'lg';

export interface DarkSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Array of options */
  options?: SelectOption[];
  /** Grouped options */
  groups?: SelectOptionGroup[];
  /** Placeholder text when no value selected */
  placeholder?: string;
  /** Size variant */
  size?: DarkSelectSize;
  /** Error state */
  error?: boolean;
  /** Full width */
  fullWidth?: boolean;
  /** Label text */
  label?: string;
  /** Helper text below select */
  helperText?: string;
  /** Error message (shows instead of helperText when error=true) */
  errorMessage?: string;
}

const DarkSelect = forwardRef<HTMLSelectElement, DarkSelectProps>(
  (
    {
      options = [],
      groups = [],
      placeholder,
      size = 'md',
      error = false,
      fullWidth = true,
      label,
      helperText,
      errorMessage,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    // Size classes
    const sizeClasses = {
      sm: 'h-8 text-sm px-2 pr-8',
      md: 'h-10 text-sm px-3 pr-10',
      lg: 'h-12 text-base px-4 pr-12',
    };

    // Icon size classes
    const iconSizes = {
      sm: 'w-4 h-4 right-2',
      md: 'w-5 h-5 right-3',
      lg: 'w-5 h-5 right-4',
    };

    const baseClasses = `
      appearance-none
      rounded-lg
      border
      bg-[#1a1d23]
      text-white
      transition-colors
      focus:outline-none
      focus:ring-1
      disabled:cursor-not-allowed
      disabled:opacity-50
    `;

    const stateClasses = error
      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
      : 'border-gray-600 focus:border-blue-500 focus:ring-blue-500 hover:border-gray-500';

    const widthClass = fullWidth ? 'w-full' : '';

    return (
      <div className={`${fullWidth ? 'w-full' : 'inline-block'}`}>
        {label && (
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            {label}
          </label>
        )}

        <div className="relative">
          <select
            ref={ref}
            disabled={disabled}
            className={`
              ${baseClasses}
              ${sizeClasses[size]}
              ${stateClasses}
              ${widthClass}
              ${className}
            `.trim().replace(/\s+/g, ' ')}
            {...props}
          >
            {placeholder && (
              <option value="" disabled={props.required}>
                {placeholder}
              </option>
            )}

            {/* Render flat options */}
            {options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}

            {/* Render grouped options */}
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <ChevronDown
            className={`
              absolute top-1/2 -translate-y-1/2 pointer-events-none
              text-gray-400
              ${iconSizes[size]}
            `}
          />
        </div>

        {(helperText || errorMessage) && (
          <p className={`mt-1.5 text-sm ${error ? 'text-red-400' : 'text-muted-foreground'}`}>
            {error ? errorMessage : helperText}
          </p>
        )}
      </div>
    );
  }
);

DarkSelect.displayName = 'DarkSelect';

export { DarkSelect };
export default DarkSelect;

// Also export a simple inline select for filters
export interface InlineSelectProps extends Omit<DarkSelectProps, 'label' | 'helperText' | 'errorMessage' | 'error'> {
  /** Prefix label shown before select */
  prefix?: string;
}

export function InlineSelect({
  prefix,
  size = 'sm',
  fullWidth = false,
  className = '',
  ...props
}: InlineSelectProps) {
  return (
    <div className="inline-flex items-center gap-2">
      {prefix && <span className="text-sm text-gray-400">{prefix}</span>}
      <DarkSelect
        size={size}
        fullWidth={fullWidth}
        className={className}
        {...props}
      />
    </div>
  );
}
