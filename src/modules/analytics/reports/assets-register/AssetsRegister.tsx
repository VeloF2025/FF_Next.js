/**
 * AssetsRegister — Fixed Assets (Data tab) + Current Assets (Current Assets worksheet).
 * Fixed Assets: category totals from Data tab + placeholder for full register.
 * Current Assets: pre-paid costs, wayleave deposits with running total.
 */

// 🟢 WORKING: Assets Register report component — Fixed + Current Assets
'use client';

import { Loader2, AlertCircle } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { useAssetsRegisterData } from './useAssetsRegisterData';

function fZAR(value: number): string {
  if (value === 0) return '—';
  const abs = Math.abs(Math.round(value));
  return `R\u00a0${abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0')}`;
}

const thBase = 'px-3 py-2 text-left text-xs font-bold text-white whitespace-nowrap';
const thR = 'px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap';

export default function AssetsRegister() {
  const { data, isLoading, error } = useAssetsRegisterData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading assets register&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-4">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error.message}</span>
      </div>
    );
  }

  const fixedAssets = data?.data?.fixedAssets;
  const currentAssets = data?.data?.currentAssets;
  const currentItems = currentAssets?.items ?? [];
  const currentSummary = currentAssets?.categorySummary ?? {};
  const currentTotal = Object.values(currentSummary).reduce((s, v) => s + v, 0);

  const tableContent = (
    <div className="space-y-6">

      {/* ── Fixed Assets ── */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Fixed Assets</h3>
        <div className="overflow-x-auto rounded border border-gray-700">
          <table className="min-w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: '#1a3a4a' }}>
                <th className={thBase}>Category</th>
                <th className={thR}>Total Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(fixedAssets?.byCategory ?? {}).map(([cat, amt], i) => (
                <tr key={cat} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
                  <td className="px-3 py-1.5 text-gray-200">{cat}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-200">{fZAR(amt)}</td>
                </tr>
              ))}
              {Object.keys(fixedAssets?.byCategory ?? {}).length === 0 && (
                <tr><td colSpan={2} className="px-3 py-4 text-center text-gray-500">No fixed asset data</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
                <td className="px-3 py-2 text-white">Total Fixed Assets</td>
                <td className="px-3 py-2 text-right tabular-nums text-white">{fZAR(fixedAssets?.total ?? 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {fixedAssets?.note && (
          <p className="text-xs text-gray-500 mt-1.5 italic">{fixedAssets.note}</p>
        )}
      </div>

      {/* ── Current Assets ── */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Current Assets</h3>
        <div className="overflow-x-auto rounded border border-gray-700">
          <table className="min-w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: '#1a3a4a' }}>
                <th className={thBase}>Date</th>
                <th className={thBase}>Description</th>
                <th className={thBase}>Category</th>
                <th className={thR}>Amount</th>
                <th className={thR}>Running Total</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.map((item, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
                  <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{item.date}</td>
                  <td className="px-3 py-1.5 text-gray-200">{item.description}</td>
                  <td className="px-3 py-1.5 text-gray-400">{item.category}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-200">{fZAR(item.amount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">{fZAR(item.runningTotal)}</td>
                </tr>
              ))}
              {currentItems.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No data available</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
                <td colSpan={3} className="px-3 py-2 text-white">Total Current Assets</td>
                <td className="px-3 py-2 text-right tabular-nums text-white">{fZAR(currentTotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

    </div>
  );

  return (
    <ReportTabLayout
      tableContent={tableContent}
      chartsContent={
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
          Charts coming soon
        </div>
      }
    />
  );
}
