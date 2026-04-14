/**
 * Financial Page - Unified tab interface for budget and cost management
 * Tabs: Budget | Cost Centers
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { AppLayout } from '@/components/layout';
import { useTabPersistence } from '@/modules/procurement/hooks';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import {
  DollarSign,
  Wallet,
  Building2,
  Plus,
  Search,
  Loader2,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  FileText,
  LayoutTemplate,
  Percent,
  FolderTree,
  Eye,
  Pencil,
  MoreVertical,
} from 'lucide-react';
import Link from 'next/link';
import { createLogger } from '@/lib/logger';

const log = createLogger('FinancialPage');

interface FinancialPageProps {
  projectId?: string;
}

const TABS = [
  { id: 'budget', label: 'Budget', icon: Wallet },
  { id: 'cost-centers', label: 'Cost Centers', icon: Building2 },
] as const;

type TabId = typeof TABS[number]['id'];

// Loading component
function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      <span className="ml-2 text-[var(--ff-text-secondary)]">{message}</span>
    </div>
  );
}

// Types for Budget
interface BudgetTemplate {
  id: string;
  code: string;
  name: string;
  description?: string;
  template_type: string;
  category_count: number;
  total_percent: number;
  usage_count: number;
  is_system: boolean;
}

interface ProjectBudget {
  project_id: string;
  project_name: string;
  total_budget: number;
  spent: number;
  remaining: number;
  percent_used: number;
  status: 'on_track' | 'warning' | 'over_budget';
}

// Types for Cost Centers
interface CostCenterSummary {
  id: string;
  code: string;
  name: string;
  description?: string;
  parent_id?: string;
  cost_center_type: string;
  is_active: boolean;
  total_budget?: number;
  total_spent?: number;
  child_count?: number;
}

const budgetStatusConfig = {
  on_track: { label: 'On Track', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  warning: { label: 'Warning', color: 'bg-yellow-500/20 text-yellow-400', icon: AlertTriangle },
  over_budget: { label: 'Over Budget', color: 'bg-red-500/20 text-red-400', icon: AlertTriangle },
};

const formatCurrency = (value: number | undefined) => {
  if (value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(value);
};

// Budget Tab Content
function BudgetTabContent() {
  const router = useRouter();
  const [templates, setTemplates] = useState<BudgetTemplate[]>([]);
  const [projectBudgets, setProjectBudgets] = useState<ProjectBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchBudgetData();
  }, []);

  const fetchBudgetData = async () => {
    try {
      setIsLoading(true);
      const [templatesRes, budgetsRes] = await Promise.all([
        fetch('/api/procurement/budget/templates'),
        fetch('/api/procurement/budget/projects'),
      ]);

      const templatesData = await templatesRes.json();
      const budgetsData = await budgetsRes.json();

      if (templatesData.success) {
        setTemplates(templatesData.data || []);
      }
      if (budgetsData.success) {
        setProjectBudgets(budgetsData.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch budget data', { error: err });
    } finally {
      setIsLoading(false);
    }
  };

  const totalBudget = projectBudgets.reduce((sum, b) => sum + (b.total_budget || 0), 0);
  const totalSpent = projectBudgets.reduce((sum, b) => sum + (b.spent || 0), 0);
  const overBudgetCount = projectBudgets.filter(b => b.status === 'over_budget').length;

  const filteredProjects = projectBudgets.filter(
    (b) => b.project_name.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) return <LoadingState message="Loading budget data..." />;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <StatCardGrid columns={4}>
        <StatCard
          label="Total Budget"
          value={formatCurrency(totalBudget)}
          icon={DollarSign}
          colorType="total"
        />
        <StatCard
          label="Total Spent"
          value={formatCurrency(totalSpent)}
          icon={TrendingUp}
          colorType="success"
        />
        <StatCard
          label="Templates"
          value={templates.length}
          icon={LayoutTemplate}
          colorType="financial"
        />
        <StatCard
          label="Over Budget"
          value={overBudgetCount}
          icon={AlertTriangle}
          colorType="error"
        />
      </StatCardGrid>

      {/* Templates Section */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Budget Templates</h3>
          <button
            onClick={() => router.push('/procurement/budget?action=new-template')}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Template
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {templates.slice(0, 6).map((template) => (
            <div
              key={template.id}
              className="p-3 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:border-amber-500/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">{template.name}</p>
                  <p className="text-xs text-[var(--ff-text-secondary)]">{template.code}</p>
                </div>
                <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded">
                  {template.category_count} categories
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-[var(--ff-text-tertiary)]">
                <Percent className="h-3 w-3" />
                {template.total_percent}% allocated
                <span className="mx-1">•</span>
                Used {template.usage_count}x
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Project Budgets */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Project Budgets</h3>
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] text-sm"
            />
          </div>
        </div>

        <div className="space-y-2">
          {filteredProjects.map((budget) => {
            const status = budgetStatusConfig[budget.status];
            const StatusIcon = status.icon;
            return (
              <div
                key={budget.project_id}
                className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-amber-500/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                    <div>
                      <p className="font-medium text-[var(--ff-text-primary)]">{budget.project_name}</p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">
                        {formatCurrency(budget.spent)} of {formatCurrency(budget.total_budget)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-32 h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          budget.percent_used > 100
                            ? 'bg-red-500'
                            : budget.percent_used > 80
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(budget.percent_used, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-[var(--ff-text-primary)] w-12">
                      {budget.percent_used.toFixed(0)}%
                    </span>
                    <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${status.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {filteredProjects.length === 0 && (
            <div className="text-center py-12 text-[var(--ff-text-secondary)]">
              No project budgets found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Cost Centers Tab Content
function CostCentersTabContent() {
  const router = useRouter();
  const [costCenters, setCostCenters] = useState<CostCenterSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchCostCenters();
  }, []);

  const fetchCostCenters = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/procurement/cost-centers');
      const data = await res.json();
      if (data.success) {
        setCostCenters(data.data?.cost_centers || []);
      }
    } catch (err) {
      log.error('Failed to fetch cost centers', { error: err });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const totalCostCenters = costCenters.length;
  const activeCostCenters = costCenters.filter(c => c.is_active).length;
  const totalBudget = costCenters.reduce((sum, c) => sum + (c.total_budget || 0), 0);
  const totalSpent = costCenters.reduce((sum, c) => sum + (c.total_spent || 0), 0);

  const rootCenters = costCenters.filter(c => !c.parent_id);
  const getChildren = (parentId: string) => costCenters.filter(c => c.parent_id === parentId);

  const filteredCenters = search
    ? costCenters.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.code.toLowerCase().includes(search.toLowerCase())
      )
    : rootCenters;

  if (isLoading) return <LoadingState message="Loading cost centers..." />;

  const renderCostCenter = (center: CostCenterSummary, depth = 0) => {
    const children = getChildren(center.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(center.id);

    return (
      <div key={center.id}>
        <div
          className={`p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-amber-500/50 transition-colors ${
            depth > 0 ? 'ml-6 mt-2' : ''
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {hasChildren && !search ? (
                <button
                  onClick={() => toggleExpand(center.id)}
                  className="p-1 hover:bg-[var(--ff-bg-tertiary)] rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                  )}
                </button>
              ) : (
                <div className="w-6" />
              )}
              <Building2 className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
              <div>
                <p className="font-medium text-[var(--ff-text-primary)]">{center.name}</p>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  {center.code} • {center.cost_center_type}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className={`px-2 py-1 rounded text-xs ${center.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                {center.is_active ? 'Active' : 'Inactive'}
              </span>
              {center.total_budget !== undefined && (
                <span className="text-sm text-[var(--ff-text-secondary)]">
                  {formatCurrency(center.total_spent)} / {formatCurrency(center.total_budget)}
                </span>
              )}
              {hasChildren && (
                <span className="text-xs text-[var(--ff-text-tertiary)]">
                  {children.length} sub-centers
                </span>
              )}
            </div>
          </div>
        </div>
        {hasChildren && isExpanded && !search && (
          <div className="space-y-2">
            {children.map((child) => renderCostCenter(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <StatCardGrid columns={4}>
        <StatCard
          label="Total Cost Centers"
          value={totalCostCenters}
          icon={Building2}
          colorType="total"
        />
        <StatCard
          label="Active"
          value={activeCostCenters}
          icon={CheckCircle}
          colorType="active"
        />
        <StatCard
          label="Total Budget"
          value={formatCurrency(totalBudget)}
          icon={DollarSign}
          colorType="financial"
        />
        <StatCard
          label="Total Spent"
          value={formatCurrency(totalSpent)}
          icon={TrendingUp}
          colorType="pending"
        />
      </StatCardGrid>

      {/* Search and Actions */}
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search cost centers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={() => router.push('/procurement/cost-centers?action=new')}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Cost Center
        </button>
      </div>

      {/* Cost Centers Tree */}
      <div className="space-y-2">
        {filteredCenters.map((center) => renderCostCenter(center))}
        {filteredCenters.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No cost centers found
          </div>
        )}
      </div>
    </div>
  );
}

export default function FinancialPage({ projectId }: FinancialPageProps) {
  const { activeTab, changeTab, isInitialized } = useTabPersistence({
    pageKey: 'financial',
    defaultTab: 'budget',
    validTabs: TABS.map(t => t.id),
  });

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Page Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <DollarSign className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  Financial
                </h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Manage budgets and cost center allocations
                </p>
              </div>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="px-6">
            <nav className="flex gap-1" aria-label="Financial tabs">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => changeTab(tab.id)}
                    className={`
                      flex items-center gap-2 px-4 py-3 text-sm font-medium
                      border-b-2 transition-colors
                      ${isActive
                        ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                        : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-secondary)]'
                      }
                    `}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {!isInitialized ? (
            <LoadingState message="Loading..." />
          ) : (
            <>
              {activeTab === 'budget' && <BudgetTabContent />}
              {activeTab === 'cost-centers' && <CostCentersTabContent />}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { query } = context;
  const projectId = query.projectId as string | undefined;

  return {
    props: {
      projectId: projectId || null,
    },
  };
};
