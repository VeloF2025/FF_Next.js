// import React from 'react'; // Not used in this component
import { Link } from 'react-router-dom';
import { ChevronRight, HelpCircle, Settings, Plus } from 'lucide-react';
import type { ProcurementPermissions } from '@/types/procurement/portal.types';
import type { ProcurementBreadcrumb } from '../../types';

interface ProcurementPageHeaderProps {
  title: string;
  breadcrumbs: ProcurementBreadcrumb[];
  helpText?: string;
  permissions: ProcurementPermissions;
  actions?: React.ReactNode;
}

/**
 * Consistent page header for all procurement pages
 * Includes breadcrumbs, title, help text, and common actions
 */
export function ProcurementPageHeader({
  title,
  breadcrumbs,
  helpText,
  permissions,
  actions
}: ProcurementPageHeaderProps) {
  
  // Quick action based on current page
  const getQuickActions = () => {
    const currentPath = window.location.pathname;
    
    if (currentPath.includes('/boq') && !currentPath.includes('/create')) {
      return permissions.canEditBOQ ? (
        <Link
          to="/app/procurement/boq/create"
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create BOQ
        </Link>
      ) : null;
    }
    
    if (currentPath.includes('/rfq') && !currentPath.includes('/create')) {
      return permissions.canCreateRFQ ? (
        <Link
          to="/app/procurement/rfq/create"
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create RFQ
        </Link>
      ) : null;
    }
    
    if (currentPath.includes('/orders') && !currentPath.includes('/create')) {
      return permissions.canApproveOrders ? (
        <Link
          to="/app/procurement/orders/create"
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Order
        </Link>
      ) : null;
    }
    
    return null;
  };

  return (
    <div className="bg-card shadow-sm border-b border-border">
      <div className="px-4 sm:px-6 lg:px-8">
        {/* Breadcrumbs */}
        <nav className="flex pt-4 pb-2" aria-label="Breadcrumb">
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
                  <Link
                    to={breadcrumb.path || '#'}
                    className="text-sm font-medium text-muted-foreground hover:text-muted-foreground"
                  >
                    {breadcrumb.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>

        {/* Title and Actions */}
        <div className="pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-foreground">{title}</h1>
              {helpText && (
                <div className="ml-3 group relative">
                  <HelpCircle className="h-5 w-5 text-gray-400 hover:text-muted-foreground cursor-help" />
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-10">
                    {helpText}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              )}
            </div>
            {helpText && (
              <p className="mt-1 text-sm text-muted-foreground sm:hidden">{helpText}</p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-4 sm:mt-0 flex items-center space-x-3">
            {/* Custom actions passed as props */}
            {actions}
            
            {/* Quick actions based on page */}
            {getQuickActions()}
            
            {/* Settings (if permissions allow) */}
            {permissions.canAccessReports && (
              <Link
                to="/app/procurement/reports"
                className="inline-flex items-center px-3 py-2 border border-border rounded-md shadow-sm text-sm font-medium text-muted-foreground bg-card hover:bg-background focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <Settings className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Reports</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}