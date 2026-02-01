// WORKING: Goods Receipt Notes list page
// PRD-050 Phase 2: Core Procurement - GRN
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  PackageCheck,
  Plus,
  Search,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronRight,
  Truck,
  Package,
} from 'lucide-react';
import type { GRNListItem, GRNStatus, InspectionStatus } from '@/types/procurement/grn.types';
import { log } from '@/lib/logger';

const statusConfig: Record<GRNStatus, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  receiving: { label: 'Receiving', color: 'bg-blue-500/20 text-blue-400', icon: Package },
  inspecting: { label: 'Inspecting', color: 'bg-yellow-500/20 text-yellow-400', icon: AlertCircle },
  completed: { label: 'Completed', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  partial: { label: 'Partial', color: 'bg-orange-500/20 text-orange-400', icon: Clock },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-400', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'bg-gray-500/20 text-gray-300', icon: XCircle },
};

const inspectionConfig: Record<InspectionStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'text-yellow-400' },
  passed: { label: 'Passed', color: 'text-green-400' },
  failed: { label: 'Failed', color: 'text-red-400' },
  partial: { label: 'Partial', color: 'text-orange-400' },
};

export default function GRNListPage() {
  const router = useRouter();
  const [grns, setGrns] = useState<GRNListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<GRNStatus | 'all'>('all');

  useEffect(() => {
    fetchGRNs();
  }, []);

  const fetchGRNs = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/procurement/grn');
      const data = await response.json();

      if (data.success) {
        setGrns(data.data || []);
      } else {
        setError(data.error?.message || 'Failed to fetch GRNs');
      }
    } catch (err) {
      log.error('Failed to fetch GRNs', err);
      setError('Failed to load goods receipt notes');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredGRNs = grns.filter((grn) => {
    const matchesSearch =
      grn.grnNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      grn.purchaseOrderNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      grn.supplierName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || grn.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  // Stats
  const stats = {
    total: grns.length,
    receiving: grns.filter((g) => g.status === 'receiving').length,
    inspecting: grns.filter((g) => g.status === 'inspecting').length,
    completed: grns.filter((g) => g.status === 'completed').length,
    discrepancies: grns.filter((g) => g.hasDiscrepancy).length,
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <PackageCheck className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                    Goods Receipt Notes
                  </h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Receive and inspect deliveries
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push('/procurement/grn/new')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                New GRN
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6 border-t border-[var(--ff-border-light)]">
            <ProcurementTabs activeTab="grn" categoriesOnly />
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Stats */}
          <div className="mb-6 grid grid-cols-5 gap-4">
            <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ff-text-secondary)]">Total GRNs</span>
                <span className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  {stats.total}
                </span>
              </div>
            </div>
            <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ff-text-secondary)]">Receiving</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">
                  {stats.receiving}
                </span>
              </div>
            </div>
            <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ff-text-secondary)]">Inspecting</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">
                  {stats.inspecting}
                </span>
              </div>
            </div>
            <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ff-text-secondary)]">Completed</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">
                  {stats.completed}
                </span>
              </div>
            </div>
            <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ff-text-secondary)]">Discrepancies</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">
                  {stats.discrepancies}
                </span>
              </div>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search GRNs, PO numbers, suppliers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as GRNStatus | 'all')}
              className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="receiving">Receiving</option>
              <option value="inspecting">Inspecting</option>
              <option value="completed">Completed</option>
              <option value="partial">Partial</option>
              <option value="rejected">Rejected</option>
            </select>
            <button className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors">
              <Filter className="h-4 w-4" />
              More Filters
            </button>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-400">{error}</p>
              <button
                onClick={fetchGRNs}
                className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
              >
                Retry
              </button>
            </div>
          ) : filteredGRNs.length === 0 ? (
            <div className="text-center py-12">
              <PackageCheck className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">No goods receipt notes found</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Create a GRN to receive goods from a purchase order
              </p>
              <button
                onClick={() => router.push('/procurement/grn/new')}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                Create First GRN
              </button>
            </div>
          ) : (
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      GRN #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      PO #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Supplier
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Warehouse
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Delivery Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Status
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Items
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Qty Received
                    </th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ff-border-light)]">
                  {filteredGRNs.map((grn) => {
                    const status = statusConfig[grn.status];
                    const StatusIcon = status.icon;

                    return (
                      <tr
                        key={grn.id}
                        onClick={() => router.push(`/procurement/grn/${grn.id}`)}
                        className="hover:bg-[var(--ff-bg-hover)] transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[var(--ff-text-primary)]">
                              {grn.grnNumber}
                            </span>
                            {grn.hasDiscrepancy && (
                              <AlertCircle className="h-4 w-4 text-red-400" title="Has discrepancy" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                          {grn.purchaseOrderNumber || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                            <span className="text-[var(--ff-text-secondary)]">
                              {grn.supplierName || 'Unknown'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                          {grn.warehouseName || '-'}
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                          {formatDate(grn.deliveryDate)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-[var(--ff-text-secondary)]">
                          {grn.totalItems}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-[var(--ff-text-primary)]">
                              {grn.totalQuantityReceived}
                            </span>
                            {grn.totalQuantityRejected > 0 && (
                              <span className="text-red-400 text-sm">
                                (-{grn.totalQuantityRejected})
                              </span>
                            )}
                          </div>
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
