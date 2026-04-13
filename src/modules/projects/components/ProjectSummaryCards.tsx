import { FolderOpen, CheckCircle, Clock, AlertCircle, DollarSign, TrendingUp } from 'lucide-react';

interface ProjectSummary {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalBudget: number;
  onHoldProjects: number;
  highPriorityProjects: number;
}

interface ProjectSummaryCardsProps {
  summary?: ProjectSummary;
  projects?: { status?: string; budget_allocated?: number; budget?: number; priority?: string }[];
}

export function ProjectSummaryCards({ summary, projects = [] }: ProjectSummaryCardsProps) {
  // Calculate summary from projects if not provided
  // Use case-insensitive matching since DB has mixed case statuses
  const calculatedSummary = summary || {
    totalProjects: projects.length,
    activeProjects: projects.filter(p => {
      const s = (p.status || '').toLowerCase();
      return s === 'in_progress' || s === 'active';
    }).length,
    completedProjects: projects.filter(p => {
      const s = (p.status || '').toLowerCase();
      return s === 'completed' || s === 'complete';
    }).length,
    totalBudget: projects.reduce((sum, p) => sum + (Number(p.budget_allocated) || Number(p.budget) || 0), 0),
    onHoldProjects: projects.filter(p => (p.status || '').toLowerCase() === 'on_hold').length,
    highPriorityProjects: projects.filter(p => {
      const pr = (p.priority || '').toLowerCase();
      return pr === 'high' || pr === 'critical';
    }).length,
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Projects</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{calculatedSummary.totalProjects}</p>
          </div>
          <FolderOpen className="h-8 w-8 text-blue-500" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Active Projects</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{calculatedSummary.activeProjects}</p>
          </div>
          <TrendingUp className="h-8 w-8 text-green-500" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Completed</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{calculatedSummary.completedProjects}</p>
          </div>
          <CheckCircle className="h-8 w-8 text-blue-500" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">On Hold</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{calculatedSummary.onHoldProjects}</p>
          </div>
          <Clock className="h-8 w-8 text-yellow-500" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Budget</p>
            <p className="text-xl font-bold text-[var(--ff-text-primary)]">{formatCurrency(calculatedSummary.totalBudget)}</p>
          </div>
          <DollarSign className="h-8 w-8 text-purple-500" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">High Priority</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{calculatedSummary.highPriorityProjects}</p>
          </div>
          <AlertCircle className="h-8 w-8 text-red-500" />
        </div>
      </div>
    </div>
  );
}