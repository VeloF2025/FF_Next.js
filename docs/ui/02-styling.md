# Section 4.2: Styling & Theme System

## Overview

FibreFlow uses a **modern styling architecture** combining Tailwind CSS for utility-first styling with a sophisticated custom theme system that supports multiple themes, CSS variables, and dynamic theme switching.

### Styling Stack
- **Tailwind CSS 3.3**: Utility-first CSS framework
- **CSS Custom Properties**: Dynamic theming with CSS variables
- **PostCSS**: CSS processing and optimization
- **Emotion**: CSS-in-JS for dynamic styles (limited use)
- **Theme System**: 5 built-in themes with system preference support

### Design Principles
- **Consistency**: Design tokens ensure visual consistency
- **Flexibility**: Multiple themes for different use cases
- **Performance**: Optimized CSS with PurgeCSS
- **Accessibility**: Color contrast and focus states
- **Responsiveness**: Mobile-first responsive design

## Tailwind Configuration

### Main Configuration (`tailwind.config.js`)

```javascript
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class', // Enable dark mode with class strategy
  theme: {
    extend: {
      colors: {
        // Custom color palette
        primary: {
          50: 'var(--color-primary-50)',
          100: 'var(--color-primary-100)',
          200: 'var(--color-primary-200)',
          300: 'var(--color-primary-300)',
          400: 'var(--color-primary-400)',
          500: 'var(--color-primary-500)',
          600: 'var(--color-primary-600)',
          700: 'var(--color-primary-700)',
          800: 'var(--color-primary-800)',
          900: 'var(--color-primary-900)',
        },
        secondary: {
          // Secondary color scale
        },
        accent: {
          // Accent color scale
        },
        // Semantic colors
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        info: 'var(--color-info)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      spacing: {
        '72': '18rem',
        '84': '21rem',
        '96': '24rem',
      },
      animation: {
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-in',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      screens: {
        '3xl': '1920px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
  ],
}
```

## Theme System

### Theme Configuration (`src/config/themes/`)

The theme system provides 5 distinct themes, each with comprehensive design tokens:

```typescript
// src/config/themes/types.ts
export interface ThemeConfig {
  name: ThemeName;
  displayName: string;
  colors: {
    // Primary palette
    primary: ColorScale;
    secondary: ColorScale;
    accent: ColorScale;
    
    // Semantic colors
    success: string;
    warning: string;
    error: string;
    info: string;
    
    // UI colors
    background: {
      primary: string;
      secondary: string;
      tertiary: string;
    };
    text: {
      primary: string;
      secondary: string;
      tertiary: string;
      inverse: string;
    };
    border: {
      light: string;
      medium: string;
      dark: string;
    };
  };
  typography: {
    fontFamily: {
      sans: string;
      mono: string;
    };
    fontSize: {
      xs: string;
      sm: string;
      base: string;
      lg: string;
      xl: string;
      '2xl': string;
      '3xl': string;
      '4xl': string;
    };
    fontWeight: {
      light: number;
      normal: number;
      medium: number;
      semibold: number;
      bold: number;
    };
  };
  spacing: {
    unit: number;
    scale: number[];
  };
  borderRadius: {
    none: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    full: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
}
```

### Available Themes

#### 1. Light Theme (Default)
```typescript
export const lightTheme: ThemeConfig = {
  name: 'light',
  displayName: 'Light',
  colors: {
    primary: {
      50: '#eff6ff',
      500: '#3b82f6',
      900: '#1e3a8a',
    },
    background: {
      primary: '#ffffff',
      secondary: '#f9fafb',
      tertiary: '#f3f4f6',
    },
    text: {
      primary: '#111827',
      secondary: '#6b7280',
      tertiary: '#9ca3af',
    },
  },
  // ... more config
};
```

#### 2. Dark Theme
```typescript
export const darkTheme: ThemeConfig = {
  name: 'dark',
  displayName: 'Dark',
  colors: {
    primary: {
      50: '#1e3a8a',
      500: '#60a5fa',
      900: '#dbeafe',
    },
    background: {
      primary: '#0f172a',
      secondary: '#1e293b',
      tertiary: '#334155',
    },
    text: {
      primary: '#f1f5f9',
      secondary: '#cbd5e1',
      tertiary: '#94a3b8',
    },
  },
  // ... more config
};
```

