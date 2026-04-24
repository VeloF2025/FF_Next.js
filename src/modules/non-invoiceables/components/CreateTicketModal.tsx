'use client';

/**
 * CreateTicketModal — Shared ticket creation for the Non-Invoiceable Action Centre.
 *
 * Two-step flow:
 *   1. Form step        — user picks ticket type / priority / team / notes
 *   2. Review duplicates — BEFORE any ticket is created, each selected item
 *                          is checked against open maintenance_tickets by DR,
 *                          ONT serial, and pole_number. Items that collide
 *                          must be either LINKED to the existing ticket or
 *                          SKIPPED — we do not allow silent duplicate creation
 *                          because the same work often arrives from multiple
 *                          sources (weekly billing, NOC manual, auto-ingest).
 *
 * Routing by source:
 *   oes_pp_data     → /api/activate/pp-data-tickets
 *   olt_mismatch    → /api/system/olt-report/tickets
 *   offline_devices → /api/activate/reporting/serial-mismatches/create-ticket
 */

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ExternalLink, Link2, AlertTriangle } from 'lucide-react';
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
  id: string;              // composite id, e.g. "offline_devices:<uuid>"
  dr_number: string;
  category: NonInvoiceableCategory;
  source: IssueSource;
  /** Populated where available — used as secondary duplicate-match key. */
  offline_serial?: string | null;
  oes_serial?: string | null;
  olt_serial?: string | null;
}

export interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedItems: SelectedItem[];
  onSuccess: () => void;
}

type Priority = 'low' | 'normal' | 'high' | 'urgent';

interface DuplicateTicket {
  id: string;
  ticket_uid: string;
  title: string;
  status: string;
  type: string;
  ticket_category: string | null;
  dr_number: string | null;
  ont_serial: string | null;
  created_at: string;
  match_reasons: Array<'dr_number' | 'ont_serial' | 'pole_number'>;
}

interface FlaggedItem {
  item: SelectedItem;
  duplicates: DuplicateTicket[];
  action: 'link' | 'skip';
  /** Ticket id to link to when action === 'link'. Defaults to first duplicate. */
  linkTargetId: string;
}

type Step = 'form' | 'review-duplicates';

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

/** Extract the source id from a composite id like "olt_mismatch:1234". */
function extractSourceId(compositeId: string): string {
  return compositeId.split(':').pop() ?? '';
}

function extractNumericId(compositeId: string): number {
  const parsed = parseInt(extractSourceId(compositeId), 10);
  if (isNaN(parsed)) throw new Error(`Cannot parse numeric ID from: "${compositeId}"`);
  return parsed;
}

/** Best-available ONT serial for duplicate matching. */
function bestSerial(item: SelectedItem): string | undefined {
  return item.offline_serial || item.oes_serial || item.olt_serial || undefined;
}

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

async function fetchDuplicates(item: SelectedItem): Promise<DuplicateTicket[]> {
  const params = new URLSearchParams();
  if (item.dr_number) params.set('dr_number', item.dr_number);
  const serial = bestSerial(item);
  if (serial) params.set('ont_serial', serial);

  const res = await fetch(`/api/noc/tickets-duplicate-check?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Duplicate check failed (${res.status})`);
  }
  const json = (await res.json()) as {
    success: boolean;
    data?: { duplicates?: DuplicateTicket[] };
  };
  return json.data?.duplicates ?? [];
}

