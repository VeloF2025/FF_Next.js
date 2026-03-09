import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import type { GetServerSideProps } from 'next';
import type { Project } from '../../src/types/project.types';
import { ProjectType, ProjectStatus, Priority } from '../../src/types/project.types';
import { AlertCircle } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProcurementTabs } from '../../src/modules/procurement/components/ProcurementTabs';
import { ProcurementFilters } from '../../src/modules/procurement/components/ProcurementFilters';
import { ProcurementPortalProvider } from '../../src/modules/procurement/context/ProcurementPortalProvider';
import { useProcurementPermissions } from '../../src/modules/procurement/hooks/useProcurementPermissions';
import { log } from '../../src/lib/logger';
import Link from 'next/link';
import {
  FileText,
  Quote,
  ShoppingCart,
  Package,
  Truck,
  MapPin,
  ArrowRight,
  Loader2,
  Send,
  ClipboardList,
  FileInput,
  PackageCheck,
  Workflow,
} from 'lucide-react';
import type {
  ProcurementTabId,
  ProcurementViewMode,
  AggregateProjectMetrics,
  ProjectSummary
} from '../../src/types/procurement/portal.types';
import { ProcurementOverview } from '@/modules/procurement/components/ProcurementOverview';

interface ProcurementPageProps {
  initialProject?: Project;
  initialViewMode?: ProcurementViewMode;
  initialTab?: ProcurementTabId;
}

