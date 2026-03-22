// import React from 'react'; // Not used in this component
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ProcurementBreadcrumb } from '../../types';

interface ProcurementBreadcrumbsProps {
  breadcrumbs: ProcurementBreadcrumb[];
}

/**
 * Procurement-specific breadcrumb component
 * Provides consistent navigation breadcrumbs across all procurement pages
 */
export function ProcurementBreadcrumbs({ breadcrumbs }: ProcurementBreadcrumbsProps) {
  return (
    <nav className="flex" aria-label="Breadcrumb">
      <ol className="flex items-center space-x-2">
        {breadcrumbs.map((breadcrumb, index) => (
          <li key={index} className="flex items-center">
            {index > 0 && (
              <ChevronRight className="h-4 w-4 text-gray-400 mx-2" />
            )}
            {breadcrumb.isActive ? (
              <span className="text-sm font-medium text-foreground">
                {breadcrumb.label}
              </span>
            ) : (
              <Link href={breadcrumb.path || '#'}
                className="text-sm font-medium text-muted-foreground hover:text-muted-foreground"
              >
                {breadcrumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}