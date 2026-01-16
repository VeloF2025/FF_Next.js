/**
 * Budget Alerts Panel Component
 * PRD-057: Project Budget Tracking System
 *
 * Displays active budget alerts with acknowledge and resolve actions
 */

import React from 'react';
import { AlertTriangle, XCircle, Info, Check, CheckCheck } from 'lucide-react';
import type { BudgetAlert, AlertSeverity, AlertStatus } from '@/types/budget';

interface BudgetAlertsPanelProps {
  alerts: BudgetAlert[];
  onAcknowledge?: (alertId: string) => void;
  onResolve?: (alertId: string) => void;
  loading?: boolean;
}

const getSeverityIcon = (severity: AlertSeverity) => {
  switch (severity) {
    case 'critical':
      return <XCircle className="h-5 w-5 text-red-500" />;
    case 'warning':
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    case 'info':
      return <Info className="h-5 w-5 text-blue-500" />;
    default:
      return null;
  }
};

const getSeverityBgColor = (severity: AlertSeverity): string => {
  switch (severity) {
    case 'critical':
      return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    case 'warning':
      return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
    case 'info':
      return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
    default:
      return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  }
};

const getStatusBadge = (status: AlertStatus) => {
  switch (status) {
    case 'active':
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
          Active
        </span>
      );
    case 'acknowledged':
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
          Acknowledged
        </span>
      );
    case 'resolved':
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
          Resolved
        </span>
      );
    default:
      return null;
  }
};

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function BudgetAlertsPanel({
  alerts,
  onAcknowledge,
  onResolve,
  loading = false,
}: BudgetAlertsPanelProps) {
  const activeAlerts = alerts.filter((a) => a.status !== 'resolved');
  const resolvedAlerts = alerts.filter((a) => a.status === 'resolved');

  if (alerts.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm" data-testid="budget-alerts">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Alerts</h3>
        </div>
        <div className="p-6 text-center text-gray-500 dark:text-gray-400">
          <Check className="h-8 w-8 mx-auto mb-2 text-green-500" />
          <p>No active alerts</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm" data-testid="budget-alerts">
      <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Alerts</h3>
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
          {activeAlerts.length} active
        </span>
      </div>

      <div className="p-4 space-y-3">
        {activeAlerts.map((alert) => (
          <div
            key={alert.id}
            className={`p-3 rounded-lg border ${getSeverityBgColor(alert.severity)}`}
            data-testid="alert-item"
            data-severity={alert.severity}
          >
            <div className="flex items-start gap-3">
              {getSeverityIcon(alert.severity)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-gray-900 dark:text-white">{alert.title}</span>
                  {getStatusBadge(alert.status)}
                </div>
                {alert.message && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">{alert.message}</p>
                )}
                {alert.currentPercent !== undefined && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Current utilization: {alert.currentPercent.toFixed(1)}%
                    {alert.thresholdPercent !== undefined && (
                      <> (Threshold: {alert.thresholdPercent}%)</>
                    )}
                  </p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {formatDate(alert.createdAt)}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                {alert.status === 'active' && onAcknowledge && (
                  <button
                    className="px-3 py-1 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                    disabled={loading}
                    onClick={() => onAcknowledge(alert.id)}
                  >
                    Acknowledge
                  </button>
                )}
                {alert.status === 'acknowledged' && onResolve && (
                  <button
                    className="px-3 py-1 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                    disabled={loading}
                    onClick={() => onResolve(alert.id)}
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {resolvedAlerts.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              Show {resolvedAlerts.length} resolved alerts
            </summary>
            <div className="mt-2 space-y-2">
              {resolvedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 opacity-60"
                  data-testid="alert-item"
                >
                  <div className="flex items-center gap-2">
                    <CheckCheck className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{alert.title}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Resolved {alert.resolvedAt ? formatDate(alert.resolvedAt) : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export default BudgetAlertsPanel;
