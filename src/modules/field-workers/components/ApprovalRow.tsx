/**
 * ApprovalRow — renders one pending field-worker registration.
 *
 * Shows: name, phone, declared project, source, registration date.
 * When `isAdmin` is true, renders Approve / Reject buttons.
 * Buttons are disabled while the action is in-flight.
 */

import { useState } from 'react';
import { Check, X, Clock, MapPin, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { approveWorker, rejectWorker, type PendingWorker } from '../api';
import { log } from '@/lib/logger';

interface ApprovalRowProps {
  worker: PendingWorker;
  isAdmin: boolean;
  /** Called after a successful approve/reject so the parent can remove the row. */
  onActioned: (workerId: string) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function sourceLabel(source: string | null): string {
  if (!source) return '—';
  return source.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function ApprovalRow({ worker, isAdmin, onActioned }: ApprovalRowProps) {
  const [busy, setBusy] = useState(false);

  const fullName =
    [worker.first_name, worker.last_name].filter(Boolean).join(' ') || '(unnamed)';

  async function handleApprove() {
    setBusy(true);
    try {
      await approveWorker(worker.id);
      toast.success(`${fullName} approved`);
      onActioned(worker.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Approve failed: ${message}`);
      log.error('[ApprovalRow] approve failed', { id: worker.id, error: message });
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    try {
      await rejectWorker(worker.id);
      toast.success(`${fullName} rejected`);
      onActioned(worker.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Reject failed: ${message}`);
      log.error('[ApprovalRow] reject failed', { id: worker.id, error: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-neutral-800 hover:bg-neutral-900/50 align-top">
      {/* Name + phone */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
          <span className="font-medium text-neutral-100">{fullName}</span>
        </div>
        <div className="text-xs text-neutral-400 mt-0.5 pl-5">{worker.phone}</div>
      </td>

      {/* Role */}
      <td className="px-3 py-2 text-sm text-neutral-300 capitalize">{worker.role}</td>

      {/* Declared project */}
      <td className="px-3 py-2">
        {worker.declared_project_name ? (
          <div className="flex items-center gap-1 text-sm text-neutral-300">
            <MapPin className="w-3 h-3 text-neutral-500 shrink-0" />
            {worker.declared_project_name}
          </div>
        ) : (
          <span className="text-neutral-500 text-sm">—</span>
        )}
      </td>

      {/* Source */}
      <td className="px-3 py-2 text-sm text-neutral-400">
        {sourceLabel(worker.source)}
      </td>

      {/* Registered at */}
      <td className="px-3 py-2 text-xs text-neutral-400 whitespace-nowrap">
        <Clock className="w-3 h-3 inline mr-1" />
        {formatDate(worker.created_at)}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        {isAdmin ? (
          <div className="flex gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={handleApprove}
              aria-label={`Approve ${fullName}`}
              className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 hover:bg-emerald-800/60 disabled:opacity-50 disabled:cursor-not-allowed text-xs flex items-center gap-1 text-emerald-200"
            >
              <Check className="w-3 h-3" />
              {busy ? 'Saving…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleReject}
              aria-label={`Reject ${fullName}`}
              className="px-2 py-1 rounded bg-red-900/40 border border-red-700 hover:bg-red-800/60 disabled:opacity-50 disabled:cursor-not-allowed text-xs flex items-center gap-1 text-red-200"
            >
              <X className="w-3 h-3" />
              {busy ? 'Saving…' : 'Reject'}
            </button>
          </div>
        ) : (
          <span className="text-xs text-neutral-500">Admin only</span>
        )}
      </td>
    </tr>
  );
}
