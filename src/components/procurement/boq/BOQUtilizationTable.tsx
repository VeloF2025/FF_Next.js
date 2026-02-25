/**
 * BOQUtilizationTable — shows per-line BOQ vs ordered vs received quantities,
 * plus a non-BOQ (ad-hoc) items section at the bottom.
 *
 * Used on the project detail page → BOQ tab.
 */

import { useEffect, useState } from 'react';
import { Loader2, TrendingUp, Package } from 'lucide-react';
import type { BOQUtilizationResponse, BOQLineUtilization, NonBOQItem } from '@/types/procurement/boq-utilization.types';
import { log } from '@/lib/logger';

interface BOQUtilizationTableProps {
  projectId: string;
}

function statusBadge(line: BOQLineUtilization) {
  switch (line.status) {
    case 'fully_ordered':
      return <span className="inline-flex items-center gap-1 text-xs text-green-400"><span>●</span> Ordered</span>;
    case 'over_ordered':
      return <span className="inline-flex items-center gap-1 text-xs text-orange-400"><span>▲</span> Over</span>;
    case 'partial':
      return <span className="inline-flex items-center gap-1 text-xs text-amber-400"><span>◑</span> Partial</span>;
    default:
      return <span className="inline-flex items-center gap-1 text-xs text-[var(--ff-text-tertiary)]"><span>○</span> Not ordered</span>;
  }
}

function formatQty(n: number, uom: string) {
  return `${n.toLocaleString('en-ZA', { maximumFractionDigits: 2 })} ${uom}`;
}

function formatZAR(n: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n);
}

export function BOQUtilizationTable({ projectId }: BOQUtilizationTableProps) {
  const [data, setData] = useState<BOQUtilizationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideZero, setHideZero] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/boq-utilization`);
        const json = await res.json() as { success: boolean; data?: BOQUtilizationResponse; error?: { message: string } };
        if (json.success && json.data) {
          setData(json.data);
        } else {
          setError(json.error?.message ?? 'Failed to load BOQ utilization');
        }
      } catch (err) {
        log.error('Failed to load BOQ utilization', { err }, 'BOQUtilizationTable');
        setError('Failed to load BOQ utilization data');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [projectId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
        <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">Loading utilization...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>
    );
  }

  if (!data || data.lines.length === 0) {
    return (
      <div className="text-center py-10 text-[var(--ff-text-tertiary)] text-sm">
        No BOQ lines found for this project.
      </div>
    );
  }

  const { summary, lines, nonBoqItems } = data;
  const visibleLines = hideZero ? lines.filter((l) => l.boqQty > 0) : lines;
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex flex-wrap gap-6 mb-3">
          <div>
            <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide">Total BOQ Value</p>
            <p className="text-lg font-semibold text-[var(--ff-text-primary)]">{formatZAR(summary.totalBoqValue)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide">Ordered</p>
            <p className="text-lg font-semibold text-purple-400">
              {formatZAR(summary.totalOrderedValue)}
              <span className="ml-1.5 text-sm font-normal text-[var(--ff-text-tertiary)]">({summary.orderedPercent}%)</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide">Received</p>
            <p className="text-lg font-semibold text-green-400">
              {formatZAR(summary.totalReceivedValue)}
              <span className="ml-1.5 text-sm font-normal text-[var(--ff-text-tertiary)]">({summary.receivedPercent}%)</span>
            </p>
          </div>
          {nonBoqItems.length > 0 && (
            <div>
              <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide">Ad-hoc Items</p>
              <p className="text-lg font-semibold text-amber-400">{nonBoqItems.length}</p>
            </div>
          )}
        </div>
        {/* Progress bar */}
        <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500 rounded-full transition-all"
            style={{ width: `${Math.min(summary.orderedPercent, 100)}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
          {summary.orderedLineCount} of {summary.boqLineCount} lines have been ordered
        </p>
      </div>

      {/* BOQ Lines table */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
        <div className="flex items-center justify-between gap-2 p-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-purple-400" />
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">BOQ Line Utilization</h4>
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              {visibleLines.length} of {lines.length} lines
            </span>
          </div>
          <button
            type="button"
            onClick={() => setHideZero((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors border ${
              hideZero
                ? 'bg-purple-600/20 border-purple-500/40 text-purple-400'
                : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
            }`}
          >
            {hideZero ? `Hide zero qty (${hiddenCount})` : `Show zero qty (${hiddenCount})`}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Item Code</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Description</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">BOQ Qty</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Ordered</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Received</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Outstanding</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {visibleLines.map((line: BOQLineUtilization) => (
                <tr
                  key={line.id}
                  className={`hover:bg-[var(--ff-bg-hover)] transition-colors ${
                    line.status === 'fully_ordered' || line.status === 'over_ordered' ? 'opacity-70' : ''
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-blue-400 font-mono">{line.itemCode ?? '—'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--ff-text-primary)] max-w-xs truncate">{line.description}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--ff-text-secondary)]">{formatQty(line.boqQty, line.uom)}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--ff-text-secondary)]">
                    {line.orderedQty > 0 ? formatQty(line.orderedQty, line.uom) : <span className="text-[var(--ff-text-tertiary)]">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--ff-text-secondary)]">
                    {line.receivedQty > 0 ? formatQty(line.receivedQty, line.uom) : <span className="text-[var(--ff-text-tertiary)]">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={line.outstandingQty <= 0 ? 'text-[var(--ff-text-tertiary)]' : 'text-[var(--ff-text-primary)]'}>
                      {formatQty(Math.max(0, line.outstandingQty), line.uom)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{statusBadge(line)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Non-BOQ (ad-hoc) items */}
      {nonBoqItems.length > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-[var(--ff-border-light)]">
            <Package className="h-4 w-4 text-amber-400" />
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">
              Non-BOQ Items (Ad-hoc orders not in BOQ)
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Item Code</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Description</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Ordered</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Received</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">PO Number</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {nonBoqItems.map((item: NonBOQItem) => (
                  <tr key={item.id} className="hover:bg-[var(--ff-bg-hover)] transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-amber-400 font-mono">{item.itemCode ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--ff-text-primary)] max-w-xs truncate">{item.itemDescription}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--ff-text-secondary)]">{item.quantityOrdered.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--ff-text-secondary)]">{item.quantityReceived.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-blue-400 font-mono text-xs">{item.poNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
