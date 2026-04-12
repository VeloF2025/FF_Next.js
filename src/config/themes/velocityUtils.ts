/**
 * VELOCITY Theme Utilities
 * TypeScript utilities for applying VELOCITY theme effects programmatically
 */

import { velocityTheme } from './velocityTheme';

// CSS-in-JS Style Objects for common VELOCITY components
export const velocityStyles = {
  // Glass morphism styles
  glass: {
    light: {
      background: velocityTheme.glassmorphism?.transparency.subtle,
      backdropFilter: velocityTheme.glassmorphism?.backdrop.light,
      border: velocityTheme.glassmorphism?.border.light,
      borderRadius: velocityTheme.borderRadius.lg,
    },
    medium: {
      background: velocityTheme.glassmorphism?.transparency.medium,
      backdropFilter: velocityTheme.glassmorphism?.backdrop.medium,
      border: velocityTheme.glassmorphism?.border.medium,
      borderRadius: velocityTheme.borderRadius.lg,
    },
    heavy: {
      background: velocityTheme.glassmorphism?.transparency.strong,
      backdropFilter: velocityTheme.glassmorphism?.backdrop.heavy,
      border: velocityTheme.glassmorphism?.border.strong,
      borderRadius: velocityTheme.borderRadius.lg,
    },
    ultra: {
      background: velocityTheme.glassmorphism?.transparency.intense,
      backdropFilter: velocityTheme.glassmorphism?.backdrop.ultra,
      border: velocityTheme.glassmorphism?.border.neon,
      borderRadius: velocityTheme.borderRadius.lg,
      boxShadow: velocityTheme.elevation?.[4],
    },
  },

  // Card styles
  card: {
    default: {
      background: velocityTheme.gradients?.card,
      backdropFilter: velocityTheme.glassmorphism?.backdrop.medium,
      border: velocityTheme.glassmorphism?.border.light,
      borderRadius: velocityTheme.borderRadius.xl,
      boxShadow: velocityTheme.elevation?.[2],
      transition: `all ${velocityTheme.animations?.duration.normal} ${velocityTheme.animations?.easing.smooth}`,
    },
    hover: {
      transform: velocityTheme.animations?.transform?.hover,
      boxShadow: velocityTheme.elevation?.[4],
      border: velocityTheme.glassmorphism?.border.medium,
    },
  },

  // Button styles
  button: {
    primary: {
      background: velocityTheme.gradients?.button,
      backdropFilter: velocityTheme.glassmorphism?.backdrop.light,
      border: velocityTheme.glassmorphism?.border.medium,
      color: velocityTheme.colors.text.primary,
      fontWeight: velocityTheme.typography.fontWeight.semibold,
      borderRadius: velocityTheme.borderRadius.lg,
      padding: `${velocityTheme.spacing.sm} ${velocityTheme.spacing.lg}`,
      transition: `all ${velocityTheme.animations?.duration.normal} ${velocityTheme.animations?.easing.smooth}`,
      cursor: 'pointer',
      position: 'relative' as const,
      overflow: 'hidden' as const,
    },
    primaryHover: {
      transform: velocityTheme.animations?.transform?.hover,
      boxShadow: `${velocityTheme.elevation?.[3]}, ${velocityTheme.effects?.glow.medium}`,
      border: velocityTheme.glassmorphism?.border.strong,
    },
    primaryActive: {
      transform: velocityTheme.animations?.transform?.press,
      transition: `transform ${velocityTheme.animations?.duration.instant} ${velocityTheme.animations?.easing.sharp}`,
    },
    neon: {
      background: 'transparent',
      border: '2px solid #00f5ff',
      color: '#00f5ff',
      fontWeight: velocityTheme.typography.fontWeight.medium,
      borderRadius: velocityTheme.borderRadius.lg,
      padding: `${velocityTheme.spacing.sm} ${velocityTheme.spacing.lg}`,
      transition: `all ${velocityTheme.animations?.duration.normal} ${velocityTheme.animations?.easing.smooth}`,
      cursor: 'pointer',
      textTransform: 'uppercase' as const,
      letterSpacing: velocityTheme.typography.letterSpacing?.wide,
    },
    neonHover: {
      background: 'rgba(0, 245, 255, 0.1)',
      boxShadow: velocityTheme.effects?.neon.cyan,
      transform: velocityTheme.animations?.transform?.hover,
    },
  },

  // Layout styles
  sidebar: {
    background: velocityTheme.gradients?.surface,
    backdropFilter: velocityTheme.glassmorphism?.backdrop.heavy,
    borderRight: velocityTheme.glassmorphism?.border.light,
  },

  header: {
    background: velocityTheme.glassmorphism?.transparency.medium,
    backdropFilter: velocityTheme.glassmorphism?.backdrop.medium,
    borderBottom: velocityTheme.glassmorphism?.border.light,
    boxShadow: velocityTheme.elevation?.[2],
  },

  // Effect styles
  elevation: {
    1: { boxShadow: velocityTheme.elevation?.[1] },
    2: { boxShadow: velocityTheme.elevation?.[2] },
    3: { boxShadow: velocityTheme.elevation?.[3] },
    4: { boxShadow: velocityTheme.elevation?.[4] },
    5: { boxShadow: velocityTheme.elevation?.[5] },
    6: { boxShadow: velocityTheme.elevation?.[6] },
    7: { boxShadow: velocityTheme.elevation?.[7] },
    8: { boxShadow: velocityTheme.elevation?.[8] },
  },

  glow: {
    subtle: { boxShadow: velocityTheme.effects?.glow.subtle },
    medium: { boxShadow: velocityTheme.effects?.glow.medium },
    strong: { boxShadow: velocityTheme.effects?.glow.strong },
    intense: { boxShadow: velocityTheme.effects?.glow.intense },
  },

  neon: {
    cyan: { boxShadow: velocityTheme.effects?.neon.cyan, border: '1px solid #00f5ff' },
    blue: { boxShadow: velocityTheme.effects?.neon.blue, border: '1px solid #0066ff' },
    purple: { boxShadow: velocityTheme.effects?.neon.purple, border: '1px solid #6366f1' },
    plasma: { boxShadow: velocityTheme.effects?.neon.plasma, border: '1px solid #8a2be2' },
    laser: { boxShadow: velocityTheme.effects?.neon.laser, border: '1px solid #ff1493' },
    electric: { boxShadow: velocityTheme.effects?.neon.electric, border: '1px solid #00ffff' },
  },

  // Gradient backgrounds
  gradients: {
    primary: { background: velocityTheme.gradients?.primary },
    surface: { background: velocityTheme.gradients?.surface },
    card: { background: velocityTheme.gradients?.card },
    button: { background: velocityTheme.gradients?.button },
    ambient: { background: velocityTheme.gradients?.ambient },
    neon: { background: velocityTheme.gradients?.neon },
    holographic: { background: velocityTheme.gradients?.holographic },
    plasma: { background: velocityTheme.gradients?.plasma },
    aurora: { background: velocityTheme.gradients?.aurora },
  },

  // Animation utilities
  transitions: {
    smooth: { 
      transition: `all ${velocityTheme.animations?.duration.normal} ${velocityTheme.animations?.easing.smooth}` 
    },
    bounce: { 
      transition: `all ${velocityTheme.animations?.duration.normal} ${velocityTheme.animations?.easing.bounce}` 
    },
    elastic: { 
      transition: `all ${velocityTheme.animations?.duration.slow} ${velocityTheme.animations?.easing.elastic}` 
    },
    sharp: { 
      transition: `all ${velocityTheme.animations?.duration.fast} ${velocityTheme.animations?.easing.sharp}` 
    },
  },

  transforms: {
    hover: { transform: velocityTheme.animations?.transform?.hover },
    press: { transform: velocityTheme.animations?.transform?.press },
    float: { transform: velocityTheme.animations?.transform?.float },
  },
};

