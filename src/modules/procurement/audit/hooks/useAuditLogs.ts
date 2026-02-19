/**
 * useAuditLogs Hook
 * Fetches paginated, filterable audit logs for procurement entities
 */

import { useState, useCallback, useEffect } from 'react';
import { log } from '@/lib/logger';
import type {
  AuditLogListItem,
  AuditLog,
  AuditLogFilter,
  AuditEntityTypeValue,
  AuditActionValue,
} from '@/types/procurement/audit.types';

interface UseAuditLogsReturn {
  logs: AuditLogListItem[];
  total: number;
  page: number;
  loading: boolean;
  error: string | null;
  fetchLogs: (filter?: AuditLogFilter, page?: number) => Promise<void>;
  fetchEntityHistory: (entityType: AuditEntityTypeValue, entityId: string) => Promise<AuditLogListItem[]>;
}

export function useAuditLogs(initialFilter?: AuditLogFilter): UseAuditLogsReturn {
  const [logs, setLogs] = useState<AuditLogListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async (filter?: AuditLogFilter, pageNum = 1) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('limit', '50');

      if (filter?.entityType) params.set('entity_type', filter.entityType);
      if (filter?.entityId) params.set('entity_id', filter.entityId);
      if (filter?.action) params.set('action', filter.action);
      if (filter?.performedBy) params.set('performed_by', filter.performedBy);
      if (filter?.projectId) params.set('project_id', filter.projectId);

      const response = await fetch(`/api/procurement/audit-logs/?${params.toString()}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch audit logs');
      }

      setLogs(result.data?.items ?? result.data ?? []);
      setTotal(result.pagination?.total ?? 0);
      setPage(pageNum);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch audit logs';
      setError(message);
      log.error('Failed to fetch audit logs', { data: err }, 'useAuditLogs');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEntityHistory = useCallback(async (
    entityType: AuditEntityTypeValue,
    entityId: string,
  ): Promise<AuditLogListItem[]> => {
    try {
      const params = new URLSearchParams({
        entity_type: entityType,
        entity_id: entityId,
        limit: '100',
      });

      const response = await fetch(`/api/procurement/audit-logs/?${params.toString()}`);
      const result = await response.json();

      if (!result.success) return [];
      return result.data?.items ?? result.data ?? [];
    } catch (err) {
      log.error('Failed to fetch entity history', { data: err }, 'useAuditLogs');
      return [];
    }
  }, []);

  useEffect(() => {
    fetchLogs(initialFilter);
  }, [fetchLogs, initialFilter]);

  return { logs, total, page, loading, error, fetchLogs, fetchEntityHistory };
}
