'use client';

import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { TeamSelector } from '@/modules/noc/components/Assignment/TeamSelector';
import { groupRecordsByProject, resolveTeamForProject } from '@/modules/activate/services/ticketBatchService';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

interface OltRecord { id: string; project?: string | null; }

export interface OltTicketBatch {
  project: string;
  record_ids: string[];
  assigned_team_id?: string;
  team_name?: string;
  has_team: boolean;
}

interface CreateOltTicketsModalProps {
  selectedRecords: OltRecord[];
  onConfirm: (params: { ticket_type: string; priority: string; notes: string; batches: OltTicketBatch[] }) => void;
  onClose: () => void;
  loading: boolean;
}

const TICKET_TYPES = [
  { value: 'olt_investigation', label: 'ONT not found' },
  { value: 'serial_mismatch', label: 'Serial Mismatch' },
  { value: 'fault_repair', label: 'Fault Repair' },
  { value: 'ont_swap', label: 'ONT Swap' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export function CreateOltTicketsModal({ selectedRecords, onConfirm, onClose, loading }: CreateOltTicketsModalProps) {
  const [ticketType, setTicketType] = useState('olt_investigation');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [assignments, setAssignments] = useState<ProjectTeamAssignment[]>([]);
  const [batches, setBatches] = useState<OltTicketBatch[]>([]);

  useEffect(() => {
    fetch('/api/noc/teams?dropdown=true')
      .then(r => r.json())
      .then(d => {
        const allAssignments: ProjectTeamAssignment[] = (d.data ?? []).flatMap(
          (t: { project_assignments?: ProjectTeamAssignment[] }) => t.project_assignments ?? []
        );
        setAssignments(allAssignments);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const groups = groupRecordsByProject(
      selectedRecords.map(r => ({ id: r.id, project: r.project }))
    );
    const newBatches: OltTicketBatch[] = [];
    for (const [project, ids] of groups) {
      const resolved = resolveTeamForProject(project, assignments);
      newBatches.push({ project, record_ids: ids, assigned_team_id: resolved?.team_id, team_name: resolved?.team_name, has_team: !!resolved });
    }
    setBatches(newBatches);
  }, [selectedRecords, assignments]);

  const handleTeamOverride = (project: string, teamId: string | null) => {
    setBatches(prev => prev.map(b =>
      b.project === project ? { ...b, assigned_team_id: teamId ?? undefined } : b
    ));
  };

  const totalCount = selectedRecords.length;
  const isMixed = batches.length > 1;
  const missingTeams = batches.filter(b => !b.assigned_team_id);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Create Investigation Tickets</h3>
          <button onClick={onClose} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Creating tickets for <strong>{totalCount}</strong> OLT mismatch record{totalCount !== 1 ? 's' : ''}.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Ticket Type</label>
            <select value={ticketType} onChange={(e) => setTicketType(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm">
              {TICKET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm">
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Notes <span className="text-[var(--ff-text-tertiary)]">(optional)</span>
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes for the investigation tickets..."
              rows={3}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              {isMixed ? `${batches.length} batches will be created` : 'Assign Team'}
            </label>
            <div className="space-y-2">
              {batches.map((batch) => (
                <div key={batch.project} className="rounded border border-[var(--ff-border-light)] p-3 bg-[var(--ff-bg-secondary)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {batch.project} — {batch.record_ids.length} ticket{batch.record_ids.length !== 1 ? 's' : ''}
                    </span>
                    {!batch.has_team && (
                      <span className="text-xs text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> no team configured
                      </span>
                    )}
                  </div>
                  <TeamSelector
                    value={batch.assigned_team_id ?? null}
                    onChange={(teamId) => handleTeamOverride(batch.project, teamId)}
                    placeholder={batch.team_name ?? 'Select team...'}
                    compact
                  />
                </div>
              ))}
            </div>
            {missingTeams.length > 0 && (
              <p className="text-xs text-amber-400 mt-1">
                {missingTeams.length} project{missingTeams.length !== 1 ? 's' : ''} will be created without a team assignment.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm rounded border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ ticket_type: ticketType, priority, notes, batches })}
            disabled={loading}
            className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
            {loading ? <><InlineSpinner size="sm" /> Creating...</> : `Create ${totalCount} Ticket${totalCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
