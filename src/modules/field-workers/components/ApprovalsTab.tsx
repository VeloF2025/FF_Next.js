/**
 * ApprovalsTab — lists all pending field-worker registrations.
 *
 * Loads data on mount via listPendingFieldWorkers(), renders a table of
 * ApprovalRow components. Rows are removed optimistically after an
 * approve/reject action.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { listPendingFieldWorkers, type PendingWorker } from '../api';
import { ApprovalRow } from './ApprovalRow';
import { log } from '@/lib/logger';

interface ApprovalsTabProps {
  isAdmin: boolean;
}

export function ApprovalsTab({ isAdmin }: ApprovalsTabProps) {
  const [workers, setWorkers] = useState<PendingWorker[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listPendingFieldWorkers();
      setWorkers(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error('[ApprovalsTab] load failed', { error: message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Remove an actioned worker from local state (optimistic update). */
  function handleActioned(workerId: string) {
    setWorkers((prev) => prev?.filter((w) => w.id !== workerId) ?? null);
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold text-neutral-100">Pending Registrations</h2>
        <p className="text-sm text-neutral-400 mt-0.5">
          Field workers who have self-registered and are awaiting approval.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-neutral-400 text-sm">
          <LoadingSpinner />
          Loading…
        </div>
      )}

      {!loading && workers !== null && (
        workers.length === 0 ? (
          <p className="text-neutral-500 text-sm py-6 text-center">
            No pending registrations.
          </p>
        ) : (
          <div className="overflow-x-auto border border-neutral-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-300">
                <tr>
                  <th className="text-left px-3 py-2">Name / Phone</th>
                  <th className="text-left px-3 py-2">Role</th>
                  <th className="text-left px-3 py-2">Declared Project</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-left px-3 py-2">Registered</th>
                  <th className="text-left px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker) => (
                  <ApprovalRow
                    key={worker.id}
                    worker={worker}
                    isAdmin={isAdmin}
                    onActioned={handleActioned}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
