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
  FileText,
  Plus,
  Settings,
  ChevronRight,
  Calendar,
  BarChart3,
  Building,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { formatDisplayDate } from '@/utils/dateFormat';
import { getRAGStatus, AUDIT_STATUS_CONFIG } from '../types/audit.types';
import type { HSProjectConfig, HSProjectAudit } from '../types/audit.types';
import { ContractorHSGrid } from './ContractorHSGrid';
import { ProjectIncidentsSection } from './ProjectIncidentsSection';

interface ProjectHSTabProps {
  projectId: string;
  projectName?: string;
  onStartAudit?: () => void;
  onConfigureHS?: () => void;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ProjectHSTab({
  projectId,
  projectName: _projectName,
  onStartAudit,
  onConfigureHS,
}: ProjectHSTabProps) {
  const [_showConfigModal, setShowConfigModal] = useState(false);

  // Fetch project H&S config
  const { data: configData, error: configError, mutate: _mutateConfig } = useSWR(
    `/api/health-safety/project/${projectId}/config`,
    fetcher
  );

  // Fetch project audits
  const { data: auditsData, error: _auditsError, mutate: mutateAudits } = useSWR(
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
        <div className="h-32 bg-secondary rounded-lg" />
        <div className="h-48 bg-secondary rounded-lg" />
      </div>
    );
  }

