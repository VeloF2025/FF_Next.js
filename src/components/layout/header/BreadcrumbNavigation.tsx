/**
 * Breadcrumb Navigation Component
 */

import { ChevronRight, Menu } from 'lucide-react';
import Link from 'next/link';
import { BreadcrumbsProps } from './HeaderTypes';

export function BreadcrumbNavigation({ breadcrumbs, title, onMenuClick }: BreadcrumbsProps) {
  const getBreadcrumbPath = (breadcrumbText: string) => {
    switch (breadcrumbText.toLowerCase()) {
      case 'home':
        return '/dashboard';
      case 'dashboard':
        return '/dashboard';
      case 'projects':
        return '/projects';
      case 'clients':
        return '/clients';
      case 'staff':
      case 'staff management':
        return '/staff';
      case 'procurement':
        return '/procurement';
      case 'suppliers':
        return '/suppliers';
      case 'contractors':
        return '/contractors';
      case 'communications':
        return '/communications';
      case 'analytics':
        return '/analytics';
      case 'settings':
        return '/settings';
      case 'field app':
        return '/field';
      case 'daily progress':
        return '/daily-progress';
      default:
        return '#';
    }
  };

  return (
    <div className="flex items-center flex-1 min-w-0">
      {/* Mobile menu button */}
      <button
        onClick={onMenuClick}
        className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] rounded-lg lg:hidden mr-2"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex flex-col min-w-0">
        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 1 && (
          <nav className="hidden sm:flex items-center space-x-1 text-sm text-[var(--ff-text-tertiary)] mb-1">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              
              return (
                <div key={index} className="flex items-center">
                  {index > 0 && <ChevronRight className="h-3 w-3 mx-1" />}
                  {isLast ? (
                    <span className="text-[var(--ff-text-primary)] font-medium">
                      {crumb}
                    </span>
                  ) : (
                    <Link
                      href={getBreadcrumbPath(crumb)}
                      className="hover:text-[var(--ff-text-primary)] transition-colors"
                    >
                      {crumb}
                    </Link>
                  )}
                </div>
              );
            })}
          </nav>
        )}
        
        {/* Page title */}
        <h1 className="text-xl lg:text-2xl font-semibold text-[var(--ff-text-primary)] truncate">
          {title}
        </h1>
      </div>
    </div>
  );
}