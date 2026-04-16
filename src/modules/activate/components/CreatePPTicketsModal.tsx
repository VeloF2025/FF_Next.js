'use client';

import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { TeamSelector } from '@/modules/noc/components/Assignment/TeamSelector';
import { Button } from '@/components/ui/button';
import { groupRecordsByProject, resolveTeamForProject } from '@/modules/activate/services/ticketBatchService';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

interface PPRecord { id: number; project: string; }

export interface PPTicketBatch {
  project: string;
  pp_data_ids: number[];
  assigned_team_id?: string;
  team_name?: string;
  has_team: boolean;
}

interface CreatePPTicketsModalProps {
  selectedRecords: PPRecord[];
  onConfirm: (params: {
    ticket_type: string;
    ticket_category: string;
    priority: string;
    notes: string;
    batches: PPTicketBatch[];
  }) => void;
  onClose: () => void;
  loading: boolean;
}

const TICKET_CATEGORIES = [
  { value: 'pre_provision', label: 'Pre-Provision' },
  { value: 'fault_repair', label: 'Fault Repair' },
  { value: 'modification', label: 'Modification' },
  { value: 'ont_swap', label: 'ONT Swap' },
  { value: 'new_installation', label: 'New Installation' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export function CreatePPTicketsModal({
  selectedRecords,
  onConfirm,
  onClose,
  loading,
}: CreatePPTicketsModalProps) {
  const [ticketCategory, setTicketCategory] = useState('pre_provision');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [assignments, setAssignments] = useState<ProjectTeamAssignment[]>([]);
  const [batches, setBatches] = useState<PPTicketBatch[]>([]);

  // Load project-team assignments once
  useEffect(() => {
    fetch('/api/noc/teams?dropdown=true')
      .then(r => r.json())
      .then(d => {
        const teams = d.data ?? [];
        const allAssignments: ProjectTeamAssignment[] = teams.flatMap(
          (t: { project_assignments?: ProjectTeamAssignment[] }) => t.project_assignments ?? []
        );
        setAssignments(allAssignments);
      })
      .catch(() => {});
  }, []);

  // Recompute batches when records or assignments change
  useEffect(() => {
    const groups = groupRecordsByProject(selectedRecords);
    const newBatches: PPTicketBatch[] = [];
    for (const [project, ids] of groups) {
      const resolved = resolveTeamForProject(project, assignments);
      newBatches.push({
        project,
        pp_data_ids: ids,
        assigned_team_id: resolved?.team_id,
        team_name: resolved?.team_name,
        has_team: !!resolved,
      });
    }
    setBatches(newBatches);
  }, [selectedRecords, assignments]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'No information on 1Map') {
      setPriority('normal');
    } else {
      setPriority('high');
    }
  };

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
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Create NOC Tickets</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <p className="text-sm text-[var(--ff-text-secondary)]">
          Creating tickets for <strong>{totalCount}</strong> selected PP record{totalCount !== 1 ? 's' : ''}.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Ticket Type</label>
            <select
              value={ticketCategory}
              onChange={(e) => setTicketCategory(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
            >
              {TICKET_CATEGORIES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
            >
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Notes <span className="text-[var(--ff-text-tertiary)]">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Additional notes for the tickets..."
              rows={3}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm resize-none"
            />
          </div>

          {/* Batch summary */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              {isMixed ? `${batches.length} batches will be created` : 'Assign Team'}
            </label>
            <div className="space-y-2">
              {batches.map((batch) => (
                <div key={batch.project} className="rounded border border-[var(--ff-border-light)] p-3 bg-[var(--ff-bg-secondary)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {batch.project} — {batch.pp_data_ids.length} ticket{batch.pp_data_ids.length !== 1 ? 's' : ''}
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
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onConfirm({
              ticket_type: 'activations',
              ticket_category: ticketCategory,
              priority,
              notes,
              batches,
            })}
            disabled={loading}
            loading={loading}
          >
            {loading ? 'Creating...' : `Create ${totalCount} Ticket${totalCount !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
