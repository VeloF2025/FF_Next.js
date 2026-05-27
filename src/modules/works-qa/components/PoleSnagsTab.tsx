import { useState } from 'react';
import { usePoleSnags, type PoleSnag } from '../hooks/usePoleSnags';

interface Props {
  poleId: string;
  /** Called after resolve succeeds so the parent can refetch the pole detail. */
  onChanged: () => void;
}

interface ResolveResult { ok: boolean; ticketResolved?: boolean; error?: string }

async function resolveSnag(snagId: string, closeTicket: boolean): Promise<ResolveResult> {
  const res = await fetch('/api/works-qa/photo-snag-resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snag_id: snagId, close_ticket: closeTicket }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` };
  }
  const body = await res.json() as { data?: { ticket_resolved?: boolean } };
  return { ok: true, ticketResolved: body.data?.ticket_resolved };
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'text-red-400',
  major: 'text-orange-400',
  minor: 'text-yellow-400',
};

function SnagRow({ snag, onResolved }: { snag: PoleSnag; onResolved: () => void }) {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOpen = !['verified', 'closed'].includes(snag.status);

  async function handleResolve() {
    setResolving(true);
    setError(null);
    const result = await resolveSnag(snag.id, true);
    setResolving(false);
    if (!result.ok) {
      setError(result.error ?? 'Resolve failed');
      return;
    }
    onResolved();
  }

  return (
    <div className={`border border-zinc-800 rounded p-2 flex flex-col gap-1 ${isOpen ? '' : 'opacity-60'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-200">
          {/* Pole-level snags (planted-check / "other issue") have no slot_key. */}
          {snag.slot_key ? snag.slot_key.replace(/_/g, ' ') : 'Pole-level'}
        </span>
        <span className={`text-[10px] uppercase tracking-wider ${SEVERITY_CLASS[snag.severity] ?? 'text-zinc-400'}`}>
          {snag.severity}
        </span>
      </div>
      <p className="text-xs text-zinc-300 leading-tight">{snag.description}</p>
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <span>{new Date(snag.created_at).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })}</span>
        {snag.assignee_name && <span>· {snag.assignee_name}</span>}
        {snag.ticket_uid && <span>· {snag.ticket_uid}</span>}
        <span className="ml-auto text-zinc-400">{snag.status}</span>
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      {isOpen && (
        <div className="flex gap-1">
          <button
            type="button"
            disabled={resolving}
            onClick={handleResolve}
            className="text-[11px] px-2 py-0.5 rounded bg-green-600/80 hover:bg-green-500 text-white disabled:opacity-50"
          >
            {resolving ? 'Resolving…' : 'Resolve & close ticket'}
          </button>
        </div>
      )}
    </div>
  );
}

async function generateSnagReport(poleId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/works-qa/pole-snag-report?pole_id=${poleId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export function PoleSnagsTab({ poleId, onChanged }: Props) {
  const { snags, isLoading, mutate } = usePoleSnags(poleId);
  const [reportStatus, setReportStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [reportError, setReportError] = useState<string | null>(null);

  const open = snags.filter(s => !['verified', 'closed'].includes(s.status));
  const resolved = snags.filter(s => ['verified', 'closed'].includes(s.status));

  async function handleGenerate() {
    setReportStatus('generating');
    setReportError(null);
    const result = await generateSnagReport(poleId);
    if (result.ok) {
      setReportStatus('done');
    } else {
      setReportStatus('error');
      setReportError(result.error ?? 'Report failed');
    }
  }

  if (isLoading) return <div className="text-xs text-zinc-500 p-3">Loading snags…</div>;
  if (snags.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3 text-xs text-zinc-500">
        <p>No snags on this pole yet.</p>
        <p className="text-[10px]">Use the Snag button on a photo to raise one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-zinc-900 rounded p-2 text-center">
          <div className="text-zinc-500 text-[10px] uppercase">Open</div>
          <div className="text-red-400 font-semibold">{open.length}</div>
        </div>
        <div className="bg-zinc-900 rounded p-2 text-center">
          <div className="text-zinc-500 text-[10px] uppercase">Resolved</div>
          <div className="text-green-400 font-semibold">{resolved.length}</div>
        </div>
        <div className="bg-zinc-900 rounded p-2 text-center">
          <div className="text-zinc-500 text-[10px] uppercase">Total</div>
          <div className="text-zinc-100 font-semibold">{snags.length}</div>
        </div>
      </div>

      {open.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-[10px] uppercase tracking-wider text-zinc-400">Open ({open.length})</h4>
          {open.map(s => (
            <SnagRow key={s.id} snag={s} onResolved={() => { void mutate(); onChanged(); }} />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-[10px] uppercase tracking-wider text-zinc-500">Resolved ({resolved.length})</h4>
          {resolved.map(s => (
            <SnagRow key={s.id} snag={s} onResolved={() => { void mutate(); onChanged(); }} />
          ))}
        </div>
      )}

      <div className="border-t border-zinc-800 pt-2">
        <button
          type="button"
          disabled={reportStatus === 'generating'}
          onClick={handleGenerate}
          className="w-full text-xs px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 disabled:opacity-50"
        >
          {reportStatus === 'generating' ? 'Generating…' :
           reportStatus === 'done' ? '✓ Snag report saved' :
           'Generate Snag Report'}
        </button>
        {reportError && <p className="text-[10px] text-red-400 mt-1">{reportError}</p>}
      </div>
    </div>
  );
}
