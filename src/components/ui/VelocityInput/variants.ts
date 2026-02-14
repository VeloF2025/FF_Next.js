/**
 * VelocityInput Variants
 * Style variants and configurations using class-variance-authority
 */

import { cva } from 'class-variance-authority';

export const velocityInputVariants = cva(
  // Base styles with VELOCITY enhancements
  'w-full rounded-lg border-0 bg-transparent px-4 py-3 text-base placeholder-transparent transition-all duration-300 ease-in-out focus:outline-none focus:ring-0 resize-none',
  {
    variants: {
      variant: {
        glass: 'bg-card/8 backdrop-blur-md border border-white/20 text-white focus:bg-card/12 focus:border-blue-400/60 focus:shadow-[0_0_25px_rgba(0,102,255,0.4)] hover:border-white/30',
        'glass-dark': 'bg-black/25 backdrop-blur-md border border-white/15 text-white focus:bg-black/35 focus:border-blue-400/60 focus:shadow-[0_0_25px_rgba(0,102,255,0.4)] hover:border-white/25',
        'glass-intense': 'bg-card/15 backdrop-blur-lg border border-white/30 text-white focus:bg-card/20 focus:border-blue-400/70 focus:shadow-[0_0_30px_rgba(0,102,255,0.5)] hover:border-white/40',
        
        // Enhanced neon variants
        neon: 'bg-transparent border-2 border-cyan-400/40 text-cyan-100 focus:border-cyan-300/80 focus:shadow-[0_0_25px_rgba(0,245,255,0.5)] focus:text-cyan-50 hover:border-cyan-400/60',
        'neon-purple': 'bg-transparent border-2 border-purple-400/40 text-purple-100 focus:border-purple-300/80 focus:shadow-[0_0_25px_rgba(99,102,241,0.5)] focus:text-purple-50 hover:border-purple-400/60',
        'neon-pink': 'bg-transparent border-2 border-pink-400/40 text-pink-100 focus:border-pink-300/80 focus:shadow-[0_0_25px_rgba(236,72,153,0.5)] focus:text-pink-50 hover:border-pink-400/60',
        'neon-green': 'bg-transparent border-2 border-green-400/40 text-green-100 focus:border-green-300/80 focus:shadow-[0_0_25px_rgba(34,197,94,0.5)] focus:text-green-50 hover:border-green-400/60',
        
        // Premium variants
        holographic: 'bg-gradient-to-br from-transparent via-purple-500/8 to-cyan-500/8 border border-purple-400/25 text-white focus:border-cyan-400/60 backdrop-blur-md focus:shadow-[0_0_25px_rgba(147,51,234,0.4)] hover:border-purple-400/40',
        
        plasma: 'bg-gradient-conic from-cyan-400/10 via-purple-500/10 to-pink-500/10 border border-purple-400/25 text-white focus:border-cyan-400/60 backdrop-blur-sm focus:shadow-[0_0_30px_rgba(138,43,226,0.4)] hover:border-purple-400/40',
        
        aurora: 'bg-gradient-to-br from-green-400/8 via-blue-500/8 to-purple-600/8 border border-blue-400/25 text-white focus:border-green-400/60 backdrop-blur-sm focus:shadow-[0_0_25px_rgba(34,197,94,0.3)] hover:border-blue-400/40',
        
        // Solid variants
        solid: 'bg-blue-900/40 border border-blue-600/50 text-blue-100 focus:bg-blue-900/60 focus:border-blue-500 focus:shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:border-blue-600/70',
        minimal: 'bg-transparent border-b-2 border-white/20 rounded-none text-white focus:border-blue-400/60 focus:shadow-[0_2px_8px_rgba(0,102,255,0.3)] hover:border-white/30 px-0',
      },
      size: {
        sm: 'px-3 py-2 text-sm',
        md: 'px-4 py-3 text-base',
        lg: 'px-5 py-4 text-lg',
      },
      state: {
        default: '',
        error: 'border-red-400/50 text-red-100 focus:border-red-400 focus:shadow-[0_0_20px_rgba(239,68,68,0.4)]',
        success: 'border-green-400/50 text-green-100 focus:border-green-400 focus:shadow-[0_0_20px_rgba(34,197,94,0.4)]',
        warning: 'border-yellow-400/50 text-yellow-100 focus:border-yellow-400 focus:shadow-[0_0_20px_rgba(245,158,11,0.4)]',
      },
    },
    defaultVariants: {
      variant: 'glass',
      size: 'md',
      state: 'default',
    },
  }
);

export const velocityLabelVariants = cva(
  // Base label styles
  'absolute left-4 transition-all duration-300 pointer-events-none origin-left',
  {
    variants: {
      variant: {
        glass: 'text-white/70 peer-focus:text-blue-300',
        'glass-dark': 'text-white/70 peer-focus:text-blue-300',
        'glass-intense': 'text-white/70 peer-focus:text-blue-300',
        neon: 'text-cyan-300/70 peer-focus:text-cyan-200',
        'neon-purple': 'text-purple-300/70 peer-focus:text-purple-200',
        'neon-pink': 'text-pink-300/70 peer-focus:text-pink-200',
        'neon-green': 'text-green-300/70 peer-focus:text-green-200',
        holographic: 'text-white/70 peer-focus:text-cyan-300',
        plasma: 'text-white/70 peer-focus:text-cyan-300',
        aurora: 'text-white/70 peer-focus:text-green-300',
        solid: 'text-blue-200/70 peer-focus:text-blue-100',
        minimal: 'text-white/70 peer-focus:text-blue-300',
      },
      size: {
        sm: 'text-sm',
        md: 'text-base',
        lg: 'text-lg',
      },
      state: {
        default: '',
        error: 'text-red-300 peer-focus:text-red-200',
        success: 'text-green-300 peer-focus:text-green-200',
        warning: 'text-yellow-300 peer-focus:text-yellow-200',
      },
      floating: {
        true: '-top-2 left-3 scale-75 bg-black/50 px-2 rounded',
        false: '',
      },
    },
    compoundVariants: [
      {
        size: 'sm',
        floating: false,
        class: 'top-2',
      },
      {
        size: 'md', 
        floating: false,
        class: 'top-3',
      },
      {
        size: 'lg',
        floating: false,
        class: 'top-4',
      },
    ],
    defaultVariants: {
      variant: 'glass',
      size: 'md',
      state: 'default',
      floating: false,
    },
  }
);