import { useState } from 'react';
import { CheckCircle, XCircle, Pause } from 'lucide-react';
import { log } from '@/lib/logger';
import { ReasonBottomSheet } from './ReasonBottomSheet';
import type { ApprovalRequestRecord, ApprovalActionType } from './types';

export function ApprovalActionBar({ record, onActioned }: { record: ApprovalRequestRecord; onActioned: () => void }) {
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'reject' | 'park'>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!record.canAct) {
    return <div className="fixed bottom-0 inset-x-0 p-4 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-center text-sm text-[var(--ff-text-secondary)]">
      {record.status === 'pending' ? 'You are not an approver for this request.' : `This request is already ${record.status}.`}
    </div>;
  }

  const act = async (action: ApprovalActionType, reasonText?: string) => {
    setBusy(true); setErr(null);
    // Endpoints expect different keys: approve → { notes }, reject/park → { reason }.
    const body = action === 'approve' ? { notes: reasonText } : { reason: reasonText };
    try {
      const res = await fetch(`/api/procurement/approvals/${record.id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) { setSheet(null); onActioned(); }
      else setErr(data.error?.message || `Failed to ${action}`);
    } catch (e) { log.error(`Approval ${action} failed`, { error: e }, 'procurement'); setErr(`Failed to ${action}`); }
    finally { setBusy(false); }
  };

  return (
    <>
      {err && <div className="fixed bottom-20 inset-x-0 mx-4 p-2 rounded-lg bg-red-500/20 text-red-300 text-sm text-center">{err}</div>}
      <div className="fixed bottom-0 inset-x-0 flex gap-2 p-3 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
        <button onClick={() => setSheet('reject')} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-1.5 py-3 rounded-lg border border-red-500/50 text-red-400 disabled:opacity-50"><XCircle className="h-4 w-4" />Reject</button>
        <button onClick={() => setSheet('park')} disabled={busy} className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] disabled:opacity-50"><Pause className="h-4 w-4" />Park</button>
        <button onClick={() => act('approve')} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-1.5 py-3 rounded-lg bg-green-600 text-white disabled:opacity-50"><CheckCircle className="h-4 w-4" />Approve</button>
      </div>
      {sheet === 'reject' && <ReasonBottomSheet title="Reject request" confirmLabel="Confirm reject" busy={busy} onCancel={() => setSheet(null)} onConfirm={(r) => act('reject', r)} />}
      {sheet === 'park' && <ReasonBottomSheet title="Park request" confirmLabel="Confirm park" busy={busy} onCancel={() => setSheet(null)} onConfirm={(r) => act('park', r)} />}
    </>
  );
}
