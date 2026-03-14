// WORKING: Approvals page — all statuses with filtering
import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout';
import Link from 'next/link';
import {
  ClipboardCheck, Search, AlertCircle, AlertTriangle,
  Loader2, X, Settings, Clock, CheckCircle, XCircle,
} from 'lucide-react';
import { ApprovalCard } from '@/modules/procurement/approvals/ApprovalCard';
import type { ApprovalItem } from '@/modules/procurement/approvals/ApprovalCard';
import type { WorkflowType } from '@/types/procurement/approval.types';
import { log } from '@/lib/logger';

type StatusTab = 'all' | 'pending' | 'approved' | 'rejected';

const statusTabs: { key: StatusTab; label: string; Icon: typeof Clock }[] = [
  { key: 'all', label: 'All', Icon: ClipboardCheck },
  { key: 'pending', label: 'Pending', Icon: Clock },
  { key: 'approved', label: 'Approved', Icon: CheckCircle },
  { key: 'rejected', label: 'Rejected', Icon: XCircle },
];

export default function ApprovalsPage() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<WorkflowType | 'all'>('all');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchApprovals = useCallback(async (status: StatusTab) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/procurement/approvals/all?status=${status}`);
      const json = await res.json() as { success: boolean; data?: { approvals: ApprovalItem[]; counts: Record<string, number> } };
      if (json.success && json.data) {
        setItems(json.data.approvals);
        setCounts(json.data.counts);
      }
    } catch (err) {
      log.error('Failed to fetch approvals', err);
      setError('Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchApprovals(activeTab); }, [activeTab, fetchApprovals]);

  const handleApprove = async (taskId: string) => {
    setActioningId(taskId);
    try {
      const res = await fetch(`/api/procurement/approvals/${taskId}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: '' }),
      });
      const data = await res.json();
      if (data.success) {
        setItems((prev) => prev.filter((t) => t.id !== taskId));
      } else {
        setError(data.error?.message || 'Failed to approve');
      }
    } catch (err) {
      log.error('Failed to approve', err);
      setError('Failed to approve');
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async (taskId: string) => {
    if (!rejectReason.trim()) return;
    setActioningId(taskId);
    try {
      const res = await fetch(`/api/procurement/approvals/${taskId}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: rejectReason }),
      });
      const data = await res.json();
      if (data.success) {
        setItems((prev) => prev.filter((t) => t.id !== taskId));
        setShowRejectModal(null);
        setRejectReason('');
      } else {
        setError(data.error?.message || 'Failed to reject');
      }
    } catch (err) {
      log.error('Failed to reject', err);
      setError('Failed to reject');
    } finally {
      setActioningId(null);
    }
  };

  const filtered = items.filter((item) => {
    const matchSearch = !searchTerm ||
      item.documentNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.requestedByName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.respondedByName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchType = typeFilter === 'all' || item.documentType === typeFilter;
    return matchSearch && matchType;
  });

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <ClipboardCheck className="h-6 w-6 text-amber-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">Approvals</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Review and manage procurement approvals</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {(counts.pending || 0) > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/20 rounded-lg">
                    <Clock className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-400">{counts.pending} pending</span>
                  </div>
                )}
                <Link
                  href="/settings?tab=procurement"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
                >
                  <Settings className="h-4 w-4" /> Approval Settings
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Status Tabs */}
          <div className="mb-6 flex items-center gap-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-1 w-fit">
            {statusTabs.map((tab) => {
              const count = tab.key === 'all' ? (counts.total || 0) : (counts[tab.key] || 0);
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
                  }`}
                >
                  <tab.Icon className="h-4 w-4" />
                  {tab.label}
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                    isActive ? 'bg-amber-500/30 text-amber-300' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search + Type Filter */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search by document number, requester, approver..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as WorkflowType | 'all')}
              className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              <option value="all">All Types</option>
              <option value="purchase_requisition">Requisitions</option>
              <option value="purchase_order">Purchase Orders</option>
              <option value="goods_receipt">Goods Receipts</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
              <span className="text-red-400">{error}</span>
              <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
              <p className="text-[var(--ff-text-primary)] font-medium">
                {activeTab === 'pending' ? 'All caught up!' : 'No approvals found'}
              </p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                {activeTab === 'pending' ? 'No pending approvals at the moment' : `No ${activeTab} approvals to display`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <ApprovalCard
                  key={item.id}
                  item={item}
                  onApprove={handleApprove}
                  onReject={(id) => setShowRejectModal(id)}
                  actioningId={actioningId}
                />
              ))}
            </div>
          )}
        </div>

        {/* Reject Modal */}
        {showRejectModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Reject Approval Request</h3>
              <div className="mb-4">
                <label className="block text-sm text-[var(--ff-text-secondary)] mb-2">
                  Reason for rejection <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Please provide a reason for rejection..."
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setShowRejectModal(null); setRejectReason(''); }}
                  className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReject(showRejectModal)}
                  disabled={!rejectReason.trim() || actioningId === showRejectModal}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {actioningId === showRejectModal ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
