/**
 * ProcurementLayout — wrapper layout for Procurement module pages.
 */
import React from 'react';

interface ProcurementLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export function ProcurementLayout({ children, className }: ProcurementLayoutProps) {
  return (
    <div className={className}>
      {children}
    </div>
  );
}
