'use client';

import { ReactNode, Suspense } from 'react';
import { RefreshCw } from 'lucide-react';

interface ChartWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
  className?: string;
}

export function ChartWrapper({ children, fallback, className = '' }: ChartWrapperProps) {
  const defaultFallback = (
    <div className={`flex items-center justify-center h-64 ${className}`}>
      <RefreshCw className="w-8 h-8 text-[var(--ff-text-tertiary)] animate-spin" />
    </div>
  );

  return (
    <Suspense fallback={fallback || defaultFallback}>
      {children}
    </Suspense>
  );
}