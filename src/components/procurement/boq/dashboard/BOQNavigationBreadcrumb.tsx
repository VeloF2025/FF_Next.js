/**
 * BOQ Navigation Breadcrumb Component
 * Handles navigation between different BOQ dashboard views
 */

import { ChevronRight, RefreshCw } from 'lucide-react';
import { DashboardView } from './BOQDashboardTypes';

interface BOQNavigationBreadcrumbProps {
  currentView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  onRefresh?: () => void;
}

export default function BOQNavigationBreadcrumb({ 
  currentView, 
  onViewChange,
  onRefresh 
}: BOQNavigationBreadcrumbProps) {
  const breadcrumbItems = [
    { view: 'overview' as DashboardView, label: 'Dashboard' },
    ...(currentView !== 'overview' ? [{ view: currentView, label: getViewLabel(currentView) }] : [])
  ];

  function getViewLabel(view: DashboardView): string {
    switch (view) {
      case 'upload': return 'Upload BOQ';
      case 'list': return 'BOQ List';
      case 'viewer': return 'View BOQ';
      case 'mapping': return 'Mapping Review';
      case 'history': return 'Version History';
      default: return 'Dashboard';
    }
  }

  return (
    <div className="flex items-center justify-between bg-card px-4 py-2 rounded-lg shadow-sm">
      <nav className="flex items-center space-x-2">
        {breadcrumbItems.map((item, index) => (
          <div key={item.view} className="flex items-center">
            {index > 0 && <ChevronRight className="h-4 w-4 text-gray-400 mx-2" />}
            <button
              onClick={() => onViewChange(item.view)}
              className={`text-sm font-medium ${
                item.view === currentView
                  ? 'text-blue-600'
                  : 'text-muted-foreground hover:text-muted-foreground'
              }`}
            >
              {item.label}
            </button>
          </div>
        ))}
      </nav>
      
      {onRefresh && currentView === 'overview' && (
        <button
          onClick={onRefresh}
          className="p-1 text-gray-400 hover:text-muted-foreground"
          title="Refresh dashboard"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}