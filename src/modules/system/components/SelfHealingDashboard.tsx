/**
 * Self-Healing Dashboard Component
 *
 * Displays Python daemon status, pending approvals, AI classification suggestions,
 * and recovery action history with approve/reject functionality.
 *
 * NOTE: Works with the AI Recovery Agent running on Velocity server (100.96.203.105)
 * as systemd service 'ai-recovery-agent.service'.
 */

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Play,
  Pause,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Shield,
  Zap,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  History,
  Server,
} from 'lucide-react';
import type {
  DaemonStatus,
  ApprovalQueueItem,
  ClassificationSuggestion,
  RiskLevel,
} from '../types/self-healing.types';
import { log } from '@/lib/logger';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface DashboardData {
  daemon: DaemonStatus;
  pendingApprovals: ApprovalQueueItem[];
  suggestions: ClassificationSuggestion[];
  stats: {
    successRate: number | null;
    mttrSeconds: number | null;
    incidentCount: number;
  };
}

export default function SelfHealingDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedApproval, setExpandedApproval] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

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
    } catch (err) {
      log.error('Failed to load self-healing data', { error: err });
    } finally {
      setLoading(false);
    }
  };

  const handleDaemonAction = async (action: 'start-daemon' | 'stop-daemon' | 'trigger-check') => {
    try {
      setActionLoading(action);
      const response = await fetch('/api/system/self-healing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) throw new Error('Action failed');

      await fetchData();
    } catch (err) {
      log.error('Daemon action failed', { error: err });
    } finally {
      setActionLoading(null);
    }
  };

  const handleApproval = async (id: string, approve: boolean) => {
    try {
      setActionLoading(id);
      const response = await fetch('/api/system/approve-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueId: id,
          approved: approve,
          decidedBy: 'current-user', // Will be replaced by actual user
        }),
      });

      if (!response.ok) throw new Error('Approval failed');

      await fetchData();
    } catch (err) {
      log.error('Approval action failed', { error: err });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-red-900/20 border border-red-500 rounded-lg p-4">
        <p className="text-red-400">Failed to load self-healing data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Daemon Control Panel */}
      <DaemonControlPanel
        daemon={data.daemon}
        onAction={handleDaemonAction}
        actionLoading={actionLoading}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Approvals */}
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-yellow-400" />
              <h3 className="text-lg font-medium text-white">Pending Approvals</h3>
            </div>
            <span className="text-sm text-muted-foreground">
              {data.pendingApprovals.length} pending
            </span>
          </div>

          {data.pendingApprovals.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">
              No pending approvals
            </p>
          ) : (
            <div className="space-y-2">
              {data.pendingApprovals.map((item) => (
                <ApprovalCard
                  key={item.id}
                  item={item}
                  isExpanded={expandedApproval === item.id}
                  onToggle={() =>
                    setExpandedApproval(expandedApproval === item.id ? null : item.id)
                  }
                  onApprove={() => handleApproval(item.id, true)}
                  onReject={() => handleApproval(item.id, false)}
                  isLoading={actionLoading === item.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Classification Suggestions */}
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-medium text-white">AI Suggestions</h3>
            </div>
            <span className="text-sm text-muted-foreground">
              {data.suggestions.length} pending
            </span>
          </div>

          {data.suggestions.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">
              No suggestions at this time
            </p>
          ) : (
            <div className="space-y-2">
              {data.suggestions.slice(0, 5).map((suggestion) => (
                <SuggestionCard key={suggestion.id} suggestion={suggestion} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recovery Statistics */}
      <RecoveryStats stats={data.stats} />

      {/* History Toggle */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowHistory(!showHistory)}
        className="flex items-center gap-2"
      >
        <History className="w-4 h-4" />
        <span className="text-sm">{showHistory ? 'Hide' : 'Show'} Recovery History</span>
        {showHistory ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </Button>

      {showHistory && <RecoveryHistory />}
    </div>
  );
}

// Sub-components

function DaemonControlPanel({
  daemon,
  onAction,
  actionLoading,
}: {
  daemon: DaemonStatus;
  onAction: (action: 'start-daemon' | 'stop-daemon' | 'trigger-check') => void;
  actionLoading: string | null;
}) {
  const isRunning = daemon.isRunning;

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div
            className={`w-3 h-3 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`}
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium text-white">AI Recovery Agent</h3>
              <span className="text-xs px-2 py-0.5 bg-blue-900 text-blue-300 rounded">
                <Server className="w-3 h-3 inline mr-1" />
                Velocity
              </span>
            </div>
            <p className="text-sm text-gray-400">
              {isRunning ? (
                <>
                  Running • Last check:{' '}
                  {daemon.lastCheck
                    ? formatRelativeTime(new Date(daemon.lastCheck))
                    : 'Never'}
                </>
              ) : (
                'Stopped'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRunning ? (
            <>
              <Button
                variant="primary"
                onClick={() => onAction('trigger-check')}
                disabled={actionLoading === 'trigger-check'}
                className="flex items-center gap-2"
              >
                <RefreshCw
                  className={`w-4 h-4 ${actionLoading === 'trigger-check' ? 'animate-spin' : ''}`}
                />
                Check Now
              </Button>
              <Button
                variant="danger"
                onClick={() => onAction('stop-daemon')}
                disabled={actionLoading === 'stop-daemon'}
                className="flex items-center gap-2"
              >
                <Pause className="w-4 h-4" />
                Stop
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={() => onAction('start-daemon')}
              disabled={actionLoading === 'start-daemon'}
              className="flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Start Daemon
            </Button>
          )}
        </div>
      </div>

      {/* Daemon Stats */}
      {isRunning && (
        <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-700">
          <div>
            <span className="text-sm text-muted-foreground">Interval</span>
            <p className="text-white">{(daemon.intervalMs / 1000).toFixed(0)}s</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Cycles</span>
            <p className="text-white">{daemon.cycleCount}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Errors</span>
            <p className={daemon.errorCount > 0 ? 'text-red-400' : 'text-white'}>
              {daemon.errorCount}
            </p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Started</span>
            <p className="text-white">
              {daemon.startedAt ? formatRelativeTime(new Date(daemon.startedAt)) : 'N/A'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  item,
  isExpanded,
  onToggle,
  onApprove,
  onReject,
  isLoading,
}: {
  item: ApprovalQueueItem;
  isExpanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  isLoading: boolean;
}) {
  const riskConfig: Record<RiskLevel, { color: string; bg: string }> = {
    safe: { color: 'text-green-400', bg: 'bg-green-900' },
    moderate: { color: 'text-yellow-400', bg: 'bg-yellow-900' },
    dangerous: { color: 'text-red-400', bg: 'bg-red-900' },
  };

  const risk = riskConfig[item.riskLevel] || riskConfig.moderate;

  return (
    <div className="bg-gray-700/50 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-700/70 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-0.5 rounded ${risk.bg} ${risk.color}`}>
            {item.riskLevel}
          </span>
          <span className="text-white">{item.actionName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {formatRelativeTime(new Date(item.requestedAt))}
          </span>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Service: </span>
            <span className="text-gray-300">{item.serviceName}</span>
          </div>
          {item.reason && (
            <div className="text-sm">
              <span className="text-muted-foreground">Reason: </span>
              <span className="text-gray-300">{item.reason}</span>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={onApprove}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-2"
            >
              <ThumbsUp className="w-4 h-4" />
              Approve
            </Button>
            <Button
              variant="danger"
              onClick={onReject}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-2"
            >
              <ThumbsDown className="w-4 h-4" />
              Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: ClassificationSuggestion }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-gray-700/50 rounded-lg p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-gray-300">{suggestion.serviceName}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Suggest: {suggestion.currentRiskLevel} → {suggestion.suggestedRiskLevel}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Collapse suggestion' : 'Expand suggestion'}
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </Button>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-gray-600">
          <p className="text-xs text-gray-400">{suggestion.rationale}</p>
          <div className="flex gap-2 mt-2">
            <Button variant="link" size="sm">Apply</Button>
            <Button variant="ghost" size="sm">Dismiss</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecoveryStats({
  stats,
}: {
  stats: { successRate: number | null; mttrSeconds: number | null; incidentCount: number };
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <span className="text-sm text-gray-400">Success Rate</span>
        </div>
        <p
          className={`text-2xl font-semibold ${
            stats.successRate === null
              ? 'text-gray-400'
              : stats.successRate >= 90
                ? 'text-green-400'
                : stats.successRate >= 70
                  ? 'text-yellow-400'
                  : 'text-red-400'
          }`}
        >
          {stats.successRate !== null ? `${stats.successRate}%` : 'N/A'}
        </p>
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-4 h-4 text-blue-400" />
          <span className="text-sm text-gray-400">Avg Resolution</span>
        </div>
        <p className="text-2xl font-semibold text-blue-400">
          {stats.mttrSeconds !== null ? formatDuration(stats.mttrSeconds) : 'N/A'}
        </p>
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-purple-400" />
          <span className="text-sm text-gray-400">Total Incidents</span>
        </div>
        <p className="text-2xl font-semibold text-purple-400">{stats.incidentCount}</p>
      </div>
    </div>
  );
}

function RecoveryHistory() {
  const [history, setHistory] = useState<
    Array<{
      id: string;
      actionName: string;
      serviceName: string;
      executedAt: Date;
      success: boolean;
      duration: number;
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await fetch('/api/system/stats?includeHistory=true');
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        setHistory(result.data?.history || []);
      } catch (err) {
        log.error('Failed to load history', { error: err });
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 text-center">
        <p className="text-muted-foreground text-sm">No recovery actions in history</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-700">
          <tr>
            <th className="px-4 py-2 text-left text-sm text-gray-400">Action</th>
            <th className="px-4 py-2 text-left text-sm text-gray-400">Service</th>
            <th className="px-4 py-2 text-left text-sm text-gray-400">Time</th>
            <th className="px-4 py-2 text-left text-sm text-gray-400">Duration</th>
            <th className="px-4 py-2 text-left text-sm text-gray-400">Result</th>
          </tr>
        </thead>
        <tbody>
          {history.map((item) => (
            <tr key={item.id} className="border-t border-gray-700">
              <td className="px-4 py-2 text-gray-300">{item.actionName}</td>
              <td className="px-4 py-2 text-gray-300">{item.serviceName}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {formatRelativeTime(new Date(item.executedAt))}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{item.duration}ms</td>
              <td className="px-4 py-2">
                {item.success ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Helpers

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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}
