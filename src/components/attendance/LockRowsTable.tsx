/**
 * Lock-history table for /staff/attendance/locks (#2005 extraction).
 *
 * Presentational — the page owns the data and the unlock/re-lock intent. Pulled
 * out so the page stays under the file-size cap after the inline reason prompt.
 */

import { Lock, Unlock } from 'lucide-react';

export interface LockRow {
  week_start_date: string;
  locked_at: string;
  locked_by: string;
  lock_reason: string | null;
  unlocked_at: string | null;
  unlocked_by: string | null;
  unlock_reason: string | null;
}

function formatTs(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return ts;
  }
}

interface Props {
  locks: LockRow[];
  busy: string | null;
  onAction: (week: string, action: 'lock' | 'unlock') => void;
}

export function LockRowsTable({ locks, busy, onAction }: Props) {
  return (
    <div className="overflow-x-auto border border-neutral-800 rounded">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-900 text-neutral-300">
          <tr>
            <th className="text-left px-3 py-2">Week Start</th>
            <th className="text-left px-3 py-2">State</th>
            <th className="text-left px-3 py-2">Locked</th>
            <th className="text-left px-3 py-2">Unlocked</th>
            <th className="text-left px-3 py-2">Reason</th>
            <th className="text-left px-3 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {locks.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center py-6 text-neutral-500">
                No locks yet. Exports will create them automatically.
              </td>
            </tr>
          )}
          {locks.map((l) => {
            const isLocked = l.unlocked_at == null;
            return (
              <tr key={l.week_start_date} className="border-t border-neutral-800 hover:bg-neutral-900/50">
                <td className="px-3 py-2 font-medium">{l.week_start_date}</td>
                <td className="px-3 py-2">
                  {isLocked ? (
                    <span className="text-amber-400 inline-flex items-center gap-1">
                      <Lock className="w-3 h-3" /> locked
                    </span>
                  ) : (
                    <span className="text-emerald-400 inline-flex items-center gap-1">
                      <Unlock className="w-3 h-3" /> unlocked
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-400">{formatTs(l.locked_at)}</td>
                <td className="px-3 py-2 text-xs text-neutral-400">{formatTs(l.unlocked_at)}</td>
                <td className="px-3 py-2 max-w-sm text-xs">
                  {isLocked ? l.lock_reason : l.unlock_reason}
                </td>
                <td className="px-3 py-2">
                  {isLocked ? (
                    <button
                      type="button"
                      disabled={busy === l.week_start_date}
                      onClick={() => onAction(l.week_start_date, 'unlock')}
                      className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 hover:bg-emerald-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
                    >
                      <Unlock className="w-3 h-3" /> Unlock
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === l.week_start_date}
                      onClick={() => onAction(l.week_start_date, 'lock')}
                      className="px-2 py-1 rounded bg-amber-900/40 border border-amber-700 hover:bg-amber-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
                    >
                      <Lock className="w-3 h-3" /> Re-lock
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