/** Map our three sources to the payload shape the link endpoint expects. */
function linkPayload(item: SelectedItem, targetTicketId: string) {
  const source_id = item.source === 'oes_pp_data' || item.source === 'olt_mismatch'
    ? extractNumericId(item.id)
    : extractSourceId(item.id);

  if (item.source === 'offline_devices') {
    // Default to the "plain offline" variant — mismatch variant only applies
    // if the serial_mismatch flag was set server-side, which the UI doesn't
    // expose here. Backend keys on the column that's still NULL.
    return {
      source: 'offline_devices',
      source_id,
      source_variant: 'offline' as const,
      target_ticket_id: targetTicketId,
    };
  }
  return {
    source: item.source === 'oes_pp_data' ? 'oes_pp_data' : 'olt_mismatch_records',
    source_id,
    target_ticket_id: targetTicketId,
  };
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
  const [step, setStep] = useState<Step>('form');
  const [ticketType, setTicketType] = useState('');
  const [priority, setPriority] = useState<Priority>('high');
  const [assignedTeamId, setAssignedTeamId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [cleanItems, setCleanItems] = useState<SelectedItem[]>([]);
  const [flaggedItems, setFlaggedItems] = useState<FlaggedItem[]>([]);

  /** Reset transient state on close so re-opening is clean. */
  const closeModal = () => {
    setStep('form');
    setCleanItems([]);
    setFlaggedItems([]);
    onClose();
  };

  /** Union of valid ticket types across the selected items' categories. */
  const availableTicketTypes = useMemo<string[]>(() => {
    const seen = new Set<string>();
    for (const item of selectedItems) {
      for (const t of CATEGORY_TICKET_TYPES[item.category]) seen.add(t);
    }
    return Array.from(seen).sort();
  }, [selectedItems]);

  /**
   * Step 1 → 2: pre-flight duplicate check. Splits selected items into
   * "clean" (no existing ticket collides) and "flagged" (at least one open
   * ticket matches DR/serial/pole). Skips directly to creation if nothing
   * is flagged.
   */
  const runDuplicateCheck = async () => {
    if (!ticketType) {
      toast.error('Please select a ticket type.');
      return;
    }
    setIsSubmitting(true);
    try {
      const results = await Promise.all(
        selectedItems.map(async (item) => ({ item, duplicates: await fetchDuplicates(item) })),
      );
      const clean = results.filter((r) => r.duplicates.length === 0).map((r) => r.item);
      const flagged: FlaggedItem[] = [];
      for (const r of results) {
        const first = r.duplicates[0];
        if (!first) continue;
        flagged.push({
          item: r.item,
          duplicates: r.duplicates,
          action: 'link',
          linkTargetId: first.id,
        });
      }

      setCleanItems(clean);
      setFlaggedItems(flagged);

      if (flagged.length === 0) {
        // Nothing to review — go straight to creation.
        await submitCreations(clean);
      } else {
        setStep('review-duplicates');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Duplicate check failed.';
      log.error('CreateTicketModal: duplicate check failed', { error: message });
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Issue the actual create calls to the per-source endpoints. */
  const submitCreations = async (items: SelectedItem[]) => {
    if (items.length === 0) {
      toast.success('No new tickets needed (all items were linked or skipped).');
      onSuccess();
      closeModal();
      return;
    }

    const ppIds: number[] = [];
    const oltIds: number[] = [];
    const offlineIds: string[] = [];

    for (const item of items) {
      if (item.source === 'oes_pp_data') ppIds.push(extractNumericId(item.id));
      else if (item.source === 'olt_mismatch') oltIds.push(extractNumericId(item.id));
      else if (item.source === 'offline_devices') offlineIds.push(extractSourceId(item.id));
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
        postJson('/api/activate/reporting/serial-mismatches/create-ticket', { id, priority }),
      ),
    ];

    await Promise.all(calls);
    log.info('CreateTicketModal: tickets created', { count: items.length, ticketType, priority });
    toast.success(`${items.length} ticket${items.length !== 1 ? 's' : ''} created.`);
  };

  /** Apply "link" actions then create the remaining clean items. */
  const submitReviewed = async () => {
    setIsSubmitting(true);
    try {
      // 1. Link every flagged item with action === 'link' to its chosen target.
      const linkCalls = flaggedItems
        .filter((f) => f.action === 'link')
        .map((f) =>
          postJson('/api/activate/non-invoiceables/link-to-existing', linkPayload(f.item, f.linkTargetId)),
        );
      await Promise.all(linkCalls);
      const linkedCount = linkCalls.length;
      const skippedCount = flaggedItems.filter((f) => f.action === 'skip').length;

      // 2. Create tickets for the clean set.
      await submitCreations(cleanItems);

      if (linkedCount > 0) {
        toast.success(`${linkedCount} item${linkedCount !== 1 ? 's' : ''} linked to existing tickets.`);
      }
      if (skippedCount > 0) {
        toast.success(`${skippedCount} item${skippedCount !== 1 ? 's' : ''} skipped.`);
      }

      onSuccess();
      closeModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resolve duplicates.';
      log.error('CreateTicketModal: review submission failed', { error: message });
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputClass =
    'w-full px-3 py-2 rounded-lg bg-[#0d1117] border border-gray-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center">
      <div className="bg-[#1a1d23] border border-gray-700 rounded-lg shadow-xl w-full max-w-2xl mx-4 mt-10 p-6 max-h-[85vh] overflow-y-auto">
        {step === 'form' ? (
          <>
            <h2 className="text-lg font-semibold text-white mb-5">
              Create Tickets
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''})
              </span>
            </h2>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runDuplicateCheck();
              }}
              className="space-y-4"
            >
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
                  <option value="" disabled>
                    Select ticket type…
                  </option>
                  {availableTicketTypes.map((t) => (
                    <option key={t} value={t}>
                      {TICKET_TYPE_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
                {availableTicketTypes.length === 0 && (
                  <p className="mt-1 text-xs text-yellow-400">
                    Selected categories do not support ticket creation.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className={inputClass}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Assign Team</label>
                <TeamSelector
                  value={assignedTeamId}
                  onChange={(id) => setAssignedTeamId(id)}
                  placeholder="Unassigned"
                  showClear
                />
              </div>

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

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={closeModal} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={isSubmitting}
                  disabled={availableTicketTypes.length === 0}
                >
                  Continue
                </Button>
              </div>
            </form>
          </>
        ) : (
          // ---------- review-duplicates ----------
          <>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              <h2 className="text-lg font-semibold text-white">
                {flaggedItems.length} item{flaggedItems.length !== 1 ? 's have' : ' has'} existing open tickets
              </h2>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Duplicate tickets waste effort. For each flagged item pick <strong>Link</strong> to attach it to the
              existing ticket, or <strong>Skip</strong> to leave it un-actioned. {cleanItems.length > 0 && (
                <>The other {cleanItems.length} clean item{cleanItems.length !== 1 ? 's' : ''} will be created as new tickets.</>
              )}
            </p>

            <div className="space-y-3">
              {flaggedItems.map((flagged, idx) => (
                <div key={flagged.item.id} className="border border-gray-700 rounded-lg p-3 bg-[#0d1117]">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm text-white font-medium">
                        {flagged.item.dr_number}
                        <span className="ml-2 text-xs text-gray-400">{flagged.item.category}</span>
                      </div>
                      {bestSerial(flagged.item) && (
                        <div className="text-xs text-gray-500 mt-0.5">Serial: {bestSerial(flagged.item)}</div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setFlaggedItems((prev) =>
                            prev.map((f, i) => (i === idx ? { ...f, action: 'link' } : f)),
                          )
                        }
                        className={`px-3 py-1 text-xs rounded-md ${
                          flagged.action === 'link'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        <Link2 className="w-3 h-3 inline mr-1" />
                        Link
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFlaggedItems((prev) =>
                            prev.map((f, i) => (i === idx ? { ...f, action: 'skip' } : f)),
                          )
                        }
                        className={`px-3 py-1 text-xs rounded-md ${
                          flagged.action === 'skip'
                            ? 'bg-gray-500 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        Skip
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-gray-400 mb-1">
                    Matches {flagged.duplicates.length} open ticket{flagged.duplicates.length !== 1 ? 's' : ''}:
                  </div>
                  <div className="space-y-1">
                    {flagged.duplicates.map((dup) => (
                      <label
                        key={dup.id}
                        className={`flex items-center gap-2 p-2 rounded-md cursor-pointer ${
                          flagged.action === 'link' && flagged.linkTargetId === dup.id
                            ? 'bg-blue-900/40 border border-blue-600/60'
                            : 'bg-[#161b22] border border-transparent'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`link-${flagged.item.id}`}
                          checked={flagged.linkTargetId === dup.id}
                          disabled={flagged.action !== 'link'}
                          onChange={() =>
                            setFlaggedItems((prev) =>
                              prev.map((f, i) => (i === idx ? { ...f, linkTargetId: dup.id } : f)),
                            )
                          }
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white truncate">
                            <span className="font-mono">{dup.ticket_uid}</span>
                            <span className="ml-2 text-xs text-gray-400">{dup.status}</span>
                            <span className="ml-2 text-xs text-gray-500">{dup.ticket_category ?? dup.type}</span>
                          </div>
                          <div className="text-xs text-gray-400 truncate">{dup.title}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            Matched on: {dup.match_reasons.join(', ')}
                          </div>
                        </div>
                        <a
                          href={`/noc/tickets/${dup.id}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                        >
                          Open <ExternalLink className="w-3 h-3" />
                        </a>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-700">
              <button
                type="button"
                onClick={() => setStep('form')}
                disabled={isSubmitting}
                className="text-sm text-gray-400 hover:text-white"
              >
                ← Back
              </button>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" onClick={closeModal} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button type="button" variant="primary" loading={isSubmitting} onClick={() => void submitReviewed()}>
                  Apply {cleanItems.length > 0 && `(+ create ${cleanItems.length} new)`}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
