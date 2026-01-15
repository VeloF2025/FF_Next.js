/**
 * Fleet Drivers Dashboard Tab
 * Overview stats and summary for fleet drivers
 */

import {
  Users,
  Car,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Award,
  RefreshCw,
} from 'lucide-react';
import type { DriverDashboardStats } from '@/modules/fleet/types/driver.types';

interface DashboardTabProps {
  stats: DriverDashboardStats;
  onRecalculateScores: () => void;
  calculating: boolean;
}

function StatCard({
  label,
  value,
  icon: Icon,
  subtext,
  variant = 'default',
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  subtext?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const variantStyles = {
    default: 'text-[var(--ff-primary)]',
    success: 'text-green-500',
    warning: 'text-yellow-500',
    danger: 'text-red-500',
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
        <Icon className={`w-4 h-4 ${variantStyles[variant]}`} />
        <span className="text-sm">{label}</span>
      </div>
      <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{value}</p>
      {subtext && <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{subtext}</p>}
    </div>
  );
}

function ScoreDistributionBar({ stats }: { stats: DriverDashboardStats }) {
  const total = stats.totalDrivers;
  if (total === 0) return null;

  const { excellent, good, fair, needsImprovement, noScore } = stats.scoreDistribution;

  const segments = [
    { label: 'Excellent (90+)', count: excellent, color: 'bg-green-500' },
    { label: 'Good (70-89)', count: good, color: 'bg-blue-500' },
    { label: 'Fair (50-69)', count: fair, color: 'bg-yellow-500' },
    { label: 'Needs Improvement (<50)', count: needsImprovement, color: 'bg-red-500' },
    { label: 'No Score', count: noScore, color: 'bg-gray-400' },
  ];

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <h3 className="font-semibold text-[var(--ff-text-primary)] mb-4">Score Distribution</h3>

      <div className="h-4 rounded-full overflow-hidden flex mb-4">
        {segments.map((seg, i) => {
          const width = (seg.count / total) * 100;
          if (width === 0) return null;
          return (
            <div
              key={i}
              className={`${seg.color} transition-all`}
              style={{ width: `${width}%` }}
              title={`${seg.label}: ${seg.count}`}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${seg.color}`} />
            <span className="text-[var(--ff-text-tertiary)]">{seg.label.split(' ')[0]}: {seg.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LicenseExpiryTimeline({ stats }: { stats: DriverDashboardStats }) {
  const { licenseExpiryByMonth } = stats;
  const maxCount = Math.max(...licenseExpiryByMonth.map(m => m.count), 1);

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <h3 className="font-semibold text-[var(--ff-text-primary)] mb-4">License Expiries (Next 6 Months)</h3>

      <div className="flex items-end gap-2 h-32">
        {licenseExpiryByMonth.map((month, i) => {
          const height = (month.count / maxCount) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col items-center">
              <div
                className={`w-full rounded-t transition-all ${month.count > 0 ? 'bg-orange-500' : 'bg-[var(--ff-bg-tertiary)]'}`}
                style={{ height: `${Math.max(height, 5)}%` }}
                title={`${month.month}: ${month.count} expiring`}
              />
              <span className="text-xs text-[var(--ff-text-tertiary)] mt-2 whitespace-nowrap">
                {month.month.split(' ')[0]}
              </span>
              <span className="text-xs font-medium text-[var(--ff-text-primary)]">{month.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardTab({ stats, onRecalculateScores, calculating }: DashboardTabProps) {
  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex justify-end">
        <button
          onClick={onRecalculateScores}
          disabled={calculating}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-hover)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${calculating ? 'animate-spin' : ''}`} />
          {calculating ? 'Calculating...' : 'Recalculate All Scores'}
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          label="Total Drivers"
          value={stats.totalDrivers}
          icon={Users}
          subtext={`${stats.activeDrivers} active`}
        />
        <StatCard
          label="With Vehicle"
          value={stats.driversWithVehicle}
          icon={Car}
          subtext={`${stats.driversWithoutVehicle} without`}
        />
        <StatCard
          label="Valid Licenses"
          value={stats.licensesValid}
          icon={CheckCircle2}
          variant="success"
        />
        <StatCard
          label="Expiring Soon"
          value={stats.licensesExpiringSoon}
          icon={AlertTriangle}
          variant="warning"
          subtext="Within 30 days"
        />
        <StatCard
          label="Expired"
          value={stats.licensesExpired}
          icon={AlertTriangle}
          variant="danger"
        />
        <StatCard
          label="Avg Score"
          value={stats.avgCompositeScore !== null ? Math.round(stats.avgCompositeScore) : 'N/A'}
          icon={Award}
          subtext={stats.avgCheckInCompliance !== null ? `${Math.round(stats.avgCheckInCompliance)}% check-in` : undefined}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ScoreDistributionBar stats={stats} />
        <LicenseExpiryTimeline stats={stats} />
      </div>

      {/* Former Drivers Note */}
      {stats.formerDrivers > 0 && (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 text-sm text-[var(--ff-text-secondary)]">
          <strong>{stats.formerDrivers}</strong> former driver{stats.formerDrivers !== 1 ? 's' : ''} with
          historical records. Use the &quot;Include former drivers&quot; toggle in the Drivers List tab to view them.
        </div>
      )}
    </div>
  );
}