#### 3. VF Theme (Corporate)
- Professional blue and gray palette
- Optimized for business dashboards
- High contrast for data visualization

#### 4. FibreFlow Theme (Brand)
- Custom brand colors
- Orange and teal accents
- Matches company branding

#### 5. Velocity Theme (Modern)
- Purple and pink gradients
- Modern, vibrant appearance
- Suited for innovation-focused UI

### Theme Context & Provider

```typescript
// src/contexts/ThemeContext.tsx
interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  systemTheme: 'light' | 'dark' | null;
  enableSystemTheme: boolean;
  toggleSystemTheme: () => void;
}

export function ThemeProvider({ 
  children, 
  defaultTheme = 'light',
  enableSystemTheme = true 
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    return localStorage.getItem('theme-preference') as ThemeName || defaultTheme;
  });
  
  const [useSystemTheme, setUseSystemTheme] = useState(enableSystemTheme);
  const systemTheme = useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light';
  
  // Apply theme CSS variables to document
  useEffect(() => {
    const activeTheme = useSystemTheme ? systemTheme : theme;
    const themeConfig = themes[activeTheme];
    
    // Apply CSS variables
    Object.entries(themeConfig.colors).forEach(([key, value]) => {
      if (typeof value === 'object') {
        Object.entries(value).forEach(([shade, color]) => {
          document.documentElement.style.setProperty(
            `--color-${key}-${shade}`,
            color
          );
        });
      } else {
        document.documentElement.style.setProperty(`--color-${key}`, value);
      }
    });
    
    // Apply class for Tailwind dark mode
    if (activeTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    // Save preference
    localStorage.setItem('theme-preference', activeTheme);
  }, [theme, systemTheme, useSystemTheme]);
  
  return (
    <ThemeContext.Provider value={{
      theme,
      setTheme,
      systemTheme,
      enableSystemTheme: useSystemTheme,
      toggleSystemTheme: () => setUseSystemTheme(!useSystemTheme),
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

## Global Styles

### Base Styles (`src/styles/global.css`)

```css
@import 'tailwindcss/base';
@import 'tailwindcss/components';
@import 'tailwindcss/utilities';

/* Custom base styles */
@layer base {
  /* Typography */
  html {
    @apply antialiased;
    font-family: var(--font-sans);
  }
  
  body {
    @apply bg-background text-foreground;
    background-color: var(--color-background-primary);
    color: var(--color-text-primary);
  }
  
  /* Headings */
  h1 {
    @apply text-4xl font-bold tracking-tight;
  }
  
  h2 {
    @apply text-3xl font-semibold tracking-tight;
  }
  
  h3 {
    @apply text-2xl font-semibold;
  }
  
  h4 {
    @apply text-xl font-medium;
  }
  
  /* Links */
  a {
    @apply text-primary-600 hover:text-primary-700 transition-colors;
  }
  
  /* Focus styles */
  *:focus-visible {
    @apply outline-none ring-2 ring-primary-500 ring-offset-2;
  }
}

/* Component styles */
@layer components {
  /* Button variants */
  .btn {
    @apply px-4 py-2 rounded-md font-medium transition-all duration-200;
    @apply focus:outline-none focus:ring-2 focus:ring-offset-2;
  }
  
  .btn-primary {
    @apply bg-primary-600 text-white hover:bg-primary-700;
    @apply focus:ring-primary-500;
  }
  
  .btn-secondary {
    @apply bg-gray-200 text-gray-900 hover:bg-gray-300;
    @apply focus:ring-gray-500;
  }
  
  .btn-danger {
    @apply bg-red-600 text-white hover:bg-red-700;
    @apply focus:ring-red-500;
  }
  
  /* Card styles */
  .card {
    @apply bg-white rounded-lg shadow-md p-6;
    @apply dark:bg-gray-800;
  }
  
  .card-header {
    @apply text-lg font-semibold mb-4;
  }
  
  /* Form elements */
  .input {
    @apply w-full px-3 py-2 border border-gray-300 rounded-md;
    @apply focus:outline-none focus:ring-2 focus:ring-primary-500;
    @apply dark:bg-gray-700 dark:border-gray-600;
  }
  
  .label {
    @apply block text-sm font-medium text-gray-700 mb-1;
    @apply dark:text-gray-300;
  }
  
  /* Table styles */
  .table {
    @apply min-w-full divide-y divide-gray-200;
  }
  
  .table-header {
    @apply bg-gray-50 dark:bg-gray-900;
  }
  
  .table-row {
    @apply hover:bg-gray-50 dark:hover:bg-gray-800;
  }
}

