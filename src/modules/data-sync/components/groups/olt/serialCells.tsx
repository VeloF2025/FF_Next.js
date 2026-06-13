/**
 * Serial cells for the OLT reconciliation ledger table (OltReconLedgerTab).
 * Extracted to keep the parent component under the 200-line limit.
 */

import type { ReconLedgerRow } from '../../../types';

export function Serial({ value, conflict }: { value: string | null; conflict: boolean }) {
  if (!value) return <span className="text-[var(--ff-text-tertiary)]">—</span>;
  return (
    <span className={`font-mono text-xs ${conflict ? 'text-red-300 font-semibold' : 'text-[var(--ff-text-secondary)]'}`}>
      {value}
    </span>
  );
}

/**
 * WA serial cell. Adds a "typed" tag when the serial came from wa_original_text
 * rather than a scan (rec #5), and surfaces a typed serial that DISAGREES with the
 * scanned one as a muted sub-note so the discrepancy stays visible.
 */
export function WaSerialCell({ row, conflict }: { row: ReconLedgerRow; conflict: boolean }) {
  const showTypedNote =
    row.wa_typed_serial != null &&
    row.wa_serial_source === 'scanned' &&
    row.wa_typed_serial !== row.wa_serial;
  return (
    <td className="px-3 py-2">
      <span className="inline-flex items-center gap-1">
        <Serial value={row.wa_serial} conflict={conflict} />
        {row.wa_serial_source === 'typed' && (
          <span className="px-1 py-0.5 rounded text-[9px] bg-sky-500/20 text-sky-400">typed</span>
        )}
      </span>
      {showTypedNote && (
        <div className="text-[10px] text-[var(--ff-text-tertiary)] mt-0.5 font-mono">typed: {row.wa_typed_serial}</div>
      )}
    </td>
  );
}
