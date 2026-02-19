/**
 * FaultAnalyticsDashboard Component
 * Summary stats and breakdown tables for fault analytics
 */

import { useEffect } from 'react';
import { AlertTriangle, CheckCircle, Shield, RefreshCw } from 'lucide-react';
import { useFaultReports } from '../../hooks/useFaultReports';
import type { FaultTypeValue } from '@/types/procurement/fault.types';

const FAULT_TYPE_LABELS: Record<FaultTypeValue, string> = {
  dead_on_arrival: 'Dead on Arrival',
  field_failure: 'Field Failure',
  physical_damage: 'Physical Damage',
  configuration_error: 'Configuration Error',
  unknown: 'Unknown',
};

const FAULT_TYPE_ORDER: FaultTypeValue[] = [
  'dead_on_arrival',
  'field_failure',
  'physical_damage',
  'configuration_error',
  'unknown',
];

function StatCard({
  label,
  value,
  icon,
  colorClass,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className={`rounded-lg p-3 ${colorClass}`}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        {loading ? (
          <div className="mt-1 h-7 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        ) : (
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        )}
      </div>
    </div>
  );
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-2.5">
          <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </td>
      ))}
    </tr>
  );
}

export function FaultAnalyticsDashboard() {
  const { analytics, loading, error, fetchAnalytics } = useFaultReports();

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const totalFaults = analytics
    ? Object.values(analytics.faultsByType).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Fault Analytics</h2>
        <button
          onClick={fetchAnalytics}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Open"
          value={analytics?.totalOpen ?? 0}
          icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
          colorClass={analytics && analytics.totalOpen > 0 ? 'bg-red-500/10' : 'bg-gray-100 dark:bg-gray-700'}
          loading={loading}
        />
        <StatCard
          label="Total Resolved"
          value={analytics?.totalResolved ?? 0}
          icon={<CheckCircle className="h-5 w-5 text-green-500" />}
          colorClass="bg-green-500/10"
          loading={loading}
        />
        <StatCard
          label="Warranty Claims"
          value={analytics?.totalWarrantyClaims ?? 0}
          icon={<Shield className="h-5 w-5 text-purple-500" />}
          colorClass="bg-purple-500/10"
          loading={loading}
        />
      </div>

      {/* Faults by Type */}
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Faults by Type</h3>
        </div>
        <table className="min-w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/50">
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Type</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Count</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Percentage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={3} />)
            ) : analytics ? (
              FAULT_TYPE_ORDER.map((type) => {
                const count = analytics.faultsByType[type] ?? 0;
                const pct = totalFaults > 0 ? ((count / totalFaults) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={type}>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{FAULT_TYPE_LABELS[type]}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900 dark:text-white">{count}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-gray-500 dark:text-gray-400">{pct}%</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">No data</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom Tables Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Suppliers by Faults */}
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Top Suppliers by Faults</h3>
          </div>
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Supplier</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={2} />)
              ) : analytics && analytics.faultsBySupplier.length > 0 ? (
                analytics.faultsBySupplier.slice(0, 10).map((row) => (
                  <tr key={row.supplierId}>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.supplierName}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900 dark:text-white">{row.count}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">No data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Top Technicians by Reports */}
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Top Technicians by Reports</h3>
          </div>
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Technician</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Reports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={2} />)
              ) : analytics && analytics.faultsByTechnician.length > 0 ? (
                analytics.faultsByTechnician.slice(0, 10).map((row) => (
                  <tr key={row.userId}>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.userName}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900 dark:text-white">{row.count}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">No data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
