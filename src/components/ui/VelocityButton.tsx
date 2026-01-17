/**
 * VelocityButton Component - Premium button with glassmorphism and neon effects
 * Features: 12+ premium variants, glass morphism, neon glow, holographic effects, premium animations
 * 
 * Enhanced with:
 * - VELOCITY theme integration
 * - Performance optimizations
 * - Accessibility features
 * - Size variants (xs, sm, md, lg, xl)
 * - Icon support with proper spacing
 * - Loading states with premium animations
 */

import React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
// Removed unused useVelocityTheme import

const velocityButtonVariants = cva(
  // Base styles with VELOCITY enhancements
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-all duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-50 relative overflow-hidden',
  {
    variants: {
      variant: {
        // Glass morphism variants (enhanced)
        glass: 'bg-white/10 text-white hover:bg-white/20 backdrop-blur-md border border-white/20 hover:border-white/30 hover:shadow-lg hover:scale-105 active:scale-95',
        'glass-primary': 'bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 backdrop-blur-md border border-blue-400/30 hover:border-blue-400/50 hover:shadow-[0_8px_32px_rgba(0,102,255,0.4)] hover:scale-105 active:scale-95',
        'glass-success': 'bg-green-500/20 text-green-100 hover:bg-green-500/30 backdrop-blur-md border border-green-400/30 hover:border-green-400/50 hover:shadow-[0_8px_32px_rgba(34,197,94,0.3)] hover:scale-105 active:scale-95',
        'glass-warning': 'bg-yellow-500/20 text-yellow-100 hover:bg-yellow-500/30 backdrop-blur-md border border-yellow-400/30 hover:border-yellow-400/50 hover:shadow-[0_8px_32px_rgba(245,158,11,0.3)] hover:scale-105 active:scale-95',
        'glass-destructive': 'bg-red-500/20 text-red-100 hover:bg-red-500/30 backdrop-blur-md border border-red-400/30 hover:border-red-400/50 hover:shadow-[0_8px_32px_rgba(239,68,68,0.3)] hover:scale-105 active:scale-95',
        
        // Neon glow variants (enhanced)
        neon: 'bg-transparent text-cyan-300 border-2 border-cyan-400/50 hover:bg-cyan-400/10 hover:text-cyan-100 hover:border-cyan-300 hover:shadow-[0_0_20px_rgba(0,245,255,0.6)] hover:scale-105 active:scale-95',
        'neon-purple': 'bg-transparent text-purple-300 border-2 border-purple-400/50 hover:bg-purple-400/10 hover:text-purple-100 hover:border-purple-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.6)] hover:scale-105 active:scale-95',
        'neon-pink': 'bg-transparent text-pink-300 border-2 border-pink-400/50 hover:bg-pink-400/10 hover:text-pink-100 hover:border-pink-300 hover:shadow-[0_0_20px_rgba(236,72,153,0.6)] hover:scale-105 active:scale-95',
        'neon-green': 'bg-transparent text-green-300 border-2 border-green-400/50 hover:bg-green-400/10 hover:text-green-100 hover:border-green-300 hover:shadow-[0_0_20px_rgba(34,197,94,0.6)] hover:scale-105 active:scale-95',
        
        // Premium gradient variants
        gradient: 'bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600 border-0 hover:shadow-[0_8px_32px_rgba(79,70,229,0.5)] hover:scale-105 active:scale-95',
        'gradient-neon': 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 text-white hover:from-cyan-300 hover:via-blue-400 hover:to-purple-400 border-0 hover:shadow-[0_8px_32px_rgba(59,130,246,0.7)] hover:scale-105 active:scale-95',
        'gradient-sunset': 'bg-gradient-to-r from-orange-400 via-pink-500 to-purple-600 text-white hover:from-orange-300 hover:via-pink-400 hover:to-purple-500 border-0 hover:shadow-[0_8px_32px_rgba(251,146,60,0.5)] hover:scale-105 active:scale-95',
        'gradient-ocean': 'bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-700 text-white hover:from-cyan-400 hover:via-blue-500 hover:to-indigo-600 border-0 hover:shadow-[0_8px_32px_rgba(6,182,212,0.5)] hover:scale-105 active:scale-95',
        
        // Holographic and special effects
        holographic: 'bg-gradient-to-br from-transparent via-purple-500/10 to-cyan-500/10 text-white border border-purple-400/30 backdrop-blur-md hover:from-purple-500/20 hover:to-cyan-500/20 hover:shadow-[0_8px_32px_rgba(147,51,234,0.4)] hover:scale-105 active:scale-95',
        
        // NEW Premium variants
        plasma: 'bg-gradient-conic from-cyan-400 via-purple-500 to-pink-500 text-white border-0 hover:shadow-[0_8px_40px_rgba(138,43,226,0.6)] hover:brightness-110 hover:scale-105 active:scale-95',
        
        aurora: 'bg-gradient-to-br from-green-400 via-blue-500 to-purple-600 text-white border-0 hover:shadow-[0_8px_32px_rgba(34,197,94,0.4)] hover:brightness-110 hover:scale-105 active:scale-95',
        
        // Special effects (enhanced)
        pulse: 'bg-blue-500/20 text-blue-100 border border-blue-400/30 backdrop-blur-md animate-pulse hover:animate-none hover:bg-blue-500/30 hover:scale-105 active:scale-95',
        
        shimmer: 'bg-gradient-to-r from-transparent via-white/10 to-transparent bg-[length:200%_100%] animate-shimmer text-white border border-white/20 backdrop-blur-md hover:border-white/40 hover:scale-105 active:scale-95',
        
        glow: 'bg-blue-500/30 text-white border border-blue-400/50 backdrop-blur-md shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] hover:bg-blue-500/40 hover:scale-105 active:scale-95',
        
        // Minimal and solid variants
        solid: 'bg-blue-600 text-white hover:bg-blue-700 border-0 hover:shadow-lg hover:scale-105 active:scale-95',
        'solid-success': 'bg-green-600 text-white hover:bg-green-700 border-0 hover:shadow-lg hover:scale-105 active:scale-95',
        'solid-warning': 'bg-yellow-600 text-white hover:bg-yellow-700 border-0 hover:shadow-lg hover:scale-105 active:scale-95',
        'solid-destructive': 'bg-red-600 text-white hover:bg-red-700 border-0 hover:shadow-lg hover:scale-105 active:scale-95',
        
        outline: 'bg-transparent text-blue-400 border border-blue-400/50 hover:bg-blue-400/10 hover:border-blue-400 hover:scale-105 active:scale-95',
        ghost: 'bg-transparent text-white hover:bg-white/10 hover:scale-105 active:scale-95',
      },
      size: {
        xs: 'h-7 px-2 text-xs',
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 py-2',
        lg: 'h-11 px-6 text-base',
        xl: 'h-12 px-8 text-lg',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
        'icon-xs': 'h-6 w-6',
      },
      glow: {
        none: '',
        subtle: 'hover:shadow-[0_0_15px_rgba(59,130,246,0.3)]',
        medium: 'hover:shadow-[0_0_25px_rgba(59,130,246,0.5)]',
        strong: 'hover:shadow-[0_0_35px_rgba(59,130,246,0.7)]',
      },
    },
    defaultVariants: {
      variant: 'glass-primary',
      size: 'md',
      glow: 'subtle',
    },
  }
);

