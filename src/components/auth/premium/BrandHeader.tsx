/**
 * BrandHeader - Logo and branding display for login page
 * Uses VFLogo component for white-label support (reads from Settings → localStorage)
 */

import { useState, useEffect } from 'react';

interface BrandHeaderProps {
  companyName?: string;
  tagline?: string;
  subtitle?: string;
}

export function BrandHeader({
  companyName = 'FibreFlow',
  tagline = 'Fiber Network Management',
  subtitle,
}: BrandHeaderProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check for custom uploaded logo in localStorage (same as VFLogo)
    const customLogo = localStorage.getItem('vf-custom-logo');
    if (customLogo) {
      setLogoSrc(customLogo);
    }
  }, []);

  return (
    <div className="flex flex-col items-center space-y-4 lg:space-y-6">
      {/* Logo container with glow effect */}
      <div className="relative">
        {/* Glow backdrop */}
        <div
          className="absolute inset-0 blur-2xl opacity-40"
          style={{
            background: 'radial-gradient(circle, rgba(16, 185, 129, 0.5) 0%, transparent 70%)',
            transform: 'scale(1.5)',
          }}
        />

        {/* Logo */}
        <div className="relative w-20 h-20 lg:w-24 lg:h-24 rounded-2xl bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 flex items-center justify-center shadow-xl">
          {mounted && logoSrc ? (
            <img
              src={logoSrc}
              alt={companyName}
              className="w-16 h-16 lg:w-20 lg:h-20 object-contain"
            />
          ) : (
            <img
              src="/assets/vf/vf-logo.svg"
              alt={companyName}
              className="w-16 h-16 lg:w-20 lg:h-20 object-contain"
              onError={(e) => {
                // Fallback to text logo if image fails
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </div>
      </div>

      {/* Company name with gradient */}
      <div className="text-center">
        <h1
          className="text-3xl lg:text-4xl font-bold tracking-tight"
          style={{
            background: 'linear-gradient(135deg, #10b981 0%, #34d399 50%, #6ee7b7 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {companyName}
        </h1>
        <p className="text-sm lg:text-base text-slate-400 mt-1">
          {subtitle || tagline}
        </p>
      </div>
    </div>
  );
}
