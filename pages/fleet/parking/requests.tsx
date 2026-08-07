/**
 * /fleet/parking/requests — the approval queue.
 *
 * Gated on fleet.parking-requests. A 409 from the decision endpoint is not an
 * error to apologise for: it means the queue on screen has moved on, usually
 * because another approver got there first. So it reloads the list and says
 * what happened rather than leaving a stale card sitting there.
 */
import { useCallback, useEffect, useState } from 'react';

import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { fleetConfig } from '@/modules/navigation';
import { RequestCard } from '@/modules/fleet/parking/web/RequestCard';
import type { DecisionOutcome, PendingRequest } from '@/modules/fleet/parking/types';

export default function ParkingRequestsPage() {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fleet/parking/requests', { credentials: 'same-origin' });
      const payload = await res.json();
      if (!res.ok || payload?.success !== true) {
        throw new Error(payload?.error?.message ?? 'Could not load the queue');
      }
      setRequests(payload.data.requests as PendingRequest[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, outcome: DecisionOutcome, note: string | null) => {
    setDecidingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/fleet/parking/requests/${id}/decide`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, decisionNote: note }),
      });
      const payload = await res.json();
      if (res.status === 409) {
        // Someone else decided it, or the driver lost the vehicle. Neither is
        // a failure of this request — resync and tell the approver why.
        setNotice(payload?.error?.message ?? 'That request has already been decided.');
        await load();
        return;
      }
      if (!res.ok || payload?.success !== true) {
        throw new Error(payload?.error?.message ?? 'Could not save the decision');
      }
      setNotice(outcome === 'approved' ? 'Address approved.' : 'Request declined.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the decision');
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <AppLayout>
      <ModulePage config={fleetConfig} hideTabs>
        <div className="p-6 space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
              Parking requests
            </h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Drivers waiting for an overnight parking address to be approved.
            </p>
          </div>

          {notice && (
            <div className="border border-[var(--ff-border)] bg-[var(--ff-bg-secondary)] rounded-lg px-4 py-3 text-sm text-[var(--ff-text-primary)]">
              {notice}
            </div>
          )}
          {error && (
            <div className="border border-red-500/30 bg-red-500/10 rounded-lg px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {loading && (
            <p className="text-sm text-[var(--ff-text-secondary)]">Loading…</p>
          )}

          {!loading && requests.length === 0 && !error && (
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Nothing waiting. New requests appear here as drivers submit them.
            </p>
          )}

          <div className="space-y-4">
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                deciding={decidingId === request.id}
                onDecide={(outcome, note) => void decide(request.id, outcome, note)}
              />
            ))}
          </div>
        </div>
      </ModulePage>
    </AppLayout>
  );
}
