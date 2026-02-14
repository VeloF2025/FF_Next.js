import React, { forwardRef } from 'react';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, onCheckedChange, checked, onChange, ...props }, ref) => {
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const isChecked = event.target.checked;
      onCheckedChange?.(isChecked);
      onChange?.(event);
    };

    return (
      <div className="relative inline-flex items-center">
        <input
          type="checkbox"
          className="sr-only"
          ref={ref}
          checked={checked}
          onChange={handleChange}
          {...props}
        />
        <div
          className={clsx(
            'flex h-4 w-4 items-center justify-center rounded border-2 transition-colors',
            checked
              ? 'bg-purple-600 border-purple-600 text-white'
              : 'border-border bg-card hover:border-purple-600',
            props.disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
        >
          {checked && <Check className="h-3 w-3" />}
        </div>
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';