/* Utility styles */
@layer utilities {
  /* Text truncation */
  .truncate-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  
  /* Custom animations */
  .animate-slide-up {
    animation: slideUp 0.3s ease-out;
  }
  
  @keyframes slideUp {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  
  /* Gradients */
  .gradient-primary {
    background: linear-gradient(135deg, var(--color-primary-400) 0%, var(--color-primary-600) 100%);
  }
  
  .gradient-brand {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }
}
```

## Responsive Design

### Breakpoint System

```typescript
// Tailwind default breakpoints
const breakpoints = {
  sm: '640px',   // Mobile landscape
  md: '768px',   // Tablet portrait
  lg: '1024px',  // Tablet landscape / small laptop
  xl: '1280px',  // Desktop
  '2xl': '1536px', // Large desktop
  '3xl': '1920px', // Extra large screens (custom)
};
```

### Responsive Component Example

```tsx
function ResponsiveLayout() {
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      {/* Mobile: Stack vertically */}
      {/* Tablet: 2 columns */}
      {/* Desktop: 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        {items.map(item => (
          <Card key={item.id} className="w-full">
            {/* Responsive text sizing */}
            <h3 className="text-lg sm:text-xl lg:text-2xl">
              {item.title}
            </h3>
            
            {/* Hide on mobile, show on tablet+ */}
            <p className="hidden md:block text-gray-600">
              {item.description}
            </p>
            
            {/* Responsive spacing */}
            <div className="mt-2 sm:mt-3 lg:mt-4">
              <Button size="sm" className="w-full sm:w-auto">
                View Details
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

## Component Styling Patterns

### Utility-First Approach

```tsx
// Prefer utility classes
<button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
  Click me
</button>

// Over inline styles
<button style={{ padding: '8px 16px', backgroundColor: '#2563eb' }}>
  Click me
</button>
```

### Component Variants with CVA

```typescript
import { cva } from 'class-variance-authority';

const buttonVariants = cva(
  // Base styles
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary-600 text-white hover:bg-primary-700',
        secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
        ghost: 'hover:bg-gray-100 hover:text-gray-900',
        link: 'text-primary-600 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-10 px-4',
        lg: 'h-11 px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

// Usage
<Button variant="secondary" size="lg">
  Large Secondary Button
</Button>
```

### Conditional Styling

```typescript
import { cn } from '@/lib/utils';

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
      {
        'bg-green-100 text-green-800': status === 'active',
        'bg-yellow-100 text-yellow-800': status === 'pending',
        'bg-red-100 text-red-800': status === 'inactive',
        'bg-gray-100 text-gray-800': status === 'archived',
      }
    )}>
      {status}
    </span>
  );
}
```

## Dark Mode Implementation

### Dark Mode Toggle Component

```typescript
function ThemeToggle() {
  const { theme, setTheme, systemTheme, enableSystemTheme, toggleSystemTheme } = useTheme();
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800">
          {theme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="mr-2 h-4 w-4" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="mr-2 h-4 w-4" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={toggleSystemTheme}>
          <Monitor className="mr-2 h-4 w-4" />
          System ({enableSystemTheme ? 'On' : 'Off'})
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### Dark Mode Styles

```css
/* Automatic dark mode with Tailwind */
.dark {
  /* Override CSS variables for dark theme */
  --color-background-primary: #0f172a;
  --color-background-secondary: #1e293b;
  --color-text-primary: #f1f5f9;
  --color-text-secondary: #cbd5e1;
  --color-border: #334155;
}

/* Component with dark mode support */
.card {
  @apply bg-white dark:bg-gray-800;
  @apply text-gray-900 dark:text-gray-100;
  @apply border border-gray-200 dark:border-gray-700;
}
```

## Animation & Transitions

### Predefined Animations

```css
/* Smooth transitions */
.transition-base {
  @apply transition-all duration-200 ease-in-out;
}

/* Hover effects */
.hover-lift {
  @apply transition-transform hover:-translate-y-1 hover:shadow-lg;
}

/* Loading animations */
.skeleton {
  @apply animate-pulse bg-gray-200 dark:bg-gray-700;
}

/* Entrance animations */
.fade-in {
  animation: fadeIn 0.5s ease-in;
}

.slide-in-bottom {
  animation: slideInBottom 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideInBottom {
  from { 
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
```

### React Transition Components

```typescript
import { Transition } from '@headlessui/react';

function Modal({ isOpen, onClose, children }) {
  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30" />
        </Transition.Child>
        
        {/* Modal panel */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <Dialog.Panel className="modal-content">
            {children}
          </Dialog.Panel>
        </Transition.Child>
      </Dialog>
    </Transition>
  );
}
```

## Performance Optimization

### CSS Bundle Optimization

```javascript
// postcss.config.js
module.exports = {
  plugins: {
    'tailwindcss': {},
    'autoprefixer': {},
    'cssnano': process.env.NODE_ENV === 'production' ? {} : false,
  },
}
```

### PurgeCSS Configuration

```javascript
// Tailwind automatically purges unused CSS in production
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './public/index.html',
  ],
  // Safelist specific classes that might be dynamically generated
  safelist: [
    'bg-red-500',
    'bg-green-500',
    'bg-blue-500',
    { pattern: /^(bg|text|border)-(red|green|blue)-(100|500|900)$/ },
  ],
}
```

## Next.js Migration Impact

### CSS Modules Support

```tsx
// styles/Button.module.css
.button {
  @apply px-4 py-2 rounded-md;
}

.primary {
  @apply bg-blue-600 text-white hover:bg-blue-700;
}

// components/Button.tsx
import styles from './Button.module.css';

export function Button({ variant = 'primary', children }) {
  return (
    <button className={`${styles.button} ${styles[variant]}`}>
      {children}
    </button>
  );
}
```

### Next.js App Directory Styling

```tsx
// app/globals.css
@tailwind base;
@tailwind components;
@tailwind utilities;

// app/layout.tsx
import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

## Best Practices

### Do's
- ✅ Use semantic color names (primary, secondary, etc.)
- ✅ Leverage Tailwind's utility classes
- ✅ Maintain consistent spacing using the scale
- ✅ Test in both light and dark modes
- ✅ Use CSS variables for dynamic values
- ✅ Compare new pages to existing reference pages (e.g., Suppliers)

### Don'ts
- ❌ Don't use arbitrary color values
- ❌ Don't mix styling approaches unnecessarily
- ❌ Don't forget responsive design
- ❌ Don't ignore accessibility contrast ratios
- ❌ Don't create deeply nested selectors
- ❌ Don't wrap pages in `bg-[var(--ff-bg-tertiary)]` - it creates wrong background

## Page Layout Anti-Patterns (Dark Mode)

### ❌ WRONG: Gray Background Wrapper
```tsx
// Creates lighter purple/gray (#334155) - WRONG
<AppLayout>
  <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {content}
    </div>
  </div>
</AppLayout>
```

### ✅ CORRECT: Simple Layout (Inherits from AppLayout)
```tsx
// Inherits correct dark background (#0f172a) from AppLayout
<AppLayout>
  <div className="p-6 space-y-6">
    {content}
  </div>
</AppLayout>
```

**Why:** `--ff-bg-tertiary` (#334155) is for inputs/table headers, not page backgrounds. AppLayout already provides the correct dark background.

**Visual test:** Compare your page to `/suppliers` - backgrounds should match exactly.

## Summary

The styling and theme system provides a robust, flexible foundation for the FibreFlow application's UI. With Tailwind CSS for rapid development, comprehensive theming support, and careful attention to responsive design and accessibility, the system ensures a consistent, maintainable, and user-friendly interface across all devices and user preferences.