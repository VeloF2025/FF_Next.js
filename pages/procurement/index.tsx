import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import type { Project } from '../../src/types/project.types';
import { ProjectType, ProjectStatus, Priority } from '../../src/types/project.types';
import { AlertCircle } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProcurementTabs } from '../../src/modules/procurement/components/ProcurementTabs';
import { ProjectFilter } from '../../src/modules/procurement/components/ProjectFilter';
import { ProcurementPortalProvider } from '../../src/modules/procurement/context/ProcurementPortalProvider';
import { useProcurementPermissions } from '../../src/modules/procurement/hooks/useProcurementPermissions';
import { log } from '../../src/lib/logger';
import Link from 'next/link';
import {
  FileText,
  Send,
  Quote,
  ShoppingCart,
  Package,
  Truck,
  ClipboardList,
  BarChart3,
  MapPin,
  ArrowRight
} from 'lucide-react';
import type { 
  ProcurementTabId, 
  ProcurementViewMode,
  AggregateProjectMetrics,
  ProjectSummary
} from '../../src/types/procurement/portal.types';

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
    boq: {},
    rfq: {},
    quotes: {},
    'purchase-orders': {},
    stock: {},
    'field-stock': {},
    suppliers: {},
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

  // Update URL when state changes (only after user interaction, not on initial mount)
  useEffect(() => {
    // Skip during SSR hydration to prevent React error #418/#423
    if (!isMounted) return;

    // Skip the first render after mount to prevent hydration errors
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const query: any = {
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

  /**
   * Load aggregate metrics for "All Projects" view
   */
  const loadAggregateMetrics = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/procurement/metrics/aggregate');
      if (!response.ok) throw new Error('Failed to load metrics');
      const data = await response.json();
      setAggregateMetrics(data);
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

  // Load data based on view mode
  useEffect(() => {
    if (viewMode === 'all') {
      loadAggregateMetrics();
      loadProjectSummaries();
    }
  }, [viewMode]);

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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="py-8">
              {/* Page Header */}
              <div className="mb-8">
                <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Procurement Portal</h1>
                <p className="mt-2 text-[var(--ff-text-secondary)]">
                  Manage procurement across all projects
                </p>
              </div>

              {/* Project Filter */}
              <div className="mb-6">
                <ProjectFilter
                  selectedProject={selectedProject}
                  onProjectChange={handleProjectChange}
                  viewMode={viewMode}
                  onViewModeChange={handleViewModeChange}
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

              {/* Tab Navigation */}
              <ProcurementTabs />

              {/* Tab Content */}
              <div className="mt-6">
                {activeTab === 'overview' && <DashboardTabContent project={selectedProject} />}
                {activeTab === 'boq' && <PlaceholderTab title="Bill of Quantities" icon={FileText} description="Manage project BOQ items" />}
                {activeTab === 'rfq' && <PlaceholderTab title="Request for Quotations" icon={Send} description="Create and manage RFQs" />}
                {activeTab === 'quotes' && <PlaceholderTab title="Quote Evaluation" icon={Quote} description="Evaluate and compare supplier quotes" />}
                {activeTab === 'purchase-orders' && <PurchaseOrdersTabContent />}
                {activeTab === 'stock' && <PlaceholderTab title="Stock Movement" icon={Package} description="Track inventory movements" />}
                {activeTab === 'field-stock' && <FieldStockTabContent />}
                {activeTab === 'suppliers' && <SuppliersTabContent />}
                {activeTab === 'reports' && <PlaceholderTab title="Procurement Reports" icon={ClipboardList} description="Generate and view reports" />}
              </div>
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
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-8">
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

function DashboardTabContent({ project }: { project?: Project }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-6">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="h-6 w-6 text-purple-500" />
        <h3 className="text-xl font-semibold text-[var(--ff-text-primary)]">
          {project ? `${project.name} Overview` : 'Procurement Overview'}
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <QuickLinkCard
          title="Requisitions"
          href="/procurement/requisitions"
          icon={FileText}
          description="Create and manage purchase requisitions"
        />
        <QuickLinkCard
          title="Purchase Orders"
          href="/procurement/purchase-orders"
          icon={ShoppingCart}
          description="View and track purchase orders"
        />
        <QuickLinkCard
          title="Goods Receipt"
          href="/procurement/grn"
          icon={Package}
          description="Record goods received"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <QuickLinkCard
          title="Approvals"
          href="/procurement/approvals"
          icon={ClipboardList}
          description="Review pending approvals"
        />
        <QuickLinkCard
          title="Suppliers"
          href="/suppliers"
          icon={Truck}
          description="Manage supplier database"
        />
        <QuickLinkCard
          title="Field Stock"
          href="/procurement/field-stock"
          icon={MapPin}
          description="Track field inventory"
        />
      </div>
    </div>
  );
}

function QuickLinkCard({ title, href, icon: Icon, description }: {
  title: string;
  href: string;
  icon: React.ElementType;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border)] p-4 hover:border-purple-500 transition-colors group"
    >
      <div className="flex items-center justify-between mb-2">
        <Icon className="h-5 w-5 text-purple-500" />
        <ArrowRight className="h-4 w-4 text-[var(--ff-text-tertiary)] group-hover:text-purple-500 transition-colors" />
      </div>
      <h4 className="font-medium text-[var(--ff-text-primary)] mb-1">{title}</h4>
      <p className="text-sm text-[var(--ff-text-secondary)]">{description}</p>
    </Link>
  );
}

function PurchaseOrdersTabContent() {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-6">
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
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-6">
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

function SuppliersTabContent() {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-6">
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