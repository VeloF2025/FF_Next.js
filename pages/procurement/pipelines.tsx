/**
 * /procurement/pipelines
 *
 * Shows all procurement threads (pipeline records) — each thread tracks
 * the full lifecycle of a procurement transaction across the 9-step wizard.
 * Thread numbering: PT26-00001.
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  GitBranch,
  Search,
  Filter,
  X,
  Loader2,
  AlertCircle,
  Building2,
  ChevronRight,
  Plus,
  Package,
  FileText,
  ShoppingCart,
  PackageCheck,
  CheckCircle2,
  Clock,
  Pause,
  XCircle,
} from 'lucide-react';
import { log } from '@/lib/logger';

// ── Step labels (must match WizardStepIndicator) ─────────────────────────────

const STEP_LABELS: Record<number, string> = {
  1: 'Requirements',
  2: 'Strategy',
  3: 'Submit',
  4: 'Approval Gate',
  5: 'Create Order',
  6: 'Receive Goods',
  7: 'Payment Request',
  8: 'Payment Approval',
  9: 'Complete',
};

function formatZAR(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PipelineThread {
  id: string;
  threadNumber: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  costCenterName: string | null;
  costCenterCode: string | null;
  requisitionId: string | null;
  requisitionNumber: string | null;
  poId: string | null;
  poNumber: string | null;
  rfqId: string | null;
  quoteId: string | null;
  grnId: string | null;
  paymentApprovalId: string | null;
  strategy: string | null;
  currentStep: number;
  status: string;
  estimatedTotal: number | null;
  poTotal: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Summary {
  total: number;
  active: number;
  completed: number;
  totalValue: number;
}

// ── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  active: { label: 'Active', color: 'bg-blue-500/20 text-blue-400', icon: Clock },
  completed: { label: 'Completed', color: 'bg-green-500/20 text-green-400', icon: CheckCircle2 },
  on_hold: { label: 'On Hold', color: 'bg-amber-500/20 text-amber-400', icon: Pause },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-400', icon: XCircle },
};

// ── Step Progress Bar (inline mini version) ──────────────────────────────────

function StepProgress({ currentStep, totalSteps = 9 }: { currentStep: number; totalSteps?: number }) {
  const pct = Math.round(((currentStep - 1) / (totalSteps - 1)) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-1.5 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-[var(--ff-text-tertiary)] whitespace-nowrap">
        {currentStep}/{totalSteps}
      </span>
    </div>
  );
}

// ── Document Badges ──────────────────────────────────────────────────────────

function DocBadges({ thread }: { thread: PipelineThread }) {
  const badges: { label: string; value: string; icon: typeof FileText; color: string }[] = [];

  if (thread.requisitionNumber) {
    badges.push({
      label: 'PR',
      value: thread.requisitionNumber,
      icon: FileText,
      color: 'text-blue-400 bg-blue-500/10',
    });
  }
  if (thread.poNumber) {
    badges.push({
      label: 'PO',
      value: thread.poNumber,
      icon: ShoppingCart,
      color: 'text-green-400 bg-green-500/10',
    });
  }
  if (thread.grnId) {
    badges.push({
      label: 'GRN',
      value: 'Received',
      icon: PackageCheck,
      color: 'text-purple-400 bg-purple-500/10',
    });
  }

  if (badges.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {badges.map((b) => {
        const Icon = b.icon;
        return (
          <span key={b.label} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${b.color}`}>
            <Icon className="h-3 w-3" />
            {b.value}
          </span>
        );
      })}
    </div>
  );
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function PipelinesPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<PipelineThread[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    fetchThreads();
  }, []);

  async function fetchThreads() {
    try {
      setIsLoading(true);
      const res = await fetch('/api/procurement/threads');
      const data = await res.json();
      if (data.success) {
        setThreads(data.data.threads);
        setSummary(data.data.summary);
      } else {
        setError(data.error?.message || 'Failed to load pipelines');
      }
    } catch (err) {
      log.error('Failed to load pipelines', { error: err });
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  }

  const filtered = threads.filter((t) => {
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      t.threadNumber.toLowerCase().includes(q) ||
      (t.title ?? '').toLowerCase().includes(q) ||
      (t.projectName ?? '').toLowerCase().includes(q) ||
      (t.costCenterName ?? '').toLowerCase().includes(q) ||
      (t.projectCode ?? '').toLowerCase().includes(q) ||
      (t.requisitionNumber ?? '').toLowerCase().includes(q) ||
      (t.poNumber ?? '').toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-500/10">
                  <GitBranch className="h-6 w-6 text-indigo-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">Procurement Pipelines</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Track procurement threads from requisition to completion
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push('/procurement/workflow')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                New Pipeline
              </button>
            </div>
          </div>
          <div className="px-6 border-t border-[var(--ff-border-light)]">
            <ProcurementTabs activeTab="pipelines" />
          </div>
        </div>

        <div className="p-6">
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <SummaryCard
                label="Total Pipelines"
                value={summary.total}
                icon={<GitBranch className="h-5 w-5 text-indigo-400" />}
                color="indigo"
              />
              <SummaryCard
                label="Active"
                value={summary.active}
                icon={<Clock className="h-5 w-5 text-blue-400" />}
                color="blue"
              />
              <SummaryCard
                label="Completed"
                value={summary.completed}
                icon={<CheckCircle2 className="h-5 w-5 text-green-400" />}
                color="green"
              />
              <SummaryCard
                label="Total Value"
                value={summary.totalValue}
                isCurrency
                icon={<Package className="h-5 w-5 text-purple-400" />}
                color="purple"
              />
            </div>
          )}

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search by thread number, project, PR, PO..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="on_hold">On Hold</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            {(searchTerm || statusFilter !== 'all') && (
              <button
                onClick={() => { setSearchTerm(''); setStatusFilter('all'); }}
                className="text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)] flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear filters
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Thread list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <GitBranch className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <p className="text-[var(--ff-text-primary)] font-medium">
                {threads.length > 0 ? 'No pipelines match your filters' : 'No procurement pipelines yet'}
              </p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                {threads.length > 0
                  ? 'Try adjusting your search or filters'
                  : 'Start a new procurement workflow to create a pipeline'
                }
              </p>
              {threads.length === 0 && (
                <button
                  onClick={() => router.push('/procurement/workflow')}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                >
                  <Plus className="h-4 w-4" />
                  Start New Pipeline
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((thread) => {
                const statusCfg = STATUS_CONFIG[thread.status] ?? STATUS_CONFIG.active;
                const StatusIcon = statusCfg.icon;
                const stepLabel = STEP_LABELS[Number(thread.currentStep)] ?? `Step ${thread.currentStep}`;
                const value = thread.poTotal ?? thread.estimatedTotal;

                return (
                  <div
                    key={thread.id}
                    className="flex items-center gap-4 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-indigo-500/30 transition-colors group cursor-pointer"
                    onClick={() => router.push(`/procurement/workflow?threadId=${thread.id}`)}
                  >
                    {/* Thread icon + number */}
                    <div className="p-2 rounded-lg bg-indigo-500/10 shrink-0">
                      <GitBranch className="h-5 w-5 text-indigo-400" />
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-[var(--ff-text-primary)] text-sm">
                          {thread.threadNumber}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {statusCfg.label}
                        </span>
                        {thread.strategy && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
                            {thread.strategy === 'rfq' ? 'RFQ Route' : 'Direct PO'}
                          </span>
                        )}
                      </div>

                      {/* Title + project */}
                      <div className="flex items-center gap-3 text-xs text-[var(--ff-text-tertiary)] flex-wrap mb-1.5">
                        {thread.title && (
                          <span className="text-[var(--ff-text-secondary)]">{thread.title}</span>
                        )}
                        {thread.projectName ? (
                          <span className="flex items-center gap-1">
                            <Package className="h-3 w-3" />
                            {thread.projectCode ? `${thread.projectCode} — ` : ''}{thread.projectName}
                          </span>
                        ) : thread.costCenterName ? (
                          <span className="flex items-center gap-1 text-blue-400">
                            <Building2 className="h-3 w-3" />
                            {thread.costCenterCode ? `${thread.costCenterCode} — ` : ''}{thread.costCenterName}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-400">
                            <AlertCircle className="h-3 w-3" />
                            No allocation
                          </span>
                        )}
                        <span>Updated {formatDate(thread.updatedAt)}</span>
                      </div>

                      {/* Document badges */}
                      <DocBadges thread={thread} />
                    </div>

                    {/* Step progress */}
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-[var(--ff-text-secondary)] mb-1">{stepLabel}</div>
                      <StepProgress currentStep={Number(thread.currentStep)} />
                    </div>

                    {/* Value */}
                    {value != null && value > 0 && (
                      <div className="text-right shrink-0 min-w-[100px]">
                        <div className="text-sm font-semibold text-[var(--ff-text-primary)]">
                          {formatZAR(value)}
                        </div>
                        <div className="text-xs text-[var(--ff-text-tertiary)]">
                          {thread.poTotal ? 'PO Total' : 'Estimated'}
                        </div>
                      </div>
                    )}

                    {/* Arrow */}
                    <ChevronRight className="h-5 w-5 text-[var(--ff-text-tertiary)] group-hover:text-[var(--ff-text-secondary)] shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

// ── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
  color,
  isCurrency = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  isCurrency?: boolean;
}) {
  const colorClass: Record<string, string> = {
    indigo: 'border-indigo-500/20',
    blue: 'border-blue-500/20',
    green: 'border-green-500/20',
    purple: 'border-purple-500/20',
  };

  return (
    <div className={`p-4 bg-[var(--ff-bg-secondary)] border rounded-lg ${colorClass[color] ?? 'border-[var(--ff-border-light)]'}`}>
      <div className="flex items-center justify-between mb-2">
        {icon}
        <span className="text-2xl font-bold text-[var(--ff-text-primary)]">
          {isCurrency ? formatZAR(value) : value}
        </span>
      </div>
      <div className="text-sm text-[var(--ff-text-secondary)]">{label}</div>
    </div>
  );
}
