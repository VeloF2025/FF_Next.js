import { useState } from 'react';
import { 
  Sun, 
  Moon, 
  Monitor, 
  Palette, 
  ChevronDown,
  Check,
  Zap
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { ThemeName } from '@/types/theme.types';
import { getThemeDisplayName, getThemeDescription } from '@/config/themes';

interface ThemeToggleProps {
  variant?: 'button' | 'dropdown' | 'compact';
  showLabel?: boolean;
  className?: string;
}

const themeIcons: Record<ThemeName, typeof Sun> = {
  light: Sun,
  dark: Moon,
  vf: Palette,
  fibreflow: Palette,
  velocity: Zap,
};

export function ThemeToggle({ 
  variant = 'dropdown', 
  showLabel = true, 
  className = '' 
}: ThemeToggleProps) {
  const { 
    currentTheme, 
    availableThemes, 
    setTheme, 
    toggleTheme, 
    resetToSystemTheme, 
    isSystemTheme 
  } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  // Simple toggle button (light/dark only)
  if (variant === 'button') {
    const Icon = currentTheme === 'dark' ? Sun : Moon;
    
    return (
      <button
        onClick={toggleTheme}
        className={`
          inline-flex items-center justify-center p-2 
          rounded-lg border border-[var(--ff-border-primary)]
          bg-[var(--ff-surface-primary)] text-[var(--ff-text-primary)]
          hover:bg-[var(--ff-surface-secondary)]
          focus:outline-none focus:ring-2 focus:ring-[var(--ff-border-focus)]
          transition-colors duration-200
          ${className}
        `}
        title={`Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} theme`}
      >
        <Icon className="h-5 w-5" />
        {showLabel && (
          <span className="ml-2 text-sm font-medium">
            {currentTheme === 'dark' ? 'Light' : 'Dark'}
          </span>
        )}
      </button>
    );
  }

  // Compact version (icon only with tooltip)
  if (variant === 'compact') {
    const Icon = themeIcons[currentTheme];
    
    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`
            inline-flex items-center justify-center p-2 
            rounded-lg text-[var(--ff-text-secondary)]
            hover:text-[var(--ff-text-primary)]
            hover:bg-[var(--ff-surface-secondary)]
            transition-colors duration-200
            ${className}
          `}
          title={`Current theme: ${getThemeDisplayName(currentTheme)}`}
        >
          <Icon className="h-5 w-5" />
        </button>

        {isOpen && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 z-10" 
              onClick={() => setIsOpen(false)} 
            />
            
            {/* Dropdown */}
            <div className="absolute right-0 top-full mt-2 z-20 w-48 py-2 bg-[var(--ff-surface-elevated)] border border-[var(--ff-border-primary)] rounded-lg shadow-lg">
              <div className="px-3 py-2 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                Select Theme
              </div>
              
              {availableThemes.map((theme) => {
                const ThemeIcon = themeIcons[theme];
                const isSelected = currentTheme === theme;
                
                return (
                  <button
                    key={theme}
                    onClick={() => {
                      setTheme(theme);
                      setIsOpen(false);
                    }}
                    className={`
                      w-full px-3 py-2 text-left flex items-center
                      hover:bg-[var(--ff-surface-secondary)]
                      ${isSelected ? 'bg-[var(--ff-surface-secondary)]' : ''}
                    `}
                  >
                    <ThemeIcon className="h-4 w-4 mr-3 text-[var(--ff-text-tertiary)]" />
                    <span className="text-sm text-[var(--ff-text-primary)]">
                      {getThemeDisplayName(theme)}
                    </span>
                    {isSelected && (
                      <Check className="h-4 w-4 ml-auto text-[var(--ff-text-accent)]" />
                    )}
                  </button>
                );
              })}
              
              <hr className="my-2 border-[var(--ff-border-secondary)]" />
              
              <button
                onClick={() => {
                  resetToSystemTheme();
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left flex items-center hover:bg-[var(--ff-surface-secondary)]"
              >
                <Monitor className="h-4 w-4 mr-3 text-[var(--ff-text-tertiary)]" />
                <span className="text-sm text-[var(--ff-text-primary)]">
                  System
                </span>
                {isSystemTheme && (
                  <Check className="h-4 w-4 ml-auto text-[var(--ff-text-accent)]" />
                )}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Full dropdown version
  const Icon = themeIcons[currentTheme];
  
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          inline-flex items-center px-3 py-2 
          rounded-lg border border-[var(--ff-border-primary)]
          bg-[var(--ff-surface-primary)] text-[var(--ff-text-primary)]
          hover:bg-[var(--ff-surface-secondary)]
          focus:outline-none focus:ring-2 focus:ring-[var(--ff-border-focus)]
          transition-colors duration-200
          ${className}
        `}
      >
        <Icon className="h-4 w-4" />
        {showLabel && (
          <>
            <span className="ml-2 text-sm font-medium">
              {isSystemTheme ? 'System' : getThemeDisplayName(currentTheme)}
            </span>
            <ChevronDown className="ml-2 h-4 w-4" />
          </>
        )}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)} 
          />
          
          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 z-20 w-64 py-2 bg-[var(--ff-surface-elevated)] border border-[var(--ff-border-primary)] rounded-lg shadow-lg">
            <div className="px-3 py-2 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
              Select Theme
            </div>
            
            {availableThemes.map((theme) => {
              const ThemeIcon = themeIcons[theme];
              const isSelected = currentTheme === theme && !isSystemTheme;
              
              return (
                <button
                  key={theme}
                  onClick={() => {
                    setTheme(theme);
                    setIsOpen(false);
                  }}
                  className={`
                    w-full px-3 py-2 text-left flex items-start
                    hover:bg-[var(--ff-surface-secondary)]
                    ${isSelected ? 'bg-[var(--ff-surface-secondary)]' : ''}
                  `}
                >
                  <ThemeIcon className="h-4 w-4 mt-0.5 mr-3 text-[var(--ff-text-tertiary)]" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {getThemeDisplayName(theme)}
                    </div>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">
                      {getThemeDescription(theme)}
                    </div>
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 mt-0.5 text-[var(--ff-text-accent)]" />
                  )}
                </button>
              );
            })}
            
            <hr className="my-2 border-[var(--ff-border-secondary)]" />
            
            <button
              onClick={() => {
                resetToSystemTheme();
                setIsOpen(false);
              }}
              className={`
                w-full px-3 py-2 text-left flex items-start
                hover:bg-[var(--ff-surface-secondary)]
                ${isSystemTheme ? 'bg-[var(--ff-surface-secondary)]' : ''}
              `}
            >
              <Monitor className="h-4 w-4 mt-0.5 mr-3 text-[var(--ff-text-tertiary)]" />
              <div className="flex-1">
                <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                  System
                </div>
                <div className="text-xs text-[var(--ff-text-tertiary)]">
                  Use your system&apos;s theme preference
                </div>
              </div>
              {isSystemTheme && (
                <Check className="h-4 w-4 mt-0.5 text-[var(--ff-text-accent)]" />
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}