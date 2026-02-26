/**
 * BOQUtilizationTable — BOQ financial utilization view.
 * Shows BOQ Value / Ordered Value / Remaining Value per line,
 * with KPI summary cards and a progress bar at the top.
 *
 * Used on the project detail page → BOQ/Materials tab.
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
    case 'received':
      return <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">● Received</span>;
    case 'partially_received':
      return <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">◐ Part Recv</span>;
    case 'fully_ordered':
      return <span className="inline-flex items-center gap-1 text-xs text-purple-400 font-medium">● Ordered</span>;
    case 'over_ordered':
      return <span className="inline-flex items-center gap-1 text-xs text-orange-400 font-medium">▲ Over</span>;
    case 'partial':
      return <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-medium">◑ Partial</span>;
    default:
      return <span className="inline-flex items-center gap-1 text-xs text-[var(--ff-text-tertiary)]">○ Not ordered</span>;
  }
}

function fmtQty(n: number, uom: string) {
  return `${n.toLocaleString('en-ZA', { maximumFractionDigits: 2 })} ${uom}`;
}

function fmtZAR(n: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n);
}

/** Stacked cell: value on top (primary), qty below (secondary) */
function ValueCell({
  value,
  qty,
  uom,
  valueClass = 'text-[var(--ff-text-primary)]',
  empty = false,
}: {
  value: number;
  qty: number;
  uom: string;
  valueClass?: string;
  empty?: boolean;
}) {
  if (empty || (value === 0 && qty === 0)) {
    return <span className="text-[var(--ff-text-tertiary)]">—</span>;
  }
  return (
    <div>
      <div className={`text-sm font-medium ${valueClass}`}>{fmtZAR(value)}</div>
      <div className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{fmtQty(qty, uom)}</div>
    </div>
  );
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
        const json = await res.json() as {
          success: boolean;
          data?: BOQUtilizationResponse;
          error?: { message: string };
        };
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
    return <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>;
  }

  if (!data || data.lines.length === 0) {
    return (
      <div className="text-center py-10 text-[var(--ff-text-tertiary)] text-sm">
        No BOQ lines found for this project.
      </div>
    );
  }

  const { summary, lines, nonBoqItems } = data;
  const remainingValue = summary.totalBoqValue - summary.totalOrderedValue;
  const remainingPercent = summary.totalBoqValue > 0
    ? Math.round((remainingValue / summary.totalBoqValue) * 100)
    : 0;

  const visibleLines = hideZero ? lines.filter((l) => l.boqQty > 0) : lines;
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div className="space-y-4">

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* BOQ Value */}
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Total BOQ Value</p>
          <p className="text-xl font-bold text-[var(--ff-text-primary)]">{fmtZAR(summary.totalBoqValue)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{summary.boqLineCount} lines</p>
        </div>

        {/* Ordered */}
        <div className="bg-[var(--ff-bg-secondary)] border border-purple-500/30 rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Ordered</p>
          <p className="text-xl font-bold text-purple-400">{fmtZAR(summary.totalOrderedValue)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            {summary.orderedPercent}% of BOQ · {summary.orderedLineCount} of {summary.boqLineCount} lines
          </p>
        </div>

        {/* Remaining */}
        <div className="bg-[var(--ff-bg-secondary)] border border-amber-500/30 rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Remaining</p>
          <p className="text-xl font-bold text-amber-400">{fmtZAR(remainingValue)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{remainingPercent}% still to order</p>
        </div>

        {/* Received */}
        <div className="bg-[var(--ff-bg-secondary)] border border-green-500/30 rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Received</p>
          <p className="text-xl font-bold text-green-400">{fmtZAR(summary.totalReceivedValue)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{summary.receivedPercent}% of BOQ</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg px-4 py-3">
        <div className="flex justify-between text-xs text-[var(--ff-text-tertiary)] mb-1.5">
          <span>Ordered {summary.orderedPercent}%</span>
          <span>Remaining {remainingPercent}%</span>
        </div>
        <div className="h-2.5 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden flex">
          <div
            className="h-full bg-purple-500 transition-all"
            style={{ width: `${Math.min(summary.orderedPercent, 100)}%` }}
          />
          {summary.receivedPercent > 0 && (
            <div
              className="h-full bg-green-500 transition-all -ml-px"
              style={{ width: `${Math.min(summary.receivedPercent, summary.orderedPercent)}%` }}
            />
          )}
        </div>
        <p className="mt-1.5 text-xs text-[var(--ff-text-tertiary)]">
          {summary.orderedLineCount} of {summary.boqLineCount} lines ordered
          {nonBoqItems.length > 0 && ` · ${nonBoqItems.length} ad-hoc item${nonBoqItems.length > 1 ? 's' : ''} outside BOQ`}
        </p>
      </div>

      {/* ── Line-item table ── */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-purple-400" />
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">BOQ Line Detail</h4>
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
            {hideZero ? `Hide zero qty (${hiddenCount})` : `Show all (${hiddenCount} zero)`}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-28">
                  Item Code
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                  Description
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-36">
                  BOQ Value
                  <div className="text-[10px] font-normal normal-case text-[var(--ff-text-tertiary)]/70">qty</div>
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-purple-400/80 uppercase w-36">
                  Ordered
                  <div className="text-[10px] font-normal normal-case text-[var(--ff-text-tertiary)]/70">qty</div>
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-amber-400/80 uppercase w-36">
                  Remaining
                  <div className="text-[10px] font-normal normal-case text-[var(--ff-text-tertiary)]/70">qty</div>
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-green-400/80 uppercase w-36">
                  Received
                  <div className="text-[10px] font-normal normal-case text-[var(--ff-text-tertiary)]/70">qty</div>
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-28">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {visibleLines.map((line: BOQLineUtilization) => {
                const boqVal = line.boqValue ?? 0;
                const ordVal = line.orderedValue ?? 0;
                const remVal = boqVal - ordVal;
                const recVal = line.receivedQty * (line.unitPrice ?? 0);

                return (
                  <tr
                    key={line.id}
                    className={`hover:bg-[var(--ff-bg-hover)] transition-colors ${
                      line.status === 'fully_ordered' || line.status === 'over_ordered' ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="text-xs text-blue-400 font-mono">{line.itemCode ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-primary)]">
                      <span className="line-clamp-2 text-sm leading-tight">{line.description}</span>
                    </td>

                    {/* BOQ Value + qty */}
                    <td className="px-4 py-3 text-right">
                      <ValueCell value={boqVal} qty={line.boqQty} uom={line.uom} empty={boqVal === 0 && line.unitPrice === null} />
                    </td>

                    {/* Ordered */}
                    <td className="px-4 py-3 text-right">
                      <ValueCell
                        value={ordVal}
                        qty={line.orderedQty}
                        uom={line.uom}
                        valueClass="text-purple-400"
                        empty={line.orderedQty === 0}
                      />
                    </td>

                    {/* Remaining */}
                    <td className="px-4 py-3 text-right">
                      <ValueCell
                        value={Math.max(0, remVal)}
                        qty={Math.max(0, line.outstandingQty)}
                        uom={line.uom}
                        valueClass={remVal <= 0 ? 'text-[var(--ff-text-tertiary)]' : 'text-amber-400'}
                        empty={false}
                      />
                    </td>

                    {/* Received */}
                    <td className="px-4 py-3 text-right">
                      <ValueCell
                        value={recVal}
                        qty={line.receivedQty}
                        uom={line.uom}
                        valueClass="text-green-400"
                        empty={line.receivedQty === 0}
                      />
                    </td>

                    <td className="px-4 py-3">{statusBadge(line)}</td>
                  </tr>
                );
              })}
            </tbody>

            {/* Footer totals */}
            <tfoot>
              <tr className="border-t-2 border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                <td colSpan={2} className="px-4 py-3 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                  Total ({visibleLines.length} lines)
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-semibold text-[var(--ff-text-primary)]">
                    {fmtZAR(visibleLines.reduce((s, l) => s + (l.boqValue ?? 0), 0))}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-semibold text-purple-400">
                    {fmtZAR(visibleLines.reduce((s, l) => s + (l.orderedValue ?? 0), 0))}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-semibold text-amber-400">
                    {fmtZAR(visibleLines.reduce((s, l) => s + Math.max(0, (l.boqValue ?? 0) - (l.orderedValue ?? 0)), 0))}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-semibold text-green-400">
                    {fmtZAR(visibleLines.reduce((s, l) => s + l.receivedQty * (l.unitPrice ?? 0), 0))}
                  </span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Non-BOQ ad-hoc items ── */}
      {nonBoqItems.length > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] border border-amber-500/20 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--ff-border-light)]">
            <Package className="h-4 w-4 text-amber-400" />
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">
              Ad-hoc Orders <span className="text-amber-400">({nonBoqItems.length})</span>
            </h4>
            <span className="text-xs text-[var(--ff-text-tertiary)]">not in BOQ</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Item Code</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Description</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Value</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Qty Ordered</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Qty Received</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">PO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {nonBoqItems.map((item: NonBOQItem) => (
                  <tr key={item.id} className="hover:bg-[var(--ff-bg-hover)] transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-amber-400 font-mono">{item.itemCode ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--ff-text-primary)]">{item.itemDescription}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--ff-text-secondary)]">
                      {item.totalPrice ? fmtZAR(item.totalPrice) : '—'}
                    </td>
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
