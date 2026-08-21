/**
 * PaperSheetCapture — record a HISTORICAL paper install sheet.
 *
 * Deliberately AMBER, and deliberately not the issue flow. Mislabelling a live
 * handout as a historical sheet would back-date real stock movement, so the
 * two must not look alike or share a toggle.
 *
 * This records what an old sheet says. It does not move stock: on the 21
 * sheets captured in May 2026, 72% of serials were already recorded and
 * needed nothing. What it does surface is the small group the system still
 * believes is on the shelf — those ONTs could be issued again to someone else.
 */

import { useCallback, useState } from 'react';
import { useEffect } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { fetchTechnicians } from '@/modules/field-stock-pwa/api';
import type { PwaTechSummary } from '@/modules/field-stock-pwa/types';
import { request } from '@/modules/field-stock-pwa/api/request';
import { PaperSheetResult } from './PaperSheetResult';
import type { SheetSummary } from './paperSheetTypes';


export interface PaperSheetCaptureProps {
  /** Serials already scanned, owned by the page so the scanner can add to them. */
  serials: string[];
  onBack: () => void;
  /**
   * Date used for the previous sheet in this session, carried forward as the
   * default. A stack of sheets is mostly one date or a short run of days, so
   * re-typing it per page is where fat-fingered dates come from.
   */
  initialDate?: string;
  /** Receiver used for the previous sheet — a stack is usually one person. */
  initialReceiverId?: string;
  /** Reports what this sheet used, so the next one can start from it. */
  onRecorded?: (used: { sheetDate: string; receiverStaffId: string }) => void;
}

export function PaperSheetCapture({
  serials, onBack, initialDate, initialReceiverId, onRecorded,
}: PaperSheetCaptureProps) {
  const [sheetDate, setSheetDate] = useState(initialDate ?? '');
  const [receiverStaffId, setReceiverStaffId] = useState(initialReceiverId ?? '');
  const [receivers, setReceivers] = useState<PwaTechSummary[]>([]);
  const [receiversError, setReceiversError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SheetSummary | null>(null);

  // Deliberately NOT site-filtered: these are historical sheets, and the
  // receiver may have worked at a site the storeman is not standing in.
  useEffect(() => {
    let live = true;
    fetchTechnicians()
      .then((rows) => { if (live) setReceivers(rows); })
      .catch((err) => {
        if (live) setReceiversError(err instanceof Error ? err.message : 'Could not load people');
      });
    return () => { live = false; };
  }, []);

  const canSave = sheetDate !== '' && receiverStaffId !== '' && serials.length > 0 && !saving;

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await request<SheetSummary>('/api/my/stores/paper-sheets', {
        method: 'POST',
        body: JSON.stringify({ sheetDate, receiverStaffId, serials }),
      });
      setSummary(result);
      onRecorded?.({ sheetDate, receiverStaffId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the sheet');
    } finally {
      setSaving(false);
    }
  }, [sheetDate, receiverStaffId, serials, onRecorded]);

  if (summary) {
    return <PaperSheetResult summary={summary} onBack={onBack} />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-amber-950/30 border border-amber-800 px-4 py-3">
        <p className="text-sm text-amber-200 font-medium flex items-center gap-2">
          <FileText className="w-4 h-4 shrink-0" />
          Recording an old paper sheet
        </p>
        <p className="text-xs text-amber-300/80 mt-1">
          This does not hand out stock. Use it only for sheets already filled in on paper.
        </p>
      </div>

      <label className="block">
        <span className="text-xs text-neutral-400">
          Date written on the sheet
          {initialDate ? ' (carried over — change it if this page differs)' : ''}
        </span>
        <input
          type="date"
          value={sheetDate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setSheetDate(e.target.value)}
          className="mt-1 w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white"
        />
      </label>

      <label className="block">
        <span className="text-xs text-neutral-400">Who received the stock</span>
        <select
          value={receiverStaffId}
          onChange={(e) => setReceiverStaffId(e.target.value)}
          className="mt-1 w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white"
        >
          <option value="">Choose the person who signed…</option>
          {receivers.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      {receiversError && (
        <p className="text-xs text-red-300 px-1">{receiversError}</p>
      )}

      <div className="rounded-lg bg-neutral-950 border border-neutral-800 px-4 py-3">
        <p className="text-sm text-neutral-300">
          {serials.length} serial{serials.length === 1 ? '' : 's'} scanned
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={!canSave}
        onClick={() => void save()}
        className="w-full min-h-[48px] rounded-lg bg-amber-700 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm font-medium inline-flex items-center justify-center gap-2"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {!sheetDate
          ? 'Enter the sheet date first'
          : !receiverStaffId
            ? 'Choose who received the stock'
            : 'Record this sheet'}
      </button>
    </div>
  );
}

