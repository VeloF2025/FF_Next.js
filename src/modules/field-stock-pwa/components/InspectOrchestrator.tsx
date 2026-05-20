'use client';

/**
 * InspectOrchestrator — warehouse disposition screen for /my/stores/inspect/[id].
 *
 * Single-screen flow (no wizard):
 *  1. Fetch the return by id from pending list; fall back to inspected list.
 *  2. Render SerialDispositionRow for every line.
 *  3. Collect inspection notes + signature.
 *  4. Submit via submitInspectAndAccept (pending path) or retryAccept (inspected path).
 *  5. On success: show inline success view, then navigate back to the queue.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { ChevronLeft, Loader2, AlertCircle } from 'lucide-react';

import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { SerialDispositionRow } from './SerialDispositionRow';
import { InspectSubmitBar } from './InspectSubmitBar';
import {
  submitInspectAndAccept,
  retryAccept,
} from '@/modules/field-stock-pwa/api/returns';
import type { ReturnCondition } from '@/modules/field-stock-pwa/lib/conditionOptions';
import type { ReturnDisposition } from '@/modules/field-stock-pwa/lib/dispositionOptions';
import type { PwaReturnResult } from '@/modules/field-stock-pwa/types';
import { InspectSuccess } from './InspectSuccess';

// =============================================================================
// Types
// =============================================================================

interface ReturnLine {
  id: string;
  serial_number: string | null;
  item_name: string;
  condition: string | null;
  disposition: string | null;
  notes: string | null;
}

interface ReturnDetail {
  id: string;
  return_number: string;
  status: string;
  lines: ReturnLine[];
}

interface LineState {
  condition: ReturnCondition | null;
  disposition: ReturnDisposition | null;
  notes: string;
}

// =============================================================================
// Props
// =============================================================================

export interface InspectOrchestratorProps {
  profile: AttendanceProfile;
  returnId: string;
}

// =============================================================================
// Fetch helpers
// =============================================================================

async function fetchReturnById(id: string): Promise<ReturnDetail | null> {
  for (const status of ['pending', 'inspected'] as const) {
    const res = await fetch(
      `/api/procurement/field-stock/returns?status=${status}`,
      { credentials: 'same-origin' },
    );
    if (!res.ok) continue;
    // API returns the apiResponse envelope { success, data, meta } — unwrap.
    const envelope = (await res.json()) as { success?: boolean; data?: unknown };
    const rows = Array.isArray(envelope?.data) ? (envelope.data as ReturnDetail[]) : [];
    const found = rows.find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}

// =============================================================================
// Component
// =============================================================================

export function InspectOrchestrator({ profile, returnId }: InspectOrchestratorProps) {
  const router = useRouter();

  const [returnDetail, setReturnDetail] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Per-line state: keyed by line.id
  const [lineStates, setLineStates] = useState<Record<string, LineState>>({});
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<PwaReturnResult | null>(null);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const detail = await fetchReturnById(returnId);
        if (!cancelled) {
          setReturnDetail(detail);
          if (detail) {
            // Pre-seed line states from existing line values (retry path has them set)
            const initial: Record<string, LineState> = {};
            for (const line of detail.lines) {
              initial[line.id] = {
                condition: (line.condition as ReturnCondition | null) ?? null,
                disposition: (line.disposition as ReturnDisposition | null) ?? null,
                notes: line.notes ?? '',
              };
            }
            setLineStates(initial);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'Failed to load return');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [returnId]);

  const isRetryPath = returnDetail?.status === 'inspected';

  const linesComplete = useMemo(() => {
    if (!returnDetail) return false;
    return returnDetail.lines.every((line) => {
      const s = lineStates[line.id];
      return s?.condition !== null && s?.condition !== undefined &&
             s?.disposition !== null && s?.disposition !== undefined;
    });
  }, [returnDetail, lineStates]);

  const handleLineChange = useCallback((
    lineId: string,
    next: { condition: ReturnCondition | null; disposition: ReturnDisposition | null; notes: string },
  ) => {
    setLineStates((prev) => ({ ...prev, [lineId]: next }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!returnDetail) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let r: PwaReturnResult;
      if (isRetryPath) {
        r = await retryAccept(returnDetail.id);
      } else {
        r = await submitInspectAndAccept({
          returnId: returnDetail.id,
          inspectionNotes,
          signatureDataUrl,
          lineDispositions: returnDetail.lines.map((line) => ({
            lineId: line.id,
            condition: lineStates[line.id]?.condition as ReturnCondition,
            disposition: lineStates[line.id]?.disposition as ReturnDisposition,
            notes: lineStates[line.id]?.notes || null,
          })),
        });
      }
      setResult(r);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submit failed. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }, [returnDetail, isRetryPath, inspectionNotes, signatureDataUrl, lineStates]);

  // ---------- Loading ----------
  if (loading) {
    return (
      <MyPortalShell title="Inspect return" staffName={profile.name}
        staffPhotoUrl={profile.profilePhotoUrl} showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 gap-2 text-sm text-neutral-400">
          <Loader2 className="w-4 h-4 animate-spin" />Loading…
        </div>
      </MyPortalShell>
    );
  }

  // ---------- Fetch error ----------
  if (fetchError || !returnDetail) {
    return (
      <MyPortalShell title="Inspect return" staffName={profile.name}
        staffPhotoUrl={profile.profilePhotoUrl} showFooterNav={false}>
        <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{fetchError ?? 'Return not found'}</span>
        </div>
      </MyPortalShell>
    );
  }

  // ---------- Success view ----------
  if (result) {
    return (
      <MyPortalShell title="Inspect return" staffName={profile.name}
        staffPhotoUrl={profile.profilePhotoUrl} showFooterNav={false}>
        <InspectSuccess result={result} onBack={() => void router.push('/my/stores/inspect')} />
      </MyPortalShell>
    );
  }

  // ---------- Main disposition screen ----------
  return (
    <MyPortalShell title={returnDetail.return_number} staffName={profile.name}
      staffPhotoUrl={profile.profilePhotoUrl} showFooterNav={false}>
      <div className="space-y-4">
        {/* Back nav */}
        <button type="button"
          onClick={() => void router.push('/my/stores/inspect')}
          className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200">
          <ChevronLeft className="w-4 h-4" />Inspection queue
        </button>

        {/* Status badge */}
        {isRetryPath && (
          <div className="rounded-lg bg-amber-950/50 border border-amber-800 px-3 py-2 text-xs text-amber-300">
            Inspection already saved — tap Retry restock to complete the accept step.
          </div>
        )}

        {/* Line disposition rows */}
        <div className="space-y-3">
          {returnDetail.lines.map((line) => (
            <SerialDispositionRow
              key={line.id}
              lineId={line.id}
              serialNumber={line.serial_number ?? '(no serial)'}
              stockItemName={line.item_name}
              condition={lineStates[line.id]?.condition ?? null}
              disposition={lineStates[line.id]?.disposition ?? null}
              notes={lineStates[line.id]?.notes ?? ''}
              onChange={(next) => handleLineChange(line.id, next)}
            />
          ))}
        </div>

        {/* Submit bar (notes + signature + button) */}
        <InspectSubmitBar
          inspectionNotes={inspectionNotes}
          onNotesChange={setInspectionNotes}
          signatureDataUrl={signatureDataUrl}
          onSignatureChange={setSignatureDataUrl}
          linesComplete={linesComplete}
          isRetryPath={!!isRetryPath}
          submitting={submitting}
          error={submitError}
          onSubmit={handleSubmit}
        />
      </div>
    </MyPortalShell>
  );
}
