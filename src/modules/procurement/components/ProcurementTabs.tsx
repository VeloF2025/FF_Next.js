// 🟢 WORKING: Comprehensive procurement tabs with badges and state management
import { useMemo } from 'react';
import {
  BarChart3,
  FileText,
  Send,
  ShoppingCart,
  Quote,
  Package,
  MapPin,
  Truck,
  ClipboardList,
  Lock,
  FileInput,
  PackageCheck
} from 'lucide-react';
import type { 
  ProcurementTab, 
  ProcurementTabId, 
  ProcurementPermissions
} from '@/types/procurement/portal.types';
import { useProcurementPortal } from '../context/ProcurementPortalProvider';

interface ProcurementTabsProps {
  activeTab?: ProcurementTabId;
  onTabChange?: (tabId: ProcurementTabId) => void;
  selectedProject?: { id: string; name: string; code: string } | undefined;
  tabBadges?: Record<ProcurementTabId, { count?: number; type?: 'info' | 'warning' | 'error' | 'success' }>;
  permissions?: ProcurementPermissions;
  isLoading?: boolean;
}

export function ProcurementTabs({
  activeTab: propActiveTab,
  onTabChange: propOnTabChange,
  selectedProject: propSelectedProject,
  tabBadges: propTabBadges,
  permissions: propPermissions,
  isLoading: propIsLoading = false
}: ProcurementTabsProps = {}) {
  // Try to get from context first, fallback to props
  let context: any = null;
  try {
    context = useProcurementPortal();
  } catch {
    // Context not available, use props
  }
  
  const activeTab = propActiveTab ?? context?.activeTab ?? 'overview';
  const onTabChange = propOnTabChange ?? context?.setActiveTab ?? (() => {});
  const selectedProject = propSelectedProject ?? context?.project;
  const tabBadges = propTabBadges ?? context?.tabBadges ?? {};
  const permissions = propPermissions ?? context?.permissions;
  const isLoading = propIsLoading || context?.isLoading || false;
  
  // Define all available tabs with enhanced configuration
  const allTabs: ProcurementTab[] = useMemo(() => [
    {
      id: 'overview',
      label: 'Dashboard',
      icon: BarChart3,
      path: '/app/procurement',
      requiresProject: false
    },
    {
      id: 'requisitions',
      label: 'Requisitions',
      icon: FileInput,
      path: '/procurement/requisitions',
      requiresProject: false,
      permission: 'canViewRequisitions'
    },
    {
      id: 'boq',
      label: 'BOQ',
      icon: FileText,
      path: '/app/procurement/boq',
      requiresProject: true,
      permission: 'canViewBOQ'
    },
    { 
      id: 'rfq', 
      label: 'RFQ', 
      icon: Send, 
      path: '/app/procurement/rfq',
      requiresProject: true,
      permission: 'canViewRFQ'
    },
    { 
      id: 'quotes', 
      label: 'Quote Evaluation', 
      icon: Quote, 
      path: '/app/procurement/quotes',
      requiresProject: true,
      permission: 'canViewQuotes'
    },
    {
      id: 'purchase-orders',
      label: 'Purchase Orders',
      icon: ShoppingCart,
      path: '/procurement/purchase-orders',
      requiresProject: false,
      permission: 'canViewPurchaseOrders'
    },
    {
      id: 'grn',
      label: 'Goods Receipt',
      icon: PackageCheck,
      path: '/procurement/grn',
      requiresProject: false,
      permission: 'canViewGRN'
    },
    {
      id: 'stock',
      label: 'Stock Movement',
      icon: Package,
      path: '/app/procurement/stock',
      requiresProject: true,
      permission: 'canAccessStock'
    },
    {
      id: 'field-stock',
      label: 'Field Stock',
      icon: MapPin,
      path: '/procurement/field-stock',
      requiresProject: false,
      permission: 'canAccessFieldStock'
    },
    {
      id: 'suppliers',
      label: 'Suppliers',
      icon: Truck,
      path: '/app/procurement/suppliers',
      requiresProject: false,
      permission: 'canViewSuppliers'
    },
    { 
      id: 'reports', 
      label: 'Reports', 
      icon: ClipboardList, 
      path: '/app/procurement/reports',
      requiresProject: true,
      permission: 'canAccessReports'
    }
  ], []);

  // Filter tabs based on permissions and project selection
  const availableTabs = useMemo(() => {
    return allTabs.filter(tab => {
      // Always show overview/dashboard
      if (tab.id === 'overview') return true;
      
      // Check if project is required and selected
      if (tab.requiresProject && !selectedProject) return false;
      
      // Check permissions (only if permissions are loaded)
      if (tab.permission && permissions) {
        const hasPermission = permissions[tab.permission as keyof ProcurementPermissions];
        if (!hasPermission) return false;
      }
      
      return true;
    }).map(tab => ({
      ...tab,
      badge: tabBadges[tab.id]
    }));
  }, [allTabs, selectedProject, tabBadges, permissions]);

  // Handle tab click with validation
  const handleTabClick = (tab: ProcurementTab) => {
    // Don't allow tab change if loading
    if (isLoading) return;
    
    // Check if project is required but not selected
    if (tab.requiresProject && !selectedProject) {
      // Could show a toast or modal here
      return;
    }

    onTabChange(tab.id);
  };

  // Get tab display state
  const getTabState = (tab: ProcurementTab) => {
    const isActive = activeTab === tab.id;
    const isDisabled = tab.requiresProject && !selectedProject;
    // If permissions not loaded (undefined), allow access by default
    // Only restrict if permissions IS loaded AND specific permission is false
    const hasPermission = !tab.permission || !permissions || Boolean(permissions[tab.permission as keyof ProcurementPermissions]);

    return {
      isActive,
      isDisabled,
      hasPermission,
      showLock: permissions !== undefined && !hasPermission
    };
  };

  // Get badge styles based on type - dark mode compatible
  const getBadgeStyles = (type?: 'info' | 'warning' | 'error' | 'success') => {
    const baseStyles = 'ml-2 px-2 py-0.5 text-xs font-medium rounded-full min-w-[1.5rem] text-center';

    switch (type) {
      case 'error':
        return `${baseStyles} bg-red-500/20 text-red-400`;
      case 'warning':
        return `${baseStyles} bg-yellow-500/20 text-yellow-400`;
      case 'success':
        return `${baseStyles} bg-green-500/20 text-green-400`;
      case 'info':
      default:
        return `${baseStyles} bg-blue-500/20 text-blue-400`;
    }
  };

  return (
    <nav className="flex space-x-1 overflow-x-auto scrollbar-hide" aria-label="Procurement portal tabs">
      {availableTabs.map((tab) => {
        const Icon = tab.icon;
        const { isActive, isDisabled, hasPermission, showLock } = getTabState(tab);
        const badge = tab.badge;
        
        return (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab)}
            disabled={isDisabled || isLoading || !hasPermission}
            className={`
              relative py-3 px-4 border-b-2 font-medium text-sm whitespace-nowrap
              flex items-center gap-2 transition-all duration-200 min-w-fit
              ${isActive
                ? 'border-purple-500 text-purple-400 bg-purple-500/10'
                : isDisabled || !hasPermission
                ? 'border-transparent text-[var(--ff-text-tertiary)] cursor-not-allowed'
                : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]'
              }
              ${isLoading ? 'opacity-50 cursor-wait' : ''}
              disabled:opacity-50
            `}
            title={
              isDisabled 
                ? `${tab.label} - Project required`
                : !hasPermission 
                ? `${tab.label} - Insufficient permissions`
                : tab.label
            }
            aria-current={isActive ? 'page' : undefined}
          >
            {/* Icon */}
            <div className="flex items-center gap-1">
              <Icon className="h-4 w-4 flex-shrink-0" />
              {showLock && <Lock className="h-3 w-3 text-[var(--ff-text-tertiary)]" />}
            </div>
            
            {/* Label */}
            <span className="truncate">{tab.label}</span>
            
            {/* Badge */}
            {badge && badge.count !== undefined && badge.count > 0 && (
              <span className={getBadgeStyles(badge.type)}>
                {badge.count > 99 ? '99+' : badge.count}
              </span>
            )}
            
            {/* Loading indicator for active tab */}
            {isLoading && isActive && (
              <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-primary-200 overflow-hidden">
                <div className="h-full bg-primary-500 animate-pulse" />
              </div>
            )}
          </button>
        );
      })}

      {/* Mobile scroll indicator */}
      <div className="flex-shrink-0 w-1" />
    </nav>
  );
}

// Export for use in other components
export type { ProcurementTabsProps };