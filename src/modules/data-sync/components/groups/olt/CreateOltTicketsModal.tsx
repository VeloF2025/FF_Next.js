'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { TeamSelector } from '@/modules/noc/components/Assignment/TeamSelector';

interface CreateOltTicketsModalProps {
  selectedCount: number;
  onConfirm: (params: { ticket_type: string; priority: string; notes: string; assigned_team_id?: string }) => void;
  onClose: () => void;
  loading: boolean;
}

const TICKET_TYPES = [
  { value: 'olt_investigation', label: 'OLT Investigation' },
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

export function CreateOltTicketsModal({
  selectedCount,
  onConfirm,
  onClose,
  loading,
}: CreateOltTicketsModalProps) {
  const [ticketType, setTicketType] = useState('olt_investigation');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [assignedTeamId, setAssignedTeamId] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Create Investigation Tickets
          </h3>
          <button onClick={onClose} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-[var(--ff-text-secondary)]">
          Creating tickets for <strong>{selectedCount}</strong> OLT mismatch record{selectedCount !== 1 ? 's' : ''}.
          These DRs have serial mismatches between the OLT report and 1Map that need investigation.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Ticket Type
            </label>
            <select
              value={ticketType}
              onChange={(e) => setTicketType(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                         text-[var(--ff-text-primary)] text-sm"
            >
              {TICKET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                         text-[var(--ff-text-primary)] text-sm"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Notes <span className="text-[var(--ff-text-tertiary)]">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes for the investigation tickets..."
              rows={3}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                         text-[var(--ff-text-primary)] text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Assign Team <span className="text-[var(--ff-text-tertiary)]">(optional)</span>
            </label>
            <TeamSelector
              value={assignedTeamId}
              onChange={(teamId) => setAssignedTeamId(teamId)}
              placeholder="Select team..."
              compact
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm rounded border border-[var(--ff-border-light)]
                       text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ ticket_type: ticketType, priority, notes, assigned_team_id: assignedTeamId || undefined })}
            disabled={loading}
            className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700
                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <><InlineSpinner size="sm" /> Creating...</>
            ) : (
              `Create ${selectedCount} Ticket${selectedCount !== 1 ? 's' : ''}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
