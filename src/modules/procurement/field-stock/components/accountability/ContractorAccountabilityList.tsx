/**
 * ContractorAccountabilityList Component
 * Displays list of contractors with stock accountability status
 */

'use client';

import { useState } from 'react';
import {
  Users,
  Search,
  Filter,
  AlertTriangle,
  Ban,
  CheckCircle,
  Eye,
  RefreshCw
} from 'lucide-react';
import type { ContractorStockAccountability } from '../../types';

interface ContractorAccountabilityListProps {
  contractors: ContractorStockAccountability[];
  loading?: boolean;
  onView?: (contractor: ContractorStockAccountability) => void;
  onReconcile?: (contractorId: string) => void;
  onBlock?: (contractorId: string) => void;
  onUnblock?: (contractorId: string) => void;
}

export function ContractorAccountabilityList({
  contractors,
  loading,
  onView,
  onReconcile,
  onBlock,
  onUnblock
}: ContractorAccountabilityListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'blocked' | 'unaccounted'>('all');

  const filteredContractors = contractors.filter(c => {
    if (filter === 'blocked' && !c.isBlocked) return false;
    if (filter === 'unaccounted' && c.unaccountedCount <= 0) return false;
    if (searchTerm) {
      return c.contractorName.toLowerCase().includes(searchTerm.toLowerCase());
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
            placeholder="Search contractors..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">All Contractors</option>
            <option value="blocked">Blocked Only</option>
            <option value="unaccounted">With Unaccounted Stock</option>
          </select>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30">
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {contractors.length}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Contractors</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-100 p-2 dark:bg-red-900/30">
              <Ban className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {contractors.filter(c => c.isBlocked).length}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Blocked</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/30">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {contractors.filter(c => c.unaccountedCount > 0).length}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">With Unaccounted</p>
            </div>
          </div>
        </div>
      </div>

      {/* Contractors List */}
      {filteredContractors.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <Users className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
            No contractors found
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {searchTerm || filter !== 'all'
              ? 'Try adjusting your filters'
              : 'Contractor accountability records will appear here'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Contractor
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Issued
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Consumed
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Returned
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Unaccounted
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {filteredContractors.map((contractor) => (
                <tr key={contractor.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {contractor.contractorName}
                    </div>
                    {contractor.lastReconciliationDate && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Last reconciled: {new Date(contractor.lastReconciliationDate).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-center">
                    {contractor.isBlocked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
                        <Ban className="h-3 w-3" />
                        Blocked
                      </span>
                    ) : contractor.unaccountedCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        <AlertTriangle className="h-3 w-3" />
                        Warning
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
                        <CheckCircle className="h-3 w-3" />
                        Good
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                    {contractor.totalIssuedCount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                    {contractor.totalConsumedCount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                    {contractor.totalReturnedCount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {contractor.unaccountedCount > 0 ? (
                      <div className="text-sm font-medium text-red-600 dark:text-red-400">
                        {contractor.unaccountedCount}
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          R{contractor.unaccountedValue?.toFixed(2) || '0.00'}
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-500">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {onView && (
                        <button
                          onClick={() => onView(contractor)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                          title="View details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      )}
                      {onReconcile && (
                        <button
                          onClick={() => onReconcile(contractor.contractorId)}
                          className="rounded p-1 text-blue-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30"
                          title="Reconcile stock"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                      )}
                      {contractor.isBlocked ? (
                        onUnblock && (
                          <button
                            onClick={() => onUnblock(contractor.contractorId)}
                            className="rounded p-1 text-green-400 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900/30"
                            title="Unblock contractor"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        )
                      ) : (
                        onBlock && (
                          <button
                            onClick={() => onBlock(contractor.contractorId)}
                            className="rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
                            title="Block contractor"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