export default function ProcurementPage({ 
  initialProject, 
  initialViewMode = 'all',
  initialTab = 'overview'
}: ProcurementPageProps) {
  const router = useRouter();
  
  // State management
  const [selectedProject, setSelectedProject] = useState<Project | undefined>(initialProject);
  const [viewMode, setViewMode] = useState<ProcurementViewMode>(initialViewMode);
  const [activeTab, setActiveTab] = useState<ProcurementTabId>(initialTab);
  const [aggregateMetrics, setAggregateMetrics] = useState<AggregateProjectMetrics | undefined>();
  const [projectSummaries, setProjectSummaries] = useState<ProjectSummary[] | undefined>();
  const [tabBadges, setTabBadges] = useState<Record<ProcurementTabId, { count?: number; type?: 'info' | 'warning' | 'error' | 'success' }>>({
    overview: {},
    pipelines: {},
    'open-orders': {},
    requisitions: {},
    boq: {},
    rfq: {},
    quotes: {},
    'purchase-orders': {},
    grn: {},
    stock: {},
    'field-stock': {},
    suppliers: {},
    approvals: {},
    reports: {}
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isMounted, setIsMounted] = useState(false);

  // Track if this is the initial mount to prevent URL update on first render
  const isInitialMount = useRef(true);

  // Get permissions for selected project
  const permissions = useProcurementPermissions(selectedProject?.id);

  // Track when component is mounted to avoid hydration issues
  useEffect(() => {
    setIsMounted(true);
  }, []);

  /**
   * Load aggregate metrics for "All Projects" view
   */
  const loadAggregateMetrics = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/procurement/metrics/aggregate');
      if (!response.ok) throw new Error('Failed to load metrics');
      const result = await response.json();
      // API returns {success: true, data: {...metrics...}}
      setAggregateMetrics(result.data || result);
    } catch (err) {
      setError('Failed to load aggregate metrics');
      log.error('Failed to load aggregate metrics', { error: err });
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Load project summaries for "All Projects" view
   */
  const loadProjectSummaries = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/procurement/projects/summaries');
      if (!response.ok) throw new Error('Failed to load project summaries');
      const data = await response.json();
      setProjectSummaries(data);
    } catch (err) {
      setError('Failed to load project summaries');
      log.error('Failed to load project summaries', { error: err });
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle project selection change
   */
  const handleProjectChange = (project: Project | undefined) => {
    setSelectedProject(project);
    setViewMode(project ? 'single' : 'all');
    setActiveTab('overview');
    setError(undefined);
  };

  /**
   * Handle view mode change
   */
  const handleViewModeChange = (mode: ProcurementViewMode) => {
    setViewMode(mode);
    if (mode === 'all') {
      setSelectedProject(undefined);
    }
  };

  // Update URL when state changes (only after user interaction, not on initial mount)
  useEffect(() => {
    // Skip during SSR hydration to prevent React error #418/#423
    if (!isMounted) return;

    // Skip the first render after mount to prevent hydration errors
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const query: Record<string, string> = {
      tab: activeTab,
      viewMode
    };

    if (selectedProject) {
      query.project = selectedProject.id;
      query.projectName = selectedProject.name;
      query.projectCode = selectedProject.code;
    }

    router.push({
      pathname: '/procurement',
      query
    }, undefined, { shallow: true });
  }, [activeTab, viewMode, selectedProject, router, isMounted]);

  // Load pending approvals count for the badge
  useEffect(() => {
    if (!isMounted) return;
    fetch('/api/procurement/approvals/pending')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const total: number = data.data?.summary?.total ?? 0;
          if (total > 0) {
            setTabBadges(prev => ({
              ...prev,
              approvals: { count: total, type: 'warning' as const },
            }));
          }
        }
      })
      .catch(() => undefined);
  }, [isMounted]);

  // Load data based on view mode (only after mount)
  useEffect(() => {
    if (!isMounted) return;
    if (viewMode === 'all') {
      loadAggregateMetrics();
      loadProjectSummaries();
    }
  }, [viewMode, isMounted]);

  // Show loading state during hydration to prevent mismatch
  if (!isMounted) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-purple-500 mx-auto mb-2" />
            <p className="text-[var(--ff-text-secondary)]">Loading procurement portal...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const contextValue = {
    project: selectedProject,
    viewMode,
    activeTab,
    setActiveTab,
    aggregateMetrics,
    projectSummaries,
    tabBadges,
    setTabBadges,
    isLoading,
    error,
    permissions,
    onProjectChange: handleProjectChange,
    onViewModeChange: handleViewModeChange,
  };

  return (
    <AppLayout>
      <ProcurementPortalProvider value={contextValue}>
        <div className="min-h-screen bg-[var(--ff-bg-primary)]">
          {/* Page Header */}
          <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
            <div className="px-6 py-4">
              <div className="flex items-center justify-between flex-1">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10">
                    <ShoppingCart className="h-6 w-6 text-purple-500" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Procurement</h1>
                    <p className="text-sm text-[var(--ff-text-secondary)]">
                      Manage procurement across all projects
                    </p>
                  </div>
                </div>
                <Link
                  href="/procurement/workflow?new=1"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                >
                  <Workflow className="h-4 w-4" />
                  New Procurement Workflow
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="px-6 border-t border-[var(--ff-border-light)]">
              <ProcurementTabs />
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Filters */}
            <div className="mb-6">
              <ProcurementFilters
                selectedProject={selectedProject}
                onProjectChange={handleProjectChange}
                isLoading={isLoading}
              />
            </div>

            {/* Error State */}
            {error && (
              <div className="mb-6 bg-red-500/20 border border-red-500/30 rounded-lg p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 mr-3" />
                  <div>
                    <h3 className="text-sm font-medium text-red-400">Error</h3>
                    <div className="mt-1 text-sm text-red-400">{error}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab Content */}
            <div className="mt-6">
              {activeTab === 'overview' && <DashboardTabContent project={selectedProject} aggregateMetrics={aggregateMetrics} isLoading={isLoading} />}
              {activeTab === 'requisitions' && <RequisitionsTabContent />}
              {activeTab === 'boq' && <PlaceholderTab title="Bill of Quantities" icon={FileText} description="Manage project BOQ items" />}
              {activeTab === 'rfq' && <PlaceholderTab title="Request for Quotations" icon={Send} description="Create and manage RFQs" />}
              {activeTab === 'quotes' && <PlaceholderTab title="Quote Evaluation" icon={Quote} description="Evaluate and compare supplier quotes" />}
              {activeTab === 'purchase-orders' && <PurchaseOrdersTabContent />}
              {activeTab === 'grn' && <GoodsReceiptTabContent />}
              {activeTab === 'stock' && <StockTabContent />}
              {activeTab === 'field-stock' && <FieldStockTabContent />}
              {activeTab === 'suppliers' && <SuppliersTabContent />}
              {activeTab === 'reports' && <PlaceholderTab title="Procurement Reports" icon={ClipboardList} description="Generate and view reports" />}
            </div>
          </div>
        </div>
      </ProcurementPortalProvider>
    </AppLayout>
  );
}

// =====================================================
// Inline Tab Content Components (avoid server-side deps)
// =====================================================

interface PlaceholderTabProps {
  title: string;
  icon: React.ElementType;
  description: string;
}

