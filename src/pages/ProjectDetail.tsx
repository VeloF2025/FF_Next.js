import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useProject, useProjectHierarchy, useDeleteProject } from '@/hooks/useProjects';
import { EnhancedSOWDisplay } from '@/components/sow/EnhancedSOWDisplay';
import { ProjectHSTab } from '@/modules/health-safety/components';
import BOQList from '@/components/procurement/boq/BOQList';
import { ActivationBlockersCard } from '@/modules/projects/components/activation';

// Import split components
import { ProjectInfoCard } from './detail/ProjectInfoCard';
import { ProjectProgressCard } from './detail/ProjectProgressCard';
import { ProjectDetailHeader } from './detail/ProjectDetailHeader';
import { ProjectStatusBadges } from './detail/ProjectStatusBadges';
import { ProjectTabs, TabId } from './detail/ProjectTabs';
import { ProjectKeyDetails } from './detail/ProjectKeyDetails';
import { ProjectQuickStats } from './detail/ProjectQuickStats';
import { ProjectHierarchyTab } from './detail/ProjectHierarchyTab';
import { ProjectTimelineTab } from './detail/ProjectTimelineTab';
import { ProjectDetailLoading } from './detail/ProjectDetailLoading';
import { ProjectDetailNotFound } from './detail/ProjectDetailNotFound';
// PRD-058: Enhanced Overview components
import { ProjectOverviewKPICards } from './detail/ProjectOverviewKPICards';
import { ProjectWorkflowChecklist } from './detail/ProjectWorkflowChecklist';
import { ProjectExpiringDocsList } from './detail/ProjectExpiringDocsList';
// Sprint 1: New tab components
import { ProjectTeamTab } from './detail/ProjectTeamTab';
import { ProjectProcurementTab } from './detail/ProjectProcurementTab';
import { ProjectMaintenanceTab } from './detail/ProjectMaintenanceTab';
// PRD-058: Agreements tab
import { ProjectAgreementsTab } from './detail/ProjectAgreementsTab';
// Wayleaves tab
import { ProjectWayleavesTab } from './detail/ProjectWayleavesTab';
// Finance Dashboard
import { FinanceDashboardTab } from '@/modules/projects/components/finance';
// Income Tab (lazy load)
import dynamic from 'next/dynamic';
const ProjectIncomeTab = dynamic(() => import('./detail/ProjectIncomeTab').then(m => ({ default: m.ProjectIncomeTab })), {
  loading: () => <div className="animate-pulse h-64 bg-[var(--ff-bg-secondary)] rounded-lg" />,
});
// Documents Tab (lazy load)
const ProjectDocumentsTab = dynamic(() => import('./detail/ProjectDocumentsTab').then(m => ({ default: m.ProjectDocumentsTab })), {
  loading: () => <div className="animate-pulse h-64 bg-[var(--ff-bg-secondary)] rounded-lg" />,
});

interface ProjectDetailProps {
  projectId: string;
}

