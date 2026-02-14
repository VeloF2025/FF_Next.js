/**
 * GlassCard Component - Premium Glassmorphism card with VELOCITY theme integration
 * Features: Multiple variants, elevation system, responsive design, hover animations
 * 
 * Enhanced with:
 * - VELOCITY theme color system
 * - Performance optimizations
 * - Accessibility features
 * - Mobile responsive glass effects
 */

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { useVelocityResponsive } from '@/config/themes';

const glassCardVariants = cva(
  // Base styles - glassmorphism foundation with VELOCITY enhancements
  'relative backdrop-blur-md border border-white/10 overflow-hidden transition-all duration-300',
  {
    variants: {
      variant: {
        // Core transparency levels
        subtle: 'bg-card/5 hover:bg-card/8 border-white/10 hover:border-white/15',
        medium: 'bg-card/10 hover:bg-card/15 border-white/15 hover:border-white/20', 
        strong: 'bg-card/15 hover:bg-card/20 border-white/20 hover:border-white/25',
        
        // Enhanced effect variants
        glow: 'bg-card/10 hover:bg-card/15 border-blue-400/20 shadow-[0_0_20px_rgba(0,102,255,0.3)] hover:shadow-[0_0_30px_rgba(0,102,255,0.5)]',
        
        neon: 'bg-card/5 hover:bg-cyan-400/5 border-cyan-400/30 hover:border-cyan-300/50 shadow-[0_0_15px_rgba(0,245,255,0.2)] hover:shadow-[0_0_25px_rgba(0,245,255,0.4)]',
        
        holographic: 'bg-gradient-to-br from-white/8 via-purple-500/8 to-cyan-500/8 hover:from-white/12 hover:via-purple-500/12 hover:to-cyan-500/12 border-transparent bg-clip-padding shadow-[0_0_20px_rgba(99,102,241,0.2)]',
        
        // New premium variants
        'neon-purple': 'bg-card/5 hover:bg-purple-500/5 border-purple-400/30 hover:border-purple-300/50 shadow-[0_0_15px_rgba(99,102,241,0.2)] hover:shadow-[0_0_25px_rgba(99,102,241,0.4)]',
        
        'neon-pink': 'bg-card/5 hover:bg-pink-500/5 border-pink-400/30 hover:border-pink-300/50 shadow-[0_0_15px_rgba(236,72,153,0.2)] hover:shadow-[0_0_25px_rgba(236,72,153,0.4)]',
        
        plasma: 'bg-gradient-conic from-cyan-400/10 via-purple-500/10 to-pink-500/10 hover:from-cyan-400/15 hover:via-purple-500/15 hover:to-pink-500/15 border border-purple-400/20 shadow-[0_0_30px_rgba(138,43,226,0.3)]',
        
        aurora: 'bg-gradient-to-br from-green-400/8 via-blue-500/8 to-purple-600/8 hover:from-green-400/12 hover:via-blue-500/12 hover:to-purple-600/12 border border-blue-400/20 shadow-[0_0_25px_rgba(34,197,94,0.2)]',
      },
      blur: {
        none: 'backdrop-blur-none',
        light: 'backdrop-blur-sm',
        medium: 'backdrop-blur-md',
        heavy: 'backdrop-blur-lg',
        ultra: 'backdrop-blur-xl',
      },
      elevation: {
        0: '',
        1: 'shadow-[0_1px_3px_rgba(0,0,0,0.2),0_0_10px_rgba(33,150,243,0.1)]',
        2: 'shadow-[0_2px_6px_rgba(0,0,0,0.3),0_0_15px_rgba(33,150,243,0.15)]',
        3: 'shadow-[0_4px_12px_rgba(0,0,0,0.4),0_0_20px_rgba(33,150,243,0.2)]',
        4: 'shadow-[0_6px_18px_rgba(0,0,0,0.5),0_0_25px_rgba(33,150,243,0.25)]',
        5: 'shadow-[0_8px_24px_rgba(0,0,0,0.6),0_0_30px_rgba(33,150,243,0.3)]',
        6: 'shadow-[0_12px_30px_rgba(0,0,0,0.7),0_0_35px_rgba(33,150,243,0.35)]',
        7: 'shadow-[0_16px_36px_rgba(0,0,0,0.8),0_0_40px_rgba(33,150,243,0.4)]',
        8: 'shadow-[0_24px_48px_rgba(0,0,0,0.9),0_0_50px_rgba(33,150,243,0.5)]',
      },
      rounded: {
        none: 'rounded-none',
        sm: 'rounded-sm',
        md: 'rounded-md',
        lg: 'rounded-lg',
        xl: 'rounded-xl',
        '2xl': 'rounded-2xl',
        full: 'rounded-full',
      },
      padding: {
        none: 'p-0',
        sm: 'p-3',
        md: 'p-4',
        lg: 'p-6',
        xl: 'p-8',
      },
    },
    defaultVariants: {
      variant: 'medium',
      blur: 'medium',
      elevation: 3,
      rounded: 'lg',
      padding: 'md',
    },
  }
);

export interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassCardVariants> {
  children: React.ReactNode;
  /** Enable hover effects (scale, border changes) */
  hover?: boolean;
  /** Enable smooth animations */
  animated?: boolean;
  /** Show loading state with shimmer effect */
  loading?: boolean;
  /** Accessibility label for screen readers */
  'aria-label'?: string;
  /** Custom glass intensity for dynamic effects */
  glassIntensity?: 'light' | 'medium' | 'heavy' | 'ultra';
  /** Custom neon color for neon variants */
  neonColor?: string;
  /** Disable glass effects on mobile for performance */
  mobileOptimized?: boolean;
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ 
    className, 
    variant, 
    blur, 
    elevation, 
    rounded, 
    padding, 
    hover = true,
    animated = true,
    loading = false,
    glassIntensity,
    neonColor,
    mobileOptimized = true,
    children,
    style,
    ...props 
  }, ref) => {
    // Removed unused utils variable
    const { getResponsiveGlass } = useVelocityResponsive();
    
    // Get responsive glass effect if mobile optimization is enabled
    const responsiveGlass = React.useMemo(() => {
      if (mobileOptimized && glassIntensity) {
        return getResponsiveGlass(glassIntensity);
      }
      return null;
    }, [mobileOptimized, glassIntensity, getResponsiveGlass]);
    
    // Custom neon color styling
    const customNeonStyle = React.useMemo(() => {
      if (neonColor && (variant?.includes('neon') || variant === 'glow')) {
        return {
          borderColor: neonColor,
          boxShadow: `0 0 20px ${neonColor}40, 0 0 40px ${neonColor}20`,
        };
      }
      return {};
    }, [neonColor, variant]);
    
    const baseClasses = cn(
      glassCardVariants({ variant, blur, elevation, rounded, padding }),
      // Enhanced animation classes
      animated && 'transition-all duration-300 ease-in-out',
      // Enhanced hover effects with VELOCITY transforms
      hover && 'hover:scale-[1.02] hover:-translate-y-1',
      // Loading shimmer effect
      loading && 'animate-pulse',
      // Focus styles for accessibility
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
      className
    );
    
    const combinedStyle = {
      ...style,
      ...customNeonStyle,
      ...(responsiveGlass || {}),
    };

    return (
      <div
        ref={ref}
        className={baseClasses}
        style={combinedStyle}
        role={props.role || 'article'}
        tabIndex={props.tabIndex || 0}
        {...props}
      >
        {/* Loading shimmer overlay */}
        {loading && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer bg-[length:200%_100%] pointer-events-none" />
        )}
        
        {/* Enhanced gradient overlays for special effects */}
        {variant === 'holographic' && (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-transparent via-purple-500/8 to-cyan-500/8 pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-tr from-cyan-400/5 via-transparent to-purple-600/5 pointer-events-none" />
          </>
        )}
        
        {variant === 'plasma' && (
          <div className="absolute inset-0 bg-gradient-conic from-cyan-400/5 via-purple-500/5 to-pink-500/5 animate-spin-slow pointer-events-none" />
        )}
        
        {variant === 'aurora' && (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-green-400/8 via-blue-500/8 to-purple-600/8 pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-400/5 via-green-500/5 to-purple-500/5 animate-pulse pointer-events-none" />
          </>
        )}
        
        {/* Enhanced glow overlay */}
        {variant === 'glow' && (
          <div className="absolute inset-0 bg-gradient-radial from-blue-500/10 via-cyan-500/5 to-transparent pointer-events-none" />
        )}
        
        {/* Content with proper z-index */}
        <div className="relative z-10">
          {children}
        </div>
      </div>
    );
  }
);

GlassCard.displayName = 'GlassCard';

export { GlassCard, glassCardVariants };