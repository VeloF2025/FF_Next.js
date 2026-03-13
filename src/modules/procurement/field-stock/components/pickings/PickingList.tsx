/**
 * PickingList Component
 * Display list of stock pickings with filtering and status management
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';
import {
  Package,
  ArrowRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Plus,
  Filter,
  RefreshCw,
  Truck,
  RotateCcw
} from 'lucide-react';
import { usePickings } from '../../hooks/usePickings';
import type { StockPicking, PickingType, PickingStatus } from '../../types';

const PICKING_TYPE_CONFIG: Record<PickingType, { label: string; icon: React.ReactNode; color: string }> = {
  issue: {
    label: 'Issue',
    icon: <ArrowRight className="h-4 w-4" />,
    color: 'blue'
  },
  receipt: {
    label: 'Receipt',
    icon: <Package className="h-4 w-4" />,
    color: 'green'
  },
  transfer: {
    label: 'Transfer',
    icon: <Truck className="h-4 w-4" />,
    color: 'purple'
  },
  return: {
    label: 'Return',
    icon: <RotateCcw className="h-4 w-4" />,
    color: 'orange'
  },
  scrap: {
    label: 'Scrap',
    icon: <XCircle className="h-4 w-4" />,
    color: 'red'
  }
};

const STATUS_CONFIG: Record<PickingStatus, { label: string; color: string; icon: React.ReactNode }> = {
  draft: {
    label: 'Draft',
    color: 'gray',
    icon: <Clock className="h-4 w-4" />
  },
  confirmed: {
    label: 'Confirmed',
    color: 'blue',
    icon: <CheckCircle2 className="h-4 w-4" />
  },
  processing: {
    label: 'Processing',
    color: 'yellow',
    icon: <Loader2 className="h-4 w-4 animate-spin" />
  },
  done: {
    label: 'Done',
    color: 'green',
    icon: <CheckCircle2 className="h-4 w-4" />
  },
  cancelled: {
    label: 'Cancelled',
    color: 'red',
    icon: <XCircle className="h-4 w-4" />
  }
};

interface PickingListProps {
  onCreateNew?: () => void;
  onSelectPicking?: (picking: StockPicking) => void;
}

export function PickingList({ onCreateNew, onSelectPicking }: PickingListProps) {
  const router = useRouter();
  const { pickings, loading, error, refresh } = usePickings({ autoFetch: true });
  const [filterType, setFilterType] = useState<PickingType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<PickingStatus | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const filteredPickings = pickings.filter(picking => {
    if (filterType !== 'all' && picking.pickingType !== filterType) return false;
    if (filterStatus !== 'all' && picking.status !== filterStatus) return false;
    return true;
  });

  const handleSelectPicking = (picking: StockPicking) => {
    if (onSelectPicking) {
      onSelectPicking(picking);
    } else {
      router.push(`/procurement/field-stock/pickings/${picking.id}`);
    }
  };

  const getStatusBadgeClass = (status: PickingStatus) => {
    const colorMap = {
      draft: 'bg-secondary text-gray-800 dark:bg-gray-800 dark:text-gray-200',
      confirmed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
      processing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
      done: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
      cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
    };
    return colorMap[status];
  };

  const getTypeBadgeClass = (type: PickingType) => {
    const colorMap = {
      issue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
      receipt: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
      transfer: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200',
      return: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200',
      scrap: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
    };
    return colorMap[type];
  };

  if (loading && pickings.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-200">Error loading transfers</p>
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button
              onClick={handleRefresh}
              className="mt-2 text-sm font-medium text-red-600 hover:text-red-500"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Type Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as PickingType | 'all')}
              className="rounded-lg border border-border bg-card py-1.5 px-3 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="all">All Types</option>
              <option value="issue">Issue</option>
              <option value="receipt">Receipt</option>
              <option value="transfer">Transfer</option>
              <option value="return">Return</option>
              <option value="scrap">Scrap</option>
            </select>
          </div>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as PickingStatus | 'all')}
            className="rounded-lg border border-border bg-card py-1.5 px-3 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="processing">Processing</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-background disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {onCreateNew && (
            <button
              onClick={onCreateNew}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              New Transfer
            </button>
          )}
        </div>
      </div>

      {/* Transfers List */}
      {filteredPickings.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-foreground">No transfers found</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {filterType !== 'all' || filterStatus !== 'all'
              ? 'Try adjusting your filters to see more results.'
              : 'Create a new transfer to get started.'}
          </p>
          {onCreateNew && (
            <button
              onClick={onCreateNew}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Create Transfer
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-200 rounded-lg border border-border bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
          {filteredPickings.map((picking) => {
            const typeConfig = PICKING_TYPE_CONFIG[picking.pickingType] || PICKING_TYPE_CONFIG.transfer;
            const statusConfig = STATUS_CONFIG[picking.status] || STATUS_CONFIG.draft;

            return (
              <div
                key={picking.id}
                onClick={() => handleSelectPicking(picking)}
                className="flex cursor-pointer items-center justify-between p-4 hover:bg-accent/50"
              >
                <div className="flex items-center gap-4">
                  <div className={`rounded-lg p-2 ${getTypeBadgeClass(picking.pickingType)}`}>
                    {typeConfig.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {picking.pickingNumber}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${getTypeBadgeClass(picking.pickingType)}`}>
                        {typeConfig.label}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
                      {picking.contractorName && (
                        <span>Contractor: {picking.contractorName}</span>
                      )}
                      {picking.technicianName && (
                        <span>Tech: {picking.technicianName}</span>
                      )}
                      {picking.scheduledDate && (
                        <span>
                          {new Date(picking.scheduledDate).toISOString().split('T')[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(picking.status)}`}>
                    {statusConfig.icon}
                    {statusConfig.label}
                  </span>
                  {picking.signedAt && (
                    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Signed
                    </span>
                  )}
                  <ArrowRight className="h-5 w-5 text-gray-400" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
