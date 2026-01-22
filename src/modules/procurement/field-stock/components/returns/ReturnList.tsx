/**
 * ReturnList Component
 * Displays stock returns with filtering and actions
 */

'use client';

import { useState } from 'react';
import {
  Package,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  FileCheck,
  RotateCcw
} from 'lucide-react';
import type { StockReturn, ReturnStatus } from '../../types';

interface ReturnListProps {
  returns: StockReturn[];
  loading?: boolean;
  onInspect?: (returnId: string) => void;
  onAccept?: (returnId: string) => void;
  onView?: (returnItem: StockReturn) => void;
}

const STATUS_CONFIG: Record<ReturnStatus, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', icon: Clock },
  received: { label: 'Received', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', icon: Package },
  inspected: { label: 'Inspected', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', icon: FileCheck },
  accepted: { label: 'Accepted', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', icon: XCircle },
  restocked: { label: 'Restocked', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300', icon: RotateCcw }
};

export function ReturnList({ returns, loading, onInspect, onAccept, onView }: ReturnListProps) {
  const [statusFilter, setStatusFilter] = useState<ReturnStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredReturns = returns.filter(ret => {
    if (statusFilter !== 'all' && ret.status !== statusFilter) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        ret.returnNumber?.toLowerCase().includes(search) ||
        ret.returnedByName?.toLowerCase().includes(search)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search returns..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReturnStatus | 'all')}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="received">Received</option>
            <option value="inspected">Inspected</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="restocked">Restocked</option>
          </select>
        </div>
      </div>

      {/* Returns List */}
      {filteredReturns.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No returns found</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {searchTerm || statusFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Returns will appear here when created'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Return #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Returned By
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Items
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {filteredReturns.map((ret) => {
                const statusConfig = STATUS_CONFIG[ret.status];
                const StatusIcon = statusConfig.icon;
                const lineCount = Array.isArray(ret.lines) ? ret.lines.length : 0;

                return (
                  <tr key={ret.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                      {ret.returnNumber}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {ret.returnedByName || 'Unknown'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {lineCount} item{lineCount !== 1 ? 's' : ''}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {ret.returnDate
                        ? new Date(ret.returnDate).toISOString().split('T')[0]
                        : '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig.color}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {statusConfig.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {onView && (
                          <button
                            onClick={() => onView(ret)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        )}
                        {ret.status === 'pending' && onInspect && (
                          <button
                            onClick={() => onInspect(ret.id)}
                            className="rounded p-1 text-purple-400 hover:bg-purple-100 hover:text-purple-600 dark:hover:bg-purple-900/30"
                            title="Inspect return"
                          >
                            <FileCheck className="h-4 w-4" />
                          </button>
                        )}
                        {ret.status === 'inspected' && onAccept && (
                          <button
                            onClick={() => onAccept(ret.id)}
                            className="rounded p-1 text-green-400 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900/30"
                            title="Accept return"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
