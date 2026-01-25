// 🟢 WORKING: Purchase Requisitions list page
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  FileInput,
  Plus,
  Search,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import type { RequisitionListItem, RequisitionStatus, RequisitionUrgency } from '@/types/procurement/requisition.types';
import { log } from '@/lib/logger';

const statusConfig: Record<RequisitionStatus, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-500/20 text-blue-400', icon: Clock },
  pending_approval: { label: 'Pending Approval', color: 'bg-yellow-500/20 text-yellow-400', icon: AlertCircle },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-400', icon: XCircle },
  ordered: { label: 'Ordered', color: 'bg-purple-500/20 text-purple-400', icon: CheckCircle },
  partially_ordered: { label: 'Partially Ordered', color: 'bg-indigo-500/20 text-indigo-400', icon: Clock },
  closed: { label: 'Closed', color: 'bg-gray-500/20 text-gray-400', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-300', icon: XCircle },
};

const urgencyConfig: Record<RequisitionUrgency, { label: string; color: string }> = {
  low: { label: 'Low', color: 'text-gray-400' },
  normal: { label: 'Normal', color: 'text-blue-400' },
  high: { label: 'High', color: 'text-orange-400' },
  critical: { label: 'Critical', color: 'text-red-400' },
};

export default function RequisitionsPage() {
  const router = useRouter();
  const [requisitions, setRequisitions] = useState<RequisitionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchRequisitions();
  }, []);

  const fetchRequisitions = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/procurement/requisitions');
      const data = await response.json();

      if (data.success) {
        setRequisitions(data.data || []);
      } else {
        setError(data.error?.message || 'Failed to fetch requisitions');
      }
    } catch (err) {
      log.error('Failed to fetch requisitions', err);
      setError('Failed to load requisitions');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredRequisitions = requisitions.filter(
    (r) =>
      r.requisitionNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.projectName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.requestedByName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatCurrency = (value: number | undefined) => {
    if (value === undefined) return '-';
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <FileInput className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                    Purchase Requisitions
                  </h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Manage material and service requests
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push('/procurement/requisitions/new')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                New Requisition
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6 border-t border-[var(--ff-border-light)]">
            <ProcurementTabs activeTab="requisitions" />
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Search and Filters */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search requisitions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
            <button className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors">
              <Filter className="h-4 w-4" />
              Filters
            </button>
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-4 gap-4">
            {['draft', 'pending_approval', 'approved', 'ordered'].map((status) => {
              const config = statusConfig[status as RequisitionStatus];
              const count = requisitions.filter((r) => r.status === status).length;
              return (
                <div
                  key={status}
                  className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--ff-text-secondary)]">{config.label}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${config.color}`}>
                      {count}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-400">{error}</p>
              <button
                onClick={fetchRequisitions}
                className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Retry
              </button>
            </div>
          ) : filteredRequisitions.length === 0 ? (
            <div className="text-center py-12">
              <FileInput className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">No requisitions found</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Create your first purchase requisition to get started
              </p>
            </div>
          ) : (
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">
                      Requisition #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">
                      Project
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">
                      Requested By
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">
                      Urgency
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">
                      Est. Total
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">
                      Items
                    </th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ff-border-light)]">
                  {filteredRequisitions.map((req) => {
                    const status = statusConfig[req.status];
                    const urgency = urgencyConfig[req.urgency];
                    const StatusIcon = status.icon;

                    return (
                      <tr
                        key={req.id}
                        onClick={() => router.push(`/procurement/requisitions/${req.id}`)}
                        className="hover:bg-[var(--ff-bg-hover)] transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-[var(--ff-text-primary)]">
                            {req.requisitionNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                          {req.projectName || '-'}
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                          {req.requestedByName || '-'}
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                          {formatDate(req.requestedDate)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-medium ${urgency.color}`}>
                            {urgency.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-primary)]">
                          {formatCurrency(req.estimatedTotal)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)]">
                          {req.itemCount}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