// Utility functions for dynamic styling
export const velocityUtils = {
  // Generate CSS custom properties for runtime theme switching
  generateCSSVariables: () => {
    const cssVars: Record<string, string> = {};

    // Color variables
    Object.entries(velocityTheme.colors.primary).forEach(([key, value]) => {
      cssVars[`--velocity-primary-${key}`] = value;
    });

    // Elevation variables
    if (velocityTheme.elevation) {
      Object.entries(velocityTheme.elevation).forEach(([key, value]) => {
        cssVars[`--velocity-elevation-${key}`] = value;
      });
    }

    // Glassmorphism variables
    if (velocityTheme.glassmorphism) {
      Object.entries(velocityTheme.glassmorphism.backdrop).forEach(([key, value]) => {
        cssVars[`--velocity-glass-backdrop-${key}`] = value;
      });
      Object.entries(velocityTheme.glassmorphism.transparency).forEach(([key, value]) => {
        cssVars[`--velocity-glass-transparency-${key}`] = value;
      });
      Object.entries(velocityTheme.glassmorphism.border).forEach(([key, value]) => {
        cssVars[`--velocity-glass-border-${key}`] = value;
      });
    }

    // Gradient variables
    if (velocityTheme.gradients) {
      Object.entries(velocityTheme.gradients).forEach(([key, value]) => {
        cssVars[`--velocity-gradient-${key}`] = value;
      });
    }

    // Effect variables
    if (velocityTheme.effects) {
      Object.entries(velocityTheme.effects.glow).forEach(([key, value]) => {
        cssVars[`--velocity-glow-${key}`] = value;
      });
      Object.entries(velocityTheme.effects.neon).forEach(([key, value]) => {
        cssVars[`--velocity-neon-${key}`] = value;
      });
      if (velocityTheme.effects.ambient) {
        Object.entries(velocityTheme.effects.ambient).forEach(([key, value]) => {
          cssVars[`--velocity-ambient-${key}`] = value;
        });
      }
      if (velocityTheme.effects.particle) {
        Object.entries(velocityTheme.effects.particle).forEach(([key, value]) => {
          cssVars[`--velocity-particle-${key}`] = value;
        });
      }
    }

    // Animation variables
    if (velocityTheme.animations) {
      Object.entries(velocityTheme.animations.duration).forEach(([key, value]) => {
        cssVars[`--velocity-duration-${key}`] = value;
      });
      Object.entries(velocityTheme.animations.easing).forEach(([key, value]) => {
        cssVars[`--velocity-easing-${key}`] = value;
      });
      if (velocityTheme.animations.transform) {
        Object.entries(velocityTheme.animations.transform).forEach(([key, value]) => {
          cssVars[`--velocity-transform-${key}`] = value;
        });
      }
    }

    return cssVars;
  },

  // Apply CSS variables to document root
  applyCSSVariables: () => {
    const cssVars = velocityUtils.generateCSSVariables();
    const root = document.documentElement;
    
    Object.entries(cssVars).forEach(([property, value]) => {
      root.style.setProperty(property, value);
    });
  },

  // Get elevation style by level
  getElevation: (level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => ({
    boxShadow: velocityTheme.elevation?.[level] || 'none',
  }),

  // Get glass morphism style by intensity
  getGlassmorphism: (intensity: 'light' | 'medium' | 'heavy' | 'ultra' = 'medium') => {
    const glassStyle = velocityStyles.glass[intensity];
    return glassStyle;
  },

  // Get neon effect style by color
  getNeonEffect: (color: 'cyan' | 'blue' | 'purple' | 'plasma' | 'laser' | 'electric') => {
    return velocityStyles.neon[color];
  },

  // Get gradient background by type
  getGradient: (type: keyof NonNullable<typeof velocityTheme.gradients>) => ({
    background: velocityTheme.gradients?.[type],
  }),

  // Responsive utilities
  getResponsiveElevation: (level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => {
    // Reduce elevation on mobile for performance
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const adjustedLevel = isMobile && level > 4 ? 4 : level;
    return velocityUtils.getElevation(adjustedLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);
  },

  // Performance utilities
  getPerformanceOptimizedStyle: (style: Record<string, unknown>) => {
    // Disable expensive effects on older/slower devices
    const supportsBackdropFilter = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('backdrop-filter', 'blur(1px)');
    
    if (!supportsBackdropFilter && style.backdropFilter) {
      const { backdropFilter, ...optimizedStyle } = style;
      void backdropFilter; // Acknowledge unused destructured variable
      return optimizedStyle;
    }
    
    return style;
  },

  // Animation utilities
  getHoverAnimation: (type: 'lift' | 'float' | 'glow' = 'lift') => {
    const baseTransition = velocityStyles.transitions.smooth;
    
    switch (type) {
      case 'lift':
        return {
          ...baseTransition,
          '&:hover': velocityStyles.transforms.hover,
        };
      case 'float':
        return {
          ...baseTransition,
          '&:hover': velocityStyles.transforms.float,
        };
      case 'glow':
        return {
          ...baseTransition,
          '&:hover': {
            ...velocityStyles.transforms.hover,
            ...velocityStyles.glow.medium,
          },
        };
      default:
        return baseTransition;
    }
  },
};

// Export styled-components or emotion helpers
export const velocityThemeHelpers = {
  // For use with styled-components or emotion
  getThemeValue: (path: string) => {
    // Helper to get nested theme values
    const pathArray = path.split('.');
    let value: Record<string, unknown> | unknown = velocityTheme;

    for (const key of pathArray) {
      if (value === null || typeof value !== 'object') { value = undefined; break; }
      value = (value as Record<string, unknown>)[key];
      if (value === undefined) break;
    }
    
    return value;
  },

  // Generate media queries
  mediaQueries: {
    mobile: '@media (max-width: 768px)',
    tablet: '@media (max-width: 1024px)',
    desktop: '@media (min-width: 1025px)',
    reducedMotion: '@media (prefers-reduced-motion: reduce)',
    highContrast: '@media (prefers-contrast: high)',
  },
};

// Type-safe theme accessor
export type VelocityStyleKey = keyof typeof velocityStyles;
export type VelocityUtilKey = keyof typeof velocityUtils;