/**
 * FloatingLabel Component
 * Animated floating label for VelocityInput
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { velocityLabelVariants } from '../variants';

interface FloatingLabelProps {
  label?: string;
  variant?: string;
  size?: 'sm' | 'md' | 'lg';
  currentState?: 'default' | 'error' | 'success' | 'warning';
  isFloating?: boolean;
  focused?: boolean;
  htmlFor?: string;
  hasLeftIcon?: boolean;
}

export const FloatingLabel: React.FC<FloatingLabelProps> = ({
  label,
  variant,
  size,
  currentState,
  isFloating,
  focused,
  htmlFor,
  hasLeftIcon,
}) => {
  if (!label) return null;

  return (
    <label
      className={cn(
        velocityLabelVariants({
          variant: variant as 'glass' | 'glass-dark' | 'glass-intense' | 'neon' | 'neon-purple' | 'neon-pink' | 'neon-green' | 'holographic' | 'plasma' | 'aurora' | 'solid' | 'minimal' | undefined,
          size,
          state: currentState,
          floating: isFloating
        }),
        variant?.includes('neon') && focused && 'drop-shadow-[0_0_4px_currentColor]',
        // Shift label right when there's a left icon (and not floating)
        hasLeftIcon && !isFloating && 'left-10'
      )}
      htmlFor={htmlFor}
    >
      {label}
    </label>
  );
};