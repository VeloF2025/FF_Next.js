import { Shield } from 'lucide-react';
import { useState, useEffect } from 'react';

export function Footer(): JSX.Element {
  // Fix hydration: use static year on initial render, update after mount
  const [currentYear, setCurrentYear] = useState(2026); // Static default for SSR

  useEffect(() => {
    setCurrentYear(new Date().getFullYear());
  }, []);

  return (
    <footer className="bg-[var(--ff-surface-primary)] border-t border-[var(--ff-border-primary)] py-3 px-4 lg:px-6">
      <div className="flex flex-col items-center gap-1">
        {/* Copyright */}
        <div className="text-xs text-[var(--ff-text-tertiary)]">
          © {currentYear} FibreFlow. All rights reserved.
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-3 text-xs text-[var(--ff-text-tertiary)]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            System Online
          </span>
          <span className="text-[var(--ff-text-quaternary)]">•</span>
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3 text-emerald-500" />
            Secure Connection
          </span>
        </div>
      </div>
    </footer>
  );
}