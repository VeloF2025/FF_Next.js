/**
 * VELOCITY Animation Utilities
 * Utility functions for animation composition and accessibility
 */

import { Variants, MotionProps } from 'framer-motion';

// 🟢 WORKING: Performance optimization utilities
export const reduceMotionVariants = (variants: Variants): Variants => {
  const reducedVariants: Variants = {};
  
  Object.keys(variants).forEach(key => {
    const variant = variants[key];
    if (typeof variant === 'object' && variant !== null) {
      reducedVariants[key] = {
        ...variant,
        transition: { duration: 0.01, ease: 'linear' }
      };
    } else if (variant !== undefined) {
      reducedVariants[key] = variant;
    }
  });

  return reducedVariants;
};

export const getAccessibilityProps = (): Partial<MotionProps> => {
  if (typeof window === 'undefined') return {};
  
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
  return prefersReducedMotion ? {
    initial: {},
    animate: {},
    exit: {},
    transition: { duration: 0.01 }
  } : {};
};

// 🟢 WORKING: Animation composition helpers
export const combineVariants = (...variantSets: Variants[]): Variants => {
  return variantSets.reduce((combined, variants) => ({
    ...combined,
    ...variants
  }), {});
};

export const withDelay = (variants: Variants, delay: number): Variants => {
  const delayedVariants: Variants = {};
  
  Object.keys(variants).forEach(key => {
    const variant = variants[key];
    if (typeof variant === 'object' && variant !== null && 'transition' in variant) {
      delayedVariants[key] = {
        ...variant,
        transition: {
          ...(typeof variant.transition === 'object' ? variant.transition : {}),
          delay
        }
      };
    } else if (variant !== undefined) {
      delayedVariants[key] = variant;
    }
  });

  return delayedVariants;
};