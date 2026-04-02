/**
 * /procurement/open-orders
 *
 * Combined view of all active purchase requisitions and purchase orders —
 * anything in-flight that hasn't been completed or cancelled.
 * Gives procurement managers a single pane of glass for in-progress activity.
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Inbox,
  FileText,
  ShoppingCart,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Search,
  ChevronRight,
  Loader2,
  AlertCircle,
  X,
  Filter,
  TrendingUp,
  Package,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { ExportCSVButton } from '@/components/shared/ExportCSVButton';

function formatZAR(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0 }).format(amount);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface OpenOrderItem {
  id: string;
  type: 'pr' | 'po';
  number: string;
  status: string;
  amount: number | null;
  docDate: string | null;
  dueDate: string | null;
  notes: string | null;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  supplierName: string | null;
  itemCount: number;
  approvalRequestId: string | null;
  hasPendingApproval: boolean;
}

interface Summary {
  totalPRs: number;
  totalPOs: number;
  total: number;
  pendingApproval: number;
  totalValue: number;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const PR_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400' },
  pending_approval: { label: 'Pending Approval', color: 'bg-amber-500/20 text-amber-400' },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400' },
  ordered: { label: 'Ordered', color: 'bg-blue-500/20 text-blue-400' },
};

const PO_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400' },
  pending_approval: { label: 'Pending Approval', color: 'bg-amber-500/20 text-amber-400' },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400' },
  sent: { label: 'Sent to Supplier', color: 'bg-blue-500/20 text-blue-400' },
  partial_delivery: { label: 'Partial Delivery', color: 'bg-purple-500/20 text-purple-400' },
};

function statusBadge(item: OpenOrderItem) {
  const map = item.type === 'pr' ? PR_STATUS : PO_STATUS;
  const cfg = map[item.status] ?? { label: item.status, color: 'bg-gray-500/20 text-gray-400' };
  return cfg;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function OpenOrdersPage() {
  const router = useRouter();
  const [items, setItems] = useState<OpenOrderItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'pr' | 'po'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    fetchOpenOrders();
  }, []);

  async function fetchOpenOrders() {
    try {
      setIsLoading(true);
      const res = await fetch('/api/procurement/open-orders');
      const data = await res.json();
      if (data.success) {
        setItems(data.data.items);
        setSummary(data.data.summary);
      } else {
        setError(data.error?.message || 'Failed to load open orders');
      }
    } catch (err) {
      log.error('Failed to load open orders', { error: err });
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  }

  const filtered = items.filter((item) => {
    const matchesType = typeFilter === 'all' || item.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      item.number.toLowerCase().includes(q) ||
      (item.projectName ?? '').toLowerCase().includes(q) ||
      (item.supplierName ?? '').toLowerCase().includes(q) ||
      (item.projectCode ?? '').toLowerCase().includes(q);
    return matchesType && matchesStatus && matchesSearch;
  });

  const getLink = (item: OpenOrderItem) =>
    item.type === 'pr'
      ? `/procurement/requisitions/${item.id}`
      : `/procurement/purchase-orders/${item.id}`;

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Inbox className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">Open Orders</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    All active purchase requisitions and purchase orders
                  </p>
                </div>
              </div>
              <ExportCSVButton
                endpoint="/api/procurement/open-orders-export"
                filenamePrefix="open-orders"
              />
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <SummaryCard
                label="Total Open"
                value={summary.total}
                icon={<Inbox className="h-5 w-5 text-purple-400" />}
                color="purple"
              />
              <SummaryCard
                label="Pending Approval"
                value={summary.pendingApproval}
                icon={<Clock className="h-5 w-5 text-amber-400" />}
                color="amber"
                href="/procurement/approvals"
              />
              <SummaryCard
                label="Requisitions"
                value={summary.totalPRs}
                icon={<FileText className="h-5 w-5 text-blue-400" />}
                color="blue"
              />
              <SummaryCard
                label="Purchase Orders"
                value={summary.totalPOs}
                icon={<ShoppingCart className="h-5 w-5 text-green-400" />}
                color="green"
              />
            </div>
          )}

          {summary && summary.totalValue > 0 && (
            <div className="mb-6 p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-purple-400 shrink-0" />
              <div>
                <span className="text-sm text-[var(--ff-text-secondary)]">Total open order value: </span>
                <span className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  {formatZAR(summary.totalValue)}
                </span>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search by number, project, supplier..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-purple-500/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as 'all' | 'pr' | 'po')}
                className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-purple-500/50"
              >
                <option value="all">All Types</option>
                <option value="po">Purchase Orders</option>
                <option value="pr">Requisitions</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-purple-500/50"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="approved">Approved</option>
                <option value="sent">Sent to Supplier</option>
              </select>
            </div>
            {(searchTerm || typeFilter !== 'all' || statusFilter !== 'all') && (
              <button
                onClick={() => { setSearchTerm(''); setTypeFilter('all'); setStatusFilter('all'); }}
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

          {/* List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-4" />
              <p className="text-[var(--ff-text-primary)] font-medium">No open orders</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                {items.length > 0 ? 'No items match your filters' : 'All procurement is complete or cancelled'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((item) => {
                const status = statusBadge(item);
                const isTypePR = item.type === 'pr';
                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    className="flex items-center gap-4 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-purple-500/30 transition-colors group"
                  >
                    {/* Type icon */}
                    <div className={`p-2 rounded-lg shrink-0 ${isTypePR ? 'bg-blue-500/10' : 'bg-green-500/10'}`}>
                      {isTypePR
                        ? <FileText className="h-5 w-5 text-blue-400" />
                        : <ShoppingCart className="h-5 w-5 text-green-400" />
                      }
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-semibold text-[var(--ff-text-primary)] text-sm">
                          {item.number}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isTypePR ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                          {isTypePR ? 'PR' : 'PO'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                          {status.label}
                        </span>
                        {item.hasPendingApproval && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Awaiting Approval
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--ff-text-tertiary)] flex-wrap">
                        {item.projectName && (
                          <span className="flex items-center gap-1">
                            <Package className="h-3 w-3" />
                            {item.projectCode ? `${item.projectCode} — ` : ''}{item.projectName}
                          </span>
                        )}
                        {item.supplierName && (
                          <span className="text-[var(--ff-text-secondary)]">
                            {item.supplierName}
                          </span>
                        )}
                        <span>{item.itemCount} item{item.itemCount !== 1 ? 's' : ''}</span>
                        <span>Created {formatDate(item.docDate)}</span>
                        {item.dueDate && (
                          <span>Due {formatDate(item.dueDate)}</span>
                        )}
                      </div>
                    </div>

                    {/* Amount */}
                    {item.amount != null && (
                      <div className="text-right shrink-0">
                        <div className="text-base font-semibold text-[var(--ff-text-primary)]">
                          {formatZAR(item.amount)}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {item.hasPendingApproval && (
                        <Link
                          href="/procurement/approvals"
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-xs font-medium"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Approve
                        </Link>
                      )}
                      <Link
                        href={getLink(item)}
                        className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded transition-colors group-hover:text-[var(--ff-text-secondary)]"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </Link>
                    </div>
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

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
  color,
  href,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  href?: string;
}) {
  const colorClass: Record<string, string> = {
    purple: 'border-purple-500/20',
    amber: 'border-amber-500/20',
    blue: 'border-blue-500/20',
    green: 'border-green-500/20',
  };

  const content = (
    <div className={`p-4 bg-[var(--ff-bg-secondary)] border rounded-lg ${colorClass[color] ?? 'border-[var(--ff-border-light)]'} ${href ? 'hover:border-[var(--ff-primary-400)] transition-colors cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        {icon}
        <span className="text-2xl font-bold text-[var(--ff-text-primary)]">{value}</span>
      </div>
      <div className="text-sm text-[var(--ff-text-secondary)]">{label}</div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}
