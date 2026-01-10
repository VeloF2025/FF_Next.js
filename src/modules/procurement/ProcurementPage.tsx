import { Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { 
  Package, 
  FileText, 
  Send, 
  ShoppingCart, 
  BarChart3, 
  Truck, 
  Quote,
  ClipboardList,
  AlertCircle
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useProcurementPermissions } from './hooks/useProcurementPermissions';
import { ProcurementProjectSelector } from './components/ProcurementProjectSelector';
import type { 
  ProcurementTab, 
  ProcurementTabId, 
  ProcurementPortalContext,
  ProcurementViewMode,
  AggregateProjectMetrics,
  ProjectSummary
} from '@/types/procurement/portal.types';
import type { Project } from '@/types/project.types';
import { ProjectType, ProjectStatus, Priority } from '@/types/project.types';
import { log } from '@/lib/logger';

export function ProcurementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // State management
  const [selectedProject, setSelectedProject] = useState<Project | undefined>(
    searchParams.get('project') ? {
      id: searchParams.get('project')!,
      name: searchParams.get('projectName') || 'Unknown',
      code: searchParams.get('projectCode') || 'N/A',
      projectType: ProjectType.FIBRE,
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
      status: ProjectStatus.ACTIVE,
      priority: Priority.MEDIUM,
      plannedProgress: 0,
      actualProgress: 0,
      createdBy: 'system',
      createdAt: new Date().toISOString()
    } : undefined
  );
  const [viewMode, setViewMode] = useState<ProcurementViewMode>(() => {
    // If no project selected and no explicit viewMode, default to 'all'
    const urlViewMode = searchParams.get('viewMode') as ProcurementViewMode;
    const hasProject = searchParams.get('project');
    
    if (urlViewMode) return urlViewMode;
    return hasProject ? 'single' : 'all';
  });
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
  const [isLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Get permissions for selected project
  const permissions = useProcurementPermissions(selectedProject?.id);

  /**
   * Load aggregate metrics for "All Projects" view
   */
  const loadAggregateMetrics = async (): Promise<void> => {
    try {
      // TODO: Replace with actual API call
      const mockAggregateMetrics: AggregateProjectMetrics = {
        totalProjects: 12,
        totalBOQValue: 2450000,
        totalActiveRFQs: 18,
        totalPurchaseOrders: 42,
        totalStockItems: 1250,
        totalSuppliers: 28,
        averageCostSavings: 12.5,
        averageCycleDays: 14.5,
        averageSupplierOTIF: 92,
        criticalAlerts: 8,
        pendingApprovals: 15
      };

      const mockProjectSummaries: ProjectSummary[] = [
        {
          id: '1',
          name: 'Johannesburg Fiber Rollout',
          code: 'JHB-2024-001',
          status: 'active',
          boqValue: 850000,
          activeRFQs: 5,
          completionPercentage: 68,
          lastActivity: '2 hours ago',
          alertCount: 2
        },
        {
          id: '2',
          name: 'Cape Town Metro Network',
          code: 'CPT-2024-002',
          status: 'active',
          boqValue: 720000,
          activeRFQs: 3,
          completionPercentage: 45,
          lastActivity: '4 hours ago',
          alertCount: 1
        },
        // Add more mock data as needed
      ];

      setAggregateMetrics(mockAggregateMetrics);
      setProjectSummaries(mockProjectSummaries);
    } catch (error) {
      log.error('Error loading aggregate metrics:', { data: error }, 'ProcurementPage');
      setError('Failed to load aggregate data');
    }
  };

  // Define all available tabs with enhanced configuration
  const allTabs: ProcurementTab[] = [
    { 
      id: 'overview', 
      label: 'Overview', 
      icon: BarChart3, 
      path: '/app/procurement',
      requiresProject: false
    },
    { 
      id: 'boq', 
      label: 'BOQ', 
      icon: FileText, 
      path: '/app/procurement/boq',
      requiresProject: true,
      permission: 'buyer'
    },
    { 
      id: 'rfq', 
      label: 'RFQ', 
      icon: Send, 
      path: '/app/procurement/rfq',
      requiresProject: true,
      permission: 'buyer'
    },
    { 
      id: 'quotes', 
      label: 'Quotes', 
      icon: Quote, 
      path: '/app/procurement/quotes',
      requiresProject: true,
      permission: 'buyer'
    },
    { 
      id: 'purchase-orders', 
      label: 'Purchase Orders', 
      icon: ShoppingCart, 
      path: '/app/procurement/orders',
      requiresProject: true,
      permission: 'buyer'
    },
    { 
      id: 'stock', 
      label: 'Stock', 
      icon: Package, 
      path: '/app/procurement/stock',
      requiresProject: true,
      permission: 'store-controller'
    },
    { 
      id: 'suppliers', 
      label: 'Suppliers', 
      icon: Truck, 
      path: '/app/procurement/suppliers',
      requiresProject: false,
      permission: 'buyer'
    },
    { 
      id: 'reports', 
      label: 'Reports', 
      icon: ClipboardList, 
      path: '/app/procurement/reports',
      requiresProject: true,
      permission: 'viewer'
    },
  ];

  // Filter tabs based on permissions and project selection
  const availableTabs = useMemo(() => {
    return allTabs.filter(tab => {
      // Always show overview
      if (tab.id === 'overview') return true;
      
      // Check if project is required and selected
      if (tab.requiresProject && !selectedProject) return false;
      
      // Check permissions (simplified - would integrate with real auth)
      if (tab.permission) {
        // Mock permission check - replace with real implementation
        return true; // For now, allow all tabs
      }
      
      return true;
    }).map(tab => ({
      ...tab,
      badge: tabBadges[tab.id]
    }));
  }, [selectedProject, tabBadges, permissions]);

  const activeTab = availableTabs.find(tab => 
    location.pathname === tab.path || 
    (tab.id !== 'overview' && location.pathname.startsWith(tab.path))
  )?.id || 'overview';

  // Portal context
  const portalContext: ProcurementPortalContext = {
    selectedProject,
    viewMode,
    aggregateMetrics,
    projectSummaries,
    activeTab,
    availableTabs,
    tabBadges,
    permissions,
    isLoading,
    error,
    setProject: setSelectedProject,
    setViewMode: (mode: ProcurementViewMode) => {
      setViewMode(mode);
      // Update URL parameters
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        if (mode === 'all') {
          newParams.set('viewMode', 'all');
          // Clear project params when switching to all projects
          newParams.delete('project');
          newParams.delete('projectName');
          newParams.delete('projectCode');
        } else {
          newParams.set('viewMode', 'single');
        }
        return newParams;
      });
    },
    setActiveTab: (tab) => {
      // Navigate to tab
      const targetTab = availableTabs.find(t => t.id === tab);
      if (targetTab) {
        navigate(targetTab.path);
      }
    },
    setLoading: (_loading) => {
      // setIsLoading(loading); // Commented out as it's prefixed with _
    },
    setError,
    updateTabBadge: (tabId: ProcurementTabId, badge?: { count?: number; type?: 'error' | 'success' | 'warning' | 'info' }) => {
      setTabBadges(prev => ({
        ...prev,
        [tabId]: badge || {}
      }));
    },
    refreshData: async () => {
      if (viewMode === 'all') {
        await loadAggregateMetrics();
      }
      // TODO: Add single project data refresh logic
      return Promise.resolve();
    }
  };

  // Handle project selection
  const handleProjectChange = (project: Project | undefined) => {
    setSelectedProject(project);
    
    // Update URL parameters
    if (project) {
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        newParams.set('project', project.id);
        newParams.set('projectName', project.name);
        newParams.set('projectCode', project.code);
        newParams.set('viewMode', 'single');
        return newParams;
      });
    } else {
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        newParams.delete('project');
        newParams.delete('projectName');
        newParams.delete('projectCode');
        return newParams;
      });
    }

    // Navigate to overview when project changes
    if (activeTab !== 'overview') {
      navigate('/app/procurement');
    }
  };

  /**
   * Handle view mode changes
   */
  const handleViewModeChange = (mode: ProcurementViewMode) => {
    setViewMode(mode);
    
    if (mode === 'all') {
      // Load aggregate data when switching to all projects view
      loadAggregateMetrics();
    }
    
    // Navigate to overview when view mode changes
    if (activeTab !== 'overview') {
      navigate('/app/procurement');
    }
  };

  // Handle tab navigation
  const handleTabClick = (tab: ProcurementTab) => {
    // Check if project is required
    if (tab.requiresProject && !selectedProject) {
      setError('Please select a project first');
      return;
    }

    // Clear error and navigate
    setError(undefined);
    navigate(tab.path);
  };

  // Load data based on view mode
  useEffect(() => {
    if (viewMode === 'all') {
      // Load aggregate metrics for all projects view
      loadAggregateMetrics();
    } else if (selectedProject) {
      // Load project-specific data and update badges
      setTabBadges(prev => ({
        ...prev,
        boq: { count: 3, type: 'info' },
        rfq: { count: 2, type: 'warning' },
        quotes: { count: 1, type: 'success' },
        stock: { count: 5, type: 'error' }
      }));
    } else {
      // Clear badges when no project selected
      setTabBadges({
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
    }
  }, [viewMode, selectedProject]);

  return (
    <div className="flex flex-col h-full">
      {/* Portal Header */}
      <div className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Procurement Portal</h1>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Integrated procurement management system
              </p>
            </div>
            <div className="flex items-center gap-4">
              {/* Project Selector */}
              <ProcurementProjectSelector
                selectedProject={selectedProject}
                viewMode={viewMode}
                onProjectChange={handleProjectChange}
                onViewModeChange={handleViewModeChange}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm text-red-700">{error}</span>
              <button
                onClick={() => setError(undefined)}
                className="ml-auto text-red-600 hover:text-red-800"
              >
                ×
              </button>
            </div>
          )}

          {/* Tab Navigation */}
          <nav className="flex space-x-1 overflow-x-auto" aria-label="Procurement tabs">
            {availableTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isDisabled = tab.requiresProject && !selectedProject;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab)}
                  disabled={isDisabled}
                  className={`
                    relative py-3 px-4 border-b-2 font-medium text-sm whitespace-nowrap
                    flex items-center gap-2 transition-all duration-200
                    ${isActive
                      ? 'border-primary-500 text-primary-600 bg-primary-50'
                      : isDisabled
                      ? 'border-transparent text-[var(--ff-text-tertiary)] cursor-not-allowed'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]'
                    }
                    disabled:opacity-50
                  `}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  
                  {/* Tab Badge */}
                  {tab.badge && tab.badge.count && tab.badge.count > 0 && (
                    <span className={`
                      ml-1 px-2 py-0.5 text-xs font-medium rounded-full
                      ${tab.badge.type === 'error' ? 'bg-red-500/20 text-red-400' :
                        tab.badge.type === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                        tab.badge.type === 'success' ? 'bg-green-500/20 text-green-400' :
                        'bg-blue-500/20 text-blue-400'
                      }
                    `}>
                      {tab.badge.count > 99 ? '99+' : tab.badge.count}
                    </span>
                  )}

                  {/* Disabled Overlay */}
                  {isDisabled && (
                    <div className="absolute inset-0 bg-[var(--ff-bg-secondary)] bg-opacity-60 cursor-not-allowed" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto bg-[var(--ff-bg-tertiary)]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-500" />
          </div>
        ) : (
          <Outlet context={portalContext} />
        )}
      </div>
    </div>
  );
}