/**
 * SP Tracker Sandbox Component
 * Main container for displaying SharePoint tracker data
 */

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { log } from '@/lib/logger';
import { SummaryCard } from './SummaryCard';
import { BlockageSection } from './BlockageSection';
import { PonTable } from './PonTable';

interface SpProjectSummary {
  id: string;
  project_id: string;
  permissions_scope: number | null;
  permissions_complete: number | null;
  pct_permissions: number | null;
  poles_scope: number | null;
  poles_complete: number | null;
  pct_poles: number | null;
  signups_scope: number | null;
  signups_complete: number | null;
  pct_signups: number | null;
  cwc_scope: number | null;
  cwc_complete: number | null;
  pct_cwc: number | null;
  optical_scope: number | null;
  optical_complete: number | null;
  pct_optical: number | null;
  connected_scope: number | null;
  connected_complete: number | null;
  pct_connected: number | null;
  synced_at: string | null;
}

interface SpPonTracker {
  id: string;
  zone_no: number;
  hld_pon: number;
  poles_planted: number | null;
  sign_ups: number | null;
  cwc_poles_date: string | null;
  optical_activated_date: string | null;
  activated: number | null;
  available: number | null;
  pct_original: number | null;
  pct_recon: number | null;
  blockage: string | null;
  synced_at: string;
}

interface SpTrackerData {
  summary: SpProjectSummary | null;
  pons: SpPonTracker[];
  lastSyncedAt: string | null;
  totalPons: number;
  blockedPons: number;
}

interface SpTrackerSandboxProps {
  projectId: string;
}

export default function SpTrackerSandbox({ projectId }: SpTrackerSandboxProps): ReactNode {
  const [data, setData] = useState<SpTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedZones, setExpandedZones] = useState<Set<number>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}/sp-tracker`);
      if (!res.ok) throw new Error('Failed to fetch SP tracker data');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch (err) {
      log.error('Failed to fetch SP tracker', { err, projectId }, 'SpTrackerSandbox');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSyncNow = useCallback(async () => {
    try {
      setSyncing(true);
      const res = await fetch('/api/sharepoint/sync-trackers', { method: 'POST' });
      if (!res.ok) throw new Error('Sync failed');
      await fetchData();
    } catch (err) {
      log.error('Sync error', { err }, 'SpTrackerSandbox');
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  const toggleZone = useCallback((zone: number) => {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zone)) {
        next.delete(zone);
      } else {
        next.add(zone);
      }
      return next;
    });
  }, []);

  if (loading) {
    return <div className="p-4 text-gray-600 dark:text-gray-400">Loading tracker data...</div>;
  }

  if (!data) {
    return <div className="p-4 text-red-600 dark:text-red-400">Failed to load tracker data</div>;
  }

  const summary = data.summary;

  return (
    <div className="space-y-6 p-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Permissions"
          scope={summary?.permissions_scope}
          complete={summary?.permissions_complete}
          pct={summary?.pct_permissions}
        />
        <SummaryCard
          label="Poles Planted"
          scope={summary?.poles_scope}
          complete={summary?.poles_complete}
          pct={summary?.pct_poles}
        />
        <SummaryCard
          label="Sign-ups"
          scope={summary?.signups_scope}
          complete={summary?.signups_complete}
          pct={summary?.pct_signups}
        />
        <SummaryCard
          label="CWC Complete"
          scope={summary?.cwc_scope}
          complete={summary?.cwc_complete}
          pct={summary?.pct_cwc}
        />
        <SummaryCard
          label="Optical Live"
          scope={summary?.optical_scope}
          complete={summary?.optical_complete}
          pct={summary?.pct_optical}
        />
        <SummaryCard
          label="Connected"
          scope={summary?.connected_scope}
          complete={summary?.connected_complete}
          pct={summary?.pct_connected}
        />
      </div>

      {/* Blockage Summary */}
      <BlockageSection pons={data.pons} />

      {/* PON Table */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
        <PonTable
          pons={data.pons}
          expandedZones={expandedZones}
          onToggleZone={toggleZone}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
        <span className="text-xs text-gray-600 dark:text-gray-400">
          Last synced: {data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString() : 'Never'}
        </span>
        <button
          type="button"
          onClick={handleSyncNow}
          disabled={syncing}
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>
    </div>
  );
}