  if (!configured) {
    return <NotConfiguredState projectId={projectId} onConfigure={onConfigureHS} />;
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-500" />
            Health & Safety Status
          </h3>
          <button
            onClick={() => setShowConfigModal(true)}
            className="text-muted-foreground hover:text-muted-foreground dark:hover:text-gray-200"
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
          className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary dark:hover:bg-gray-600 text-foreground rounded-lg transition-colors"
        >
          <AlertTriangle className="w-4 h-4" />
          Report Incident
        </button>
      </div>

      {/* Recent Audits */}
      <div className="bg-card rounded-lg border border-border">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h4 className="font-medium text-foreground">Recent Audits</h4>
          <a
            href={`/health-safety/project/${projectId}/audits`}
            className="text-sm text-orange-500 hover:text-orange-600 flex items-center gap-1"
          >
            View All <ChevronRight className="w-4 h-4" />
          </a>
        </div>

        {audits.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
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

      {/* Contractor Compliance Section */}
      <div className="bg-card rounded-lg border border-border">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h4 className="font-medium text-foreground flex items-center gap-2">
            <Building className="w-5 h-5 text-blue-500" />
            Contractor Compliance
          </h4>
        </div>
        <div className="p-4">
          <ContractorHSGrid projectId={projectId} compact />
        </div>
      </div>

      {/* Incidents Section */}
      <div className="bg-card rounded-lg border border-border">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h4 className="font-medium text-foreground flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Incidents
          </h4>
        </div>
        <div className="p-4">
          <ProjectIncidentsSection projectId={projectId} compact />
        </div>
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
  onConfigured,
}: {
  projectId: string;
  onConfigure?: () => void;
  onConfigured?: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditFrequency, setAuditFrequency] = useState('weekly');
  const [minScore, setMinScore] = useState('80');
  const [dailyBriefing, setDailyBriefing] = useState(true);
  const [heightWork, setHeightWork] = useState(false);
  const [hotWork, setHotWork] = useState(false);
  const [confinedSpace, setConfinedSpace] = useState(false);
  const [excavation, setExcavation] = useState(false);
  const [notes, setNotes] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/health-safety/project/${projectId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit_frequency: auditFrequency,
          min_score_threshold: parseInt(minScore) || 80,
          requires_daily_briefing: dailyBriefing,
          height_work_permitted: heightWork,
          hot_work_permitted: hotWork,
          confined_space_work: confinedSpace,
          excavation_work: excavation,
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch((_e: unknown) => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Failed to save H&S configuration');
      }

      if (onConfigured) onConfigured();
      // Reload the tab to show configured state
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  if (!showForm) {
    return (
      <div className="bg-card rounded-lg border border-border p-8 text-center">
        <Shield className="w-16 h-16 mx-auto mb-4 text-gray-400" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          H&S Not Configured
        </h3>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
          Configure Health & Safety settings for this project to enable audits, incident tracking, and
          compliance monitoring.
        </p>
        <button
          onClick={onConfigure || (() => setShowForm(true))}
          className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
        >
          <Settings className="w-5 h-5" />
          Configure H&S
        </button>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Shield className="w-5 h-5 text-orange-500" />
        Configure Health & Safety
      </h3>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Audit Frequency */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Audit Frequency
          </label>
          <select
            value={auditFrequency}
            onChange={(e) => setAuditFrequency(e.target.value)}
            className="ff-input w-full"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {/* Min Score */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Minimum Score Threshold (%)
          </label>
          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            min="0"
            max="100"
            className="ff-input w-full"
          />
        </div>

        {/* Daily Briefing */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="dailyBriefing"
            checked={dailyBriefing}
            onChange={(e) => setDailyBriefing(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
          />
          <label htmlFor="dailyBriefing" className="text-sm text-foreground">
            Require daily safety briefing
          </label>
        </div>

        {/* Work Permits */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Work Permits Required
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'heightWork', label: 'Height Work', checked: heightWork, set: setHeightWork },
              { id: 'hotWork', label: 'Hot Work', checked: hotWork, set: setHotWork },
              { id: 'confinedSpace', label: 'Confined Space', checked: confinedSpace, set: setConfinedSpace },
              { id: 'excavation', label: 'Excavation', checked: excavation, set: setExcavation },
            ].map((permit) => (
              <div key={permit.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={permit.id}
                  checked={permit.checked}
                  onChange={(e) => permit.set(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                />
                <label htmlFor={permit.id} className="text-sm text-foreground">
                  {permit.label}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="ff-input w-full"
            placeholder="Additional H&S notes..."
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
        <button
          onClick={() => setShowForm(false)}
          className="ff-button ff-button--secondary"
          disabled={saving}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? (
            <>
              <InlineSpinner size="sm" />
              Saving...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Save & Enable H&S
            </>
          )}
        </button>
      </div>
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
    <div className={`p-4 rounded-lg ${ragStatus ? ragColors[ragStatus] : 'bg-secondary/50'}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${ragStatus ? '' : 'text-foreground'}`}>
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
    <div className="p-4 rounded-lg bg-secondary/50">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1 rounded ${colors[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
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
            : 'bg-secondary/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Calendar className={`w-4 h-4 ${isOverdue ? 'text-red-500' : isDueSoon ? 'text-amber-500' : 'text-muted-foreground'}`} />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      {dueDate ? (
        <>
          <p className={`text-lg font-semibold ${isOverdue ? 'text-red-600' : isDueSoon ? 'text-amber-600' : 'text-foreground'}`}>
            {formatDisplayDate(dueDate)}
          </p>
          {frequency && (
            <p className="text-xs text-muted-foreground capitalize">{frequency}</p>
          )}
        </>
      ) : (
        <p className="text-lg text-gray-400">Not set</p>
      )}
    </div>
  );
}

function AuditRow({ audit }: { audit: HSProjectAudit }) {
  const statusConfig = AUDIT_STATUS_CONFIG[audit.status] || AUDIT_STATUS_CONFIG['in_progress'];
  const ragColors = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <a
      href={`/health-safety/audits/${audit.id}`}
      className="flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className={`p-2 rounded-lg ${audit.rag_status ? ragColors[audit.rag_status] : 'bg-secondary'}`}>
          <BarChart3 className="w-5 h-5" />
        </div>
        <div>
          <p className="font-medium text-foreground">
            {audit.audit_type.charAt(0).toUpperCase() + audit.audit_type.slice(1)} Audit
          </p>
          <p className="text-sm text-muted-foreground">
            {formatDisplayDate(audit.audit_date)}
            {audit.auditor?.full_name && ` • ${audit.auditor.full_name}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {audit.overall_score !== null && (
          <span className={`text-lg font-semibold ${audit.rag_status ? ragColors[audit.rag_status]?.split(' ')[1] : 'text-muted-foreground'}`}>
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
    <div className="bg-card rounded-lg border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <span className="font-medium text-foreground">Configuration Details</span>
        <ChevronRight
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Audit Frequency</p>
              <p className="font-medium text-foreground capitalize">
                {config.audit_frequency}
                {config.audit_frequency === 'custom' && config.custom_frequency_days && (
                  <span> ({config.custom_frequency_days} days)</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Min Score Threshold</p>
              <p className="font-medium text-foreground">{config.min_score_threshold}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Daily Briefing</p>
              <p className="font-medium text-foreground">
                {config.requires_daily_briefing ? 'Required' : 'Not Required'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Active Permits</p>
              <p className="font-medium text-foreground">
                {activePermits.length > 0
                  ? activePermits.map((p) => p.label).join(', ')
                  : 'None'}
              </p>
            </div>
          </div>

          {config.notes && (
            <div>
              <p className="text-muted-foreground text-sm">Notes</p>
              <p className="text-sm text-foreground">{config.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ProjectHSTab;
