/**
 * RAG Dashboard Component
 * Main dashboard showing contractor RAG status
 */

'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { log } from '@/lib/logger';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { getAllContractorsRagStatus } from '../services/ragApiService';
import type { ContractorRagStatus, RagSummaryStats, RagStatus } from '../types/rag.types';
import { RagSummaryCards } from './RagSummaryCards';
import { RagStatusBadge } from './RagStatusBadge';
import { RAG_CATEGORY_CONFIG } from '../types/rag.types';

export function RagDashboard() {
  const [contractors, setContractors] = useState<ContractorRagStatus[]>([]);
  const [summary, setSummary] = useState<RagSummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RagStatus | 'all'>('all');

  useEffect(() => {
    loadRagData();
  }, []);

  async function loadRagData() {
    try {
      setLoading(true);
      setError(null);
      const result = await getAllContractorsRagStatus();
      setContractors(result.data);
      setSummary(result.summary);
    } catch (err: any) {
      log.error('Error loading RAG data', { error: err }, 'RagDashboard');
      setError(err.message || 'Failed to load RAG status');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <InlineSpinner size="md" className="text-blue-600" />
        <span className="ml-3 text-[var(--ff-text-secondary)]">Loading RAG status...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="h-5 w-5" />
          <span className="font-medium">Error loading RAG dashboard</span>
        </div>
        <p className="text-sm text-red-400 mt-2">{error}</p>
        <button
          onClick={loadRagData}
          className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 text-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!summary) {
    return <div>No data available</div>;
  }

  const filteredContractors = filter === 'all'
    ? contractors
    : contractors.filter(c => c.overall === filter);

  return (
    <div>
      {/* Summary Cards */}
      <RagSummaryCards summary={summary} />

      {/* Filter Buttons */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium text-[var(--ff-text-primary)]">Filter:</span>
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 text-sm rounded ${
            filter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
          }`}
        >
          All ({contractors.length})
        </button>
        <button
          onClick={() => setFilter('red')}
          className={`px-3 py-1 text-sm rounded ${
            filter === 'red'
              ? 'bg-red-600 text-white'
              : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          }`}
        >
          🔴 Red ({summary.red})
        </button>
        <button
          onClick={() => setFilter('amber')}
          className={`px-3 py-1 text-sm rounded ${
            filter === 'amber'
              ? 'bg-yellow-600 text-white'
              : 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
          }`}
        >
          🟡 Amber ({summary.amber})
        </button>
        <button
          onClick={() => setFilter('green')}
          className={`px-3 py-1 text-sm rounded ${
            filter === 'green'
              ? 'bg-green-600 text-white'
              : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
          }`}
        >
          🟢 Green ({summary.green})
        </button>
      </div>

      {/* Contractors Table */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                Contractor
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                Overall
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                {RAG_CATEGORY_CONFIG.financial.icon} Financial
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                {RAG_CATEGORY_CONFIG.compliance.icon} Compliance
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                {RAG_CATEGORY_CONFIG.performance.icon} Performance
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                {RAG_CATEGORY_CONFIG.safety.icon} Safety
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {filteredContractors.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--ff-text-tertiary)]">
                  No contractors found with {filter} status
                </td>
              </tr>
            ) : (
              filteredContractors.map((contractor: any) => (
                <tr key={contractor.contractorId} className="hover:bg-[var(--ff-bg-hover)]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--ff-text-primary)]">{contractor.companyName || 'Unknown'}</div>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">ID: {contractor.contractorId.substring(0, 8)}...</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <RagStatusBadge status={contractor.overall} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <RagStatusBadge status={contractor.financial} showLabel={false} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <RagStatusBadge status={contractor.compliance} showLabel={false} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <RagStatusBadge status={contractor.performance} showLabel={false} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <RagStatusBadge status={contractor.safety} showLabel={false} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
