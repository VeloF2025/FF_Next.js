/**
 * VELOCITY Theme React Hook
 * Custom hook for easy integration of VELOCITY theme features
 */

import { useEffect, useMemo } from 'react';
import { velocityTheme } from './velocityTheme';
import { velocityStyles, velocityUtils } from './velocityUtils';
import type { VelocityStyleKey } from './velocityUtils';

interface UseVelocityThemeOptions {
  /** Whether to automatically apply CSS variables to document root */
  autoApplyVariables?: boolean;
  /** Whether to enable performance optimizations for older devices */
  optimizePerformance?: boolean;
  /** Whether to respect user's reduced motion preference */
  respectReducedMotion?: boolean;
}

/**
 * Hook for accessing VELOCITY theme utilities and styles
 */
export const useVelocityTheme = (options: UseVelocityThemeOptions = {}) => {
  const {
    autoApplyVariables = false,
    optimizePerformance = true,
    respectReducedMotion = true,
  } = options;

  // Apply CSS variables to document root on mount
  useEffect(() => {
    if (autoApplyVariables) {
      velocityUtils.applyCSSVariables();
    }
  }, [autoApplyVariables]);

  // Memoized utilities for performance
  const utils = useMemo(() => ({
    // Style getters
    getElevation: velocityUtils.getElevation,
    getGlassmorphism: velocityUtils.getGlassmorphism,
    getNeonEffect: velocityUtils.getNeonEffect,
    getGradient: velocityUtils.getGradient,
    
    // Responsive utilities
    getResponsiveElevation: velocityUtils.getResponsiveElevation,
    
    // Performance utilities
    getOptimizedStyle: optimizePerformance 
      ? velocityUtils.getPerformanceOptimizedStyle 
      : (style: Record<string, unknown>) => style,
    
    // Animation utilities
    getHoverAnimation: respectReducedMotion 
      ? (type?: 'lift' | 'float' | 'glow') => {
          // Check for reduced motion preference
          const prefersReducedMotion = typeof window !== 'undefined' && 
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          
          if (prefersReducedMotion) {
            return { transition: 'none' };
          }
          
          return velocityUtils.getHoverAnimation(type);
        }
      : velocityUtils.getHoverAnimation,
  }), [optimizePerformance, respectReducedMotion]);

  // Memoized style objects
  const styles = useMemo(() => velocityStyles, []);

  // Memoized theme values
  const theme = useMemo(() => velocityTheme, []);

  return {
    theme,
    styles,
    utils,
    
    // Convenience methods
    glass: styles.glass,
    card: styles.card,
    button: styles.button,
    elevation: styles.elevation,
    glow: styles.glow,
    neon: styles.neon,
    gradients: styles.gradients,
    transitions: styles.transitions,
    transforms: styles.transforms,
    
    // Helper methods
    applyCSSVariables: velocityUtils.applyCSSVariables,
    generateCSSVariables: velocityUtils.generateCSSVariables,
  };
};

/**
 * Hook for getting a specific VELOCITY style by key
 */
export const useVelocityStyle = (styleKey: VelocityStyleKey) => {
  return useMemo(() => velocityStyles[styleKey], [styleKey]);
};

/**
 * Hook for creating dynamic VELOCITY styles
 */
export const useVelocityDynamicStyles = () => {
  return useMemo(() => ({
    // Dynamic glass effect with custom transparency
    createGlassEffect: (transparency = 0.1, blur = 16, borderOpacity = 0.2) => ({
      background: `rgba(26, 31, 46, ${transparency})`,
      backdropFilter: `blur(${blur}px) saturate(150%)`,
      border: `1px solid rgba(0, 245, 255, ${borderOpacity})`,
      borderRadius: velocityTheme.borderRadius.lg,
    }),
    
    // Dynamic elevation with custom color
    createCustomElevation: (level = 2, glowColor = '0, 245, 255', glowOpacity = 0.2) => ({
      boxShadow: `0 ${level * 2}px ${level * 6}px rgba(0, 0, 0, ${0.3 + level * 0.1}), 0 0 ${level * 8}px rgba(${glowColor}, ${glowOpacity})`,
    }),
    
    // Dynamic neon effect with custom color
    createNeonEffect: (color = '0, 245, 255', intensity = 1) => ({
      boxShadow: Array.from({ length: 4 }, (_, i) => 
        `0 0 ${(i + 1) * 5 * intensity}px rgb(${color})`
      ).join(', '),
      border: `1px solid rgb(${color})`,
    }),
    
    // Dynamic gradient with custom colors
    createCustomGradient: (colors: string[], direction = '135deg') => ({
      background: `linear-gradient(${direction}, ${colors.join(', ')})`,
    }),
    
    // Dynamic animation with custom timing
    createCustomAnimation: (duration = '300ms', easing = 'cubic-bezier(0.4, 0, 0.2, 1)', properties = 'all') => ({
      transition: `${properties} ${duration} ${easing}`,
    }),
  }), []);
};

