/**
 * The worker's PPE acknowledgement sheet, and the scan of it.
 *
 * Mirrors the paper: one open sheet per worker carrying the signed indemnity,
 * with the scanned form attached to it. Past sheets stay listed because the
 * evidence for an old issue lives on the sheet that was open at the time.
 *
 * Deliberately never blocks anything — when no evidenced sheet exists it says
 * so and offers to start one.
 */

import { useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, CheckCircle2, FilePlus2, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';
import { HSAttachmentUpload } from '../attachments/HSAttachmentUpload';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface Sheet {
  id: string;
  sheet_date: string;
  status: 'open' | 'closed';
  signature_name: string | null;
  attachment_count: number;
  is_evidenced: boolean;
}

interface Props {
  staffId?: string | null;
  teamMemberId?: string | null;
  workerName: string;
  contractorId?: string | null;
  projectId?: string | null;
}

export function PPEAcknowledgementPanel({
  staffId,
  teamMemberId,
  workerName,
  contractorId,
  projectId,
}: Props) {
  const workerQuery = staffId
    ? `staffId=${encodeURIComponent(staffId)}`
    : teamMemberId
      ? `teamMemberId=${encodeURIComponent(teamMemberId)}`
      : null;

  const key = workerQuery ? `/api/health-safety/ppe/acknowledgements?${workerQuery}` : null;
  const { data, isLoading, mutate } = useSWR(key, fetcher);
  const sheets: Sheet[] = data?.data ?? [];
  const current = sheets.find((s) => s.status === 'open') ?? null;
  const past = sheets.filter((s) => s.status !== 'open');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startSheet() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/health-safety/ppe/acknowledgements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ staffId, teamMemberId, workerName, contractorId, projectId }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error?.message || json?.error || 'Failed to start the sheet');
      }
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the sheet');
      log.error('Failed to start PPE acknowledgement sheet', { error: err }, 'PPEAcknowledgementPanel');
    } finally {
      setBusy(false);
    }
  }

  // An unregistered worker has no id to hang a sheet off. Said plainly rather
  // than rendering an empty panel that looks like "none on file".
  if (!workerQuery) {
    return (
      <div className="text-sm text-[var(--ff-text-secondary)]">
        This issue is recorded against a name only, so it cannot carry an acknowledgement sheet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          PPE acknowledgement
        </h2>
        {current && (
          <button
            type="button"
            onClick={() => void startSheet()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-60"
          >
            <FilePlus2 className="w-4 h-4" /> Start a new sheet
          </button>
        )}
      </div>

      {error && (
        <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : current ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {current.is_evidenced ? (
              <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4" /> Signed sheet on file
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4" /> No signed sheet uploaded yet
              </span>
            )}
            <span className="text-[var(--ff-text-tertiary)]">
              · sheet opened {current.sheet_date}
            </span>
          </div>

          <HSAttachmentUpload
            surface="ppe_acknowledgement"
            parentId={current.id}
            label="Scanned acknowledgement form"
            // Revalidate the sheet so `is_evidenced` above reflects the upload
            // that just happened, rather than still reading "no signed sheet".
            onChange={() => void mutate()}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="inline-flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            No acknowledgement sheet on file for {workerName}.
          </p>
          <button
            type="button"
            onClick={() => void startSheet()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
            Start a sheet
          </button>
        </div>
      )}

      {past.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--ff-text-secondary)]">
            {past.length} earlier sheet{past.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 space-y-2">
            {past.map((sheet) => (
              <li key={sheet.id} className="pl-3 border-l border-[var(--ff-border-light)]">
                <div className="text-[var(--ff-text-secondary)]">
                  {sheet.sheet_date} · {sheet.attachment_count} document
                  {sheet.attachment_count === 1 ? '' : 's'}
                </div>
                <HSAttachmentUpload
                  surface="ppe_acknowledgement"
                  parentId={sheet.id}
                  label=""
                  readOnly
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
