/**
 * Project Health & Safety Tab Component
 *
 * Displays H&S configuration, audits, and incidents for a project.
 * Used in project detail pages.
 */

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Plus,
  Settings,
  ChevronRight,
  Calendar,
  User,
  BarChart3,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { getRAGStatus, AUDIT_STATUS_CONFIG } from '../types/audit.types';
import type { HSProjectConfig, HSProjectAudit } from '../types/audit.types';

interface ProjectHSTabProps {
  projectId: string;
  projectName?: string;
  onStartAudit?: () => void;
  onConfigureHS?: () => void;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ProjectHSTab({
  projectId,
  projectName,
  onStartAudit,
  onConfigureHS,
}: ProjectHSTabProps) {
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Fetch project H&S config
  const { data: configData, error: configError, mutate: mutateConfig } = useSWR(
    `/api/health-safety/project/${projectId}/config`,
    fetcher
  );

  // Fetch project audits
  const { data: auditsData, error: auditsError, mutate: mutateAudits } = useSWR(
    `/api/health-safety/project/${projectId}/audits?limit=5`,
    fetcher
  );

  const isLoading = !configData && !configError;
  const config = configData?.data?.config as HSProjectConfig | null;
  const auditStats = configData?.data?.audit_stats;
  const audits = (auditsData?.data?.audits || []) as HSProjectAudit[];
  const configured = configData?.data?.configured;

  const handleStartAudit = useCallback(async () => {
    if (onStartAudit) {
      onStartAudit();
      return;
    }

    // Default: create audit and redirect
    try {
      const res = await fetch(`/api/health-safety/project/${projectId}/audits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit_type: 'routine' }),
      });

      if (res.ok) {
        const data = await res.json();
        mutateAudits();
        // Could navigate to audit wizard here
        window.location.href = `/health-safety/audits/${data.data.id}`;
      }
    } catch (err) {
      log.error('Failed to create audit', { error: err, projectId }, 'ProjectHSTab');
    }
  }, [projectId, onStartAudit, mutateAudits]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded-lg" />
      </div>
    );
  }

  if (!configured) {
    return <NotConfiguredState projectId={projectId} onConfigure={onConfigureHS} />;
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-500" />
            Health & Safety Status
          </h3>
          <button
            onClick={() => setShowConfigModal(true)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Overall Score */}
          <ScoreCard
            label="Average Score"
            value={auditStats?.average_score ?? 'N/A'}
            suffix="%"
            ragStatus={auditStats?.average_score ? getRAGStatus(auditStats.average_score) : null}
          />

          {/* Total Audits */}
          <StatCard
            label="Total Audits"
            value={auditStats?.total_audits || 0}
            icon={FileText}
            color="blue"
          />

          {/* Completed */}
          <StatCard
            label="Completed"
            value={auditStats?.completed_audits || 0}
            icon={CheckCircle}
            color="green"
          />

          {/* Next Due */}
          <DueDateCard
            label="Next Audit Due"
            date={config?.next_audit_due}
            frequency={config?.audit_frequency}
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleStartAudit}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Start New Audit
        </button>

        <button
          onClick={() => window.location.href = `/health-safety/incidents?project_id=${projectId}`}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
        >
          <AlertTriangle className="w-4 h-4" />
          Report Incident
        </button>
      </div>

      {/* Recent Audits */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h4 className="font-medium text-gray-900 dark:text-white">Recent Audits</h4>
          <a
            href={`/health-safety/project/${projectId}/audits`}
            className="text-sm text-orange-500 hover:text-orange-600 flex items-center gap-1"
          >
            View All <ChevronRight className="w-4 h-4" />
          </a>
        </div>

        {audits.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No audits yet</p>
            <p className="text-sm">Start your first audit to track H&S compliance</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {audits.map((audit) => (
              <AuditRow key={audit.id} audit={audit} />
            ))}
          </div>
        )}
      </div>

      {/* Config Details (Collapsible) */}
      <ConfigDetails config={config} />
    </div>
  );
}

// Sub-components

function NotConfiguredState({
  projectId,
  onConfigure,
}: {
  projectId: string;
  onConfigure?: () => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
      <Shield className="w-16 h-16 mx-auto mb-4 text-gray-400" />
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        H&S Not Configured
      </h3>
      <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
        Configure Health & Safety settings for this project to enable audits, incident tracking, and
        compliance monitoring.
      </p>
      <button
        onClick={onConfigure || (() => window.location.href = `/health-safety/project/${projectId}/configure`)}
        className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
      >
        <Settings className="w-5 h-5" />
        Configure H&S
      </button>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  suffix = '',
  ragStatus,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  ragStatus?: 'green' | 'amber' | 'red' | null;
}) {
  const ragColors = {
    green: 'text-green-500 bg-green-50 dark:bg-green-900/20',
    amber: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
    red: 'text-red-500 bg-red-50 dark:bg-red-900/20',
  };

  return (
    <div className={`p-4 rounded-lg ${ragStatus ? ragColors[ragStatus] : 'bg-gray-50 dark:bg-gray-700/50'}`}>
      <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
      <p className={`text-2xl font-bold ${ragStatus ? '' : 'text-gray-900 dark:text-white'}`}>
        {value}
        {suffix && typeof value === 'number' && <span className="text-lg">{suffix}</span>}
      </p>
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
  value: number;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'orange' | 'red';
}) {
  const colors = {
    blue: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20',
    green: 'text-green-500 bg-green-50 dark:bg-green-900/20',
    orange: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20',
    red: 'text-red-500 bg-red-50 dark:bg-red-900/20',
  };

  return (
    <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1 rounded ${colors[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function DueDateCard({
  label,
  date,
  frequency,
}: {
  label: string;
  date?: string | null;
  frequency?: string;
}) {
  const dueDate = date ? new Date(date) : null;
  const isOverdue = dueDate && dueDate < new Date();
  const isDueSoon = dueDate && !isOverdue && dueDate < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  return (
    <div
      className={`p-4 rounded-lg ${
        isOverdue
          ? 'bg-red-50 dark:bg-red-900/20'
          : isDueSoon
            ? 'bg-amber-50 dark:bg-amber-900/20'
            : 'bg-gray-50 dark:bg-gray-700/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Calendar className={`w-4 h-4 ${isOverdue ? 'text-red-500' : isDueSoon ? 'text-amber-500' : 'text-gray-500'}`} />
        <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
      </div>
      {dueDate ? (
        <>
          <p className={`text-lg font-semibold ${isOverdue ? 'text-red-600' : isDueSoon ? 'text-amber-600' : 'text-gray-900 dark:text-white'}`}>
            {dueDate.toLocaleDateString()}
          </p>
          {frequency && (
            <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{frequency}</p>
          )}
        </>
      ) : (
        <p className="text-lg text-gray-400">Not set</p>
      )}
    </div>
  );
}

function AuditRow({ audit }: { audit: HSProjectAudit }) {
  const statusConfig = AUDIT_STATUS_CONFIG[audit.status] || AUDIT_STATUS_CONFIG.draft;
  const ragColors = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <a
      href={`/health-safety/audits/${audit.id}`}
      className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className={`p-2 rounded-lg ${ragColors[audit.rag_status] || 'bg-gray-100 dark:bg-gray-700'}`}>
          <BarChart3 className="w-5 h-5" />
        </div>
        <div>
          <p className="font-medium text-gray-900 dark:text-white">
            {audit.audit_type.charAt(0).toUpperCase() + audit.audit_type.slice(1)} Audit
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {new Date(audit.audit_date).toLocaleDateString()}
            {audit.auditor_name && ` • ${audit.auditor_name}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {audit.overall_score !== null && (
          <span className={`text-lg font-semibold ${ragColors[audit.rag_status]?.split(' ')[1] || 'text-gray-600'}`}>
            {audit.overall_score}%
          </span>
        )}
        <span
          className={`px-2 py-1 text-xs font-medium rounded-full`}
          style={{ backgroundColor: statusConfig.color + '20', color: statusConfig.color }}
        >
          {statusConfig.label}
        </span>
        <ChevronRight className="w-5 h-5 text-gray-400" />
      </div>
    </a>
  );
}

function ConfigDetails({ config }: { config: HSProjectConfig | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!config) return null;

  const permits = [
    { key: 'height_work_permitted', label: 'Height Work' },
    { key: 'hot_work_permitted', label: 'Hot Work' },
    { key: 'confined_space_work', label: 'Confined Space' },
    { key: 'excavation_work', label: 'Excavation' },
  ];

  const activePermits = permits.filter(
    (p) => config[p.key as keyof HSProjectConfig]
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <span className="font-medium text-gray-900 dark:text-white">Configuration Details</span>
        <ChevronRight
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500 dark:text-gray-400">Audit Frequency</p>
              <p className="font-medium text-gray-900 dark:text-white capitalize">
                {config.audit_frequency}
                {config.audit_frequency === 'custom' && config.custom_frequency_days && (
                  <span> ({config.custom_frequency_days} days)</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Min Score Threshold</p>
              <p className="font-medium text-gray-900 dark:text-white">{config.min_score_threshold}%</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Daily Briefing</p>
              <p className="font-medium text-gray-900 dark:text-white">
                {config.requires_daily_briefing ? 'Required' : 'Not Required'}
              </p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Active Permits</p>
              <p className="font-medium text-gray-900 dark:text-white">
                {activePermits.length > 0
                  ? activePermits.map((p) => p.label).join(', ')
                  : 'None'}
              </p>
            </div>
          </div>

          {config.notes && (
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Notes</p>
              <p className="text-sm text-gray-900 dark:text-white">{config.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ProjectHSTab;
