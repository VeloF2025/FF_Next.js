/**
 * PaperSheetResult — what recording an old paper sheet found.
 *
 * Ordered by what somebody has to act on: the serials the system still
 * believes are on the shelf come first and by name, because a count alone
 * tells nobody which ONT to go and look at.
 */

import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import type { SheetSummary } from './paperSheetTypes';

export interface PaperSheetResultProps {
  summary: SheetSummary;
  /** Leaves the tool entirely. */
  onBack: () => void;
  /**
   * Starts a fresh sheet, keeping the date and receiver as defaults.
   *
   * Without this the tool could record exactly ONE sheet per visit: the result
   * view has no reason to clear itself, so the only way onward was the button
   * that navigates away — which remounts the page and discards the carried
   * date and receiver. A stack of sheets was unusable.
   */
  onNextSheet: () => void;
}

export function PaperSheetResult({ summary, onBack, onNextSheet }: PaperSheetResultProps) {
  const flagged = summary.serials.filter((s) => s.verdict === 'contradicts-stock');
  const unclear = summary.serials.filter((s) => s.verdict === 'unclassified');
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

      {/* Serials in an ambiguous state (returned / faulty / scrapped, or a
          status added since). NAMED, not just counted: a bare number tells
          nobody which ONT to go and look at, and these are exactly the ones
          a person has to judge. */}
      {unclear.length > 0 && (
        <div className="rounded-lg bg-neutral-950 border border-neutral-800 px-4 py-3">
          <p className="text-sm text-neutral-200 font-medium flex items-center gap-2">
            <HelpCircle className="w-4 h-4 shrink-0 text-neutral-400" />
            {unclear.length} need{unclear.length === 1 ? 's' : ''} a look
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            These are in a state that could mean either — returned, faulty or scrapped.
          </p>
          <ul className="mt-2 space-y-1">
            {unclear.map((s) => (
              <li key={s.serialNumber} className="text-xs font-mono text-neutral-300">
                {s.serialNumber} <span className="text-neutral-500">— {s.status ?? 'no status'}</span>
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
      </div>

      <p className="text-[11px] text-neutral-500 px-1">
        Nothing was moved in or out of stock. This is a record of what the paper says.
      </p>

      <button type="button" onClick={onNextSheet}
        className="w-full min-h-[48px] rounded-lg bg-amber-700 text-white text-sm font-medium">
        Record the next sheet
      </button>

      <button type="button" onClick={onBack}
        className="w-full min-h-[48px] rounded-lg bg-neutral-800 text-neutral-200 text-sm font-medium">
        Done — back to stores
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
