import { AlertTriangle } from 'lucide-react';
import { useBOQs } from './hooks/useBOQ';
import { useRFQs } from './hooks/useRFQ';
import { BOQStatus, RFQStatus } from '@/types/procurement.types';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { ProcurementPortalContext } from '@/types/procurement/portal.types';
import { AllProjectsOverview } from './components/AllProjectsOverview';
import {
  ModuleCard,
  ProjectKPISection,
  AlertsSection,
  RecentActivitySection,
  GettingStartedGuide,
  getModuleCards
} from './overview';
import type { ProjectStats } from './overview';

export function ProcurementOverview() {
  const navigate = useNavigate();
  const portalContext = useOutletContext<ProcurementPortalContext>();
  const { selectedProject, viewMode, aggregateMetrics, projectSummaries, permissions } = portalContext || {};

  const { data: boqs } = useBOQs();
  const { data: rfqs } = useRFQs();

  // Calculate statistics
  const stats: ProjectStats = {
    boq: {
      total: boqs?.length || 0,
      draft: boqs?.filter(b => b.status === BOQStatus.DRAFT).length || 0,
      approved: boqs?.filter(b => b.status === BOQStatus.APPROVED).length || 0,
      totalValue: boqs?.reduce((sum, b) => sum + (b.totalEstimatedValue || 0), 0) || 0,
    },
    rfq: {
      total: rfqs?.length || 0,
      sent: rfqs?.filter(r => r.status === RFQStatus.ISSUED).length || 0,
      responsesReceived: rfqs?.filter(r => r.status === RFQStatus.RESPONSES_RECEIVED).length || 0,
      awarded: rfqs?.filter(r => r.status === RFQStatus.AWARDED).length || 0,
    },
  };

  // Get module cards configuration
  const moduleCards = getModuleCards(stats, navigate);

  // Filter cards based on permissions
  const availableCards = moduleCards.filter(card => {
    if (card.permission && !permissions) return false;
    return true;
  });

  // Conditional rendering based on view mode
  if (viewMode === 'all') {
    return <AllProjectsOverview
      aggregateMetrics={aggregateMetrics}
      projectSummaries={projectSummaries}
      navigate={navigate}
    />;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Procurement Overview</h1>
        <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
          Manage inventory, quotes, and purchase orders
        </p>
      </div>

      {/* Project Selection Notice */}
      {!selectedProject && (
        <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5" />
            <div>
              <h3 className="font-medium text-yellow-400">Select a Project</h3>
              <p className="text-sm text-yellow-400/80 mt-1">
                Choose a project from the dropdown above to access procurement modules and view project-specific data.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Module Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
        {availableCards.map((card) => (
          <ModuleCard
            key={card.id}
            card={card}
            isDisabled={!selectedProject}
            onNavigate={navigate}
          />
        ))}
      </div>

      {/* Project KPI Summary - Only show when project selected */}
      {selectedProject && (
        <ProjectKPISection
          projectName={selectedProject.name}
          projectCode={selectedProject.code}
          stats={stats}
          onNavigate={navigate}
        />
      )}

      {/* Alerts & Notifications - Only show when project selected */}
      {selectedProject && <AlertsSection onNavigate={navigate} />}

      {/* Recent Activity - Only show when project selected */}
      {selectedProject && (
        <RecentActivitySection
          boqs={boqs}
          rfqs={rfqs}
          onNavigate={navigate}
        />
      )}

      {/* Getting Started Guide - Show when no project selected */}
      {!selectedProject && <GettingStartedGuide />}
    </div>
  );
}
