/**
 * Overview Dashboard Component
 *
 * Displays aggregated system health status with stat cards,
 * service status indicators, and recent activity timeline.
 */

import React, { useState, useEffect } from 'react';
import {
  CheckCircle,
  AlertCircle,
  XCircle,
  Activity,
  Clock,
  Zap,
  AlertTriangle,
  Bell,
  RefreshCw,
} from 'lucide-react';
import type { OverallStatus, ServiceHealth, ActivityEvent } from '../types/self-healing.types';

interface DashboardData {
  health: {
    overall: OverallStatus;
    services: ServiceHealth[];
    healthyCount: number;
    unhealthyCount: number;
    criticalDown: boolean;
  };
  stats: {
    successRate: number | null;
    mttrSeconds: number | null;
    incidentCount: number;
  };
  pendingApprovals: Array<{ id: string; actionName: string }>;
  recentActivity: ActivityEvent[];
}

export default function OverviewDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/system/self-healing');
      if (!response.ok) throw new Error('Failed to fetch');
      const result = await response.json();
      setData(result.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div data-testid="loading-skeleton" className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-900/20 border border-red-500 rounded-lg p-4">
        <p className="text-red-400">Error loading data: {error || 'No data available'}</p>
      </div>
    );
  }

  const { health, stats, pendingApprovals, recentActivity } = data;

  return (
    <div className="space-y-6">
      {/* Overall Status Banner */}
      <OverallStatusBanner status={health.overall} criticalDown={health.criticalDown} />

      {/* Stat Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Services Up"
          value={`${health.healthyCount}/${health.healthyCount + health.unhealthyCount}`}
          icon={Activity}
          color={health.unhealthyCount === 0 ? 'green' : 'yellow'}
        />
        <StatCard
          label="Success Rate"
          value={stats.successRate !== null ? `${stats.successRate}%` : 'N/A'}
          icon={CheckCircle}
          color={getSuccessRateColor(stats.successRate)}
        />
        <StatCard
          label="Avg Resolution"
          value={formatMTTR(stats.mttrSeconds)}
          icon={Clock}
          color={getMTTRColor(stats.mttrSeconds)}
        />
        <StatCard
          label="Pending Approvals"
          value={pendingApprovals.length.toString()}
          icon={Bell}
          color={pendingApprovals.length > 0 ? 'yellow' : 'gray'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service Status Grid */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-medium text-white mb-4">Service Status</h3>
          <div className="grid grid-cols-2 gap-2">
            {health.services.slice(0, 10).map((service) => (
              <ServiceStatusCard key={service.serviceId} service={service} />
            ))}
          </div>
          {health.services.length > 10 && (
            <p className="text-sm text-gray-500 mt-2">
              +{health.services.length - 10} more services
            </p>
          )}
        </div>

        {/* Recent Activity Timeline */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-medium text-white mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {recentActivity.slice(0, 8).map((event) => (
              <ActivityItem key={event.id} event={event} />
            ))}
            {recentActivity.length === 0 && (
              <p className="text-gray-500 text-sm">No recent activity</p>
            )}
          </div>
        </div>
      </div>

      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-500 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-lg font-medium text-yellow-400">
              Actions Awaiting Approval
            </h3>
          </div>
          <ul className="space-y-1">
            {pendingApprovals.slice(0, 5).map((item) => (
              <li key={item.id} className="text-gray-300 text-sm">
                • {item.actionName}
              </li>
            ))}
          </ul>
          <a
            href="/system/health?tab=self-healing"
            className="text-yellow-400 hover:text-yellow-300 text-sm mt-2 inline-block"
          >
            View all pending →
          </a>
        </div>
      )}
    </div>
  );
}

// Sub-components

function OverallStatusBanner({
  status,
  criticalDown,
}: {
  status: OverallStatus;
  criticalDown: boolean;
}) {
  const config = {
    healthy: {
      bg: 'bg-green-900/20',
      border: 'border-green-500',
      icon: CheckCircle,
      iconColor: 'text-green-400',
      text: 'All Systems Operational',
      textColor: 'text-green-400',
    },
    degraded: {
      bg: 'bg-yellow-900/20',
      border: 'border-yellow-500',
      icon: AlertCircle,
      iconColor: 'text-yellow-400',
      text: 'Some Services Degraded',
      textColor: 'text-yellow-400',
    },
    critical: {
      bg: 'bg-red-900/20',
      border: 'border-red-500',
      icon: XCircle,
      iconColor: 'text-red-400',
      text: criticalDown ? 'Critical Services Down' : 'System Critical',
      textColor: 'text-red-400',
    },
  }[status];

  const Icon = config.icon;

  return (
    <div className={`${config.bg} border ${config.border} rounded-lg p-4 flex items-center gap-3`}>
      <Icon className={`w-8 h-8 ${config.iconColor}`} />
      <span data-testid="overall-status" className={`text-lg font-medium ${config.textColor}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)} - {config.text}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: 'green' | 'yellow' | 'red' | 'gray' | 'blue';
}) {
  const colorClasses = {
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
    gray: 'text-gray-400',
    blue: 'text-blue-400',
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${colorClasses[color]}`} />
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <p className={`text-2xl font-semibold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}

function ServiceStatusCard({ service }: { service: ServiceHealth }) {
  const statusConfig = {
    healthy: { dot: 'bg-green-400', text: 'text-green-400' },
    degraded: { dot: 'bg-yellow-400', text: 'text-yellow-400' },
    unhealthy: { dot: 'bg-red-400', text: 'text-red-400' },
    timeout: { dot: 'bg-orange-400', text: 'text-orange-400' },
    error: { dot: 'bg-red-400', text: 'text-red-400' },
  }[service.status] || { dot: 'bg-gray-400', text: 'text-gray-400' };

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-700/50 rounded">
      <div className={`w-2 h-2 rounded-full ${statusConfig.dot}`} />
      <span className="text-sm text-gray-300 truncate">{service.serviceName}</span>
      {service.responseTimeMs && (
        <span className="text-xs text-gray-500 ml-auto">{service.responseTimeMs}ms</span>
      )}
    </div>
  );
}

function ActivityItem({ event }: { event: ActivityEvent }) {
  const iconConfig = {
    incident_created: { icon: AlertCircle, color: 'text-red-400' },
    action_executed: { icon: Zap, color: event.success ? 'text-green-400' : 'text-red-400' },
    incident_resolved: { icon: CheckCircle, color: 'text-green-400' },
    approval_requested: { icon: Bell, color: 'text-yellow-400' },
    approval_decided: { icon: CheckCircle, color: 'text-blue-400' },
  }[event.type] || { icon: Activity, color: 'text-gray-400' };

  const Icon = iconConfig.icon;

  return (
    <div className="flex items-start gap-3">
      <Icon className={`w-4 h-4 mt-0.5 ${iconConfig.color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300 truncate">{event.description}</p>
        <p className="text-xs text-gray-500">{formatRelativeTime(new Date(event.timestamp))}</p>
      </div>
    </div>
  );
}

// Helpers

function formatMTTR(seconds: number | null): string {
  if (seconds === null) return 'N/A';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getSuccessRateColor(rate: number | null): 'green' | 'yellow' | 'red' | 'gray' {
  if (rate === null) return 'gray';
  if (rate >= 90) return 'green';
  if (rate >= 70) return 'yellow';
  return 'red';
}

function getMTTRColor(seconds: number | null): 'green' | 'yellow' | 'red' | 'gray' {
  if (seconds === null) return 'gray';
  if (seconds < 60) return 'green';
  if (seconds < 300) return 'yellow';
  return 'red';
}
