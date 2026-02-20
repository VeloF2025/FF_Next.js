/**
 * SystemHealthDashboard Component
 *
 * Shows health status of all DR Photo Unified system components.
 * Auto-refreshes every 30 seconds.
 */

'use client';

import { useState, useEffect, useRef } from 'react';

interface ServiceStatus {
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  latencyMs: number;
  message: string;
  lastCheck: string;
}

interface HealthData {
  overall: 'healthy' | 'degraded' | 'down';
  services: {
    database: ServiceStatus;
    onemap: ServiceStatus;
    vlm: ServiceStatus;
    whatsappBridge: ServiceStatus;
    whatsappSender?: ServiceStatus;
    sharepoint?: ServiceStatus;
  };
  recentActivity: {
    lastDRProcessed: string | null;
    drsLast24h: number;
    pendingCategorization: number;
    failedCategorization: number;
  };
}

interface SystemHealthDashboardProps {
  autoRefresh?: boolean;
  refreshInterval?: number; // in seconds
  compact?: boolean;
}

export function SystemHealthDashboard({
  autoRefresh = true,
  refreshInterval = 30,
  compact = false,
}: SystemHealthDashboardProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    }

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded]);

  async function fetchHealth() {
    try {
      const response = await fetch('/api/activate/health-check');
      const data = await response.json();

      if (data.success) {
        setHealth(data.data);
        setError(null);
      } else {
        setError(data.message || 'Health check failed');
      }
    } catch (err) {
      setError('Failed to fetch health status');
    } finally {
      setIsLoading(false);
      setLastRefresh(new Date());
    }
  }

  async function retryFailed() {
    setIsRetrying(true);
    setRetryResult(null);
    try {
      const response = await fetch('/api/activate/admin/retry-failed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      });
      const data = await response.json();

      if (data.success) {
        setRetryResult(`Processed ${data.data.processed} DR(s): ${data.data.successful} successful, ${data.data.failed} failed`);
        // Refresh health after retry
        setTimeout(fetchHealth, 2000);
      } else {
        setRetryResult(`Retry failed: ${data.message}`);
      }
    } catch (err) {
      setRetryResult('Retry request failed');
    } finally {
      setIsRetrying(false);
    }
  }

  useEffect(() => {
    fetchHealth();

    if (autoRefresh) {
      const interval = setInterval(fetchHealth, refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval]);

  function getStatusColor(status: ServiceStatus['status']): string {
    switch (status) {
      case 'healthy':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'down':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  }

  function getStatusIcon(status: ServiceStatus['status']): string {
    switch (status) {
      case 'healthy':
        return '✓';
      case 'degraded':
        return '⚠';
      case 'down':
        return '✗';
      default:
        return '?';
    }
  }

  function getOverallBg(overall: HealthData['overall']): string {
    switch (overall) {
      case 'healthy':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      case 'degraded':
        return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
      case 'down':
        return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
        <span>Checking system health...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-red-600 dark:text-red-400">⚠</span>
            <span className="text-red-700 dark:text-red-300">{error}</span>
          </div>
          <button
            onClick={fetchHealth}
            className="text-sm text-red-600 dark:text-red-400 hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!health) return null;

  const services = [
    { key: 'database', label: 'Database', icon: '🗄️', ...health.services.database },
    { key: 'onemap', label: '1M', icon: '🗺️', ...health.services.onemap },
    { key: 'vlm', label: 'VLM (AI)', icon: '🤖', ...health.services.vlm },
    { key: 'whatsappBridge', label: 'WA Bridge', icon: '💬', ...health.services.whatsappBridge },
    ...(health.services.whatsappSender ? [{ key: 'whatsappSender', label: 'WA Sender', icon: '📤', ...health.services.whatsappSender }] : []),
    ...(health.services.sharepoint ? [{ key: 'sharepoint', label: 'SharePoint', icon: '📁', ...health.services.sharepoint }] : []),
  ];

  // Compact view for header/navbar
  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded-md transition-colors"
        >
          <div className={`w-2 h-2 rounded-full ${getStatusColor(health.overall === 'healthy' ? 'healthy' : health.overall === 'degraded' ? 'degraded' : 'down')}`} />
          <span className="text-xs text-muted-foreground">
            {health.overall === 'healthy' ? 'All systems operational' :
             health.overall === 'degraded' ? 'Some issues detected' :
             'System issues'}
          </span>
          <span className="text-xs text-gray-400">{isExpanded ? '▲' : '▼'}</span>
        </button>

        {/* Expanded dropdown */}
        {isExpanded && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-lg p-3 min-w-[280px]">
            <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Service Status</div>
            <div className="space-y-2">
              {services.map(s => (
                <div key={s.key} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span>{s.icon}</span>
                    <span className="text-muted-foreground">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${
                      s.status === 'healthy' ? 'text-green-600 dark:text-green-400' :
                      s.status === 'degraded' ? 'text-yellow-600 dark:text-yellow-400' :
                      s.status === 'down' ? 'text-red-600 dark:text-red-400' :
                      'text-muted-foreground'
                    }`}>
                      {s.message}
                    </span>
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(s.status)}`} />
                  </div>
                </div>
              ))}
            </div>
            {lastRefresh && (
              <div className="mt-2 pt-2 border-t border-border text-xs text-muted-foreground">
                Last updated: {lastRefresh.toLocaleTimeString()}
              </div>
            )}
            <div className="mt-2 pt-2 border-t border-border">
              <a
                href="/activate/monitoring"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                View full monitoring →
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full dashboard view
  return (
    <div className="space-y-4">
      {/* Overall Status */}
      <div className={`border rounded-lg p-4 ${getOverallBg(health.overall)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full ${getStatusColor(health.overall === 'healthy' ? 'healthy' : health.overall === 'degraded' ? 'degraded' : 'down')}`} />
            <div>
              <h3 className="font-semibold text-foreground">
                System Status: {health.overall.charAt(0).toUpperCase() + health.overall.slice(1)}
              </h3>
              {lastRefresh && (
                <p className="text-xs text-muted-foreground">
                  Last checked: {lastRefresh.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchHealth}
              className="px-3 py-1 text-sm border border-border rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Refresh
            </button>
            <a
              href="/activate/monitoring"
              className="px-3 py-1 text-sm text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              Full Monitoring
            </a>
          </div>
        </div>
      </div>

      {/* Service Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {services.map((service) => (
          <div
            key={service.key}
            className={`border rounded-lg p-3 ${
              service.status === 'healthy'
                ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
                : service.status === 'degraded'
                ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-900/10'
                : service.status === 'down'
                ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
                : 'border-border bg-background/50 dark:bg-gray-800/50'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span>{service.icon}</span>
              <span className="font-medium text-foreground">{service.label}</span>
              <span className={`ml-auto w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white ${getStatusColor(service.status)}`}>
                {getStatusIcon(service.status)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {service.message}
            </p>
            <p className="text-xs text-muted-foreground dark:text-gray-400 mt-1">
              {service.latencyMs}ms
            </p>
          </div>
        ))}
      </div>

      {/* Activity Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-input/50 border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-foreground">
            {health.recentActivity.drsLast24h}
          </div>
          <div className="text-xs text-muted-foreground">DRs (24h)</div>
        </div>
        <div className="bg-input/50 border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
            {health.recentActivity.pendingCategorization}
          </div>
          <div className="text-xs text-muted-foreground">Pending</div>
        </div>
        <div className="bg-input/50 border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">
            {health.recentActivity.failedCategorization}
          </div>
          <div className="text-xs text-muted-foreground">Failed</div>
        </div>
        <div className="bg-input/50 border border-border rounded-lg p-3 text-center">
          <div className="text-sm font-mono text-foreground truncate">
            {health.recentActivity.lastDRProcessed || '—'}
          </div>
          <div className="text-xs text-muted-foreground">Last DR</div>
        </div>
      </div>

      {/* Alerts */}
      {(health.recentActivity.failedCategorization > 0 || health.recentActivity.pendingCategorization > 5) && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">Attention Needed</h4>
              <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                {health.recentActivity.failedCategorization > 0 && (
                  <li>• {health.recentActivity.failedCategorization} DR(s) failed categorization - may need retry</li>
                )}
                {health.recentActivity.pendingCategorization > 5 && (
                  <li>• {health.recentActivity.pendingCategorization} DR(s) pending - check if VLM is running</li>
                )}
              </ul>
              {retryResult && (
                <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">{retryResult}</p>
              )}
            </div>
            {health.recentActivity.failedCategorization > 0 && (
              <button
                onClick={retryFailed}
                disabled={isRetrying}
                className="px-3 py-1.5 text-sm bg-yellow-600 dark:bg-yellow-500 text-white rounded-lg hover:bg-yellow-700 dark:hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isRetrying ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Retrying...</span>
                  </>
                ) : (
                  <>
                    <span>🔄</span>
                    <span>Retry Failed</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
