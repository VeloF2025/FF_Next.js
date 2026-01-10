// 🟢 WORKING: Procurement portal type definitions
import type { LucideIcon } from 'lucide-react';
import type { Project } from '@/types/project.types';

export type ProcurementTabId =
  | 'overview'
  | 'boq'
  | 'rfq'
  | 'quotes'
  | 'purchase-orders'
  | 'stock'
  | 'field-stock'
  | 'suppliers'
  | 'reports';

export interface ProcurementTab {
  id: ProcurementTabId;
  label: string;
  icon: LucideIcon;
  path: string;
  requiresProject: boolean;
  permission?: string | undefined;
  badge?: {
    count?: number;
    type?: 'error' | 'success' | 'warning' | 'info';
  } | undefined;
}

export interface ProcurementModuleCard {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  href: string;
  requiresProject?: boolean;
  permission?: string;
  targetTab?: ProcurementTabId;
  stats?: {
    primary: { label: string; value: number | string; };
    secondary: { label: string; value: number | string; }[];
  };
  metrics: Array<{
    label: string;
    value: number | string;
    status?: 'success' | 'warning' | 'error' | 'info';
    format?: 'currency' | 'percentage';
  }>;
  quickActions: Array<{
    label: string;
    icon: LucideIcon;
    onClick: () => void;
  }>;
}

export interface ProcurementPermissions {
  canViewBOQ: boolean;
  canEditBOQ: boolean;
  canViewRFQ: boolean;
  canCreateRFQ: boolean;
  canViewQuotes: boolean;
  canEvaluateQuotes: boolean;
  canViewPurchaseOrders: boolean;
  canCreatePurchaseOrders: boolean;
  canAccessStock: boolean;
  canManageStock: boolean;
  canAccessFieldStock: boolean;
  canManageFieldStock: boolean;
  canApproveOrders: boolean;
  canAccessReports: boolean;
  canViewSuppliers: boolean;
  canEditSuppliers: boolean;
  canManageSuppliers: boolean;
  role: 'admin' | 'manager' | 'user' | 'viewer';
  approvalLimit: number;
}

/**
 * View mode for procurement portal - single project or all projects aggregated
 */
export type ProcurementViewMode = 'single' | 'all';

/**
 * Aggregate metrics for "All Projects" view mode
 */
export interface AggregateProjectMetrics {
  totalProjects: number;
  totalBOQValue: number;
  totalActiveRFQs: number;
  totalPurchaseOrders: number;
  totalStockItems: number;
  totalSuppliers: number;
  averageCostSavings: number;
  averageCycleDays: number;
  averageSupplierOTIF: number;
  criticalAlerts: number;
  pendingApprovals: number;
}

/**
 * Project summary for aggregate view
 */
export interface ProjectSummary {
  id: string;
  name: string;
  code: string;
  status: 'active' | 'completed' | 'on-hold' | 'cancelled';
  boqValue: number;
  activeRFQs: number;
  completionPercentage: number;
  lastActivity: string;
  alertCount: number;
}

/**
 * Enhanced procurement portal context with view mode support
 */
export interface ProcurementPortalContext {
  selectedProject?: Project | undefined;
  viewMode: ProcurementViewMode;
  aggregateMetrics?: AggregateProjectMetrics | undefined;
  projectSummaries?: ProjectSummary[] | undefined;
  activeTab: ProcurementTabId;
  availableTabs: ProcurementTab[];
  tabBadges: Record<ProcurementTabId, { count?: number; type?: 'error' | 'success' | 'warning' | 'info'; }>;
  permissions: ProcurementPermissions;
  isLoading: boolean;
  error?: string | undefined;
  setProject: (project: Project | undefined) => void;
  setViewMode: (mode: ProcurementViewMode) => void;
  setActiveTab: (tab: ProcurementTabId) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | undefined) => void;
  updateTabBadge: (tabId: ProcurementTabId, badge?: { count?: number; type?: 'error' | 'success' | 'warning' | 'info' }) => void;
  refreshData: () => Promise<void>;
}