export function ProjectDetail({ projectId }: ProjectDetailProps) {
  const router = useRouter();
  const id = projectId;
  const [tabBadges, setTabBadges] = useState<Record<string, number>>({});

  // Tab URL aliases - map group names and legacy URLs to actual tab IDs
  const TAB_ALIASES: Record<string, TabId> = {
    // Group name aliases (for direct URL navigation like ?tab=work)
    'work': 'sow',
    'contracts': 'agreements',
    'planning': 'timeline',
    'operations': 'procurement',
    'finance': 'finance-dashboard',
    // Legacy/alternative URL aliases
    'finance-documents': 'documents',
    'sow-data': 'sow',
    'health-safety': 'hs',
  };

  // Read tab from URL query param, normalize aliases, default to 'overview'
  const tabFromUrl = router.query.tab as string | undefined;
  const normalizedTab = tabFromUrl ? (TAB_ALIASES[tabFromUrl] || tabFromUrl) : 'overview';
  const activeTab = normalizedTab as TabId;

  // Handle tab change - update URL
  const handleTabChange = (newTab: TabId) => {
    router.push(
      {
        pathname: router.pathname,
        query: { ...router.query, tab: newTab },
      },
      undefined,
      { shallow: true }
    );
  };

  const { data: project, isLoading, error, refetch } = useProject(id!);
  const { data: hierarchy, isLoading: isHierarchyLoading } = useProjectHierarchy(id!);
  const deleteMutation = useDeleteProject();

  const handleProjectActivated = useCallback(() => {
    refetch();
  }, [refetch]);

  // Fetch badge counts for tabs
  useEffect(() => {
    async function fetchBadges() {
      try {
        const [teamRes, maintenanceRes] = await Promise.all([
          fetch(`/api/projects/${id}/team`),
          fetch(`/api/projects/${id}/maintenance-summary`),
        ]);

        const badges: Record<string, number> = {};

        if (teamRes.ok) {
          const teamData = await teamRes.json();
          badges.team = teamData.data?.stats?.total || 0;
        }

        if (maintenanceRes.ok) {
          const maintenanceData = await maintenanceRes.json();
          badges.maintenance = maintenanceData.data?.active || 0;
        }

        setTabBadges(badges);
      } catch {
        // Silently fail - badges are optional
      }
    }

    if (id) fetchBadges();
  }, [id]);

  if (isLoading) {
    return <ProjectDetailLoading />;
  }

  if (error || !project) {
    return <ProjectDetailNotFound onNavigateBack={() => router.push('/projects')} />;
  }

  const handleDeleteProject = async () => {
    if (window.confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      await deleteMutation.mutateAsync(id!);
      router.push('/projects');
    }
  };

  return (
    <div className="space-y-6 px-6">
      <ProjectDetailHeader
        project={project}
        onNavigateBack={() => router.push('/projects')}
        onEdit={() => router.push(`/projects/${id}/edit`)}
        onDelete={handleDeleteProject}
      />

      <ProjectStatusBadges project={project} />

      <ProjectTabs activeTab={activeTab} onTabChange={handleTabChange} badges={tabBadges} />

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Cards Row (PRD-058) */}
          <ProjectOverviewKPICards
            project={project}
            onNavigateToTeam={() => handleTabChange('team')}
            onNavigateToBudget={() => router.push(`/projects/${id}/budget`)}
            onNavigateToDocuments={() => handleTabChange('documents')}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Project Information */}
              <ProjectInfoCard project={project} />

              {/* Workflow Checklist (PRD-058) */}
              <ProjectWorkflowChecklist
                projectId={id!}
                projectStatus={project.status || 'planning'}
              />

              {/* Progress */}
              <ProjectProgressCard project={project} />
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Activation Requirements Card - show for planning projects */}
              {project.status?.toLowerCase() === 'planning' && (
                <ActivationBlockersCard
                  projectId={id!}
                  projectStatus={project.status}
                  onActivate={handleProjectActivated}
                  onRefresh={refetch}
                />
              )}

              {/* Expiring Documents (PRD-058) */}
              <ProjectExpiringDocsList
                projectId={id!}
                onNavigateToDocuments={() => handleTabChange('documents')}
              />

              <ProjectKeyDetails project={project} />
              <ProjectQuickStats project={project} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'team' && (
        <ProjectTeamTab projectId={id!} />
      )}

      {activeTab === 'procurement' && (
        <ProjectProcurementTab projectId={id!} />
      )}

      {activeTab === 'maintenance' && (
        <ProjectMaintenanceTab projectId={id!} />
      )}

      {activeTab === 'hierarchy' && (
        <ProjectHierarchyTab hierarchy={hierarchy} isLoading={isHierarchyLoading} />
      )}

      {activeTab === 'sow' && (
        <EnhancedSOWDisplay projectId={id!} projectName={project.name} />
      )}

      {activeTab === 'boq' && (
        <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)]">
          <div className="p-4 border-b border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Bill of Quantities</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Materials and equipment allocated to this project from BOQ imports
            </p>
          </div>
          <BOQList projectId={id} />
        </div>
      )}

      {activeTab === 'agreements' && (
        <ProjectAgreementsTab projectId={id!} />
      )}

      {activeTab === 'wayleaves' && (
        <ProjectWayleavesTab projectId={id!} projectName={project?.name} />
      )}

      {activeTab === 'timeline' && (
        <ProjectTimelineTab />
      )}

      {activeTab === 'finance-dashboard' && (
        <FinanceDashboardTab
          projectId={id!}
          onNavigateToIncome={() => handleTabChange('income')}
          onNavigateToBudget={() => router.push(`/projects/${id}/budget`)}
        />
      )}

      {activeTab === 'income' && (
        <ProjectIncomeTab projectId={id!} />
      )}

      {activeTab === 'budget' && (
        <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">Project Budget Management</h3>
            <p className="text-[var(--ff-text-secondary)] mb-6 max-w-md mx-auto">
              Track budget allocations, monitor spending by category, and manage financial health for this project.
            </p>
            <button
              onClick={() => router.push(`/projects/${id}/budget`)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Open Budget Dashboard
            </button>
          </div>
        </div>
      )}

      {activeTab === 'hs' && (
        <ProjectHSTab
          projectId={id!}
          projectName={project.name}
          onStartAudit={() => router.push(`/health-safety/project/${id}/audits/new`)}
          onConfigureHS={() => router.push(`/health-safety/project/${id}/configure`)}
        />
      )}

      {activeTab === 'documents' && (
        <ProjectDocumentsTab projectId={id!} />
      )}
    </div>
  );
}

// Default export for Next.js dynamic import
export default ProjectDetail;