/**
 * Hook for VELOCITY theme-aware responsive design
 */
export const useVelocityResponsive = () => {
  return useMemo(() => ({
    // Breakpoint utilities
    isMobile: () => typeof window !== 'undefined' && window.innerWidth < 768,
    isTablet: () => typeof window !== 'undefined' && window.innerWidth < 1024 && window.innerWidth >= 768,
    isDesktop: () => typeof window !== 'undefined' && window.innerWidth >= 1024,
    
    // Responsive styles
    getResponsiveGlass: (intensity: 'light' | 'medium' | 'heavy' | 'ultra' = 'medium') => {
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
      // Reduce glass effects on mobile for performance
      if (isMobile && (intensity === 'heavy' || intensity === 'ultra')) {
        return velocityStyles.glass.medium;
      }
      return velocityStyles.glass[intensity];
    },
    
    // Responsive elevation (reduces shadow complexity on mobile)
    getResponsiveElevation: (level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => {
      return velocityUtils.getResponsiveElevation(level);
    },
    
    // Media query helpers
    mediaQueries: {
      mobile: '@media (max-width: 767px)',
      tablet: '@media (min-width: 768px) and (max-width: 1023px)',
      desktop: '@media (min-width: 1024px)',
      reducedMotion: '@media (prefers-reduced-motion: reduce)',
      highContrast: '@media (prefers-contrast: high)',
    },
  }), []);
};

/**
 * Hook for VELOCITY theme accessibility features
 */
export const useVelocityA11y = () => {
  return useMemo(() => ({
    // High contrast mode detection
    prefersHighContrast: () => 
      typeof window !== 'undefined' && 
      window.matchMedia('(prefers-contrast: high)').matches,
    
    // Reduced motion detection
    prefersReducedMotion: () => 
      typeof window !== 'undefined' && 
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    
    // Get accessible colors with better contrast
    getAccessibleColors: () => ({
      text: {
        primary: '#ffffff',
        secondary: '#e0e0e0',
        accent: '#40c4ff',
      },
      background: {
        primary: '#0a0e1a',
        secondary: '#1a1f2e',
      },
      border: {
        primary: 'rgba(255, 255, 255, 0.3)',
        focus: '#40c4ff',
      },
    }),
    
    // Focus styles for keyboard navigation
    getFocusStyles: () => ({
      outline: '2px solid #40c4ff',
      outlineOffset: '2px',
      borderRadius: velocityTheme.borderRadius.md,
    }),
    
    // Skip link styles
    getSkipLinkStyles: () => ({
      position: 'absolute' as const,
      top: '-40px',
      left: '6px',
      background: '#40c4ff',
      color: '#0a0e1a',
      padding: '8px 12px',
      borderRadius: velocityTheme.borderRadius.md,
      textDecoration: 'none',
      fontWeight: velocityTheme.typography.fontWeight.medium,
      zIndex: 1000,
      transition: 'top 0.3s',
      '&:focus': {
        top: '6px',
      },
    }),
  }), []);
};

// Type exports for better TypeScript support
export type VelocityThemeHookOptions = UseVelocityThemeOptions;
export type VelocityThemeUtils = ReturnType<typeof useVelocityTheme>['utils'];
export type VelocityThemeStyles = ReturnType<typeof useVelocityTheme>['styles'];