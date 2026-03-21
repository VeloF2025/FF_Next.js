/**
 * RevenueOverview — Grouped bar chart showing monthly cashflow (Cash In, Cash Out, Net)
 * sourced from the Shareholder Model Excel via SharePoint Graph API.
 */

'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useRevenueData } from './useRevenueData';
import { AlertCircle, Loader2 } from 'lucide-react';

/**
 * Formats a ZAR currency value into a compact string.
 * e.g. 1500000 -> "R1.5M", 45000 -> "R45k", 800 -> "R800"
 */
function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}R${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}R${(abs / 1_000).toFixed(0)}k`;
  return `${sign}R${abs.toFixed(0)}`;
}

// 🟢 WORKING: Revenue Overview grouped bar chart — Cash In / Cash Out / Net
export default function RevenueOverview() {
  const { data, isLoading, error } = useRevenueData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading cashflow data&hellip;
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

  const chartData = data?.data ?? [];
  const note = data?.meta.note;

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="flex items-center gap-6">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider">Months</p>
          <p className="text-2xl font-bold text-white">{chartData.length}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider">Source</p>
          <p className="text-sm font-medium text-blue-400">Shareholder Model (live)</p>
        </div>
      </div>

      {/* Note badge — shown when applicable */}
      {note && (
        <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-1.5">
          {note}
        </div>
      )}

      {/* Grouped bar chart */}
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="label"
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              axisLine={{ stroke: '#4B5563' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatCurrency}
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={70}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#F9FAFB',
              }}
              formatter={(value: number, name: string) => [
                formatCurrency(value),
                name === 'cashIn' ? 'Cash In' : name === 'cashOut' ? 'Cash Out' : 'Net',
              ]}
            />
            <Legend
              formatter={(value) =>
                value === 'cashIn' ? 'Cash In' : value === 'cashOut' ? 'Cash Out' : 'Net'
              }
              wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }}
            />
            <Bar dataKey="cashIn" fill="#22C55E" radius={[3, 3, 0, 0]} name="cashIn" />
            <Bar dataKey="cashOut" fill="#EF4444" radius={[3, 3, 0, 0]} name="cashOut" />
            <Bar dataKey="net" fill="#3B82F6" radius={[3, 3, 0, 0]} name="net" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
