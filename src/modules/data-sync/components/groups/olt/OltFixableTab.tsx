/**
 * OltFixableTab — records with serial mismatches ready to fix
 */

'use client';

import React, { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import toast from 'react-hot-toast';
import {
  Wrench,
  CheckSquare,
  Square,
  Ticket,
} from 'lucide-react';
import type { OltRecord, OltStats, InvestigationContext, DisplacedInfo, BulkFixResult } from '../../../types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { OltRecordTable } from './OltRecordTable';
import { CreateHomeInstallationTicketsModal, type HomeInstallationTicketBatch } from './CreateHomeInstallationTicketsModal';

interface OltFixableTabProps {
  records: OltRecord[];
  stats: OltStats;
  isLoading: boolean;
  page: number;
  total: number;
  pageSize: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  fixing: string | null;
  fixErrors: Record<string, string>;
  setFixErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleFix: (record: OltRecord) => Promise<void>;
  isStatusMismatch: (record: OltRecord) => boolean;
  getInvestigationContext: (record: OltRecord) => InvestigationContext | null;
  fetchRecords: (status: string, subStatus?: string, search?: string) => Promise<void>;
  fetchStats: () => Promise<void>;
}

export function OltFixableTab({
  records,
  isLoading,
  page,
  total,
  pageSize,
  setPage,
  fixing,
  fixErrors,
  setFixErrors,
  handleFix,
  isStatusMismatch,
  getInvestigationContext,
  fetchRecords,
  fetchStats,
}: OltFixableTabProps) {
  // Local state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkFixing, setBulkFixing] = useState(false);
  const [bulkFixResult, setBulkFixResult] = useState<BulkFixResult | null>(null);
  const [displacedInfo, setDisplacedInfo] = useState<Record<string, DisplacedInfo>>({});

  // Home Installation status ticket creation
  const [showHITicketModal, setShowHITicketModal] = useState(false);
  const [hiTicketRecords, setHiTicketRecords] = useState<OltRecord[]>([]);
  const [creatingHITickets, setCreatingHITickets] = useState(false);

  // Reset selection on tab enter
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkFixResult(null);
  }, []);

  // A row qualifies for ticket creation when its blocker is the Home Installation status mismatch
  // and it doesn't already have a ticket.
  const canCreateHITicket = (record: OltRecord): boolean =>
    isStatusMismatch(record) && !record.maintenance_ticket_id;

  const blockedSelectedRecords = records.filter(
    (r) => selectedIds.has(r.id) && canCreateHITicket(r)
  );

  const openHITicketModal = (record?: OltRecord) => {
    const targets = record ? [record] : blockedSelectedRecords;
    if (targets.length === 0) return;
    setHiTicketRecords(targets);
    setShowHITicketModal(true);
  };

  const handleCreateHITickets = async (params: {
    priority: string;
    notes: string;
    batches: HomeInstallationTicketBatch[];
  }) => {
    setCreatingHITickets(true);
    try {
      const res = await fetch('/api/system/olt-report/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_type: 'activations',
          ticket_category: 'home_installation_status',
          priority: params.priority,
          notes: params.notes,
          batches: params.batches.map((b) => ({
            record_ids: b.record_ids,
            assigned_team_id: b.assigned_team_id,
          })),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || result.error || 'Failed to create tickets');
      const { created, skipped, filtered } = result.data as { created: number; skipped: number; filtered?: number };
      const noteParts: string[] = [];
      if (skipped > 0) noteParts.push(`${skipped} already ticketed/ineligible`);
      if (filtered && filtered > 0) noteParts.push(`${filtered} not Home-Installation-blocked`);
      toast.success(
        `Created ${created} ticket${created !== 1 ? 's' : ''}${noteParts.length ? ` (${noteParts.join(', ')})` : ''}`
      );
      setShowHITicketModal(false);
      setHiTicketRecords([]);
      setSelectedIds(new Set());
      // status_mismatch rows live in fix_status='pending', so refetching the pending list
      // is sufficient — ticketed rows still appear here but with their Ticket column populated.
      await fetchRecords('pending');
      await fetchStats();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tickets');
    } finally {
      setCreatingHITickets(false);
    }
  };

  // Batch-check displaced ONT activation status when records load
  useEffect(() => {
    if (records.length === 0) return;
    const wrongSerials = records
      .filter(r => r.wrong_onemap_serial && !isStatusMismatch(r))
      .map(r => r.wrong_onemap_serial as string);
    if (wrongSerials.length === 0) { setDisplacedInfo({}); return; }
    const unique = [...new Set(wrongSerials)];
    fetch('/api/system/olt-report/check-displaced', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serials: unique }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.data) setDisplacedInfo(data.data); })
      .catch(() => { /* non-fatal */ });
  }, [records, isStatusMismatch]);

  const fixableRecords = records.filter(r => r.olt_serial);
  const allSelected = fixableRecords.length > 0 && selectedIds.size === fixableRecords.length;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(fixableRecords.map(r => r.id)));
    }
  };

  // Bulk fix - process in batches of 5
  const handleBulkFix = async () => {
    const selected = records.filter(r => selectedIds.has(r.id) && r.olt_serial);
    if (selected.length === 0) return;

    setBulkFixing(true);
    setBulkFixResult(null);
    const statusRecords = selected.filter(r => isStatusMismatch(r));
    const serialRecords = selected.filter(r => !isStatusMismatch(r));

    const BATCH_SIZE = 5;
    let totalSuccess = 0;
    let totalFail = 0;
    const allErrors: Record<string, string> = {};

    try {
      // Fix status mismatches one by one
      for (const rec of statusRecords) {
        setBulkFixResult({ total: selected.length, successCount: totalSuccess, failCount: totalFail });
        const ctx = getInvestigationContext(rec);
        try {
          const r = await fetch('/api/system/olt-report/fix-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ propId: ctx?.propId, drNumber: rec.drop_number }),
          });
          const d = await r.json();
          const result = d.data || d;
          if (result.success) totalSuccess++;
          else { totalFail++; allErrors[rec.id] = result.error || 'Status fix failed'; }
        } catch (error) { totalFail++; allErrors[rec.id] = 'Network error'; log.warn('OltFixableTab', { action: 'fixStatusFailed', recordId: rec.id, error }); }
      }

      // Fix serial mismatches in bulk batches
      for (let i = 0; i < serialRecords.length; i += BATCH_SIZE) {
        const batch = serialRecords.slice(i, i + BATCH_SIZE);
        setBulkFixResult({ total: selected.length, successCount: totalSuccess, failCount: totalFail });

        const res = await fetch('/api/system/olt-report/fix-1map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bulk: true,
            items: batch.map(r => ({
              drNumber: r.drop_number,
              correctSerial: r.olt_serial,
              wrongSerial: r.wrong_onemap_serial,
            })),
          }),
        });
        const data = await res.json();
        const result = data.data || data;

        if (result.bulk) {
          totalSuccess += result.successCount || 0;
          totalFail += result.failCount || 0;
          if (result.results) {
            for (const r of result.results) {
              if (!r.success && r.error) {
                const rec = records.find(rec => rec.drop_number === r.drNumber);
                if (rec) allErrors[rec.id] = r.error;
              }
            }
          }
        } else {
          totalFail += batch.length;
        }
      }

      setBulkFixResult({ total: selected.length, successCount: totalSuccess, failCount: totalFail });
      setFixErrors(allErrors);
      setSelectedIds(new Set());
      fetchRecords('pending');
      fetchStats();
    } catch (error) {
      log.warn('OltFixableTab', { action: 'bulkFixFailed', error });
    } finally {
      setBulkFixing(false);
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
      {/* Bulk Action Bar */}
      {records.length > 0 && (
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--ff-text-secondary)]">
              {selectedIds.size > 0 ? (
                <>{selectedIds.size} of {fixableRecords.length} selected</>
              ) : (
                <>{fixableRecords.length} records ready to fix</>
              )}
            </span>
            {bulkFixResult && (
              <span className="text-sm">
                <span className="text-green-400">{bulkFixResult.successCount} fixed</span>
                {bulkFixResult.failCount > 0 && (
                  <span className="text-red-400 ml-2">{bulkFixResult.failCount} failed</span>
                )}
                {bulkFixing && (
                  <span className="text-[var(--ff-text-secondary)] ml-2">
                    ({bulkFixResult.successCount + bulkFixResult.failCount}/{bulkFixResult.total})
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] rounded hover:bg-[var(--ff-bg-tertiary)]/80"
            >
              {allSelected ? <CheckSquare className="w-4 h-4 text-[var(--ff-accent)]" /> : <Square className="w-4 h-4" />}
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            {blockedSelectedRecords.length > 0 && (
              <button
                onClick={() => openHITicketModal()}
                disabled={bulkFixing || creatingHITickets}
                className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Create Home Installation status tickets for selected blocked rows"
              >
                <Ticket className="w-4 h-4" />
                Create {blockedSelectedRecords.length} Ticket{blockedSelectedRecords.length !== 1 ? 's' : ''}
              </button>
            )}
            <button
              onClick={handleBulkFix}
              disabled={selectedIds.size === 0 || bulkFixing}
              className="flex items-center gap-2 px-4 py-1.5 bg-[var(--ff-accent)] text-white text-sm rounded hover:bg-[var(--ff-accent)]/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkFixing ? (
                <><InlineSpinner size="sm" />Fixing {selectedIds.size}...</>
              ) : (
                <><Wrench className="w-4 h-4" />Fix Selected ({selectedIds.size})</>
              )}
            </button>
          </div>
        </div>
      )}

      <OltRecordTable
        records={records}
        mode="pending"
        page={page}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
        isLoading={isLoading}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        allSelected={allSelected}
        fixableCount={fixableRecords.length}
        fixing={fixing}
        fixErrors={fixErrors}
        onFix={handleFix}
        bulkFixing={bulkFixing}
        isStatusMismatch={isStatusMismatch}
        getInvestigationContext={getInvestigationContext}
        displacedInfo={displacedInfo}
        canCreateTicket={canCreateHITicket}
        onCreateTicket={(record) => openHITicketModal(record)}
      />

      {showHITicketModal && (
        <CreateHomeInstallationTicketsModal
          selectedRecords={hiTicketRecords}
          onConfirm={handleCreateHITickets}
          onClose={() => {
            setShowHITicketModal(false);
            setHiTicketRecords([]);
          }}
          loading={creatingHITickets}
        />
      )}
    </div>
  );
}