function PlaceholderTab({ title, icon: Icon, description }: PlaceholderTabProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-8">
      <div className="text-center">
        <Icon className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">{title}</h3>
        <p className="text-[var(--ff-text-secondary)] mb-4">{description}</p>
        <p className="text-sm text-[var(--ff-text-tertiary)]">
          This feature is coming soon. Use the dedicated pages for full functionality.
        </p>
      </div>
    </div>
  );
}

function DashboardTabContent({
  project,
  aggregateMetrics,
  isLoading
}: {
  project?: Project;
  aggregateMetrics?: AggregateProjectMetrics;
  isLoading?: boolean;
}) {
  return (
    <ProcurementOverview
      project={project}
      aggregateMetrics={aggregateMetrics}
      isLoading={isLoading}
    />
  );
}


function PurchaseOrdersTabContent() {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-6 w-6 text-purple-500" />
          <h3 className="text-xl font-semibold text-[var(--ff-text-primary)]">Purchase Orders</h3>
        </div>
        <Link
          href="/procurement/purchase-orders"
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          View All <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <p className="text-[var(--ff-text-secondary)]">
        View and manage purchase orders. Click &quot;View All&quot; to access the full Purchase Orders page.
      </p>
    </div>
  );
}

function FieldStockTabContent() {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MapPin className="h-6 w-6 text-purple-500" />
          <h3 className="text-xl font-semibold text-[var(--ff-text-primary)]">Field Stock Control</h3>
        </div>
        <Link
          href="/procurement/field-stock"
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          Open Field Stock <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <p className="text-[var(--ff-text-secondary)]">
        Track and manage inventory in the field. Click &quot;Open Field Stock&quot; to access the full control panel.
      </p>
    </div>
  );
}

function StockTabContent() {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Package className="h-6 w-6 text-purple-500" />
          <h3 className="text-xl font-semibold text-[var(--ff-text-primary)]">Stock Management</h3>
        </div>
        <Link
          href="/procurement/inventory?tab=items"
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          View Inventory <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <p className="text-[var(--ff-text-secondary)]">
        View stock items, categories, bundles, and stock takes. Click &quot;View Inventory&quot; to access the full Inventory Management page.
      </p>
    </div>
  );
}

function SuppliersTabContent() {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-purple-500" />
          <h3 className="text-xl font-semibold text-[var(--ff-text-primary)]">Suppliers</h3>
        </div>
        <Link
          href="/suppliers"
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          Manage Suppliers <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <p className="text-[var(--ff-text-secondary)]">
        View and manage your supplier database. Click &quot;Manage Suppliers&quot; to access the full Suppliers Portal.
      </p>
    </div>
  );
}

function RequisitionsTabContent() {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileInput className="h-6 w-6 text-purple-500" />
          <h3 className="text-xl font-semibold text-[var(--ff-text-primary)]">Requisitions</h3>
        </div>
        <Link
          href="/procurement/requisitions"
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          View All <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <p className="text-[var(--ff-text-secondary)]">
        Create and manage purchase requisitions. Click &quot;View All&quot; to access the full Requisitions page.
      </p>
    </div>
  );
}

function GoodsReceiptTabContent() {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <PackageCheck className="h-6 w-6 text-emerald-500" />
          <h3 className="text-xl font-semibold text-[var(--ff-text-primary)]">Goods Receipt Notes</h3>
        </div>
        <Link
          href="/procurement/grn"
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          View All <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <p className="text-[var(--ff-text-secondary)]">
        Receive and inspect deliveries. Click &quot;View All&quot; to access the full Goods Receipt Notes page.
      </p>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { query } = context;
  
  let initialProject: Project | undefined;
  const initialViewMode = (query.viewMode as ProcurementViewMode) || 'all';
  const initialTab = (query.tab as ProcurementTabId) || 'overview';
  
  // If project parameters are in the URL, reconstruct the project object
  if (query.project && query.projectName && query.projectCode) {
    initialProject = {
      id: query.project as string,
      name: query.projectName as string,
      code: query.projectCode as string,
      projectType: ProjectType.FIBRE,
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
      status: ProjectStatus.ACTIVE,
      priority: Priority.MEDIUM,
      plannedProgress: 0,
      actualProgress: 0,
      createdBy: 'system',
      createdAt: new Date().toISOString()
    };
  }
  
  return {
    props: {
      initialProject: initialProject || null,
      initialViewMode,
      initialTab
    }
  };
};