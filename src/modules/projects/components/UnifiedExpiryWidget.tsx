/**
 * Unified Expiry Widget (PRD-058)
 * Shows all expiring documents from various sources in a unified view
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Clock,
  Calendar,
  RefreshCw,
  ChevronRight,
  XCircle,
  Bell,
  CheckCircle,
  FileText,
  Building2,
  User,
  FolderKanban,
  FileCheck,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type ExpiryUrgency = 'expired' | 'critical' | 'warning' | 'upcoming' | 'ok';
type DocumentSource = 'pipeline_approval' | 'contractor_document' | 'agreement' | 'project_requirement' | 'staff_document';

interface ExpiringDocument {
  id: string;
  source: DocumentSource;
  document_type: string;
  document_name: string;
  expiry_date: string;
  days_until_expiry: number;
  urgency: ExpiryUrgency;
  project_id?: string;
  project_name?: string;
  contractor_id?: string;
  contractor_name?: string;
  staff_id?: string;
  staff_name?: string;
}

interface ExpiryStats {
  total: number;
  expired: number;
  critical: number;
  warning: number;
  upcoming: number;
}

interface UnifiedExpiryWidgetProps {
  projectId?: string;
  compact?: boolean;
  className?: string;
}

const URGENCY_CONFIG: Record<ExpiryUrgency, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  expired: {
    label: 'Expired',
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="w-4 h-4" />,
  },
  critical: {
    label: 'Critical (< 7 days)',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  warning: {
    label: 'Warning (< 30 days)',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: <Clock className="w-4 h-4" />,
  },
  upcoming: {
    label: 'Upcoming (< 90 days)',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    icon: <Calendar className="w-4 h-4" />,
  },
  ok: {
    label: 'OK',
    color: 'text-green-600',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    icon: <CheckCircle className="w-4 h-4" />,
  },
};

const SOURCE_CONFIG: Record<DocumentSource, { label: string; icon: React.ReactNode; href: (doc: ExpiringDocument) => string }> = {
  pipeline_approval: {
    label: 'Pipeline Approval',
    icon: <FolderKanban className="w-4 h-4" />,
    href: (doc) => `/pipeline/${doc.project_id}`,
  },
  contractor_document: {
    label: 'Contractor Document',
    icon: <Building2 className="w-4 h-4" />,
    href: (doc) => `/suppliers/${doc.contractor_id}`,
  },
  agreement: {
    label: 'Agreement',
    icon: <FileCheck className="w-4 h-4" />,
    href: (doc) => `/projects/${doc.project_id}?tab=agreements`,
  },
  project_requirement: {
    label: 'Project Requirement',
    icon: <FileText className="w-4 h-4" />,
    href: (doc) => `/projects/${doc.project_id}`,
  },
  staff_document: {
    label: 'Staff Document',
    icon: <User className="w-4 h-4" />,
    href: (doc) => `/staff/${doc.staff_id}`,
  },
};

function formatDate(date: string | null | undefined): string {
  if (!date) return '-';
  const parts = new Date(date).toISOString().split('T');
  return parts[0] || '-';
}

export function UnifiedExpiryWidget({ projectId, compact = false, className = '' }: UnifiedExpiryWidgetProps) {
  const [data, setData] = useState<{
    stats: ExpiryStats;
    by_urgency: Record<ExpiryUrgency, ExpiringDocument[]>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: '90' });
      if (projectId) params.set('project_id', projectId);

      const response = await fetch(`/api/projects/expiring-documents?${params}`);
      if (!response.ok) throw new Error('Failed to fetch expiring documents');

      const result = await response.json();
      if (result.success) {
        setData({
          stats: result.data.stats,
          by_urgency: result.data.by_urgency,
        });
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const criticalCount = (data?.stats.expired || 0) + (data?.stats.critical || 0);

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 ${className}`}>
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={fetchData}
          className="mt-2 text-sm text-red-600 hover:text-red-800 flex items-center gap-1"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  if (!data || data.stats.total === 0) {
    return (
      <div className={`bg-[var(--ff-bg-secondary)] rounded-lg p-6 text-center ${className}`}>
        <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
        <p className="text-[var(--ff-text-secondary)]">No documents expiring in the next 90 days</p>
      </div>
    );
  }

  // Compact mode - for dashboard widget
  if (compact) {
    return (
      <div className={`space-y-4 ${className}`}>
        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-red-600">{data.stats.expired}</p>
            <p className="text-xs text-red-600">Expired</p>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-orange-600">{data.stats.critical}</p>
            <p className="text-xs text-orange-600">Critical (&lt;7 days)</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-amber-600">{data.stats.warning}</p>
            <p className="text-xs text-amber-600">Warning (&lt;30 days)</p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-blue-600">{data.stats.upcoming}</p>
            <p className="text-xs text-blue-600">Upcoming (&lt;90 days)</p>
          </div>
        </div>

        {/* Critical Items Preview */}
        {criticalCount > 0 && (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4 text-red-500" />
              Requires Immediate Attention
            </h4>
            <div className="space-y-2">
              {[
                ...(data.by_urgency.expired || []).slice(0, 3),
                ...(data.by_urgency.critical || []).slice(0, 3),
              ].slice(0, 5).map((doc) => (
                <Link
                  key={`${doc.source}-${doc.id}`}
                  href={SOURCE_CONFIG[doc.source].href(doc)}
                  className="flex items-center justify-between p-2 bg-[var(--ff-bg-primary)] rounded hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={URGENCY_CONFIG[doc.urgency].color}>
                      {SOURCE_CONFIG[doc.source].icon}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                        {doc.document_type}
                      </p>
                      <p className="text-xs text-[var(--ff-text-secondary)] truncate">
                        {doc.project_name || doc.contractor_name || doc.staff_name}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded flex-shrink-0 ml-2 ${URGENCY_CONFIG[doc.urgency].bgColor} ${URGENCY_CONFIG[doc.urgency].color}`}>
                    {doc.days_until_expiry < 0
                      ? `${Math.abs(doc.days_until_expiry)}d overdue`
                      : `${doc.days_until_expiry}d left`}
                  </span>
                </Link>
              ))}
              {criticalCount > 5 && (
                <Link
                  href="/projects?tab=expiring"
                  className="block text-center text-sm text-[var(--ff-accent)] hover:underline py-2"
                >
                  View all {criticalCount} critical items →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full view
  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            Document Expiry Tracking
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            All documents expiring within 90 days
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 hover:bg-[var(--ff-bg-secondary)] rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-5 h-5 text-red-500" />
            <span className="text-sm font-medium text-red-600">Expired</span>
          </div>
          <p className="text-3xl font-bold text-red-600">{data.stats.expired}</p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <span className="text-sm font-medium text-orange-600">Critical</span>
          </div>
          <p className="text-3xl font-bold text-orange-600">{data.stats.critical}</p>
          <p className="text-xs text-orange-500 mt-1">Expiring in 7 days</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-amber-500" />
            <span className="text-sm font-medium text-amber-600">Warning</span>
          </div>
          <p className="text-3xl font-bold text-amber-600">{data.stats.warning}</p>
          <p className="text-xs text-amber-500 mt-1">Expiring in 30 days</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            <span className="text-sm font-medium text-blue-600">Upcoming</span>
          </div>
          <p className="text-3xl font-bold text-blue-600">{data.stats.upcoming}</p>
          <p className="text-xs text-blue-500 mt-1">Expiring in 90 days</p>
        </div>
      </div>

      {/* Documents by Urgency */}
      <div className="bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <h3 className="font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Expiring Documents
          </h3>
        </div>
        <div className="divide-y divide-[var(--ff-border-light)]">
          {(['expired', 'critical', 'warning', 'upcoming'] as ExpiryUrgency[]).map((urgency) => {
            const items = data.by_urgency[urgency];
            if (!items || items.length === 0) return null;
            const config = URGENCY_CONFIG[urgency];

            return (
              <div key={urgency} className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={config.color}>{config.icon}</span>
                  <span className={`text-sm font-medium ${config.color}`}>
                    {config.label} ({items.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((doc) => (
                    <Link
                      key={`${doc.source}-${doc.id}`}
                      href={SOURCE_CONFIG[doc.source].href(doc)}
                      className="flex items-center justify-between p-3 bg-[var(--ff-bg-secondary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors group"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-[var(--ff-text-secondary)]">
                          {SOURCE_CONFIG[doc.source].icon}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                            {doc.document_type}
                          </p>
                          <p className="text-xs text-[var(--ff-text-secondary)] truncate">
                            {doc.project_name || doc.contractor_name || doc.staff_name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-xs text-[var(--ff-text-secondary)]">Expires</p>
                          <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                            {formatDate(doc.expiry_date)}
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${config.bgColor} ${config.color}`}>
                          {doc.days_until_expiry < 0
                            ? `${Math.abs(doc.days_until_expiry)}d overdue`
                            : `${doc.days_until_expiry}d`}
                        </span>
                        <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default UnifiedExpiryWidget;
