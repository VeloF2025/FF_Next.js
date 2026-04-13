/**
 * InputField Component
 * Core input field with icons and loading states
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { velocityInputVariants } from '../variants';

interface InputFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  variant?: string;
  size?: 'sm' | 'md' | 'lg';
  currentState?: 'default' | 'error' | 'success' | 'warning';
  hasIcon?: boolean;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  isPasswordInput?: boolean;
  showCharacterCount?: boolean;
  fullWidth?: boolean;
  customStyle?: React.CSSProperties;
  error?: string;
  success?: string;
  warning?: string;
  helperText?: string;
  onFocusHandler: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlurHandler: (e: React.FocusEvent<HTMLInputElement>) => void;
  onChangeHandler: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(
  ({
    variant,
    size,
    currentState,
    hasIcon,
    iconPosition,
    loading,
    isPasswordInput,
    showCharacterCount,
    fullWidth,
    customStyle,
    className,
    onFocusHandler,
    onBlurHandler,
    onChangeHandler,
    ...props
  }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          velocityInputVariants({ variant: (variant as 'glass' | 'glass-dark' | 'glass-intense' | 'neon' | 'neon-purple' | 'neon-pink' | 'neon-green' | 'holographic' | 'plasma' | 'aurora' | 'solid' | 'minimal' | undefined) ?? 'glass', size, state: currentState }),
          // Icon padding adjustments
          (hasIcon && iconPosition === 'left') || loading ? 'pl-10' : '',
          (hasIcon && iconPosition === 'right') || isPasswordInput ? 'pr-10' : '',
          // Character counter padding
          showCharacterCount && !isPasswordInput && !hasIcon && 'pr-16',
          // Full width
          fullWidth && 'w-full',
          'peer',
          className
        )}
        onFocus={onFocusHandler}
        onBlur={onBlurHandler}
        onChange={onChangeHandler}
        placeholder=" " // Required for floating label CSS selector
        aria-describedby={
          [
            props.error && `${props.id}-error`,
            props.success && `${props.id}-success`,
            props.warning && `${props.id}-warning`,
            props.helperText && `${props.id}-helper`,
            showCharacterCount && `${props.id}-count`
          ].filter(Boolean).join(' ') || undefined
        }
        aria-invalid={!!props.error}
        style={customStyle}
        {...props}
      />
    );
  }
);

InputField.displayName = 'InputField';