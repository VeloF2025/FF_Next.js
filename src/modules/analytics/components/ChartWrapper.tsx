'use client';

import { ReactNode, Suspense } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface ChartWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
  className?: string;
}

export function ChartWrapper({ children, fallback, className = '' }: ChartWrapperProps) {
  const defaultFallback = (
    <div className={`flex items-center justify-center h-64 ${className}`}>
      <LoadingSpinner size="lg" label="" />
    </div>
  );

  return (
    <Suspense fallback={fallback || defaultFallback}>
      {children}
    </Suspense>
  );
}