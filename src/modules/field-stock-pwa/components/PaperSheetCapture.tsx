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
import { FileText, Loader2, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { request } from '@/modules/field-stock-pwa/api/request';

interface SheetSummary {
  sheetId: string;
  total: number;
  alreadyRecorded: number;
  contradictsStock: number;
  unknownSerial: number;
  unclassified: number;
  serials: Array<{ serialNumber: string; status: string | null; verdict: string }>;
}

export interface PaperSheetCaptureProps {
  /** Serials already scanned, owned by the page so the scanner can add to them. */
  serials: string[];
  onBack: () => void;
}

export function PaperSheetCapture({ serials, onBack }: PaperSheetCaptureProps) {
  const [sheetDate, setSheetDate] = useState('');
  const [technicianName, setTechnicianName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SheetSummary | null>(null);

  const canSave = sheetDate !== '' && serials.length > 0 && !saving;

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await request<SheetSummary>('/api/my/stores/paper-sheets', {
        method: 'POST',
        body: JSON.stringify({
          sheetDate,
          technicianName: technicianName || null,
          serials,
        }),
      });
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the sheet');
    } finally {
      setSaving(false);
    }
  }, [sheetDate, technicianName, serials]);

  if (summary) {
    const flagged = summary.serials.filter((s) => s.verdict === 'contradicts-stock');
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-neutral-950 border border-neutral-800 px-4 py-3">
          <p className="text-sm text-neutral-200 font-medium">
            Sheet recorded — {summary.total} serial{summary.total === 1 ? '' : 's'}
          </p>
        </div>

        {/* The finding, first and loudest. */}
        {flagged.length > 0 && (
          <div className="rounded-lg bg-amber-950/40 border border-amber-700 px-4 py-3">
            <p className="text-sm text-amber-200 font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {flagged.length} still shown as available stock
            </p>
            <p className="text-xs text-amber-300/80 mt-1">
              The system thinks {flagged.length === 1 ? 'this one is' : 'these are'} on the shelf,
              but this sheet says {flagged.length === 1 ? 'it was' : 'they were'} handed out.
              {flagged.length === 1 ? ' It' : ' They'} could be issued again by mistake.
            </p>
            <ul className="mt-2 space-y-1">
              {flagged.map((s) => (
                <li key={s.serialNumber} className="text-xs font-mono text-amber-100">
                  {s.serialNumber}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-lg bg-neutral-950 border border-neutral-800 divide-y divide-neutral-800">
          <Row icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
               label="Already recorded — nothing to do" value={summary.alreadyRecorded} />
          <Row icon={<HelpCircle className="w-4 h-4 text-neutral-400" />}
               label="Not in the system at all" value={summary.unknownSerial} />
          {summary.unclassified > 0 && (
            <Row icon={<HelpCircle className="w-4 h-4 text-neutral-400" />}
                 label="Status we have no rule for" value={summary.unclassified} />
          )}
        </div>

        <p className="text-[11px] text-neutral-500 px-1">
          Nothing was moved in or out of stock. This is a record of what the paper says.
        </p>

        <button type="button" onClick={onBack}
          className="w-full min-h-[48px] rounded-lg bg-neutral-800 text-neutral-200 text-sm font-medium">
          Done
        </button>
      </div>
    );
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
        <span className="text-xs text-neutral-400">Date written on the sheet</span>
        <input
          type="date"
          value={sheetDate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setSheetDate(e.target.value)}
          className="mt-1 w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white"
        />
      </label>

      <label className="block">
        <span className="text-xs text-neutral-400">Name signed on the sheet (optional)</span>
        <input
          type="text"
          value={technicianName}
          onChange={(e) => setTechnicianName(e.target.value)}
          placeholder="Who took the stock"
          className="mt-1 w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white placeholder:text-neutral-500"
        />
      </label>

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
        {sheetDate ? 'Record this sheet' : 'Enter the sheet date first'}
      </button>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="px-4 py-2.5 flex items-center justify-between">
      <span className="text-xs text-neutral-400 flex items-center gap-2">{icon}{label}</span>
      <span className="text-sm text-neutral-200 tabular-nums">{value}</span>
    </div>
  );
}
