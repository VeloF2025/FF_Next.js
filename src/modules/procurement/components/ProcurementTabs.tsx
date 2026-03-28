// 🟢 WORKING: Two-level procurement tabs with direct navigation to dedicated pages
import { useMemo } from 'react';
import { useRouter } from 'next/router';
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
  PackageCheck,
  ChevronDown,
  Boxes,
  ShoppingBag,
  Search,
  CheckCircle,
  Inbox,
  GitBranch,
  TableProperties,
} from 'lucide-react';
import type {
  ProcurementTabId,
  ProcurementPermissions
} from '@/types/procurement/portal.types';
import { useProcurementPortalOptional } from '../context/ProcurementPortalProvider';

// Define category structure
type CategoryId = 'dashboard' | 'sourcing' | 'purchasing' | 'inventory' | 'field-stock' | 'approvals' | 'reports';

interface SubTab {
  id: ProcurementTabId;
  label: string;
  icon: any;
  permission?: string;
  path?: string; // Direct navigation path (if different from inline)
}

interface Category {
  id: CategoryId;
  label: string;
  icon: any;
  subTabs: SubTab[];
}

// Map sub-tab IDs to their parent category
const tabToCategoryMap: Record<ProcurementTabId, CategoryId> = {
  'overview': 'dashboard',
  'pipelines': 'purchasing',
  'open-orders': 'purchasing',
  'suppliers': 'sourcing',
  'boq': 'sourcing',
  'boq-view': 'sourcing',
  'rfq': 'sourcing',
  'requisitions': 'purchasing',
  'quotes': 'purchasing',
  'purchase-orders': 'purchasing',
  'grn': 'purchasing',
  'stock': 'inventory',
  'field-stock': 'field-stock',
  'approvals': 'approvals',
  'reports': 'reports',
};

interface ProcurementTabsProps {
  activeTab?: ProcurementTabId;
  onTabChange?: (tabId: ProcurementTabId) => void;
  selectedProject?: { id: string; name: string; code: string } | undefined;
  tabBadges?: Record<ProcurementTabId, { count?: number; type?: 'info' | 'warning' | 'error' | 'success' }>;
  permissions?: ProcurementPermissions;
  isLoading?: boolean;
  /** Only show main category tabs (Dashboard, Sourcing, etc.) - hide sub-tabs row */
  categoriesOnly?: boolean;
}

