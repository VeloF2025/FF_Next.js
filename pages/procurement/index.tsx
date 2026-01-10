import { useState, useEffect } from 'react';
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

  // Get permissions for selected project
  const permissions = useProcurementPermissions(selectedProject?.id);

  // Update URL when state changes
  useEffect(() => {
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
    });
  }, [activeTab, viewMode, selectedProject, router]);

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

              {/* Main Content */}
              <ProcurementTabs />
            </div>
          </div>
        </div>
      </ProcurementPortalProvider>
    </AppLayout>
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