export interface VelocityButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof velocityButtonVariants> {
  /** Render as child component (using Radix Slot) */
  asChild?: boolean;
  /** Show loading state with premium spinner */
  loading?: boolean;
  /** Icon element to display */
  icon?: React.ReactNode;
  /** Position of icon relative to text */
  iconPosition?: 'left' | 'right';
  /** Loading text to show during loading state */
  loadingText?: string;
  /** Ripple effect on click */
  ripple?: boolean;
  /** Custom neon color for neon variants */
  neonColor?: string;
  /** Tooltip text */
  tooltip?: string;
  /** Full width button */
  fullWidth?: boolean;
}

const VelocityButton = React.forwardRef<HTMLButtonElement, VelocityButtonProps>(
  ({ 
    className, 
    variant, 
    size, 
    glow,
    asChild = false, 
    loading = false,
    loadingText,
    icon,
    iconPosition = 'left',
    ripple = false,
    neonColor,
    tooltip,
    fullWidth = false,
    children,
    disabled,
    onClick,
    style,
    ...props 
  }, ref) => {
    const Comp = asChild ? Slot : 'button';
    // Removed unused utils variable
    const [isClicked, setIsClicked] = React.useState(false);
    
    const isDisabled = disabled || loading;
    
    // Custom neon color styling
    const customNeonStyle = React.useMemo(() => {
      if (neonColor && variant?.includes('neon')) {
        return {
          borderColor: neonColor,
          color: neonColor,
          '--neon-glow': `0 0 20px ${neonColor}60`,
        } as React.CSSProperties;
      }
      return {};
    }, [neonColor, variant]);
    
    // Handle click with ripple effect
    const handleClick = React.useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
      if (ripple && !isDisabled) {
        setIsClicked(true);
        setTimeout(() => setIsClicked(false), 300);
      }
      onClick?.(e);
    }, [ripple, isDisabled, onClick]);
    
    // Loading spinner size based on button size
    const spinnerSize = React.useMemo(() => {
      switch (size) {
        case 'xs': return 'h-3 w-3';
        case 'sm': return 'h-3 w-3';
        case 'md': return 'h-4 w-4';
        case 'lg': return 'h-5 w-5';
        case 'xl': return 'h-5 w-5';
        case 'icon':
        case 'icon-sm':
        case 'icon-xs': return 'h-4 w-4';
        default: return 'h-4 w-4';
      }
    }, [size]);
    
    const combinedStyle = {
      ...style,
      ...customNeonStyle,
    };
    
    const buttonContent = (
      <>
        {/* Ripple effect overlay */}
        {ripple && isClicked && (
          <div className="absolute inset-0 bg-white/20 animate-ping pointer-events-none" />
        )}
        
        {/* Loading spinner with neon effect */}
        {loading && (
          <div className="flex items-center">
            <svg 
              className={cn(
                'animate-spin',
                spinnerSize,
                (children || loadingText) && 'mr-2',
                variant?.includes('neon') && 'drop-shadow-[0_0_8px_currentColor]'
              )}
              xmlns="http://www.w3.org/2000/svg" 
              fill="none" 
              viewBox="0 0 24 24"
            >
              <circle 
                className="opacity-25" 
                cx="12" 
                cy="12" 
                r="10" 
                stroke="currentColor" 
                strokeWidth="2"
              />
              <path 
                className="opacity-75" 
                fill="currentColor" 
                d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {loadingText && (
              <span className="animate-pulse">{loadingText}</span>
            )}
          </div>
        )}
        
        {/* Left icon */}
        {!loading && icon && iconPosition === 'left' && (
          <span className={cn(
            'flex items-center',
            children && 'mr-2',
            variant?.includes('neon') && 'drop-shadow-[0_0_4px_currentColor]'
          )}>
            {icon}
          </span>
        )}
        
        {/* Button content */}
        {!loading && children && (
          <span className={variant?.includes('neon') ? 'drop-shadow-[0_0_4px_currentColor]' : ''}>
            {children}
          </span>
        )}
        
        {/* Right icon */}
        {!loading && icon && iconPosition === 'right' && (
          <span className={cn(
            'flex items-center',
            children && 'ml-2',
            variant?.includes('neon') && 'drop-shadow-[0_0_4px_currentColor]'
          )}>
            {icon}
          </span>
        )}
        
        {/* Shimmer effect for shimmer variant */}
        {variant === 'shimmer' && !loading && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent bg-[length:200%_100%] animate-shimmer pointer-events-none" />
        )}
        
        {/* Plasma rotation overlay */}
        {variant === 'plasma' && !loading && (
          <div className="absolute inset-0 bg-gradient-conic from-cyan-400/20 via-purple-500/20 to-pink-500/20 animate-spin-slow pointer-events-none" />
        )}
      </>
    );
    
    const buttonElement = (
      <Comp
        ref={ref}
        className={cn(
          velocityButtonVariants({ variant, size, glow }),
          // Loading state
          loading && 'cursor-wait',
          // Full width
          fullWidth && 'w-full',
          // Enhanced focus styles
          'focus-visible:ring-blue-400/50',
          // Prevent double transform application
          'transform-gpu',
          className
        )}
        style={combinedStyle}
        disabled={isDisabled}
        onClick={handleClick}
        aria-label={tooltip}
        {...props}
      >
        {buttonContent}
      </Comp>
    );
    
    // Wrap with tooltip if provided
    if (tooltip && !asChild) {
      return (
        <div className="relative inline-block group">
          {buttonElement}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-black/90 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
            {tooltip}
          </div>
        </div>
      );
    }
    
    return buttonElement;
  }
);

VelocityButton.displayName = 'VelocityButton';

export { VelocityButton, velocityButtonVariants };