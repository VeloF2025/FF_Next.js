/**
 * RAG Summary Cards Component
 * Shows summary stats for RAG dashboard
 */

'use client';

import type { RagSummaryStats } from '../types/rag.types';

interface RagSummaryCardsProps {
  summary: RagSummaryStats;
}

export function RagSummaryCards({ summary }: RagSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      {/* Total Contractors */}
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="text-sm font-medium text-[var(--ff-text-secondary)]">Total Contractors</div>
        <div className="text-3xl font-bold text-[var(--ff-text-primary)] mt-1">{summary.total}</div>
      </div>

      {/* Red Status */}
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-red-500/30">
        <div className="flex items-center gap-2 text-sm font-medium text-red-400">
          <span className="text-2xl">🔴</span>
          Red - Urgent
        </div>
        <div className="text-3xl font-bold text-red-400 mt-1">{summary.red}</div>
        <div className="text-xs text-[var(--ff-text-tertiary)] mt-1">
          Require immediate attention
        </div>
      </div>

      {/* Amber Status */}
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-yellow-500/30">
        <div className="flex items-center gap-2 text-sm font-medium text-yellow-400">
          <span className="text-2xl">🟡</span>
          Amber - Monitor
        </div>
        <div className="text-3xl font-bold text-yellow-400 mt-1">{summary.amber}</div>
        <div className="text-xs text-[var(--ff-text-tertiary)] mt-1">
          Need monitoring
        </div>
      </div>

      {/* Green Status */}
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-green-500/30">
        <div className="flex items-center gap-2 text-sm font-medium text-green-400">
          <span className="text-2xl">🟢</span>
          Green - Good
        </div>
        <div className="text-3xl font-bold text-green-400 mt-1">{summary.green}</div>
        <div className="text-xs text-[var(--ff-text-tertiary)] mt-1">
          In good standing
        </div>
      </div>
    </div>
  );
}
