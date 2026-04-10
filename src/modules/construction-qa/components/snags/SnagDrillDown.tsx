/**
 * SnagDrillDown — Inline accordion showing individual snags for a project + status.
 * Renders below the project row in the summary table when a count cell is clicked.
 * Groups snags by Zone → PON, with workflow action buttons on each snag row.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, ExternalLink } from 'lucide-react';
import { fetchSnagsByStatus, type SnagByStatusRow } from '../../services/snagService';
import { updateSnag } from '../../services/snagService';
import type { SnagStatus } from '../../types/snag.types';
import { log } from '@/lib/logger';
import { COL_COUNT } from './SnagSummaryHelpers';

interface SnagDrillDownProps {
  projectId: string;
  status: string;
  onSnagUpdated?: () => void;
}

interface ZoneGroup {
  zoneNo: number | null;
  label: string;
  pons: PonGroup[];
  count: number;
}

interface PonGroup {
  ponNo: number | null;
  label: string;
  snags: SnagByStatusRow[];
}

const WORKFLOW_ACTIONS: Record<string, {
  forward?: { status: SnagStatus; label: string };
  backward?: { status: SnagStatus; label: string };
  reject?: { status: SnagStatus; label: string };
}> = {
  open:        { forward: { status: 'assigned',    label: 'Assign' } },
  assigned:    { forward: { status: 'in_progress', label: 'Start Work' },        backward: { status: 'open',        label: 'Unassign' }, reject: { status: 'wont_fix', label: 'Not Resolvable' } },
  in_progress: { forward: { status: 'pending_qa',  label: 'Mark as Fixed' },     backward: { status: 'assigned',    label: 'Back to Assigned' }, reject: { status: 'wont_fix', label: 'Not Resolvable' } },
  pending_qa:  { forward: { status: 'resolved',    label: 'Approve QA' },        backward: { status: 'in_progress', label: 'Reject QA' } },
  fixed:       { forward: { status: 'resolved',    label: 'Approve QA' },        backward: { status: 'in_progress', label: 'Reject QA' } },
  resolved:    { forward: { status: 'verified',    label: 'Customer Confirmed' },backward: { status: 'in_progress', label: 'Customer Unhappy' } },
  verified:    { forward: { status: 'closed',      label: 'Close' },             backward: { status: 'in_progress', label: 'Reopen' } },
  closed:      {                                                                   backward: { status: 'open',        label: 'Reopen' } },
  wont_fix:    { forward: { status: 'closed',      label: 'Approve Rejection' }, backward: { status: 'in_progress', label: 'Send Back' } },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-900/60 text-red-300',
  major:    'bg-orange-900/60 text-orange-300',
  minor:    'bg-zinc-700 text-zinc-400',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In Progress',
  pending_qa: 'Pending QA', fixed: 'Pending QA', resolved: 'Resolved',
  verified: 'Verified', closed: 'Closed',
};

function groupByZonePon(snags: SnagByStatusRow[]): ZoneGroup[] {
  const zoneMap = new Map<string, { zoneNo: number | null; pons: Map<string, { ponNo: number | null; snags: SnagByStatusRow[] }> }>();
  for (const snag of snags) {
    const zKey = String(snag.zone_no ?? 'null');
    const pKey = String(snag.pon_no ?? 'null');
    if (!zoneMap.has(zKey)) zoneMap.set(zKey, { zoneNo: snag.zone_no, pons: new Map() });
    const zone = zoneMap.get(zKey)!;
    if (!zone.pons.has(pKey)) zone.pons.set(pKey, { ponNo: snag.pon_no, snags: [] });
    zone.pons.get(pKey)!.snags.push(snag);
  }
  return [...zoneMap.entries()]
    .sort(([, a], [, b]) => {
      if (a.zoneNo === null) return 1;
      if (b.zoneNo === null) return -1;
      return (a.zoneNo ?? 0) - (b.zoneNo ?? 0);
    })
    .map(([, z]) => {
      const pons: PonGroup[] = [...z.pons.values()]
        .sort((a, b) => {
          if (a.ponNo === null) return 1;
          if (b.ponNo === null) return -1;
          return (a.ponNo ?? 0) - (b.ponNo ?? 0);
        })
        .map((p) => ({ ponNo: p.ponNo, label: p.ponNo !== null ? `PON ${p.ponNo}` : 'Unassigned', snags: p.snags }));
      return { zoneNo: z.zoneNo, label: z.zoneNo !== null ? `Zone ${z.zoneNo}` : 'Unassigned', pons, count: pons.reduce((a, p) => a + p.snags.length, 0) };
    });
}

export function SnagDrillDown({ projectId, status, onSnagUpdated }: SnagDrillDownProps) {
  const [zones, setZones] = useState<ZoneGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [savingSnag, setSavingSnag] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchSnagsByStatus(projectId, status)
      .then((rows: SnagByStatusRow[]) => {
        setZones(groupByZonePon(rows));
        if (rows.length <= 30) {
          setExpandedZones(new Set(rows.map((r) => String(r.zone_no ?? 'null'))));
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load snags');
        setLoading(false);
      });
  }, [projectId, status]);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleZone = (key: string) => {
    setExpandedZones((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  const handleStatusChange = async (snagId: string, newStatus: SnagStatus) => {
    setSavingSnag(snagId);
    try {
      await updateSnag(snagId, { status: newStatus });
      onSnagUpdated?.();
      loadData();
    } catch (err) {
      log.error('Failed to update snag from drill-down', { err, snagId, newStatus });
    } finally {
      setSavingSnag(null);
    }
  };

  if (loading) {
    return (
      <tr><td colSpan={COL_COUNT} className="px-6 py-4">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <div className="h-3 w-3 border-2 border-zinc-500 border-t-zinc-300 rounded-full animate-spin" />
          Loading {STATUS_LABEL[status] ?? status} snags...
        </div>
      </td></tr>
    );
  }

  if (error) {
    return <tr><td colSpan={COL_COUNT} className="px-6 py-3 text-xs text-red-400">{error}</td></tr>;
  }

  if (zones.length === 0) {
    return <tr><td colSpan={COL_COUNT} className="px-6 py-3 text-xs text-zinc-500">No snags in {STATUS_LABEL[status] ?? status} status</td></tr>;
  }

  const rows: React.ReactNode[] = [];

  for (const zone of zones) {
    const zKey = String(zone.zoneNo ?? 'null');
    const isOpen = expandedZones.has(zKey);

    rows.push(
      <tr key={`dz-${zKey}`} className="bg-zinc-800/40">
        <td colSpan={COL_COUNT} className="px-4 py-1.5">
          <button type="button" onClick={() => toggleZone(zKey)} className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-zinc-100">
            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span className="font-medium">{zone.label}</span>
            <span className="text-zinc-500 ml-1">({zone.count})</span>
          </button>
        </td>
      </tr>
    );

    if (!isOpen) continue;

    for (const pon of zone.pons) {
      rows.push(
        <tr key={`dp-${zKey}-${pon.ponNo ?? 'null'}`} className="bg-zinc-800/20">
          <td colSpan={COL_COUNT} className="px-8 py-1">
            <span className="text-xs text-zinc-400 font-medium">{pon.label}</span>
            <span className="text-zinc-600 text-xs ml-1">({pon.snags.length})</span>
          </td>
        </tr>
      );

      for (const snag of pon.snags) {
        const actions = WORKFLOW_ACTIONS[snag.status];
        const isSaving = savingSnag === snag.id;

        rows.push(
          <tr key={`ds-${snag.id}`} className="hover:bg-zinc-800/30 transition-colors border-t border-zinc-800/50">
            <td colSpan={COL_COUNT} className="px-10 py-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <AlertTriangle className="w-3 h-3 text-orange-400 flex-shrink-0" />
                  <span className="text-xs font-mono text-zinc-400 flex-shrink-0">#{snag.snag_number}</span>
                  <span className="text-xs text-zinc-200 truncate">{snag.description}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${SEVERITY_BADGE[snag.severity] ?? SEVERITY_BADGE.minor}`}>{snag.severity}</span>
                  {snag.assigned_to_name && <span className="text-[10px] text-zinc-500 flex-shrink-0">→ {snag.assigned_to_name}</span>}
                  {snag.noc_ticket_uid && (
                    <a href={`/noc/tickets/${snag.noc_ticket_id}`} className="flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-300 flex-shrink-0" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-2.5 h-2.5" />{snag.noc_ticket_uid}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {actions?.backward && (
                    <button type="button" onClick={() => { void handleStatusChange(snag.id, actions.backward!.status); }} disabled={isSaving}
                      className="text-[10px] bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 px-2 py-1 rounded transition-colors">
                      ← {actions.backward.label}
                    </button>
                  )}
                  {actions?.forward && (
                    <button type="button" onClick={() => { void handleStatusChange(snag.id, actions.forward!.status); }} disabled={isSaving}
                      className="text-[10px] bg-green-800 hover:bg-green-700 disabled:opacity-50 text-green-100 px-2 py-1 rounded font-medium transition-colors">
                      {actions.forward.label} →
                    </button>
                  )}
                  {actions?.reject && (
                    <button type="button" onClick={() => { void handleStatusChange(snag.id, actions.reject!.status); }} disabled={isSaving}
                      className="text-[10px] bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 px-2 py-1 rounded transition-colors">
                      {actions.reject.label}
                    </button>
                  )}
                </div>
              </div>
            </td>
          </tr>
        );
      }
    }
  }

  return <>{rows}</>;
}
