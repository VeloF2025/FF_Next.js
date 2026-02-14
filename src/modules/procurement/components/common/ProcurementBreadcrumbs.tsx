// import React from 'react'; // Not used in this component
import { Link } from 'react-router-dom';
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
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {breadcrumb.label}
              </span>
            ) : (
              <Link
                to={breadcrumb.path || '#'}
                className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300"
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