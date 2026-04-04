/**
 * EntityAuditPanel — Reusable vertical timeline showing audit history for a specific entity.
 * Accepts entityType + entityId props, renders a compact timeline.
 */

import { useState, useEffect } from 'react';
import {
  Plus, Edit, Trash2, CheckCircle, XCircle, Shield, RotateCcw,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuditLogs } from '../hooks/useAuditLogs';
import type { AuditLogListItem, AuditEntityTypeValue, AuditActionValue } from '@/types/procurement/audit.types';
import { formatDisplayDateShort } from '@/utils/dateFormat';

interface EntityAuditPanelProps {
  entityType: AuditEntityTypeValue;
  entityId: string;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  create: <Plus className="h-3.5 w-3.5 text-green-600" />,
  update: <Edit className="h-3.5 w-3.5 text-blue-600" />,
  delete: <Trash2 className="h-3.5 w-3.5 text-gray-600" />,
  approve: <CheckCircle className="h-3.5 w-3.5 text-green-600" />,
  reject: <XCircle className="h-3.5 w-3.5 text-red-600" />,
  override: <Shield className="h-3.5 w-3.5 text-orange-600" />,
  reverse: <RotateCcw className="h-3.5 w-3.5 text-red-600" />,
};

const ACTION_LINE_COLORS: Record<string, string> = {
  create: 'border-green-400',
  update: 'border-blue-400',
  approve: 'border-green-400',
  reject: 'border-red-400',
  override: 'border-orange-400',
  reverse: 'border-red-400',
  delete: 'border-gray-400',
};

function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDisplayDateShort(d);
}

export function EntityAuditPanel({ entityType, entityId }: EntityAuditPanelProps) {
  const { fetchEntityHistory } = useAuditLogs();
  const [history, setHistory] = useState<AuditLogListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEntityHistory(entityType, entityId).then((items) => {
      if (!cancelled) {
        setHistory(items);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [entityType, entityId, fetchEntityHistory]);

  if (loading) {
    return <LoadingSpinner className="h-24" size="sm" label="" />;
  }

  if (history.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">
        No audit history yet
      </p>
    );
  }

  return (
    <div className="space-y-0">
      <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
        Audit History
      </h3>
      <div className="relative pl-6">
        {/* Timeline line */}
        <div className="absolute left-2.5 top-0 h-full w-px bg-gray-200 dark:bg-gray-700" />

        {history.map((entry, idx) => (
          <div key={entry.id} className="relative mb-4 last:mb-0">
            {/* Timeline dot */}
            <div className={`absolute -left-3.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-white dark:bg-gray-900 ${ACTION_LINE_COLORS[entry.action] ?? 'border-gray-400'}`}>
              {ACTION_ICONS[entry.action] ?? <Edit className="h-3.5 w-3.5 text-gray-500" />}
            </div>

            {/* Content */}
            <div className="ml-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium capitalize text-gray-800 dark:text-gray-200">
                  {entry.action}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {formatRelativeTime(entry.performedAt)}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {entry.performedByName ?? 'System'}
                {entry.changedFields && entry.changedFields.length > 0 && (
                  <> &middot; {entry.changedFields.join(', ')}</>
                )}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
