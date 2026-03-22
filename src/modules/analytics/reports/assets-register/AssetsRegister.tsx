/**
 * AssetsRegister — Pre-paid and capitalised costs from Current Assets worksheet.
 * Table tab: Date | Description | Category | Amount | Running Total
 * Charts tab: placeholder
 */

// 🟢 WORKING: Assets Register report component
'use client';

import { Loader2, AlertCircle } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { useAssetsRegisterData } from './useAssetsRegisterData';

function fZAR(value: number): { text: string; negative: boolean } {
  if (value === 0) return { text: '—', negative: false };
  const negative = value < 0;
  const abs = Math.abs(Math.round(value));
  const formatted = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return { text: `R\u00a0${formatted}`, negative };
}

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

  const items = data?.data?.items ?? [];
  const categorySummary = data?.data?.categorySummary ?? {};

  const tableContent = (
    <div className="space-y-4">
      {/* Category Summary */}
      {Object.keys(categorySummary).length > 0 && (
        <div className="overflow-x-auto rounded border border-gray-700">
          <table className="min-w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: '#1a3a4a' }}>
                <th className="px-3 py-2 text-left text-xs font-bold text-white">Category</th>
                <th className="px-3 py-2 text-right text-xs font-bold text-white">Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(categorySummary).map(([cat, amt]) => {
                const { text, negative } = fZAR(amt);
                return (
                  <tr key={cat} className="border-b border-gray-800">
                    <td className="px-3 py-1.5 text-xs text-gray-200">{cat}</td>
                    <td className={`px-3 py-1.5 text-xs text-right ${negative ? 'text-red-400' : 'text-gray-200'}`}>
                      {text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail rows */}
      <div className="overflow-x-auto rounded border border-gray-700">
        <table className="min-w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: '#1a3a4a' }}>
              <th className="px-3 py-2 text-left text-xs font-bold text-white whitespace-nowrap">Date</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-white">Description</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-white">Category</th>
              <th className="px-3 py-2 text-right text-xs font-bold text-white">Amount</th>
              <th className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">Running Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const amt = fZAR(item.amount);
              const running = fZAR(item.runningTotal);
              return (
                <tr key={i} className="border-b border-gray-800 hover:bg-gray-750">
                  <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap">{item.date}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-200">{item.description}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-400">{item.category}</td>
                  <td className={`px-3 py-1.5 text-xs text-right ${amt.negative ? 'text-red-400' : 'text-gray-200'}`}>
                    {amt.text}
                  </td>
                  <td className={`px-3 py-1.5 text-xs text-right ${running.negative ? 'text-red-400' : 'text-gray-200'}`}>
                    {running.text}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  No data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
