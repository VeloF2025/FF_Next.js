/**
 * Infrastructure Health Dashboard
 * Comprehensive system-wide health monitoring display
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  Server,
  Database,
  MessageSquare,
  Cpu,
  Cloud,
  Box,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
  Clock,
} from 'lucide-react';
import { ServiceStatusCard } from './ServiceStatusCard';
import { HealthTrendChart } from './HealthTrendChart';
import type { SystemHealthResponse, OverallStatus } from '../types/infrastructure.types';

const overallStatusConfig: Record<OverallStatus, {
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  icon: React.ElementType;
}> = {
  healthy: {
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    label: 'All Systems Operational',
    icon: CheckCircle2,
  },
  degraded: {
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
    label: 'Some Systems Degraded',
    icon: AlertTriangle,
  },
  critical: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    label: 'Critical Issues Detected',
    icon: XCircle,
  },
};

export function InfrastructureHealthDashboard() {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/system/health?save=true');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setHealth(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health status');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealth]);

  if (error && !health) {
    return (
      <div className="p-6 text-center">
        <XCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
        <h3 className="text-lg font-semibold text-white mb-2">Failed to Load Health Status</h3>
        <p className="text-white/60 mb-4">{error}</p>
        <button
          onClick={fetchHealth}
          className="px-4 py-2 bg-velocity-accent text-white rounded-lg hover:bg-velocity-accent/80 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const statusConfig = health ? overallStatusConfig[health.overall] : overallStatusConfig.healthy;
  const StatusIcon = statusConfig.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Infrastructure Health</h1>
          <p className="text-white/60 text-sm">Real-time monitoring of all FibreFlow services</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-card/5 text-velocity-accent focus:ring-velocity-accent"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-card/5 hover:bg-card/10 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Overall Status Banner */}
      {health && (
        <div className={`p-4 rounded-xl border ${statusConfig.bgColor} ${statusConfig.borderColor}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StatusIcon className={`w-8 h-8 ${statusConfig.color}`} />
              <div>
                <h2 className={`text-lg font-semibold ${statusConfig.color}`}>
                  {statusConfig.label}
                </h2>
                <p className="text-sm text-white/60">
                  {health.summary.healthyCount}/{health.summary.totalServices} services healthy
                  ({health.summary.healthPercentage}%)
                </p>
              </div>
            </div>
            <div className="text-right text-sm text-white/50">
              <div className="flex items-center gap-1 justify-end">
                <Clock className="w-3 h-3" />
                Check duration: {health.checkDurationMs}ms
              </div>
              {lastRefresh && (
                <div>Last updated: {lastRefresh.toLocaleTimeString()}</div>
              )}
            </div>
          </div>

          {health.summary.criticalServicesDown.length > 0 && (
            <div className="mt-3 p-3 bg-red-500/20 rounded-lg border border-red-500/30">
              <div className="flex items-center gap-2 text-red-400 font-semibold">
                <AlertTriangle className="w-4 h-4" />
                Critical Services Down:
              </div>
              <p className="text-sm text-white/80 mt-1">
                {health.summary.criticalServicesDown.join(', ')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !health && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 bg-card/5 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Service Groups */}
      {health && (
        <div className="space-y-6">
          {/* FibreFlow Apps */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Server className="w-5 h-5 text-velocity-accent" />
              <h3 className="text-lg font-semibold text-white">FibreFlow Instances</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ServiceStatusCard name="Production" status={health.apps.production} isCritical />
              <ServiceStatusCard name="Staging" status={health.apps.staging} />
              <ServiceStatusCard name="Dev" status={health.apps.dev} />
              <ServiceStatusCard name="Backup (VPS)" status={health.apps.backup} />
            </div>
          </section>

          {/* QFieldCloud */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Box className="w-5 h-5 text-blue-400" />
              <h3 className="text-lg font-semibold text-white">QFieldCloud</h3>
              <span className={`text-sm px-2 py-0.5 rounded-full ${
                health.qfield.overall === 'healthy' ? 'bg-green-500/20 text-green-400' :
                health.qfield.overall === 'degraded' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {health.qfield.runningContainers}/{health.qfield.totalContainers} running
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {health.qfield.containers.map((container) => (
                <div
                  key={container.name}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                    container.status === 'running' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                    container.status === 'stopped' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                    'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                  }`}
                  title={container.name}
                >
                  {container.name.replace('qfieldcloud-', '').replace('-1', '')}
                </div>
              ))}
              <ServiceStatusCard name="Sync Webhook" status={health.qfield.syncWebhook} compact />
            </div>
          </section>

          {/* AI/ML Services */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-semibold text-white">AI/ML Services</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ServiceStatusCard name="VLM (Qwen3)" status={health.ai.vlm} isCritical />
              <ServiceStatusCard name="Ollama" status={health.ai.ollama} />
              <ServiceStatusCard name="Qdrant" status={health.ai.qdrant} />
            </div>
          </section>

          {/* Messaging Services */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-5 h-5 text-green-400" />
              <h3 className="text-lg font-semibold text-white">Messaging Services</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ServiceStatusCard name="WA Feedback" status={health.messaging.waFeedback} isCritical />
              <ServiceStatusCard name="WA Bridge (VPS)" status={health.messaging.waBridgeVPS} isCritical />
            </div>
          </section>

          {/* Databases */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-5 h-5 text-orange-400" />
              <h3 className="text-lg font-semibold text-white">Databases</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ServiceStatusCard name="Neon Production" status={health.databases.neonProduction} isCritical />
              <ServiceStatusCard name="Neon Dev" status={health.databases.neonDev} />
              <ServiceStatusCard name="QField Postgres" status={health.databases.qfieldDb} />
            </div>
          </section>

          {/* Infrastructure */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Cloud className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-white">Infrastructure</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ServiceStatusCard name="Cloudflared" status={health.infrastructure.cloudflared} isCritical />
              <ServiceStatusCard name="PDFCraft" status={health.infrastructure.pdfcraft} />
              <ServiceStatusCard name="Grafana" status={health.infrastructure.grafana} />
              <ServiceStatusCard name="Portainer" status={health.infrastructure.portainer} />
            </div>
          </section>

          {/* Health Trend Chart */}
          <section>
            <HealthTrendChart hours={24} limit={48} />
          </section>

          {/* Recent Recovery Actions */}
          {health.recentRecoveryActions.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-5 h-5 text-red-400" />
                <h3 className="text-lg font-semibold text-white">Recent Recovery Actions</h3>
              </div>
              <div className="bg-card/5 rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-card/5">
                    <tr>
                      <th className="text-left px-4 py-2 text-white/60 font-medium">Time</th>
                      <th className="text-left px-4 py-2 text-white/60 font-medium">Service</th>
                      <th className="text-left px-4 py-2 text-white/60 font-medium">Action</th>
                      <th className="text-left px-4 py-2 text-white/60 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {health.recentRecoveryActions.map((action) => (
                      <tr key={action.id} className="hover:bg-card/5">
                        <td className="px-4 py-2 text-white/80">
                          {action.minutesAgo !== undefined
                            ? `${action.minutesAgo}m ago`
                            : new Date(action.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-2 text-white/80">{action.serviceName}</td>
                        <td className="px-4 py-2 text-white/80">{action.actionTaken}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            action.resultStatus === 'success' ? 'bg-green-500/20 text-green-400' :
                            action.resultStatus === 'failed' ? 'bg-red-500/20 text-red-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {action.resultStatus.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export default InfrastructureHealthDashboard;