export function ProcurementTabs({
  activeTab: propActiveTab,
  onTabChange: propOnTabChange,
  selectedProject: propSelectedProject,
  tabBadges: propTabBadges,
  permissions: propPermissions,
  isLoading: propIsLoading = false,
  categoriesOnly = false
}: ProcurementTabsProps = {}) {
  const router = useRouter();

  // Try to get from context first, fallback to props
  const context = useProcurementPortalOptional();

  const activeTab = propActiveTab ?? context?.activeTab ?? 'overview';
  const onTabChange = propOnTabChange ?? context?.setActiveTab ?? (() => {});
  const emptyBadges = {} as Record<ProcurementTabId, { count?: number; type?: 'info' | 'warning' | 'error' | 'success' }>;
  const tabBadges = propTabBadges ?? context?.tabBadges ?? emptyBadges;
  const permissions = propPermissions ?? context?.permissions;
  const isLoading = propIsLoading || context?.isLoading || false;

  // Define the two-level tab structure
  // Tabs with 'path' navigate directly to dedicated pages
  // Tabs without 'path' show inline content on /procurement
  const categories: Category[] = useMemo(() => [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: BarChart3,
      subTabs: [
        { id: 'overview', label: 'Overview', icon: BarChart3, path: '/procurement' }
      ]
    },
    {
      id: 'sourcing',
      label: 'Sourcing',
      icon: Search,
      subTabs: [
        { id: 'suppliers', label: 'Suppliers', icon: Truck, permission: 'canViewSuppliers', path: '/procurement/sourcing?tab=suppliers' },
        { id: 'boq', label: 'BOQ', icon: FileText, permission: 'canViewBOQ', path: '/procurement/sourcing?tab=boq' },
        { id: 'boq-view', label: 'BOQ View', icon: TableProperties, permission: 'canViewBOQ', path: '/procurement?tab=boq-view' },
        { id: 'rfq', label: 'RFQ', icon: Send, permission: 'canViewRFQ', path: '/procurement/sourcing?tab=rfq' },
      ]
    },
    {
      id: 'purchasing',
      label: 'Purchasing',
      icon: ShoppingBag,
      subTabs: [
        { id: 'pipelines', label: 'Pipelines', icon: GitBranch, path: '/procurement/pipelines' },
        { id: 'open-orders', label: 'Open Orders', icon: Inbox, path: '/procurement/open-orders' },
        { id: 'requisitions', label: 'Requisitions', icon: FileInput, permission: 'canViewRequisitions', path: '/procurement/requisitions' },
        { id: 'quotes', label: 'Quote Evaluation', icon: Quote, permission: 'canViewQuotes', path: '/procurement/rfq?tab=quotes' },
        { id: 'purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, permission: 'canViewPurchaseOrders', path: '/procurement/purchase-orders' },
        { id: 'grn', label: 'Goods Receipt', icon: PackageCheck, permission: 'canViewGRN', path: '/procurement/grn' },
      ]
    },
    {
      id: 'inventory',
      label: 'Inventory',
      icon: Boxes,
      subTabs: [
        { id: 'stock', label: 'Stock Management', icon: Package, permission: 'canAccessStock', path: '/procurement/inventory' },
      ]
    },
    {
      id: 'field-stock',
      label: 'Field Stock',
      icon: MapPin,
      subTabs: [
        { id: 'field-stock', label: 'Field Stock', icon: MapPin, permission: 'canAccessFieldStock', path: '/procurement/field-stock' },
      ]
    },
    {
      id: 'approvals',
      label: 'Approvals',
      icon: CheckCircle,
      subTabs: [
        { id: 'approvals', label: 'Approvals', icon: CheckCircle, path: '/procurement/approvals' }
      ]
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: ClipboardList,
      subTabs: [
        { id: 'reports', label: 'Reports', icon: ClipboardList, permission: 'canAccessReports', path: '/procurement/reports' }
      ]
    }
  ], []);

  // Determine active category based on active tab
  const activeCategory = useMemo(() => {
    return tabToCategoryMap[activeTab] || 'dashboard';
  }, [activeTab]);

  // Get sub-tabs for current category
  const currentSubTabs = useMemo(() => {
    const category = categories.find(c => c.id === activeCategory);
    return category?.subTabs || [];
  }, [categories, activeCategory]);

  // Handle main category click
  const handleCategoryClick = (category: Category) => {
    if (isLoading) return;

    // Find the first allowed sub-tab
    const firstAllowedSubTab = category.subTabs.find(subTab => {
      if (!subTab.permission || !permissions) return true;
      return permissions[subTab.permission as keyof ProcurementPermissions];
    });

    if (firstAllowedSubTab) {
      // If sub-tab has a direct path, navigate to it
      if (firstAllowedSubTab.path) {
        router.push(firstAllowedSubTab.path);
      } else {
        onTabChange(firstAllowedSubTab.id);
      }
    }
  };

  // Handle sub-tab click
  const handleSubTabClick = (subTab: SubTab) => {
    if (isLoading) return;

    // If sub-tab has a direct path, navigate to it
    if (subTab.path) {
      router.push(subTab.path);
    } else {
      onTabChange(subTab.id);
    }
  };

  // Check if sub-tab has permission
  const hasPermission = (subTab: SubTab): boolean => {
    if (!subTab.permission || !permissions) return true;
    return Boolean(permissions[subTab.permission as keyof ProcurementPermissions]);
  };

  // Get badge for a tab
  const getBadge = (tabId: ProcurementTabId) => tabBadges[tabId];

  // Get aggregated badge count for a category
  const getCategoryBadgeCount = (category: Category): number => {
    return category.subTabs.reduce((sum, subTab) => {
      const badge = tabBadges[subTab.id];
      return sum + (badge?.count || 0);
    }, 0);
  };

  // Get badge styles based on type
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
    <div className="space-y-0">
      {/* Main Category Tabs */}
      <nav
        className="flex space-x-1 overflow-x-auto scrollbar-hide border-b border-[var(--ff-border-light)]"
        aria-label="Procurement categories"
      >
        {categories.map((category) => {
          const Icon = category.icon;
          const isActive = activeCategory === category.id;
          const badgeCount = getCategoryBadgeCount(category);

          return (
            <button
              key={category.id}
              onClick={() => handleCategoryClick(category)}
              disabled={isLoading}
              className={`
                relative py-3 px-5 border-b-2 font-medium text-sm whitespace-nowrap
                flex items-center gap-2 transition-all duration-200 min-w-fit -mb-px
                ${isActive
                  ? 'border-[var(--ff-primary-500)] text-[var(--ff-primary-400)] bg-[var(--ff-primary-500)]/10'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]'
                }
                ${isLoading ? 'opacity-50 cursor-wait' : ''}
              `}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span>{category.label}</span>
              {badgeCount > 0 && (
                <span className={getBadgeStyles('info')}>
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
              {category.subTabs.length > 1 && (
                <ChevronDown className={`h-3 w-3 transition-transform ${isActive ? 'rotate-180' : ''}`} />
              )}
            </button>
          );
        })}
        <div className="flex-shrink-0 w-1" />
      </nav>

      {/* Sub-tabs (only show if category has more than 1 sub-tab and not in categoriesOnly mode) */}
      {!categoriesOnly && currentSubTabs.length > 1 && (
        <nav
          className="flex space-x-1 overflow-x-auto scrollbar-hide bg-[var(--ff-bg-secondary)]/50 px-2 py-1"
          aria-label="Category sub-tabs"
        >
          {currentSubTabs.map((subTab) => {
            const Icon = subTab.icon;
            const isActive = activeTab === subTab.id;
            const allowed = hasPermission(subTab);
            const badge = getBadge(subTab.id);

            return (
              <button
                key={subTab.id}
                onClick={() => handleSubTabClick(subTab)}
                disabled={isLoading || !allowed}
                className={`
                  relative py-2 px-4 rounded-md font-medium text-sm whitespace-nowrap
                  flex items-center gap-2 transition-all duration-200 min-w-fit
                  ${isActive
                    ? 'bg-[var(--ff-primary-500)]/20 text-[var(--ff-primary-400)] ring-1 ring-[var(--ff-primary-500)]/30'
                    : !allowed
                    ? 'text-[var(--ff-text-tertiary)] cursor-not-allowed opacity-50'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
                  }
                  ${isLoading ? 'opacity-50 cursor-wait' : ''}
                `}
                title={!allowed ? `${subTab.label} - Insufficient permissions` : subTab.label}
              >
                <div className="flex items-center gap-1">
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {!allowed && <Lock className="h-3 w-3 text-[var(--ff-text-tertiary)]" />}
                </div>
                <span>{subTab.label}</span>
                {badge && badge.count !== undefined && badge.count > 0 && (
                  <span className={getBadgeStyles(badge.type)}>
                    {badge.count > 99 ? '99+' : badge.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

export type { ProcurementTabsProps };
