'use client';

/**
 * CreateTicketModal — Shared ticket creation for the Non-Invoiceable Action Centre.
 * Routes by IssueSource: oes_pp_data → /api/activate/pp-data-tickets,
 * olt_mismatch → /api/system/olt-report/tickets,
 * offline_devices → /api/activate/reporting/serial-mismatches/create-ticket
 */

import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { TeamSelector } from '@/modules/noc/components/Assignment/TeamSelector';
import { log } from '@/lib/logger';
import {
  CATEGORY_TICKET_TYPES,
  type IssueSource,
  type NonInvoiceableCategory,
} from '@/modules/non-invoiceables/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectedItem {
  id: string;
  dr_number: string;
  category: NonInvoiceableCategory;
  source: IssueSource;
}

export interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedItems: SelectedItem[];
  onSuccess: () => void;
}

type Priority = 'low' | 'normal' | 'high' | 'urgent';

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const TICKET_TYPE_LABELS: Record<string, string> = {
  pre_provision: 'Pre-Provision',
  fault_repair: 'Fault Repair',
  modification: 'Modification',
  ont_swap: 'ONT Swap',
  new_installation: 'New Installation',
  serial_mismatch: 'Serial Mismatch',
  olt_investigation: 'ONT not found',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the numeric source ID from a composite id like "olt_mismatch:1234". */
function extractNumericId(compositeId: string): number {
  const raw = compositeId.split(':').pop() ?? '';
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Cannot parse numeric ID from: "${compositeId}"`);
  return parsed;
}

/** POST JSON to an endpoint and throw with a useful message on failure. */
async function postJson(url: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch((err: unknown) => {
      log.debug('create-ticket-modal', { message: 'non-JSON error response', err: String(err) });
      return {};
    });
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateTicketModal({
  isOpen,
  onClose,
  selectedItems,
  onSuccess,
}: CreateTicketModalProps) {
  const [ticketType, setTicketType] = useState('');
  const [priority, setPriority] = useState<Priority>('high');
  const [assignedTeamId, setAssignedTeamId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  /** Union of all valid ticket types across the selected items' categories. */
  const availableTicketTypes = useMemo<string[]>(() => {
    const seen = new Set<string>();
    for (const item of selectedItems) {
      for (const t of CATEGORY_TICKET_TYPES[item.category]) seen.add(t);
    }
    return Array.from(seen).sort();
  }, [selectedItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketType) { toast.error('Please select a ticket type.'); return; }

    setIsSubmitting(true);
    try {
      const ppIds: number[] = [];
      const oltIds: number[] = [];
      const offlineIds: number[] = [];

      for (const item of selectedItems) {
        const numId = extractNumericId(item.id);
        if (item.source === 'oes_pp_data') ppIds.push(numId);
        else if (item.source === 'olt_mismatch') oltIds.push(numId);
        else if (item.source === 'offline_devices') offlineIds.push(numId);
      }

      const shared = {
        ticket_type: ticketType,
        priority,
        notes: notes || undefined,
        assigned_team_id: assignedTeamId ?? undefined,
      };

      const calls: Promise<void>[] = [
        ...(ppIds.length > 0
          ? [postJson('/api/activate/pp-data-tickets', { pp_data_ids: ppIds, ...shared })]
          : []),
        ...(oltIds.length > 0
          ? [postJson('/api/system/olt-report/tickets', { record_ids: oltIds, ...shared })]
          : []),
        ...offlineIds.map((id) =>
          postJson('/api/activate/reporting/serial-mismatches/create-ticket', { id, priority })
        ),
      ];

      await Promise.all(calls);
      log.info('CreateTicketModal: tickets created', { count: selectedItems.length, ticketType, priority });
      toast.success(`${selectedItems.length} ticket${selectedItems.length !== 1 ? 's' : ''} created.`);
      onSuccess();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create tickets.';
      log.error('CreateTicketModal: ticket creation failed', { error: message });
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputClass = 'w-full px-3 py-2 rounded-lg bg-[#0d1117] border border-gray-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center">
      <div className="bg-[#1a1d23] border border-gray-700 rounded-lg shadow-xl w-full max-w-md mx-4 mt-20 p-6">
        <h2 className="text-lg font-semibold text-white mb-5">
          Create Tickets
          <span className="ml-2 text-sm font-normal text-gray-400">
            ({selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''})
          </span>
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Ticket Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Ticket Type <span className="text-red-400">*</span>
            </label>
            <select
              value={ticketType}
              onChange={(e) => setTicketType(e.target.value)}
              className={inputClass}
              required
            >
              <option value="" disabled>Select ticket type…</option>
              {availableTicketTypes.map((t) => (
                <option key={t} value={t}>{TICKET_TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>
            {availableTicketTypes.length === 0 && (
              <p className="mt-1 text-xs text-yellow-400">
                Selected categories do not support ticket creation.
              </p>
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className={inputClass}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Assign Team */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Assign Team</label>
            <TeamSelector
              value={assignedTeamId}
              onChange={(id) => setAssignedTeamId(id)}
              placeholder="Unassigned"
              showClear
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Notes <span className="text-gray-500 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add context or investigation notes…"
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              disabled={availableTicketTypes.length === 0}
            >
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
