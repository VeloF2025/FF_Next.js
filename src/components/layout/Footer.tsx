import { Heart, Shield, Zap } from 'lucide-react';
import { useState, useEffect } from 'react';

export function Footer(): JSX.Element {
  // Fix hydration: use static year on initial render, update after mount
  const [currentYear, setCurrentYear] = useState(2026); // Static default for SSR

  useEffect(() => {
    setCurrentYear(new Date().getFullYear());
  }, []);

  return (
    <footer className="bg-[var(--ff-surface-primary)] border-t border-[var(--ff-border-primary)] py-3 px-4 lg:px-6">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-2">
        {/* Left side - Copyright */}
        <div className="flex items-center text-sm text-[var(--ff-text-tertiary)]">
          <span>© {currentYear} FibreFlow. All rights reserved.</span>
        </div>

        {/* Center - Status/Version (desktop only) */}
        <div className="hidden lg:flex items-center space-x-4 text-xs text-[var(--ff-text-tertiary)]">
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-success-500 rounded-full"></div>
            <span>System Online</span>
          </div>
          <div className="flex items-center space-x-1">
            <Shield className="w-3 h-3" />
            <span>Secure Connection</span>
          </div>
          <div className="flex items-center space-x-1">
            <Zap className="w-3 h-3" />
            <span>React v18.3+</span>
          </div>
        </div>

        {/* Right side - Migration info */}
        <div className="flex items-center text-sm text-[var(--ff-text-tertiary)]">
          <span className="flex items-center space-x-1">
            <span>Migrated to React with</span>
            <Heart className="w-3 h-3 text-error-500 fill-current" />
            <span>by VF Team</span>
          </span>
        </div>
      </div>

      {/* Mobile status indicators */}
      <div className="lg:hidden flex justify-center items-center space-x-4 text-xs text-[var(--ff-text-tertiary)] mt-2 pt-2 border-t border-[var(--ff-border-subtle)]">
        <div className="flex items-center space-x-1">
          <div className="w-2 h-2 bg-success-500 rounded-full"></div>
          <span>Online</span>
        </div>
        <div className="flex items-center space-x-1">
          <Shield className="w-3 h-3" />
          <span>Secure</span>
        </div>
        <div className="flex items-center space-x-1">
          <Zap className="w-3 h-3" />
          <span>React</span>
        </div>
      </div>
    </footer>
  );
}