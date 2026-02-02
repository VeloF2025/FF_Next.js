/**
 * Project Overview KPI Cards (PRD-058)
 * Displays 4 key metrics: Progress, Budget, Team, Expiring Docs
 */

import { TrendingUp, DollarSign, Users, AlertTriangle, Loader2 } from 'lucide-react';
import { Project } from '@/types/project.types';
import { useProjectTeamSummary, useProjectBudgetSummary, useProjectExpiringDocs, useProjectFinanceSummary } from '@/hooks/useProjectOverview';
import { formatCurrency } from './ProjectDetailUtils';

interface ProjectOverviewKPICardsProps {
  project: Project;
  onNavigateToTeam?: () => void;
  onNavigateToBudget?: () => void;
  onNavigateToDocuments?: () => void;
}

export function ProjectOverviewKPICards({
  project,
  onNavigateToTeam,
  onNavigateToBudget,
  onNavigateToDocuments,
}: ProjectOverviewKPICardsProps) {
  const { data: teamData, isLoading: teamLoading } = useProjectTeamSummary(project.id);
  const { data: budgetData, isLoading: budgetLoading } = useProjectBudgetSummary(project.id);
  const { data: expiringDocs, isLoading: expiringLoading } = useProjectExpiringDocs(project.id, 30);
  const { data: financeSummary, isLoading: financeLoading } = useProjectFinanceSummary(project.id);

  // Use activation progress from finance dashboard, fallback to project.actualProgress
  const progress = Math.round(financeSummary?.activationProgress || project.actualProgress || 0);
  const dropsActivated = financeSummary?.totalDropsActivated || 0;
  const dropsContracted = financeSummary?.totalDropsContracted || 0;

  // Get expiring docs count (warning + critical + expired)
  const expiringCount = expiringDocs
    ? (expiringDocs.stats.expired + expiringDocs.stats.critical + expiringDocs.stats.warning)
    : 0;
  const hasExpiringDocs = expiringCount > 0;

  // Budget percentage
  const budgetPercent = budgetData?.percentUsed || 0;
  const budgetHealth = budgetData?.health || 'healthy';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Progress Card */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-blue-500" />
          </div>
          {financeLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-text-tertiary)]" />
          ) : (
            <span className={`text-2xl font-bold ${
              progress >= 75 ? 'text-green-500' :
              progress >= 50 ? 'text-blue-500' :
              progress >= 25 ? 'text-yellow-500' :
              'text-[var(--ff-text-primary)]'
            }`}>
              {progress}%
            </span>
          )}
        </div>
        <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">Progress</h3>
        <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
          {dropsContracted > 0
            ? `${dropsActivated.toLocaleString()} / ${dropsContracted.toLocaleString()} drops`
            : 'Overall completion'
          }
        </p>
        {/* Mini progress bar */}
        <div className="mt-2 h-1.5 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Budget Card */}
      <button
        onClick={onNavigateToBudget}
        className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 text-left hover:border-[var(--ff-border-dark)] transition-colors"
      >
        <div className="flex items-center justify-between mb-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            budgetHealth === 'critical' ? 'bg-red-500/10' :
            budgetHealth === 'warning' ? 'bg-yellow-500/10' :
            'bg-green-500/10'
          }`}>
            <DollarSign className={`w-5 h-5 ${
              budgetHealth === 'critical' ? 'text-red-500' :
              budgetHealth === 'warning' ? 'text-yellow-500' :
              'text-green-500'
            }`} />
          </div>
          {budgetLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-text-tertiary)]" />
          ) : (
            <span className={`text-2xl font-bold ${
              budgetHealth === 'critical' ? 'text-red-500' :
              budgetHealth === 'warning' ? 'text-yellow-500' :
              'text-green-500'
            }`}>
              {budgetPercent}%
            </span>
          )}
        </div>
        <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">Budget</h3>
        <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
          {budgetData?.totalBudget
            ? formatCurrency(budgetData.actualSpent)
            : formatCurrency(project.actualCost || 0)
          }
        </p>
        {/* Mini progress bar */}
        <div className="mt-2 h-1.5 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              budgetHealth === 'critical' ? 'bg-red-500' :
              budgetHealth === 'warning' ? 'bg-yellow-500' :
              'bg-green-500'
            }`}
            style={{ width: `${Math.min(budgetPercent, 100)}%` }}
          />
        </div>
      </button>

      {/* Team Card */}
      <button
        onClick={onNavigateToTeam}
        className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 text-left hover:border-[var(--ff-border-dark)] transition-colors"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-purple-500" />
          </div>
          {teamLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-text-tertiary)]" />
          ) : (
            <span className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {teamData?.total || 0}
            </span>
          )}
        </div>
        <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">Team</h3>
        <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
          {teamData ? `${teamData.contractors} contractors, ${teamData.staff} staff` : 'Loading...'}
        </p>
      </button>

      {/* Expiring Documents Card */}
      <button
        onClick={onNavigateToDocuments}
        className={`rounded-lg border p-4 text-left transition-colors ${
          hasExpiringDocs
            ? 'bg-red-500/5 border-red-500/30 hover:border-red-500/50'
            : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-border-dark)]'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            hasExpiringDocs ? 'bg-red-500/10' : 'bg-gray-500/10'
          }`}>
            <AlertTriangle className={`w-5 h-5 ${
              hasExpiringDocs ? 'text-red-500' : 'text-gray-400'
            }`} />
          </div>
          {expiringLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-text-tertiary)]" />
          ) : (
            <span className={`text-2xl font-bold ${
              hasExpiringDocs ? 'text-red-500' : 'text-green-500'
            }`}>
              {expiringCount}
            </span>
          )}
        </div>
        <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">
          {hasExpiringDocs ? 'Docs Expiring' : 'Documents'}
        </h3>
        <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
          {hasExpiringDocs
            ? `${expiringDocs?.stats.critical || 0} critical`
            : 'All documents valid'
          }
        </p>
      </button>
    </div>
  );
}
